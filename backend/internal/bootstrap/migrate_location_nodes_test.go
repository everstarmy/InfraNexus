package bootstrap

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/testdb"
)

func TestLocationNodeSchema(t *testing.T) {
	db, err := gorm.Open(testdb.Dialector(t), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := Migrate(db); err != nil {
			t.Fatal(err)
		}
	}
	ctx := t.Context()
	repo := repository.NewLocationNodeRepository(db)
	node := func(name string, kind domain.LocationType, parent *uuid.UUID, ext string) domain.LocationNode {
		return domain.LocationNode{
			UID: uuid.New(), Name: name, Type: kind, Parent: parent, Ext: datatypes.JSON(ext),
			Status: domain.StatusEnabled, Version: 1,
		}
	}
	center := node("Center", domain.LocationDatacenter, nil, `{"address":"Address","contact":{"name":"Contact"}}`)
	building := node("Building", domain.LocationBuilding, &center.UID, `{}`)
	room := node("Room", domain.LocationRoom, &building.UID, `{"floor":0}`)
	rack := node("Rack", domain.LocationRack, &room.UID, `{"row":"A","column":1,"height_u":42}`)
	for _, item := range []*domain.LocationNode{&center, &building, &room, &rack} {
		if err := repo.Create(ctx, item); err != nil {
			t.Fatalf("create %s: %v", item.Type, err)
		}
	}
	for _, invalid := range []domain.LocationNode{
		node("Missing parent", domain.LocationRoom, nil, `{"floor":0}`),
		node("Wrong parent", domain.LocationRoom, &center.UID, `{"floor":0}`),
		node("Missing floor", domain.LocationRoom, &building.UID, `{}`),
		node("Invalid floor", domain.LocationRoom, &building.UID, `{"floor":101}`),
		node("Duplicate coordinate", domain.LocationRack, &room.UID, `{"row":"A","column":1,"height_u":48}`),
	} {
		if err := repo.Create(ctx, &invalid); err == nil {
			t.Errorf("inserted invalid node %s", invalid.Name)
		}
	}
	if err := db.Model(&room).Update("status", domain.StatusDisabled).Error; err == nil {
		t.Fatal("disabled the parent of an enabled rack")
	}
	if err := db.Model(&rack).Update("type", domain.LocationRoom).Error; err == nil {
		t.Fatal("changed the node type")
	}
	if err := repo.Transaction(ctx, func(txCtx context.Context) error {
		rack.Version++
		rack.Name = "Renamed rack"
		return repo.Update(txCtx, &rack, 1)
	}); err != nil {
		t.Fatal(err)
	}
	children, total, err := repo.List(ctx, domain.LocationNodeQuery{
		Parent: &room.UID, Types: []domain.LocationType{domain.LocationRack}, Page: 1, PageSize: 10,
	})
	if err != nil || total != 1 || len(children) != 1 || children[0].Name != "Renamed rack" {
		t.Fatalf("list rack children: count=%d items=%+v err=%v", total, children, err)
	}
}
