package repository

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"infranexus/internal/domain"
)

var ErrAuthStore = errors.New("authentication store unavailable")

type authRepository struct {
	redis    *redis.Client
	mu       sync.Mutex
	sessions map[string]domain.Session
	families map[string]tokenFamily
}
type tokenFamily struct {
	refreshID string
	expiresAt time.Time
}
type sessionWire struct {
	ID                string `json:"id"`
	UserID            string `json:"user_id"`
	CreatedAt         int64  `json:"created_at"`
	ExpiresAt         int64  `json:"expires_at"`
	AbsoluteExpiresAt int64  `json:"absolute_expires_at"`
	IdleTimeout       int64  `json:"idle_timeout,omitempty"`
}

func toWire(s domain.Session) sessionWire {
	return sessionWire{s.ID, s.UserID.String(), s.CreatedAt.UnixMilli(), s.ExpiresAt.UnixMilli(), s.AbsoluteExpiresAt.UnixMilli(), s.IdleTimeout}
}
func fromWire(w sessionWire) (domain.Session, error) {
	id, err := uuid.Parse(w.UserID)
	return domain.Session{
		ID:                w.ID,
		UserID:            id,
		CreatedAt:         time.UnixMilli(w.CreatedAt),
		ExpiresAt:         time.UnixMilli(w.ExpiresAt),
		AbsoluteExpiresAt: time.UnixMilli(w.AbsoluteExpiresAt),
		IdleTimeout:       w.IdleTimeout,
	}, err
}
func NewAuthRepository(rdb *redis.Client) domain.AuthRepository {
	return &authRepository{redis: rdb, sessions: make(map[string]domain.Session), families: make(map[string]tokenFamily)}
}
func sessionKey(id string) string { return "infranexus:session:" + id }
func familyKey(id string) string  { return "infranexus:family:" + id }

var saveSessionScript = redis.NewScript(`if ARGV[1] ~= '' then redis.call('DEL', KEYS[2]) end; return redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])`)

func (r *authRepository) SaveSession(ctx context.Context, s domain.Session, oldID string) error {
	if r.redis == nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		delete(r.sessions, oldID)
		if len(r.sessions) >= 4096 {
			for id, old := range r.sessions {
				if !time.Now().Before(old.ExpiresAt) || !time.Now().Before(old.AbsoluteExpiresAt) {
					delete(r.sessions, id)
				}
			}
		}
		if len(r.sessions) >= 4096 {
			return ErrAuthStore
		}
		r.sessions[s.ID] = s
		return nil
	}
	data, err := json.Marshal(toWire(s))
	if err != nil {
		return err
	}
	ttl := time.Until(s.ExpiresAt)
	if ttl <= 0 {
		return ErrAuthStore
	}
	return saveSessionScript.Run(ctx, r.redis, []string{sessionKey(s.ID), sessionKey(oldID)}, oldID, data, ttl.Milliseconds()).Err()
}

// Session records from older versions lack millisecond expiry fields. Reject
// those records instead of failing the script or inventing a new lifetime.
const loadActiveSessionScript = `
local function loadActiveSession(now)
    local v = redis.call('GET', KEYS[1])
    if not v then return nil end
    local ok, s = pcall(cjson.decode, v)
    if not ok or type(s) ~= 'table'
        or type(s.expires_at) ~= 'number'
        or type(s.absolute_expires_at) ~= 'number'
        or s.expires_at <= now or s.absolute_expires_at <= now then
        redis.call('DEL', KEYS[1])
        return nil
    end
    return s
end
`

var renewSessionScript = redis.NewScript(loadActiveSessionScript + `
local now = tonumber(ARGV[1])
local s = loadActiveSession(now)
if not s then return nil end
local idle = tonumber(s.idle_timeout)
if not idle or idle <= 0 then idle = tonumber(ARGV[2]) end
local expiry = math.min(now + idle, s.absolute_expires_at)
s.expires_at = expiry
redis.call('SET', KEYS[1], cjson.encode(s), 'PX', math.max(1, expiry - now))
return cjson.encode(s)
`)

