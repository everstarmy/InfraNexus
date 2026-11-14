package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"infranexus/internal/core/requestmeta"
	"infranexus/internal/domain"
)

type receivingService struct{ uow domain.ReceivingUnitOfWork }

func NewReceivingService(uow domain.ReceivingUnitOfWork) domain.ReceivingService {
	return &receivingService{uow: uow}
}
func assetErr(reason, message string) error {
	return &domain.ReceivingError{Reason: reason, Message: message}
}
func assetVersion(got, want int64) error {
	if want < 1 {
		return assetErr("VALIDATION_FAILED", "expected_version 必须为正整数")
	}
	if got != want {
		return &domain.ReceivingError{Reason: "VERSION_CONFLICT", Message: "内容已被修改，请重新加载后确认", CurrentVersion: got}
	}
	return nil
}
func assetDecode[T any](raw []byte) (T, error) {
	var in T
	if len(raw) == 0 {
		raw = []byte("{}")
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return in, assetErr("VALIDATION_FAILED", "请求必须是 JSON 对象")
	}
	if err := json.Unmarshal(raw, &in, json.RejectUnknownMembers(true)); err != nil {
		return in, assetErr("VALIDATION_FAILED", "请求字段或格式无效")
	}
	if err := validateReceivingInput(reflect.ValueOf(in)); err != nil {
		return in, err
	}
	return in, nil
}
func assetJSON(v any) (datatypes.JSONType[jsontext.Value], error) {
	b, err := json.Marshal(v)
	return datatypes.NewJSONType(jsontext.Value(b)), err
}
func assetNullJSON() datatypes.JSONType[jsontext.Value] {
	return datatypes.NewJSONType(jsontext.Value("null"))
}
func assetText(v string, maxLen int, required bool) error {
	if len(v) > maxLen || required && strings.TrimSpace(v) == "" {
		return assetErr("VALIDATION_FAILED", "必填内容为空或字段长度超限")
	}
	return nil
}
func assetSN(v *string) (*string, *string, error) {
	if v == nil {
		return nil, nil, nil
	}
	s := strings.TrimSpace(*v)
	if s == "" || len(s) > 128 {
		return nil, nil, assetErr("VALIDATION_FAILED", "序列号必须为 1～128 个 ASCII 字符")
	}
	for _, r := range s {
		if r < 33 || r > 126 {
			return nil, nil, assetErr("VALIDATION_FAILED", "序列号含有不支持的字符")
		}
	}
	return &s, new(strings.ToUpper(s)), nil
}
func assetQ(field string, value any) domain.AssetQuery {
	return domain.AssetQuery{Filters: []domain.AssetFilter{{Field: field, Value: value}}}
}
func assetPage(c domain.ReceivingCall) (domain.AssetQuery, error) {
	q := domain.AssetQuery{Page: 1, PageSize: 20, Search: c.Query["search"]}
	for key, ptr := range map[string]*int{"page": &q.Page, "page_size": &q.PageSize} {
		if s := c.Query[key]; s != "" {
			v, e := strconv.Atoi(s)
			if e != nil || v < 1 {
				return q, assetErr("VALIDATION_FAILED", "分页参数无效")
			}
			*ptr = v
		}
	}
	for key, ptr := range map[string]**time.Time{"created_from": &q.CreatedFrom, "created_to": &q.CreatedTo} {
		if raw := c.Query[key]; raw != "" {
			v, e := time.Parse(time.RFC3339, raw)
			if e != nil {
				return q, assetErr("VALIDATION_FAILED", "时间筛选格式无效")
			}
			*ptr = &v
		}
	}
	if q.CreatedFrom != nil && q.CreatedTo != nil && q.CreatedFrom.After(*q.CreatedTo) {
		return q, assetErr("VALIDATION_FAILED", "开始时间不得晚于结束时间")
	}
	if q.Page > 1000000 {
		return q, assetErr("VALIDATION_FAILED", "分页超出范围")
	}
	if q.PageSize > 100 || len(q.Search) > 128 {
		return q, assetErr("VALIDATION_FAILED", "分页或搜索超过限制")
	}
	return q, nil
}
func assetAll[T any](ctx context.Context, repo domain.AssetRepository[T], field string, value any) ([]T, error) {
	p, e := repo.List(ctx, assetQ(field, value))
	return p.Items, e
}
func assetOnly[T any](ctx context.Context, repo domain.AssetRepository[T], field string, value any) (*T, error) {
	p, e := repo.List(ctx, assetQ(field, value))
	if e != nil {
		return nil, e
	}
	if len(p.Items) != 1 {
		return nil, gorm.ErrRecordNotFound
	}
	return &p.Items[0], nil
}
func assetReadOperation(op string) bool {
	last := op[strings.LastIndex(op, ".")+1:]
	return last == "list" || last == "get" || last == "history" || last == "references" || last == "preview" || last == "metadata" || last == "result" || last == "content" || last == "diff"
}
func (s *receivingService) Execute(ctx context.Context, c domain.ReceivingCall) (out any, err error) {
	read := assetReadOperation(c.Operation)
	run := func(r domain.ReceivingRepositories) error {
		var e error
		if read {
			out, e = s.dispatch(ctx, r, c)
			return e
		}
		if c.ActorID == uuid.Nil {
			return assetErr("PERMISSION_DENIED", "缺少操作身份")
		}
		scope := receivingScope(c)
		canonical := append(jsontext.Value(nil), c.Body...)
		if len(canonical) == 0 {
			canonical = jsontext.Value("{}")
		}
		if e := canonical.Canonicalize(jsontext.CanonicalizeRawInts(false)); e != nil {
			return assetErr("VALIDATION_FAILED", "请求 JSON 无效")
		}
		fileHash := sha256.Sum256(c.File)
		digestInput, e := json.Marshal(struct {
			Body     jsontext.Value `json:"body"`
			FileHash string         `json:"file_hash"`
			Filename string         `json:"filename"`
		}{canonical, hex.EncodeToString(fileHash[:]), c.Filename})
		if e != nil {
			return e
		}
		digestBytes := sha256.Sum256(digestInput)
		digest := hex.EncodeToString(digestBytes[:])
		if c.Key != "" {
			if len(c.Key) > 128 {
				return assetErr("VALIDATION_FAILED", "幂等键过长")
			}
			for _, ch := range c.Key {
				if ch < 33 || ch > 126 {
					return assetErr("VALIDATION_FAILED", "幂等键格式无效")
				}
			}
			q := assetQ("actor_user_id", c.ActorID)
			q.Filters = append(q.Filters, domain.AssetFilter{Field: "operation", Value: c.Operation}, domain.AssetFilter{Field: "target_scope", Value: scope}, domain.AssetFilter{Field: "key", Value: c.Key})
			found, e := r.AssetCommandReceipts.List(ctx, q)
			if e != nil {
				return e
			}
			if len(found.Items) > 0 {
				v := found.Items[0]
				if v.Digest != digest {
					return assetErr("IDEMPOTENCY_KEY_REUSED", "同一幂等键不能用于不同请求")
				}
				out = v.Result.Data()
				return nil
			}
		}
		out, e = s.dispatch(ctx, r, c)
		if e != nil {
			return e
		}
		resourceID := c.ID
		if resourceID == uuid.Nil {
			var identity struct {
				ID uuid.UUID `json:"id"`
			}
			b, e := json.Marshal(out)
			if e != nil {
				return e
			}
			if e = json.Unmarshal(b, &identity); e != nil {
				return e
			}
			resourceID = identity.ID
		}
		resultJSON, e := assetJSON(out)
		if e != nil {
			return e
		}
		action := domain.AssetAction{Kind: c.Operation, ResourceID: resourceID, ActorUserID: c.ActorID, RequestID: requestmeta.RequestID(ctx), Before: assetNullJSON(), After: resultJSON}
		if e = r.AssetActions.Create(ctx, &action); e != nil {
			return e
		}
		if c.Key != "" {
			receipt := domain.AssetCommandReceipt{ActorUserID: c.ActorID, Operation: c.Operation, TargetScope: scope, Key: c.Key, Digest: digest, Result: resultJSON}
			return r.AssetCommandReceipts.Create(ctx, &receipt)
		}
		return nil
	}
	if read {
		err = s.uow.Read(ctx, run)
	} else {
		err = s.uow.Write(ctx, c.ActorID.String()+":"+c.Operation+":"+c.ID.String()+":"+c.Key, run)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = assetErr("RESOURCE_NOT_FOUND", "记录不存在")
	}
	if pg, ok := errors.AsType[*pgconn.PgError](err); ok {
		switch pg.Code {
		case "23505":
			reason := "RESOURCE_CONFLICT"
			if strings.Contains(pg.ConstraintName, "sn") {
				reason = "SERIAL_CONFLICT"
			}
			err = assetErr(reason, "记录已存在或序列号重复")
		case "23503":
			err = assetErr("RESOURCE_REFERENCED", "记录被引用或关联对象不存在")
		case "23514":
			err = assetErr("STATE_CONFLICT", "操作不符合数据状态或一致性约束")
		}
	}
	return out, err
}
func (s *receivingService) dispatch(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall) (any, error) {
	switch {
	case c.Operation == "metadata":
		return receivingMetadata(), nil
	case strings.HasPrefix(c.Operation, "model."):
		return s.model(ctx, r, c)
	case strings.HasPrefix(c.Operation, "order."):
		return s.order(ctx, r, c)
	case strings.HasPrefix(c.Operation, "receipt."):
		return s.receipt(ctx, r, c)
	case strings.HasPrefix(c.Operation, "asset."):
		return s.asset(ctx, r, c)
	default:
		return nil, assetErr("RESOURCE_NOT_FOUND", "接口不存在")
	}
}

