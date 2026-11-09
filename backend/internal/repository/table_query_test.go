package repository

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infranexus/internal/domain"
	"infranexus/internal/testdb"
)

func TestAdvancedUserQueryPostgres(t *testing.T) {
	testAdvancedUserQuery(t, testdb.Dialector(t))
}
func testAdvancedUserQuery(t *testing.T, driver gorm.Dialector) {
	t.Helper()
	db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&domain.Department{}, &domain.Role{}, &domain.Permission{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	marker := uuid.NewString()
	repo := NewUserRepository(db)
	now := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	for i, name := range []string{"zeta", "Alpha", "beta", "outside"} {
		status := 1
		if i == 3 {
			status = 2
		}
		user := &domain.User{Username: marker + name, Email: marker + name + "@example.test", Nickname: name, Status: status, AuthType: "local", LastLoginAt: &now}
		if i == 2 {
			user.LastLoginAt = nil
		}
		if err := repo.Create(t.Context(), user); err != nil {
			t.Fatal(err)
		}
	}
	q, err := domain.ParseUserQuery(`{"version":1,"search":"","filter":{"logic":"or","children":[{"field":"nickname","op":"contains","value":"a"},{"field":"status","op":"eq","value":2}]},"sorts":[{"field":"status","desc":true},{"field":"nickname","desc":false}]}`)
	if err != nil {
		t.Fatal(err)
	}
	filter := domain.UserFilter{Keyword: marker, Statuses: []int{1}, Query: q, Page: 1, PageSize: 2}
	found, total, err := repo.Search(t.Context(), filter)
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 || len(found) != 2 || found[0].Nickname != "Alpha" || found[1].Nickname != "beta" {
		t.Fatalf("scope/order/count: total=%d rows=%+v", total, found)
	}
	filter.Page = 2
	found, total, err = repo.Search(t.Context(), filter)
	if err != nil || total != 3 || len(found) != 1 || found[0].Nickname != "zeta" {
		t.Fatalf("cross-page order: total=%d rows=%+v err=%v", total, found, err)
	}
	filter.Page = 1
	filter.PageSize = 10
	q.Filter = domain.QueryNode{Logic: "and", Children: []domain.QueryNode{{Field: "last_login_at", Op: "between", Value: []any{"2026-10-28T08:00:00+08:00", "2026-10-28T00:00:00Z"}}}}
	found, total, err = repo.Search(t.Context(), filter)
	if err != nil || total != 2 {
		t.Fatalf("inclusive time range: total=%d err=%v", total, err)
	}
	q.Filter = domain.QueryNode{Logic: "and"}
	q.Sorts = []domain.QuerySort{{Field: "last_login_at", Desc: false}, {Field: "nickname", Desc: true}}
	found, _, err = repo.Search(t.Context(), filter)
	if err != nil || len(found) != 3 || found[0].Nickname != "zeta" || found[2].LastLoginAt != nil {
		t.Fatalf("null-last multi-sort: %+v err=%v", found, err)
	}
	q.Filter = domain.QueryNode{Logic: "and", Children: []domain.QueryNode{{Field: "nickname", Op: "contains", Value: "%"}}}
	_, total, err = repo.Search(t.Context(), filter)
	if err != nil || total != 0 {
		t.Fatalf("literal wildcard: %d %v", total, err)
	}
	q.Filter = domain.QueryNode{Logic: "and"}
	filter.IDs = []uuid.UUID{found[0].ID}
	selected, count, err := repo.Search(t.Context(), filter)
	if err != nil || count != 1 || len(selected) != 1 || selected[0].ID != found[0].ID {
		t.Fatalf("selected IDs must intersect query: %v %d %v", selected, count, err)
	}
	filter.Statuses = []int{2}
	_, count, err = repo.Search(t.Context(), filter)
	if err != nil || count != 0 {
		t.Fatalf("IDs bypassed scope: %d %v", count, err)
	}
	q.Filter = domain.QueryNode{Logic: "and", Children: []domain.QueryNode{{Field: "password", Op: "eq", Value: "x"}}}
	if _, _, err := repo.Search(t.Context(), filter); err == nil {
		t.Fatal("repository accepted forbidden field")
	}
}
