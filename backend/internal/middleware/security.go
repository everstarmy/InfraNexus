package middleware

import (
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"

	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func TrustedOrigin(origins []string) fiber.Handler {
	return func(c fiber.Ctx) error {
		if c.Method() == fiber.MethodGet || c.Method() == fiber.MethodHead || c.Method() == fiber.MethodOptions {
			return c.Next()
		}
		if principal, ok := c.Locals("current_principal").(*domain.Principal); ok && principal.FamilyID != "" {
			return c.Next()
		}
		candidate := c.Get("Origin")
		if candidate == "" {
			ref := c.Get("Referer")
			u, err := url.Parse(ref)
			if err == nil && u.Scheme != "" && u.Host != "" {
				candidate = u.Scheme + "://" + u.Host
			}
		}
		if candidate != "" {
			for _, allowed := range origins {
				if candidate == allowed {
					return c.Next()
				}
			}
		}
		return response.Error(c, fiber.StatusForbidden, response.CodePermissionDenied, "请求来源不可信")
	}
}

type rateBucket struct {
	window time.Time
	count  int
}

func LoginRateLimit(limit int) fiber.Handler {
	if limit <= 0 {
		limit = 10
	}
	var mu sync.Mutex
	buckets := make(map[string]rateBucket)
	return func(c fiber.Ctx) error {
		key := strings.TrimSpace(c.IP())
		now := time.Now()
		mu.Lock()
		if len(buckets) > 4096 {
			for k, b := range buckets {
				if now.Sub(b.window) >= time.Minute {
					delete(buckets, k)
				}
			}
			if len(buckets) > 4096 {
				mu.Unlock()
				return response.Error(c, 429, response.CodeRateLimited, "请求过于频繁")
			}
		}
		b := buckets[key]
		if now.Sub(b.window) >= time.Minute {
			b = rateBucket{window: now}
		}
		b.count++
		buckets[key] = b
		mu.Unlock()
		if b.count > limit {
			return response.Error(c, 429, response.CodeRateLimited, "请求过于频繁")
		}
		return c.Next()
	}
}