type assetEdit struct {
	ExpectedVersion int64          `json:"expected_version"`
	Data            jsontext.Value `json:"data"`
}
type assetCommand struct {
	ExpectedVersion int64  `json:"expected_version"`
	Reason          string `json:"reason"`
	Status          int    `json:"status"`
}

func assetCompany(ctx context.Context, r domain.ReceivingRepositories, id uuid.UUID, kind int) error {
	v, e := r.Companies.Get(ctx, id, true)
	if e != nil {
		return e
	}
	if v.Status != 1 || v.Type != kind && v.Type != 3 {
		return assetErr("REFERENCE_DISABLED", "厂商身份不匹配或已停用")
	}
	return nil
}
func assetLocation(ctx context.Context, r domain.ReceivingRepositories, in *domain.AssetLocation) (*uuid.UUID, error) {
	if in == nil {
		return nil, nil
	}
	w, e := r.Warehouses.Get(ctx, in.WarehouseID, true)
	if e != nil {
		return nil, e
	}
	if w.Status != 1 {
		return nil, assetErr("REFERENCE_DISABLED", "库房已停用")
	}
	row := domain.CustodyLocation{Kind: "warehouse", WarehouseID: &w.ID}
	field := "warehouse_id"
	id := w.ID
	if in.BinID != nil {
		b, e := r.Bins.Get(ctx, *in.BinID, true)
		if e != nil {
			return nil, e
		}
		s, e := r.Shelves.Get(ctx, b.ShelfID, true)
		if e != nil {
			return nil, e
		}
		if b.Status != 1 || s.Status != 1 || s.WarehouseID != w.ID {
			return nil, assetErr("REFERENCE_DISABLED", "库位不属于该库房或已停用")
		}
		row = domain.CustodyLocation{Kind: "bin", BinID: &b.ID}
		field = "bin_id"
		id = b.ID
	}
	p, e := r.CustodyLocations.List(ctx, assetQ(field, id))
	if e != nil {
		return nil, e
	}
	if len(p.Items) > 0 {
		return &p.Items[0].ID, nil
	}
	if e = r.CustodyLocations.Create(ctx, &row); e != nil {
		return nil, e
	}
	return &row.ID, nil
}
func assetLocationView(ctx context.Context, r domain.ReceivingRepositories, id uuid.UUID) (*domain.AssetLocation, error) {
	l, e := r.CustodyLocations.Get(ctx, id, false)
	if e != nil {
		return nil, e
	}
	out := &domain.AssetLocation{}
	if l.BinID != nil {
		b, e := r.Bins.Get(ctx, *l.BinID, false)
		if e != nil {
			return nil, e
		}
		s, e := r.Shelves.Get(ctx, b.ShelfID, false)
		if e != nil {
			return nil, e
		}
		out.WarehouseID = s.WarehouseID
		out.BinID = &b.ID
		out.BinName = b.Name
		out.Path = s.Name + " / " + b.Name
	} else {
		out.WarehouseID = *l.WarehouseID
	}
	w, e := r.Warehouses.Get(ctx, out.WarehouseID, false)
	if e != nil {
		return nil, e
	}
	out.WarehouseName = w.Name
	out.Path = strings.TrimSuffix(w.Name+" / "+out.Path, " / ")
	return out, nil
}
func assetNewID() (uuid.UUID, error) { return uuid.NewV7() }
func assetNumber(prefix string) string {
	return prefix + "-" + strings.ReplaceAll(uuid.NewString(), "-", "")
}
func assetCommandInput(c domain.ReceivingCall) (assetCommand, error) {
	if strings.HasSuffix(c.Operation, ".delete") {
		n, e := strconv.ParseInt(c.Query["expected_version"], 10, 64)
		if e != nil {
			return assetCommand{}, assetErr("VALIDATION_FAILED", "缺少版本")
		}
		return assetCommand{ExpectedVersion: n}, nil
	}
	return assetDecode[assetCommand](c.Body)
}
func assetHistory(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall) (any, error) {
	q, e := assetPage(c)
	if e != nil {
		return nil, e
	}
	q.Filters = []domain.AssetFilter{{Field: "resource_id", Value: c.ID}}
	return r.AssetActions.List(ctx, q)
}
func assetTimeValid(t *time.Time) bool { return t != nil && !t.IsZero() && !t.After(time.Now().UTC()) }
func assetFilterQuery(c domain.ReceivingCall, fields ...string) (domain.AssetQuery, error) {
	q, e := assetPage(c)
	if e != nil {
		return q, e
	}
	for _, f := range fields {
		if v := c.Query[f]; v != "" {
			if strings.HasSuffix(f, "_id") {
				id, e := uuid.Parse(v)
				if e != nil {
					return q, assetErr("VALIDATION_FAILED", "筛选 ID 无效")
				}
				q.Filters = append(q.Filters, domain.AssetFilter{Field: f, Value: id})
			} else {
				if f == "status" && v != "1" && v != "2" {
					return q, assetErr("VALIDATION_FAILED", "status 须为 1 或 2")
				}
				q.Filters = append(q.Filters, domain.AssetFilter{Field: f, Value: v})
			}
		}
	}
	return q, nil
}

