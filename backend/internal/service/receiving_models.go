package service

import (
	"context"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"

	"infranexus/internal/domain"
)

type catalogInput struct {
	ManufacturerID uuid.UUID `json:"manufacturer_id"`
	Name           string    `json:"name"`
	PartNo         string    `json:"part_no"`
	ModelName      string    `json:"model_name"`
	Kind           string    `json:"kind"`
	Category       string    `json:"category"`
	Description    string    `json:"description"`
}
type catalogNameInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}
type revisionInput struct {
	Name               *string          `json:"name"`
	Description        *string          `json:"description"`
	TrackingMode       string           `json:"tracking_mode"`
	Unit               string           `json:"unit"`
	MountingType       string           `json:"mounting_type"`
	HeightU            *int             `json:"height_u"`
	RatedPowerW        *int             `json:"rated_power_w"`
	Spec               domain.AssetSpec `json:"spec"`
	Slots              []slotInput      `json:"slots"`
	Ports              []portInput      `json:"ports"`
	StandardComponents []standardInput  `json:"standard_components"`
	Compatibilities    []compatInput    `json:"compatibilities"`
}
type slotInput struct {
	ID         uuid.UUID            `json:"id,omitempty"`
	StableKey  string               `json:"stable_key"`
	Name       string               `json:"name"`
	Kind       string               `json:"kind"`
	Interface  *string              `json:"interface"`
	FormFactor *string              `json:"form_factor"`
	Position   domain.AssetPosition `json:"position"`
}
type portInput struct {
	ID         uuid.UUID `json:"id,omitempty"`
	StableKey  string    `json:"stable_key"`
	Name       string    `json:"name"`
	Protocol   string    `json:"protocol"`
	Connector  string    `json:"connector"`
	SpeedMbps  *int64    `json:"speed_mbps"`
	SourceKind string    `json:"source_kind"`
	SlotKey    *string   `json:"slot_key"`
}
type standardInput struct {
	ID                  uuid.UUID `json:"id,omitempty"`
	PartModelRevisionID uuid.UUID `json:"part_model_revision_id"`
	SlotKey             *string   `json:"slot_key"`
	Quantity            int       `json:"quantity"`
	Required            bool      `json:"required"`
}
type compatInput struct {
	ID                  uuid.UUID `json:"id,omitempty"`
	PartModelRevisionID uuid.UUID `json:"part_model_revision_id"`
	SlotKey             *string   `json:"slot_key"`
	Status              string    `json:"status"`
	EvidenceNote        string    `json:"evidence_note"`
}
type revisionView struct {
	domain.CatalogRevision
	Slots              []domain.ModelSlot          `json:"slots"`
	Ports              []domain.ModelPort          `json:"ports"`
	StandardComponents []domain.ModelComponent     `json:"standard_components"`
	Compatibilities    []domain.ModelCompatibility `json:"compatibilities"`
}