func (r *authRepository) RenewSession(ctx context.Context, id string, now time.Time, idle time.Duration) (*domain.Session, error) {
	if r.redis == nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		s, ok := r.sessions[id]
		if !ok || !now.Before(s.ExpiresAt) || !now.Before(s.AbsoluteExpiresAt) {
			delete(r.sessions, id)
			return nil, nil
		}
		effectiveIdle := idle
		if s.IdleTimeout > 0 {
			effectiveIdle = time.Duration(s.IdleTimeout) * time.Millisecond
		}
		s.ExpiresAt = now.Add(effectiveIdle)
		if s.ExpiresAt.After(s.AbsoluteExpiresAt) {
			s.ExpiresAt = s.AbsoluteExpiresAt
		}
		r.sessions[id] = s
		return &s, nil
	}
	raw, err := renewSessionScript.Run(ctx, r.redis, []string{sessionKey(id)}, now.UnixMilli(), idle.Milliseconds()).Result()
	if errors.Is(err, redis.Nil) || (err == nil && raw == nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	str, ok := raw.(string)
	if !ok {
		return nil, ErrAuthStore
	}
	var w sessionWire
	if err = json.Unmarshal([]byte(str), &w); err != nil {
		return nil, err
	}
	s, err := fromWire(w)
	return &s, err
}

var updateSessionIdleScript = redis.NewScript(loadActiveSessionScript + `
local now = tonumber(ARGV[2])
local s = loadActiveSession(now)
if not s then return 0 end
s.idle_timeout = tonumber(ARGV[1])
local idle = s.idle_timeout
if not idle or idle <= 0 then idle = tonumber(ARGV[3]) end
local expiry = math.min(now + idle, s.absolute_expires_at)
s.expires_at = expiry
redis.call('SET', KEYS[1], cjson.encode(s), 'PX', math.max(1, expiry - now))
return 1
`)

func (r *authRepository) UpdateSessionIdle(ctx context.Context, id string, idleMs int64, defaultIdleMs int64) error {
	if id == "" {
		return nil
	}
	if r.redis == nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		if s, ok := r.sessions[id]; ok {
			s.IdleTimeout = idleMs
			eff := idleMs
			if eff <= 0 {
				eff = defaultIdleMs
			}
			now := time.Now()
			s.ExpiresAt = now.Add(time.Duration(eff) * time.Millisecond)
			if s.ExpiresAt.After(s.AbsoluteExpiresAt) {
				s.ExpiresAt = s.AbsoluteExpiresAt
			}
			r.sessions[id] = s
		}
		return nil
	}
	now := time.Now().UnixMilli()
	return updateSessionIdleScript.Run(ctx, r.redis, []string{sessionKey(id)}, idleMs, now, defaultIdleMs).Err()
}
func (r *authRepository) DeleteSession(ctx context.Context, id string) error {
	if r.redis == nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		delete(r.sessions, id)
		return nil
	}
	return r.redis.Del(ctx, sessionKey(id)).Err()
}
func (r *authRepository) CreateFamily(ctx context.Context, id, refreshID string, expiry time.Time) error {
	if r.redis == nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		if len(r.families) >= 4096 {
			for key, f := range r.families {
				if !time.Now().Before(f.expiresAt) {
					delete(r.families, key)
				}
			}
		}
		if len(r.families) >= 4096 {
			return ErrAuthStore
		}
		r.families[id] = tokenFamily{refreshID, expiry}
		return nil
	}
	ttl := time.Until(expiry)
	if ttl <= 0 {
		return ErrAuthStore
	}
	ok, err := r.redis.SetNX(ctx, familyKey(id), refreshID, ttl).Result()
	if err != nil {
		return err
	}
	if !ok {
		return ErrAuthStore
	}
	return nil
}
func (r *authRepository) CheckFamily(ctx context.Context, id string) (bool, error) {
	if r.redis == nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		f, ok := r.families[id]
		if ok && !time.Now().Before(f.expiresAt) {
			delete(r.families, id)
			return false, nil
		}
		return ok, nil
	}
	n, err := r.redis.Exists(ctx, familyKey(id)).Result()
	return n == 1, err
}

var rotateFamilyScript = redis.NewScript(`local current=redis.call('GET',KEYS[1]); if not current or current~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL'); return 1`)

func (r *authRepository) RotateFamily(ctx context.Context, id, oldID, newID string, expiry time.Time) (bool, error) {
	if r.redis == nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		f, ok := r.families[id]
		if !ok || !time.Now().Before(f.expiresAt) || f.refreshID != oldID {
			return false, nil
		}
		f.refreshID = newID
		r.families[id] = f
		return true, nil
	}
	n, err := rotateFamilyScript.Run(ctx, r.redis, []string{familyKey(id)}, oldID, newID).Int()
	return n == 1, err
}
func (r *authRepository) RevokeFamily(ctx context.Context, id string) error {
	if r.redis == nil {
		r.mu.Lock()
		defer r.mu.Unlock()
		delete(r.families, id)
		return nil
	}
	return r.redis.Del(ctx, familyKey(id)).Err()
}
