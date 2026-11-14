package service

import (
	"reflect"
	"strings"

	"infranexus/internal/domain"
)

type receivingSpecField struct {
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Required  bool     `json:"required"`
	Nullable  bool     `json:"nullable"`
	Enum      []string `json:"enum,omitempty"`
	Unit      string   `json:"unit,omitempty"`
	Minimum   *float64 `json:"minimum,omitempty"`
	Maximum   *float64 `json:"maximum,omitempty"`
	MaxLength *int     `json:"max_length,omitempty"`
}
type receivingSpecSchema struct {
	SchemaVersion int                  `json:"schema_version"`
	Fields        []receivingSpecField `json:"fields"`
}
type receivingMetadataView struct {
	ComponentKinds     []string                       `json:"component_kinds"`
	DeviceCategories   []string                       `json:"device_categories"`
	SpecSchemas        map[string]receivingSpecSchema `json:"spec_schemas"`
	Limits             map[string]int                 `json:"limits"`
	Capabilities       map[string]bool                `json:"capabilities"`
	AcceptedImageTypes []string                       `json:"accepted_image_types"`
	States             map[string][]string            `json:"states"`
}

func receivingMetadata() receivingMetadataView {
	out := receivingMetadataView{ComponentKinds: componentKinds, DeviceCategories: deviceCategories, SpecSchemas: map[string]receivingSpecSchema{}, Limits: map[string]int{"max_receipt_devices": 50, "max_receipt_components": 4096, "max_component_expand": 512, "max_photo_bytes": 10485760, "max_photos_per_item": 20, "max_photo_pixels": 40000000}, Capabilities: map[string]bool{"component_movement": false, "baseline_correction": false}, AcceptedImageTypes: []string{"image/jpeg", "image/png"}, States: map[string][]string{"model_revision": {"draft", "published"}, "arrival_order": {"draft", "open", "completed", "closed", "canceled"}, "receipt": {"draft", "completed", "canceled"}, "inspection": {"pending", "pass", "reject"}, "placement": {"installed", "stored"}}}
	types := map[string]reflect.Kind{}
	typ := reflect.TypeFor[domain.AssetSpec]()
	for i := 1; i < typ.NumField(); i++ {
		f := typ.Field(i)
		types[strings.Split(f.Tag.Get("json"), ",")[0]] = f.Type.Elem().Kind()
	}
	for kind, names := range specFields {
		schema := receivingSpecSchema{SchemaVersion: 1, Fields: []receivingSpecField{{Name: "schema_version", Type: "integer", Required: true, Minimum: new(1.0), Maximum: new(1.0)}}}
		for _, name := range names {
			f := receivingSpecField{Name: name, Nullable: true}
			switch types[name] {
			case reflect.String:
				f.Type = "string"
				f.MaxLength = new(64)
				if name == "description" {
					f.MaxLength = new(1024)
				}
			case reflect.Bool:
				f.Type = "boolean"
			case reflect.Float64:
				f.Type = "number"
				f.Minimum = new(0.0)
			default:
				f.Type = "integer"
				f.Minimum = new(1.0)
				f.Maximum = new(9007199254740991.0)
				if name == "cache_bytes" {
					f.Minimum = new(0.0)
				}
			}
			if kind == "memory" && (name == "capacity_bytes" || name == "memory_generation" || name == "speed_mt_s") || kind == "disk" && (name == "capacity_bytes" || name == "interface" || name == "media_type") {
				f.Required = true
				f.Nullable = false
			}
			switch name {
			case "memory_generation":
				f.Enum = []string{"DDR3", "DDR4", "DDR5"}
			case "media_type":
				f.Enum = []string{"HDD", "SSD"}
			case "interface":
				if kind == "disk" {
					f.Enum = []string{"SATA", "SAS", "NVMe"}
				}
			case "capacity_bytes", "cache_bytes":
				f.Unit = "bytes"
			case "speed_mt_s":
				f.Unit = "MT/s"
			case "speed_mbps":
				f.Unit = "Mbps"
			case "rated_power_w":
				f.Unit = "W"
			case "width_mm", "depth_mm":
				f.Unit = "mm"
			case "weight_kg":
				f.Unit = "kg"
			case "wavelength_nm":
				f.Unit = "nm"
			case "base_frequency_mhz":
				f.Unit = "MHz"
			}
			schema.Fields = append(schema.Fields, f)
		}
		out.SpecSchemas[kind] = schema
	}
	return out
}