func catalogRepos(r domain.ReceivingRepositories, component bool) (domain.AssetRepository[domain.CatalogModel], domain.AssetRepository[domain.CatalogRevision]) {
	if component {
		return r.ComponentModels, r.ComponentRevisions
	}
	return r.CatalogModels, r.CatalogRevisions
}
func catalogPublished(ctx context.Context, r domain.ReceivingRepositories, id uuid.UUID, component bool) (*domain.CatalogModel, *domain.CatalogRevision, error) {
	models, revs := catalogRepos(r, component)
	v, e := revs.Get(ctx, id, true)
	if e != nil {
		return nil, nil, e
	}
	m, e := models.Get(ctx, v.ModelID, true)
	if e != nil {
		return nil, nil, e
	}
	if m.Status != 1 {
		return nil, nil, assetErr("REFERENCE_DISABLED", "型号已停用")
	}
	if v.State != "published" {
		return nil, nil, assetErr("MODEL_NOT_PUBLISHED", "型号版本尚未发布")
	}
	if e = assetCompany(ctx, r, m.ManufacturerID, 1); e != nil {
		return nil, nil, e
	}
	return m, v, nil
}
func revisionDetails(ctx context.Context, r domain.ReceivingRepositories, v domain.CatalogRevision, component bool) (revisionView, error) {
	out := revisionView{CatalogRevision: v, Slots: []domain.ModelSlot{}, Ports: []domain.ModelPort{}, StandardComponents: []domain.ModelComponent{}, Compatibilities: []domain.ModelCompatibility{}}
	if component {
		return out, nil
	}
	var e error
	if out.Slots, e = assetAll(ctx, r.ModelSlots, "revision_id", v.ID); e != nil {
		return out, e
	}
	if out.Ports, e = assetAll(ctx, r.ModelPorts, "revision_id", v.ID); e != nil {
		return out, e
	}
	if out.StandardComponents, e = assetAll(ctx, r.ModelComponents, "revision_id", v.ID); e != nil {
		return out, e
	}
	out.Compatibilities, e = assetAll(ctx, r.ModelCompatibilitys, "revision_id", v.ID)
	return out, e
}
func (s *receivingService) model(ctx context.Context, r domain.ReceivingRepositories, c domain.ReceivingCall) (any, error) {
	bits := strings.Split(c.Operation, ".")
	component := bits[1] == "component"
	op := strings.Join(bits[2:], ".")
	models, revs := catalogRepos(r, component)
	if op == "list" {
		q, e := assetFilterQuery(c, "manufacturer_id", "status", "kind", "category")
		if e != nil {
			return nil, e
		}
		rows, e := models.List(ctx, q)
		if e != nil {
			return nil, e
		}
		out := domain.AssetRows[catalogView]{Items: []catalogView{}, Total: rows.Total, Page: rows.Page, PageSize: rows.PageSize}
		for _, m := range rows.Items {
			v, e := catalogDetails(ctx, revs, m)
			if e != nil {
				return nil, e
			}
			out.Items = append(out.Items, v)
		}
		return out, nil
	}
	if op == "create" {
		in, e := assetDecode[catalogInput](c.Body)
		if e != nil {
			return nil, e
		}
		if e = assetText(in.Name, 128, true); e != nil {
			return nil, e
		}
		if e = assetText(in.Description, 1024, false); e != nil {
			return nil, e
		}
		if e = assetCompany(ctx, r, in.ManufacturerID, 1); e != nil {
			return nil, e
		}
		m := domain.CatalogModel{ManufacturerID: in.ManufacturerID, Name: strings.TrimSpace(in.Name), Description: in.Description, Status: 1, PartNo: strings.TrimSpace(in.PartNo), ModelName: strings.TrimSpace(in.ModelName), Kind: in.Kind, Category: in.Category}
		key := m.ModelName
		if component {
			key = m.PartNo
			if m.ModelName != "" || m.Category != "" || !slices.Contains(componentKinds, m.Kind) {
				return nil, assetErr("VALIDATION_FAILED", "组件类别或型号字段无效")
			}
		} else if m.PartNo != "" || m.Kind != "" || !slices.Contains(deviceCategories, m.Category) {
			return nil, assetErr("VALIDATION_FAILED", "设备类别或型号字段无效")
		}
		if e = assetText(key, 128, true); e != nil {
			return nil, e
		}
		m.NormalizedKey = strings.ToUpper(key)
		return &m, models.Create(ctx, &m)
	}
	m, e := models.Get(ctx, c.ID, !assetReadOperation(c.Operation))
	if e != nil {
		return nil, e
	}
	switch op {
	case "get":
		return catalogDetails(ctx, revs, *m)
	case "history":
		return assetHistory(ctx, r, c)
	case "references":
		p, e := revs.List(ctx, assetQ("model_id", m.ID))
		return struct {
			Revisions int64 `json:"revisions"`
		}{p.Total}, e
	case "update":
		edit, e := assetDecode[assetEdit](c.Body)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(m.Version, edit.ExpectedVersion); e != nil {
			return nil, e
		}
		in, e := assetDecode[catalogNameInput](edit.Data)
		if e != nil {
			return nil, e
		}
		if e = assetText(in.Name, 128, true); e != nil {
			return nil, e
		}
		if e = assetText(in.Description, 1024, false); e != nil {
			return nil, e
		}
		m.Name = strings.TrimSpace(in.Name)
		m.Description = in.Description
		m.Version++
		return m, models.Save(ctx, m)
	case "status", "delete":
		in, e := assetCommandInput(c)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(m.Version, in.ExpectedVersion); e != nil {
			return nil, e
		}
		if op == "delete" {
			p, e := revs.List(ctx, assetQ("model_id", m.ID))
			if e != nil {
				return nil, e
			}
			if p.Total > 0 {
				return nil, assetErr("RESOURCE_REFERENCED", "请先处理模型版本")
			}
			return struct {
				Deleted bool `json:"deleted"`
			}{true}, models.Delete(ctx, m.ID)
		}
		if in.Status != 1 && in.Status != 2 {
			return nil, assetErr("VALIDATION_FAILED", "状态无效")
		}
		m.Status = in.Status
		m.Version++
		return m, models.Save(ctx, m)
	case "revisions.list":
		q, e := assetPage(c)
		if e != nil {
			return nil, e
		}
		q.Filters = []domain.AssetFilter{{Field: "model_id", Value: m.ID}}
		if v := c.Query["state"]; v != "" {
			q.Filters = append(q.Filters, domain.AssetFilter{Field: "state", Value: v})
		}
		if component {
			return revs.List(ctx, q)
		}
		return listDeviceRevisions(ctx, r, c, *m, q)
	case "revisions.create":
		in, e := assetDecode[struct {
			FromRevisionID *uuid.UUID `json:"from_revision_id"`
		}](c.Body)
		if e != nil {
			return nil, e
		}
		all, e := assetAll(ctx, revs, "model_id", m.ID)
		if e != nil {
			return nil, e
		}
		next := m.LastRevisionNo + 1
		for _, v := range all {
			next = max(next, v.RevisionNo+1)
		}
		v := domain.CatalogRevision{ModelID: m.ID, RevisionNo: next, State: "draft", Spec: datatypes.NewJSONType(domain.AssetSpec{SchemaVersion: 1})}
		v.Status = domain.StatusEnabled
		if !component {
			v.Name = "版本 " + strconv.Itoa(next)
		}
		if component {
			v.TrackingMode = "individual"
			v.Unit = "piece"
		}
		var copyView *revisionView
		if in.FromRevisionID != nil {
			src, e := revs.Get(ctx, *in.FromRevisionID, false)
			if e != nil {
				return nil, e
			}
			if src.ModelID != m.ID {
				return nil, assetErr("RESOURCE_NOT_FOUND", "版本不属于该型号")
			}
			details, e := revisionDetails(ctx, r, *src, component)
			if e != nil {
				return nil, e
			}
			copyView = &details
			v.TrackingMode = src.TrackingMode
			v.Unit = src.Unit
			v.MountingType = src.MountingType
			v.Description = src.Description
			v.HeightU = src.HeightU
			v.RatedPowerW = src.RatedPowerW
			v.Spec = src.Spec
		}
		if e = revs.Create(ctx, &v); e != nil {
			return nil, e
		}
		m.LastRevisionNo = next
		m.Version++
		if e = models.Save(ctx, m); e != nil {
			return nil, e
		}
		if copyView != nil && !component {
			if e = copyTemplates(ctx, r, v.ID, *copyView); e != nil {
				return nil, e
			}
		}
		return revisionDetails(ctx, r, v, component)
	}
	v, e := revs.Get(ctx, c.ChildID, !assetReadOperation(c.Operation))
	if e != nil {
		return nil, e
	}
	if v.ModelID != m.ID {
		return nil, assetErr("RESOURCE_NOT_FOUND", "版本不属于该型号")
	}
	if op == "revisions.get" {
		return revisionDetails(ctx, r, *v, component)
	}
	if !component {
		switch op {
		case "revisions.status":
			return setDeviceRevisionStatus(ctx, r, c, v)
		case "revisions.compatible.list":
			return listCompatibleComponents(ctx, r, c, *v)
		}
	}
	if v.State != "draft" {
		return nil, assetErr("IMMUTABLE_RECORD", "已发布版本不能修改")
	}
	if op == "revisions.update" {
		edit, e := assetDecode[assetEdit](c.Body)
		if e != nil {
			return nil, e
		}
		if e = assetVersion(v.Version, edit.ExpectedVersion); e != nil {
			return nil, e
		}
		in, e := assetDecode[revisionInput](edit.Data)
		if e != nil {
			return nil, e
		}
		if e = validateAssetSpec(in.Spec, m.Kind, component); e != nil {
			return nil, e
		}
		if component {
			if in.TrackingMode != "individual" || in.Unit != "piece" || len(in.Slots)+len(in.Ports)+len(in.StandardComponents)+len(in.Compatibilities) > 0 || in.MountingType != "" {
				return nil, assetErr("VALIDATION_FAILED", "组件版本仅支持逐件规格")
			}
			v.TrackingMode = in.TrackingMode
			v.Unit = in.Unit
		} else {
			if !slices.Contains([]string{"rack", "blade", "standalone"}, in.MountingType) || in.MountingType == "rack" && (in.HeightU == nil || *in.HeightU < 1) || in.MountingType != "rack" && in.HeightU != nil || in.RatedPowerW != nil && *in.RatedPowerW <= 0 {
				return nil, assetErr("VALIDATION_FAILED", "安装形态、高度或功率无效")
			}
			if in.Name != nil {
				v.Name = strings.TrimSpace(*in.Name)
			}
			if in.Description != nil {
				v.Description = *in.Description
			}
			if e = assetText(v.Name, 128, true); e != nil {
				return nil, e
			}
			if e = assetText(v.Description, 1024, false); e != nil {
				return nil, e
			}
			v.MountingType = in.MountingType
			v.HeightU = in.HeightU
			v.RatedPowerW = in.RatedPowerW
			if e = replaceTemplates(ctx, r, v.ID, in); e != nil {
				return nil, e
			}
		}
		v.Spec = datatypes.NewJSONType(in.Spec)
		v.Version++
		if e = revs.Save(ctx, v); e != nil {
			return nil, e
		}
		return revisionDetails(ctx, r, *v, component)
	}
	in, e := assetCommandInput(c)
	if e != nil {
		return nil, e
	}
	if e = assetVersion(v.Version, in.ExpectedVersion); e != nil {
		return nil, e
	}
	if op == "revisions.delete" {
		if !component {
			if e = clearTemplates(ctx, r, v.ID); e != nil {
				return nil, e
			}
		}
		return struct {
			Deleted bool `json:"deleted"`
		}{true}, revs.Delete(ctx, v.ID)
	}
	if op != "revisions.publish" {
		return nil, assetErr("RESOURCE_NOT_FOUND", "未知模型操作")
	}
	if m.Status != 1 {
		return nil, assetErr("REFERENCE_DISABLED", "型号已停用")
	}
	if e = assetCompany(ctx, r, m.ManufacturerID, 1); e != nil {
		return nil, e
	}
	if e = validateAssetSpec(v.Spec.Data(), m.Kind, component); e != nil {
		return nil, e
	}
	if !component {
		if !slices.Contains([]string{"rack", "blade", "standalone"}, v.MountingType) {
			return nil, assetErr("VALIDATION_FAILED", "请填写安装形态")
		}
		details, e := revisionDetails(ctx, r, *v, false)
		if e != nil {
			return nil, e
		}
		for _, b := range details.StandardComponents {
			if _, _, e = catalogPublished(ctx, r, b.PartModelRevisionID, true); e != nil {
				return nil, e
			}
			if e = componentCompatible(ctx, r, v.ID, b.PartModelRevisionID, b.SlotKey); e != nil {
				return nil, e
			}
		}
		for _, comp := range details.Compatibilities {
			if comp.Status == "confirmed" {
				comp.ConfirmedBy = &c.ActorID
				comp.ConfirmedAt = new(time.Now().UTC())
				if e = r.ModelCompatibilitys.Save(ctx, &comp); e != nil {
					return nil, e
				}
			}
		}
	}
	v.State = "published"
	v.PublishedAt = new(time.Now().UTC())
	v.PublishedBy = &c.ActorID
	v.Version++
	if e = revs.Save(ctx, v); e != nil {
		return nil, e
	}
	return revisionDetails(ctx, r, *v, component)
}

