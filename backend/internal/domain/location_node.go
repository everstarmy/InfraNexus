package domain

import (
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type LocationType string

const (
	LocationDatacenter LocationType = "datacenter"
	LocationBuilding   LocationType = "building"
	LocationRoom       LocationType = "room"
	LocationRack       LocationType = "rack"
)

// ParentType returns an empty parent type for a valid root node.
func (t LocationType) ParentType() (LocationType, bool) {
	switch t {
	case LocationDatacenter:
		return "", true
	case LocationBuilding:
		return LocationDatacenter, true
	case LocationRoom:
		return LocationBuilding, true
	case LocationRack:
		return LocationRoom, true
	default:
		return "", false
	}
}

type LocationFields struct {
	Name   string         `json:"name"`
	Type   LocationType   `json:"type"`
	Parent *uuid.UUID     `json:"parent"`
	Ext    jsontext.Value `json:"ext"`
}

type DatacenterExt struct {
	Address string            `json:"address"`
	Contact DatacenterContact `json:"contact"`
}

type DatacenterContact struct {
	Name  string `json:"name"`
	Phone string `json:"phone,omitempty"`
	Email string `json:"email,omitempty"`
}

type BuildingExt struct{}

type RoomExt struct {
	Floor *int `json:"floor"`
}

type RackExt struct {
	Row            string `json:"row"`
	Column         int    `json:"column"`
	HeightU        int    `json:"height_u"`
	PowerCapacityW *int32 `json:"power_capacity_w"`
}

var locationRackRow = regexp.MustCompile(`^(?:[A-Z]|[1-9]|1[0-9]|2[0-5])$`)

// Normalize validates fields intrinsic to a node. Callers must separately
// resolve the parent and validate its type and state in the write transaction.
func (fields LocationFields) Normalize() (LocationFields, error) {
	fields.Name = strings.TrimSpace(fields.Name)
	if fields.Name == "" || utf8.RuneCountInString(fields.Name) > 128 {
		return LocationFields{}, fmt.Errorf("name must contain 1 to 128 characters")
	}
	parentType, ok := fields.Type.ParentType()
	if !ok {
		return LocationFields{}, fmt.Errorf("invalid location type")
	}
	if parentType == "" && fields.Parent != nil || parentType != "" && (fields.Parent == nil || *fields.Parent == uuid.Nil) {
		return LocationFields{}, fmt.Errorf("invalid parent for location type %s", fields.Type)
	}
	if fields.Ext.Kind() != '{' {
		return LocationFields{}, fmt.Errorf("ext must be a JSON object")
	}

	var ext any
	switch fields.Type {
	case LocationDatacenter:
		ext = new(DatacenterExt)
	case LocationBuilding:
		ext = new(BuildingExt)
	case LocationRoom:
		ext = new(RoomExt)
	case LocationRack:
		ext = new(RackExt)
	}
	if err := json.Unmarshal(fields.Ext, ext, json.RejectUnknownMembers(true)); err != nil {
		return LocationFields{}, fmt.Errorf("invalid ext for location type %s: %w", fields.Type, err)
	}
	switch value := ext.(type) {
	case *DatacenterExt:
		value.Address = strings.TrimSpace(value.Address)
		value.Contact.Name = strings.TrimSpace(value.Contact.Name)
		value.Contact.Phone = strings.TrimSpace(value.Contact.Phone)
		value.Contact.Email = strings.TrimSpace(value.Contact.Email)
		if value.Address == "" || utf8.RuneCountInString(value.Address) > 512 {
			return LocationFields{}, fmt.Errorf("address must contain 1 to 512 characters")
		}
		if value.Contact.Name == "" || utf8.RuneCountInString(value.Contact.Name) > 128 {
			return LocationFields{}, fmt.Errorf("contact name must contain 1 to 128 characters")
		}
		if utf8.RuneCountInString(value.Contact.Phone) > 64 {
			return LocationFields{}, fmt.Errorf("contact phone exceeds 64 characters")
		}
		if email := value.Contact.Email; email != "" {
			address, err := mail.ParseAddress(email)
			if err != nil || address.Address != email || len(email) > 254 {
				return LocationFields{}, fmt.Errorf("invalid contact email")
			}
		}
	case *RoomExt:
		if value.Floor == nil || *value.Floor < -5 || *value.Floor > 100 {
			return LocationFields{}, fmt.Errorf("floor must be an integer between -5 and 100")
		}
	case *RackExt:
		row := strings.TrimSpace(value.Row)
		if len(row) == 1 && row[0] >= 'a' && row[0] <= 'z' {
			row = strings.ToUpper(row)
		}
		value.Row = row
		if !locationRackRow.MatchString(value.Row) {
			return LocationFields{}, fmt.Errorf("row must be A–Z or 1–25")
		}
		if value.Column < 1 || value.Column > 9999 {
			return LocationFields{}, fmt.Errorf("column must be an integer between 1 and 9999")
		}
		if value.HeightU < 1 || value.HeightU > 100 {
			return LocationFields{}, fmt.Errorf("height_u must be an integer between 1 and 100")
		}
		if value.PowerCapacityW != nil && *value.PowerCapacityW <= 0 {
			return LocationFields{}, fmt.Errorf("power_capacity_w must be positive")
		}
	}
	data, err := json.Marshal(ext)
	if err != nil {
		return LocationFields{}, fmt.Errorf("encode location ext: %w", err)
	}
	fields.Ext = data
	return fields, nil
}
