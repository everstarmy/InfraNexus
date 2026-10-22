package repository

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"

	"infranexus/internal/domain"
)

func TestOrganizationUnitOfWorkSerializesConcurrentRevisionWrites(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "organization.db")), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	runConcurrentOrganizationWrites(t, db)
}

func TestOrganizationUnitOfWorkSerializesConcurrentRevisionWritesPostgres(t *testing.T) {
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set INFRANEXUS_TEST_POSTGRES_DSN to an isolated, disposable PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatalf("connect test PostgreSQL database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	runConcurrentOrganizationWrites(t, db)
}

func TestOrganizationUnitOfWorkSerializesOpposingDepartmentMoves(t *testing.T) {
	db := openOrganizationSQLite(t, "opposing-moves.db")
	runOpposingDepartmentMoves(t, db)
}

func TestOrganizationUnitOfWorkSerializesDepartmentDeleteAndUserTransfer(t *testing.T) {
	db := openOrganizationSQLite(t, "delete-transfer.db")
	runDepartmentDeleteAndUserTransfer(t, db)
}

func TestOrganizationUnitOfWorkDepartmentRacesPostgres(t *testing.T) {
	dsn := os.Getenv("INFRANEXUS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set INFRANEXUS_TEST_POSTGRES_DSN to an isolated, disposable PostgreSQL database")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatalf("connect test PostgreSQL database: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	runOpposingDepartmentMoves(t, db)
	runDepartmentDeleteAndUserTransfer(t, db)
}

func openOrganizationSQLite(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), name)), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(8)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

func prepareOrganizationRaceDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&domain.OrganizationState{}, &domain.Department{}, &domain.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Unscoped().Where("id = ?", domain.OrganizationStateID).Delete(&domain.OrganizationState{}).Error; err != nil {
		t.Fatal(err)
	}
	state := domain.OrganizationState{ID: domain.OrganizationStateID, Revision: 1}
	if err := db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.Assignments(map[string]any{"revision": 1})}).Create(&state).Error; err != nil {
		t.Fatal(err)
	}
}

func createRaceDepartment(t *testing.T, repo domain.DepartmentRepository, name string) domain.Department {
	t.Helper()
	department := domain.Department{
		BaseEntity: domain.BaseEntity{ID: uuid.New()},
		Name:       name,
		Code:       strings.ToLower(name) + "-" + uuid.NewString()[:8],
		Status:     domain.StatusEnabled,
		Source:     domain.SourceLocal,
		TreePath:   domain.DepartmentPath(domain.DepartmentRootPath, uuid.Nil),
	}
	department.TreePath = domain.DepartmentPath(domain.DepartmentRootPath, department.ID)
	if err := repo.Create(t.Context(), &department); err != nil {
		t.Fatal(err)
	}
	return department
}