var componentKinds = []string{"cpu", "memory", "disk", "nic", "hba", "power_supply", "fan", "controller", "optical_module", "other"}
var deviceCategories = []string{"server", "storage", "fc_switch", "network_switch", "other"}
var specFields = map[string][]string{
	"memory": {"capacity_bytes", "memory_generation", "speed_mt_s", "ecc"}, "disk": {"capacity_bytes", "interface", "media_type", "form_factor"}, "cpu": {"socket", "cores", "threads", "base_frequency_mhz"}, "nic": {"protocol", "port_count", "speed_mbps", "interface"}, "hba": {"protocol", "port_count", "speed_mbps", "interface"}, "power_supply": {"rated_power_w", "input_type"}, "fan": {"form_factor", "rated_power_w"}, "controller": {"interface", "cache_bytes", "has_nonvolatile_cache"}, "optical_module": {"protocol", "connector", "speed_mbps", "wavelength_nm"}, "other": {"description"}, "device": {"width_mm", "depth_mm", "weight_kg", "description"},
}

func validateAssetSpec(in domain.AssetSpec, kind string, component bool) error {
	if in.SchemaVersion != 1 {
		return assetErr("VALIDATION_FAILED", "不支持的规格结构版本")
	}
	if !component {
		kind = "device"
	}
	fields := specFields[kind]
	v := reflect.ValueOf(in)
	typ := v.Type()
	for i := 1; i < v.NumField(); i++ {
		f := v.Field(i)
		if f.IsNil() {
			continue
		}
		name := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
		if !slices.Contains(fields, name) {
			return assetErr("VALIDATION_FAILED", "规格字段不适用于该型号类别")
		}
		x := f.Elem()
		switch x.Kind() {
		case reflect.String:
			if len(x.String()) > 1024 || strings.TrimSpace(x.String()) == "" {
				return assetErr("VALIDATION_FAILED", "规格文本无效")
			}
		case reflect.Int, reflect.Int64:
			if x.Int() < 0 || x.Int() == 0 && name != "cache_bytes" || x.Int() > 9007199254740991 {
				return assetErr("VALIDATION_FAILED", "规格数值无效")
			}
		case reflect.Float64:
			if x.Float() <= 0 {
				return assetErr("VALIDATION_FAILED", "规格数值无效")
			}
		}
	}
	if kind == "memory" && (in.CapacityBytes == nil || in.MemoryGeneration == nil || !slices.Contains([]string{"DDR3", "DDR4", "DDR5"}, *in.MemoryGeneration) || in.SpeedMTS == nil) {
		return assetErr("VALIDATION_FAILED", "内存容量、代际和速率必填")
	}
	if kind == "disk" && (in.CapacityBytes == nil || in.Interface == nil || in.MediaType == nil || !slices.Contains([]string{"SATA", "SAS", "NVMe"}, *in.Interface) || !slices.Contains([]string{"HDD", "SSD"}, *in.MediaType)) {
		return assetErr("VALIDATION_FAILED", "硬盘容量、接口和介质类型必填")
	}
	if in.Cores != nil && in.Threads != nil && *in.Threads < *in.Cores {
		return assetErr("VALIDATION_FAILED", "线程数不能小于核心数")
	}
	return nil
}
func clearAssetChildren[T any](ctx context.Context, repo domain.AssetRepository[T], field string, id uuid.UUID, getID func(T) uuid.UUID) error {
	rows, e := assetAll(ctx, repo, field, id)
	if e != nil {
		return e
	}
	for _, row := range rows {
		if e = repo.Delete(ctx, getID(row)); e != nil {
			return e
		}
	}
	return nil
}
func clearTemplates(ctx context.Context, r domain.ReceivingRepositories, id uuid.UUID) error {
	if e := clearAssetChildren(ctx, r.ModelComponents, "revision_id", id, func(v domain.ModelComponent) uuid.UUID { return v.ID }); e != nil {
		return e
	}
	if e := clearAssetChildren(ctx, r.ModelCompatibilitys, "revision_id", id, func(v domain.ModelCompatibility) uuid.UUID { return v.ID }); e != nil {
		return e
	}
	if e := clearAssetChildren(ctx, r.ModelPorts, "revision_id", id, func(v domain.ModelPort) uuid.UUID { return v.ID }); e != nil {
		return e
	}
	return clearAssetChildren(ctx, r.ModelSlots, "revision_id", id, func(v domain.ModelSlot) uuid.UUID { return v.ID })
}
func replaceTemplates(ctx context.Context, r domain.ReceivingRepositories, id uuid.UUID, in revisionInput) error {
	if len(in.Slots)+len(in.Ports)+len(in.StandardComponents)+len(in.Compatibilities) > 4096 {
		return assetErr("LIMIT_EXCEEDED", "模板超过 4096 项")
	}
	// ID ownership is checked before deletion, so foreign IDs cannot be moved.
	old, e := r.CatalogRevisions.Get(ctx, id, false)
	if e != nil {
		return e
	}
	view, e := revisionDetails(ctx, r, *old, false)
	if e != nil {
		return e
	}
	owned := map[uuid.UUID]string{}
	for _, v := range view.Slots {
		owned[v.ID] = "slot"
	}
	for _, v := range view.Ports {
		owned[v.ID] = "port"
	}
	for _, v := range view.StandardComponents {
		owned[v.ID] = "component"
	}
	for _, v := range view.Compatibilities {
		owned[v.ID] = "compatibility"
	}
	checkID := func(id uuid.UUID, kind string) error {
		if id != uuid.Nil && owned[id] != kind {
			return assetErr("RESOURCE_NOT_FOUND", "子项不属于该版本")
		}
		return nil
	}
	for _, v := range in.Slots {
		if e = checkID(v.ID, "slot"); e != nil {
			return e
		}
	}
	for _, v := range in.Ports {
		if e = checkID(v.ID, "port"); e != nil {
			return e
		}
	}
	for _, v := range in.StandardComponents {
		if e = checkID(v.ID, "component"); e != nil {
			return e
		}
	}
	for _, v := range in.Compatibilities {
		if e = checkID(v.ID, "compatibility"); e != nil {
			return e
		}
	}
	if e = clearTemplates(ctx, r, id); e != nil {
		return e
	}
	slots := map[string]bool{}
	for _, v := range in.Slots {
		if e = assetText(v.StableKey, 64, true); e != nil {
			return e
		}
		if e = assetText(v.Name, 128, true); e != nil {
			return e
		}
		if !slices.Contains(componentKinds, v.Kind) || slots[v.StableKey] {
			return assetErr("VALIDATION_FAILED", "槽位类型无效或重复")
		}
		slots[v.StableKey] = true
		if v.Position.SchemaVersion != 1 {
			return assetErr("VALIDATION_FAILED", "槽位位置版本无效")
		}
		row := domain.ModelSlot{RevisionID: id, StableKey: v.StableKey, Name: v.Name, Kind: v.Kind, Interface: v.Interface, FormFactor: v.FormFactor, Position: datatypes.NewJSONType(v.Position)}
		row.ID = v.ID
		if e = r.ModelSlots.Create(ctx, &row); e != nil {
			return e
		}
	}
	validSlot := func(key *string) bool { return key == nil || slots[*key] }
	for _, v := range in.Ports {
		if !validSlot(v.SlotKey) || v.SourceKind != "fixed" && v.SourceKind != "option_slot" || v.SourceKind == "option_slot" && v.SlotKey == nil || v.SpeedMbps != nil && *v.SpeedMbps <= 0 {
			return assetErr("VALIDATION_FAILED", "端口来源或速率无效")
		}
		for _, txt := range []string{v.StableKey, v.Name, v.Protocol, v.Connector} {
			if e = assetText(txt, 64, true); e != nil {
				return e
			}
		}
		row := domain.ModelPort{RevisionID: id, StableKey: v.StableKey, Name: v.Name, Protocol: v.Protocol, Connector: v.Connector, SpeedMbps: v.SpeedMbps, SourceKind: v.SourceKind, SlotKey: v.SlotKey}
		row.ID = v.ID
		if e = r.ModelPorts.Create(ctx, &row); e != nil {
			return e
		}
	}
	for _, v := range in.Compatibilities {
		if !validSlot(v.SlotKey) || !slices.Contains([]string{"pending", "confirmed", "incompatible"}, v.Status) {
			return assetErr("VALIDATION_FAILED", "兼容关系无效")
		}
		if e = assetText(v.EvidenceNote, 1024, v.Status == "confirmed"); e != nil {
			return e
		}
		if _, _, e = catalogPublished(ctx, r, v.PartModelRevisionID, true); e != nil {
			return e
		}
		row := domain.ModelCompatibility{RevisionID: id, PartModelRevisionID: v.PartModelRevisionID, SlotKey: v.SlotKey, Status: v.Status, EvidenceNote: v.EvidenceNote}
		row.ID = v.ID
		if e = r.ModelCompatibilitys.Create(ctx, &row); e != nil {
			return e
		}
	}
	totalComponents := 0
	for _, v := range in.StandardComponents {
		totalComponents += v.Quantity
		if totalComponents > 4096 {
			return assetErr("LIMIT_EXCEEDED", "标配组件总数超过 4096 件")
		}
		if !validSlot(v.SlotKey) || v.Quantity < 1 || v.Quantity > 512 || v.SlotKey != nil && v.Quantity != 1 {
			return assetErr("VALIDATION_FAILED", "标配数量或槽位无效")
		}
		if _, _, e = catalogPublished(ctx, r, v.PartModelRevisionID, true); e != nil {
			return e
		}
		row := domain.ModelComponent{RevisionID: id, PartModelRevisionID: v.PartModelRevisionID, SlotKey: v.SlotKey, Quantity: v.Quantity, Required: v.Required}
		row.ID = v.ID
		if e = r.ModelComponents.Create(ctx, &row); e != nil {
			return e
		}
	}
	return nil
}
func copyTemplates(ctx context.Context, r domain.ReceivingRepositories, id uuid.UUID, v revisionView) error {
	in := revisionInput{}
	for _, x := range v.Slots {
		in.Slots = append(in.Slots, slotInput{StableKey: x.StableKey, Name: x.Name, Kind: x.Kind, Interface: x.Interface, FormFactor: x.FormFactor, Position: x.Position.Data()})
	}
	for _, x := range v.Ports {
		in.Ports = append(in.Ports, portInput{StableKey: x.StableKey, Name: x.Name, Protocol: x.Protocol, Connector: x.Connector, SpeedMbps: x.SpeedMbps, SourceKind: x.SourceKind, SlotKey: x.SlotKey})
	}
	for _, x := range v.StandardComponents {
		in.StandardComponents = append(in.StandardComponents, standardInput{PartModelRevisionID: x.PartModelRevisionID, SlotKey: x.SlotKey, Quantity: x.Quantity, Required: x.Required})
	}
	for _, x := range v.Compatibilities {
		in.Compatibilities = append(in.Compatibilities, compatInput{PartModelRevisionID: x.PartModelRevisionID, SlotKey: x.SlotKey, Status: x.Status, EvidenceNote: x.EvidenceNote})
	}
	return replaceTemplates(ctx, r, id, in)
}
func componentCompatible(ctx context.Context, r domain.ReceivingRepositories, deviceRev, partRev uuid.UUID, slot *string) error {
	m, p, e := catalogPublished(ctx, r, partRev, true)
	if e != nil {
		return e
	}
	rows, e := assetAll(ctx, r.ModelCompatibilitys, "revision_id", deviceRev)
	if e != nil {
		return e
	}
	var slots []domain.ModelSlot
	if slot != nil {
		slots, e = assetAll(ctx, r.ModelSlots, "revision_id", deviceRev)
		if e != nil {
			return e
		}
	}
	return validateCompatibleComponent(*m, *p, rows, slots, slot)
}