func receivingScope(c domain.ReceivingCall) string {
	var ids []string
	for _, id := range []uuid.UUID{c.ID, c.ChildID, c.ItemID, c.ComponentID} {
		if id != uuid.Nil {
			ids = append(ids, id.String())
		}
	}
	if len(ids) == 0 {
		return "collection"
	}
	return strings.Join(ids, ":")
}

// Validate bounded text before SQL so malformed input is never a driver error.
func validateReceivingInput(v reflect.Value) error {
	if !v.IsValid() {
		return nil
	}
	if v.Kind() == reflect.Pointer {
		if v.IsNil() {
			return nil
		}
		return validateReceivingInput(v.Elem())
	}
	if v.Kind() == reflect.Slice {
		if v.Type().Elem().Kind() == reflect.Uint8 {
			return nil
		}
		if v.Len() > 4096 {
			return assetErr("LIMIT_EXCEEDED", "明细数量超限")
		}
		for i := 0; i < v.Len(); i++ {
			if e := validateReceivingInput(v.Index(i)); e != nil {
				return e
			}
		}
		return nil
	}
	if v.Kind() != reflect.Struct {
		return nil
	}
	for i := 0; i < v.NumField(); i++ {
		f := v.Field(i)
		field := v.Type().Field(i)
		if !field.IsExported() {
			continue
		}
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if name == "data" && f.Kind() == reflect.Slice && len(bytes.TrimSpace(f.Bytes())) == 0 {
			return assetErr("VALIDATION_FAILED", "缺少 data")
		}
		value := f
		if value.Kind() == reflect.Pointer {
			if value.IsNil() {
				continue
			}
			value = value.Elem()
		}
		if value.Kind() == reflect.String {
			limit := 1024
			switch name {
			case "name", "part_no", "model_name", "serial_number", "external_order_no":
				limit = 128
			case "stable_key", "slot_key", "interface", "form_factor", "socket", "protocol", "connector", "input_type":
				limit = 64
			case "kind", "category", "state", "status", "mounting_type", "initial_placement", "inspection_result", "source_kind", "tracking_mode", "unit", "memory_generation", "media_type", "side":
				limit = 32
			}
			if len(value.String()) > limit || strings.ContainsRune(value.String(), 0) {
				return assetErr("VALIDATION_FAILED", "字段长度超限或含有非法字符")
			}
		}
		if e := validateReceivingInput(f); e != nil {
			return e
		}
	}
	return nil
}
