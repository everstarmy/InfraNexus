package domain

import (
	"encoding/json/jsontext"
	"testing"

	"github.com/google/uuid"
)

func TestLocationFieldsNormalize(t *testing.T) {
	parent := uuid.New()
	for _, tc := range []struct {
		name string
		kind LocationType
		ext  string
		want string
	}{
		{"floor zero", LocationRoom, `{"floor":0}`, `{"floor":0}`},
		{"floor minimum", LocationRoom, `{"floor":-5}`, `{"floor":-5}`},
		{"floor maximum", LocationRoom, `{"floor":100}`, `{"floor":100}`},
		{"floor missing", LocationRoom, `{}`, ""},
		{"floor below minimum", LocationRoom, `{"floor":-6}`, ""},
		{"floor above maximum", LocationRoom, `{"floor":101}`, ""},
		{"floor fraction", LocationRoom, `{"floor":1.5}`, ""},
		{"unknown building field", LocationBuilding, `{"floor":0}`, ""},
		{"null ext", LocationBuilding, `null`, ""},
		{"rack lowercase row", LocationRack, `{"row":"a","column":1,"height_u":42}`, `{"row":"A","column":1,"height_u":42,"power_capacity_w":null}`},
		{"rack invalid row", LocationRack, `{"row":"26","column":1,"height_u":42}`, ""},
		{"rack zero power", LocationRack, `{"row":"25","column":1,"height_u":42,"power_capacity_w":0}`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fields := LocationFields{Name: " node ", Type: tc.kind, Parent: &parent, Ext: jsontext.Value(tc.ext)}
			node, err := fields.Normalize()
			if tc.want == "" {
				if err == nil {
					t.Fatal("accepted invalid ext")
				}
				return
			}
			if err != nil || node.Name != "node" || string(node.Ext) != tc.want {
				t.Fatalf("got name=%q ext=%s err=%v", node.Name, node.Ext, err)
			}
		})
	}
}