func runOpposingDepartmentMoves(t *testing.T, db *gorm.DB) {
	t.Helper()
	prepareOrganizationRaceDB(t, db)
	departments := NewDepartmentRepository(db)
	uow := NewOrganizationUnitOfWork(db)
	left := createRaceDepartment(t, departments, "left")
	right := createRaceDepartment(t, departments, "right")
	start := make(chan struct{})
	results := make(chan error, 2)
	var ready sync.WaitGroup
	var workers sync.WaitGroup
	for _, move := range []struct {
		id       uuid.UUID
		parentID uuid.UUID
	}{{left.ID, right.ID}, {right.ID, left.ID}} {
		move := move
		ready.Add(1)
		workers.Go(func() {
			ready.Done()
			<-start
			expectedRevision := int64(1)
			_, err := uow.Write(t.Context(), &expectedRevision, func(ctx context.Context) error {
				department, err := departments.GetByID(ctx, move.id)
				if err != nil {
					return err
				}
				parent, err := departments.GetByID(ctx, move.parentID)
				if err != nil {
					return err
				}
				if parent.ID == department.ID || strings.HasPrefix(parent.TreePath, department.TreePath+"/") {
					return errors.New("department move would create a cycle")
				}
				return departments.Move(ctx, department.ID, &parent.ID, department.TreePath, domain.DepartmentPath(parent.TreePath, department.ID))
			})
			results <- err
		})
	}
	ready.Wait()
	close(start)
	workers.Wait()
	close(results)
	succeeded, conflicted := countOrganizationRaceResults(t, results)
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("opposing moves: successes=%d conflicts=%d, want one each", succeeded, conflicted)
	}
	items := make([]domain.Department, 0, 2)
	for _, id := range []uuid.UUID{left.ID, right.ID} {
		department, err := departments.GetByID(t.Context(), id)
		if err != nil {
			t.Fatal(err)
		}
		items = append(items, *department)
	}
	children := 0
	for _, department := range items {
		if department.ParentID != nil {
			children++
			parent, err := departments.GetByID(t.Context(), *department.ParentID)
			if err != nil {
				t.Fatal(err)
			}
			if department.TreePath != domain.DepartmentPath(parent.TreePath, department.ID) {
				t.Fatalf("department path %q does not match parent path %q", department.TreePath, parent.TreePath)
			}
		}
	}
	if children != 1 {
		t.Fatalf("child departments = %d, want 1 after exactly one move", children)
	}
	assertOrganizationRevision(t, db, 2)
}

func runDepartmentDeleteAndUserTransfer(t *testing.T, db *gorm.DB) {
	t.Helper()
	prepareOrganizationRaceDB(t, db)
	departments := NewDepartmentRepository(db)
	users := NewUserRepository(db)
	uow := NewOrganizationUnitOfWork(db)
	source := createRaceDepartment(t, departments, "source")
	target := createRaceDepartment(t, departments, "target")
	member := domain.User{Username: "member-" + uuid.NewString()[:8], Email: uuid.NewString() + "@example.test", Password: "hash", DepartmentID: &source.ID, Status: domain.StatusEnabled}
	if err := users.Create(t.Context(), &member); err != nil {
		t.Fatal(err)
	}
	errDepartmentNotEmpty := errors.New("department still has users or child departments")
	start := make(chan struct{})
	results := make(chan struct {
		name string
		err  error
	}, 2)
	var ready sync.WaitGroup
	var workers sync.WaitGroup
	ready.Add(2)
	workers.Go(func() {
		ready.Done()
		<-start
		expectedRevision := int64(1)
		_, err := uow.Write(t.Context(), &expectedRevision, func(ctx context.Context) error {
			subtree, err := departments.ListSubtree(ctx, source.TreePath)
			if err != nil {
				return err
			}
			ids := make([]uuid.UUID, 0, len(subtree))
			for _, item := range subtree {
				ids = append(ids, item.ID)
				children, err := departments.CountChildren(ctx, item.ID)
				if err != nil {
					return err
				}
				members, err := users.CountByDepartmentIDs(ctx, []uuid.UUID{item.ID})
				if err != nil {
					return err
				}
				if children > 0 || members > 0 {
					return errDepartmentNotEmpty
				}
			}
			if len(ids) == 0 {
				return gorm.ErrRecordNotFound
			}
			return departments.Delete(ctx, source.ID)
		})
		results <- struct {
			name string
			err  error
		}{name: "delete", err: err}
	})
	workers.Go(func() {
		ready.Done()
		<-start
		expectedRevision := int64(1)
		_, err := uow.Write(t.Context(), &expectedRevision, func(ctx context.Context) error {
			if _, err := departments.GetByID(ctx, target.ID); err != nil {
				return err
			}
			moved, err := users.MoveToDepartment(ctx, []uuid.UUID{member.ID}, target.ID)
			if err != nil {
				return err
			}
			if moved != 1 {
				return gorm.ErrRecordNotFound
			}
			return nil
		})
		results <- struct {
			name string
			err  error
		}{name: "transfer", err: err}
	})
	ready.Wait()
	close(start)
	workers.Wait()
	close(results)
	var deleteErr, transferErr error
	for result := range results {
		if result.name == "delete" {
			deleteErr = result.err
		} else {
			transferErr = result.err
		}
	}
	if transferErr != nil {
		t.Fatalf("transfer failed: %v", transferErr)
	}
	if !errors.Is(deleteErr, domain.ErrTreeRevisionConflict) && !errors.Is(deleteErr, errDepartmentNotEmpty) {
		t.Fatalf("delete error = %v, want stale revision or not-empty guard", deleteErr)
	}
	if _, err := departments.GetByID(t.Context(), source.ID); err != nil {
		t.Fatalf("source department must remain after concurrent transfer: %v", err)
	}
	updatedMember, err := users.GetByID(t.Context(), member.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updatedMember.DepartmentID == nil || *updatedMember.DepartmentID != target.ID {
		t.Fatalf("member department = %v, want %s", updatedMember.DepartmentID, target.ID)
	}
	assertOrganizationRevision(t, db, 2)
}

func countOrganizationRaceResults(t *testing.T, results <-chan error) (int, int) {
	t.Helper()
	succeeded, conflicted := 0, 0
	for err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, domain.ErrTreeRevisionConflict):
			conflicted++
		default:
			t.Fatalf("organization race failed unexpectedly: %v", err)
		}
	}
	return succeeded, conflicted
}