func validateCompatibleComponent(m domain.CatalogModel, p domain.CatalogRevision, rows []domain.ModelCompatibility, slots []domain.ModelSlot, slot *string) error {
	confirmed := false
	for _, v := range rows {
		if v.PartModelRevisionID != p.ID {
			continue
		}
		same := v.SlotKey == nil && slot == nil || v.SlotKey != nil && slot != nil && *v.SlotKey == *slot
		if same && v.Status == "incompatible" {
			return assetErr("INCOMPATIBLE_COMPONENT", "组件与槽位明确不兼容")
		}
		if v.Status == "confirmed" && (same || v.SlotKey == nil) {
			confirmed = true
		}
	}
	if !confirmed {
		return assetErr("INCOMPATIBLE_COMPONENT", "缺少已确认的组件兼容关系")
	}
	if slot != nil {
		for _, v := range slots {
			if v.StableKey == *slot {
				if v.Kind != m.Kind {
					return assetErr("INCOMPATIBLE_COMPONENT", "组件类别与槽位不符")
				}
				spec := p.Spec.Data()
				iface := spec.Interface
				if m.Kind == "memory" {
					iface = spec.MemoryGeneration
				}
				if v.Interface != nil && (iface == nil || *v.Interface != *iface) {
					return assetErr("INCOMPATIBLE_COMPONENT", "组件接口与槽位不符")
				}
				if v.FormFactor != nil && (spec.FormFactor == nil || *v.FormFactor != *spec.FormFactor) {
					return assetErr("INCOMPATIBLE_COMPONENT", "组件尺寸与槽位不符")
				}
				return nil
			}
		}
		return assetErr("INCOMPATIBLE_COMPONENT", "槽位不存在")
	}
	return nil
}