func assertOrganizationRevision(t *testing.T, db *gorm.DB, want int64) {
	t.Helper()
	var state domain.OrganizationState
	if err := db.First(&state, "id = ?", domain.OrganizationStateID).Error; err != nil {
		t.Fatal(err)
	}
	if state.Revision != want {
		t.Fatalf("organization revision = %d, want %d", state.Revision, want)
	}
}

func runConcurrentOrganizationWrites(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&domain.OrganizationState{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("id = ?", domain.OrganizationStateID).Delete(&domain.OrganizationState{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&domain.OrganizationState{ID: domain.OrganizationStateID, Revision: 1}).Error; err != nil {
		t.Fatal(err)
	}

	units := []domain.OrganizationUnitOfWork{NewOrganizationUnitOfWork(db), NewOrganizationUnitOfWork(db)}
	start := make(chan struct{})
	results := make(chan error, len(units))
	var ready sync.WaitGroup
	ready.Add(len(units))
	var workers sync.WaitGroup
	for _, unit := range units {
		workers.Go(func() {
			ready.Done()
			<-start
			expectedRevision := int64(1)
			_, err := unit.Write(t.Context(), &expectedRevision, func(context.Context) error { return nil })
			results <- err
		})
	}
	ready.Wait()
	close(start)
	workers.Wait()
	close(results)

	succeeded := 0
	conflicted := 0
	for err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, domain.ErrTreeRevisionConflict):
			conflicted++
		default:
			t.Fatalf("concurrent organization write failed unexpectedly: %v", err)
		}
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("concurrent writes: successes=%d conflicts=%d, want 1 each", succeeded, conflicted)
	}
	var state domain.OrganizationState
	if err := db.First(&state, "id = ?", domain.OrganizationStateID).Error; err != nil {
		t.Fatal(err)
	}
	if state.Revision != 2 {
		t.Fatalf("organization revision = %d, want 2", state.Revision)
	}

	failed := errors.New("write rejected")
	expectedRevision := int64(2)
	if _, err := units[0].Write(t.Context(), &expectedRevision, func(context.Context) error { return failed }); !errors.Is(err, failed) {
		t.Fatalf("callback error = %v, want %v", err, failed)
	}
	if revision, err := units[0].Revision(t.Context()); err != nil || revision != 2 {
		t.Fatalf("revision after rollback = %d, %v; want 2, nil", revision, err)
	}
}
