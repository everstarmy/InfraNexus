package service

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type departmentService struct {
	deptRepo     domain.DepartmentRepository
	userRepo     domain.UserRepository
	organization domain.OrganizationUnitOfWork
}

func NewDepartmentService(deptRepo domain.DepartmentRepository, userRepo domain.UserRepository, organization domain.OrganizationUnitOfWork) domain.DepartmentService {
	return &departmentService{deptRepo: deptRepo, userRepo: userRepo, organization: organization}
}

func (s *departmentService) Tree(ctx context.Context) (*domain.DepartmentTreeSnapshot, error) {
	for range 3 {
		revision, err := s.organization.Revision(ctx)
		if err != nil {
			return nil, err
		}
		depts, err := s.deptRepo.ListAll(ctx)
		if err != nil {
			return nil, err
		}
		counts, err := s.userRepo.MemberCounts(ctx)
		if err != nil {
			return nil, err
		}
		leaderNames, err := s.leaderNames(ctx, depts)
		if err != nil {
			return nil, err
		}
		latestRevision, err := s.organization.Revision(ctx)
		if err != nil {
			return nil, err
		}
		if latestRevision == revision {
			return &domain.DepartmentTreeSnapshot{Revision: revision, Items: BuildDepartmentTree(depts, counts, leaderNames)}, nil
		}
	}
	return nil, coreerrors.ErrResourceConflict.WithMessage("组织架构正在更新，请重新加载")
}

func (s *departmentService) leaderNames(ctx context.Context, depts []domain.Department) (map[uuid.UUID]string, error) {
	ids := make([]uuid.UUID, 0)
	for _, d := range depts {
		if d.LeaderID != nil {
			ids = append(ids, *d.LeaderID)
		}
	}
	users, err := s.userRepo.FindByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	names := make(map[uuid.UUID]string, len(users))
	for _, u := range users {
		names[u.ID] = displayName(&u)
	}
	return names, nil
}

func displayName(u *domain.User) string {
	if u.Nickname != "" {
		return u.Nickname
	}
	return u.Username
}

func BuildDepartmentTree(ordered []domain.Department, memberCounts map[uuid.UUID]int64, leaderNames map[uuid.UUID]string) []*domain.DepartmentTreeDTO {
	nodes := make(map[uuid.UUID]*domain.DepartmentTreeDTO, len(ordered))
	for _, d := range ordered {
		node := &domain.DepartmentTreeDTO{
			ID:          d.ID,
			ParentID:    d.ParentID,
			Name:        d.Name,
			Code:        d.Code,
			SortOrder:   d.SortOrder,
			LeaderID:    d.LeaderID,
			Phone:       d.Phone,
			Email:       d.Email,
			Status:      d.Status,
			Source:      d.Source,
			TreePath:    d.TreePath,
			Depth:       domain.DepartmentDepth(d.TreePath),
			MemberCount: memberCounts[d.ID],
			Children:    []*domain.DepartmentTreeDTO{},
		}
		if d.LeaderID != nil {
			node.LeaderName = leaderNames[*d.LeaderID]
		}
		nodes[d.ID] = node
	}
	roots := make([]*domain.DepartmentTreeDTO, 0)
	for _, d := range ordered {
		node := nodes[d.ID]
		if parent, ok := parentNode(nodes, d.ParentID); ok {
			parent.Children = append(parent.Children, node)
		} else {
			roots = append(roots, node)
		}
	}
	var total func(n *domain.DepartmentTreeDTO) int64
	total = func(n *domain.DepartmentTreeDTO) int64 {
		sum := n.MemberCount
		for _, child := range n.Children {
			sum += total(child)
		}
		n.TotalMemberCount = sum
		return sum
	}
	for _, root := range roots {
		total(root)
	}
	return roots
}

func parentNode(nodes map[uuid.UUID]*domain.DepartmentTreeDTO, parentID *uuid.UUID) (*domain.DepartmentTreeDTO, bool) {
	if parentID == nil {
		return nil, false
	}
	node, ok := nodes[*parentID]
	return node, ok
}

func (s *departmentService) Get(ctx context.Context, id uuid.UUID) (*domain.Department, error) {
	dept, err := s.deptRepo.GetByID(ctx, id)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrDepartmentNotFound)
	}
	return dept, nil
}

func (s *departmentService) loadParent(ctx context.Context, parentID *uuid.UUID) (*domain.Department, error) {
	if parentID == nil {
		return nil, nil
	}
	parent, err := s.deptRepo.GetByID(ctx, *parentID)
	if err != nil {
		return nil, notFoundAs(err, coreerrors.ErrDepartmentNotFound.WithMessage("上级部门不存在"))
	}
	return parent, nil
}

func (s *departmentService) checkLeader(ctx context.Context, leaderID *uuid.UUID) error {
	if leaderID == nil {
		return nil
	}
	if _, err := s.userRepo.GetByID(ctx, *leaderID); err != nil {
		return notFoundAs(err, coreerrors.ErrUserNotFound.WithMessage("部门负责人不存在"))
	}
	return nil
}

func (s *departmentService) checkUnique(ctx context.Context, selfID uuid.UUID, parentID *uuid.UUID, name, code string) error {
	if existing, err := s.deptRepo.FindChildByName(ctx, parentID, name); err == nil && existing.ID != selfID {
		return coreerrors.ErrResourceConflict.WithMessage("同级部门名称已存在")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if existing, err := s.deptRepo.GetByCode(ctx, code); err == nil && existing.ID != selfID {
		return coreerrors.ErrResourceConflict.WithMessage("部门编码已存在")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return nil
}

func (s *departmentService) Create(ctx context.Context, req domain.CreateDepartmentRequest) (*domain.Department, error) {
	status := req.Status
	if status == 0 {
		status = domain.StatusEnabled
	}
	dept := domain.Department{
		ParentID:  req.ParentID,
		Name:      strings.TrimSpace(req.Name),
		Code:      req.Code,
		SortOrder: req.SortOrder,
		LeaderID:  req.LeaderID,
		Phone:     req.Phone,
		Email:     req.Email,
		Status:    status,
		Source:    domain.SourceLocal,
	}
	dept.ID = uuid.New()
	_, err := s.organization.Write(ctx, &req.ExpectedRevision, func(txctx context.Context) error {
		parent, err := s.loadParent(txctx, req.ParentID)
		if err != nil {
			return err
		}
		parentPath := domain.DepartmentRootPath
		if parent != nil {
			parentPath = parent.TreePath
		}
		if domain.DepartmentDepth(parentPath)+1 > domain.MaxDepartmentDepth {
			return coreerrors.ErrDepartmentInvalidParent.WithMessage("部门层级超过上限")
		}
		if err := s.checkLeader(txctx, req.LeaderID); err != nil {
			return err
		}
		if err := s.checkUnique(txctx, uuid.Nil, req.ParentID, dept.Name, req.Code); err != nil {
			return err
		}
		dept.TreePath = domain.DepartmentPath(parentPath, dept.ID)
		return s.deptRepo.Create(txctx, &dept)
	})
	if err != nil {
		return nil, organizationWriteError(err)
	}
	return &dept, nil
}

func (s *departmentService) Update(ctx context.Context, id uuid.UUID, req domain.UpdateDepartmentRequest) (*domain.Department, error) {
	var updated *domain.Department
	_, err := s.organization.Write(ctx, &req.ExpectedRevision, func(txctx context.Context) error {
		dept, err := s.Get(txctx, id)
		if err != nil {
			return err
		}
		if err := s.checkLeader(txctx, req.LeaderID); err != nil {
			return err
		}
		name := strings.TrimSpace(req.Name)
		if err := s.checkUnique(txctx, dept.ID, dept.ParentID, name, req.Code); err != nil {
			return err
		}
		dept.Name = name
		dept.Code = req.Code
		dept.SortOrder = req.SortOrder
		dept.LeaderID = req.LeaderID
		dept.Phone = req.Phone
		dept.Email = req.Email
		dept.Status = req.Status
		if err := s.deptRepo.Update(txctx, dept); err != nil {
			return err
		}
		updated = dept
		return nil
	})
	if err != nil {
		return nil, organizationWriteError(err)
	}
	return updated, nil
}

func (s *departmentService) Move(ctx context.Context, id uuid.UUID, parentID *uuid.UUID, expectedRevision int64) (*domain.Department, error) {
	var updated *domain.Department
	_, err := s.organization.Write(ctx, &expectedRevision, func(txctx context.Context) error {
		dept, err := s.Get(txctx, id)
		if err != nil {
			return err
		}
		if sameParent(dept.ParentID, parentID) {
			updated = dept
			return nil
		}
		newParentPath := domain.DepartmentRootPath
		if parentID != nil {
			if *parentID == id {
				return coreerrors.ErrDepartmentInvalidParent.WithMessage("不能将部门移动到自身之下")
			}
			parent, err := s.loadParent(txctx, parentID)
			if err != nil {
				return err
			}
			if strings.HasPrefix(parent.TreePath+"/", dept.TreePath+"/") {
				return coreerrors.ErrDepartmentInvalidParent.WithMessage("不能将部门移动到其下级部门之下")
			}
			newParentPath = parent.TreePath
		}
		newPath := domain.DepartmentPath(newParentPath, dept.ID)
		subtree, err := s.deptRepo.ListSubtree(txctx, dept.TreePath)
		if err != nil {
			return err
		}
		deepest := domain.DepartmentDepth(dept.TreePath)
		for _, item := range subtree {
			deepest = max(deepest, domain.DepartmentDepth(item.TreePath))
		}
		if deepest-domain.DepartmentDepth(dept.TreePath)+domain.DepartmentDepth(newPath) > domain.MaxDepartmentDepth {
			return coreerrors.ErrDepartmentInvalidParent.WithMessage("移动后部门层级超过上限")
		}
		if err := s.checkUnique(txctx, dept.ID, parentID, dept.Name, dept.Code); err != nil {
			return err
		}
		if err := s.deptRepo.Move(txctx, dept.ID, parentID, dept.TreePath, newPath); err != nil {
			return err
		}
		updated, err = s.Get(txctx, id)
		return err
	})
	if err != nil {
		return nil, organizationWriteError(err)
	}
	return updated, nil
}

func (s *departmentService) MoveRelative(ctx context.Context, id, targetID uuid.UUID, position string, expectedRevision int64) (*domain.Department, error) {
	var updated *domain.Department
	_, err := s.organization.Write(ctx, &expectedRevision, func(txctx context.Context) error {
		moving, err := s.Get(txctx, id)
		if err != nil {
			return err
		}
		target, err := s.Get(txctx, targetID)
		if err != nil {
			return err
		}
		if id == targetID || strings.HasPrefix(target.TreePath, moving.TreePath+"/") {
			return coreerrors.ErrDepartmentInvalidParent.WithMessage("不能把部门放到自身或其下级部门前后")
		}
		if position != "before" && position != "after" {
			return coreerrors.ErrParamInvalid.WithMessage("position 只支持 before 或 after")
		}

		all, err := s.deptRepo.ListAll(txctx)
		if err != nil {
			return err
		}
		oldSiblings := make([]domain.Department, 0, len(all))
		newSiblings := make([]domain.Department, 0, len(all))
		for _, item := range all {
			if sameParent(item.ParentID, moving.ParentID) {
				oldSiblings = append(oldSiblings, item)
			}
			if sameParent(item.ParentID, target.ParentID) {
				newSiblings = append(newSiblings, item)
			}
		}
		sameGroup := sameParent(moving.ParentID, target.ParentID)
		if sameGroup {
			newSiblings = oldSiblings
		}
		newSiblings = slices.DeleteFunc(newSiblings, func(item domain.Department) bool { return item.ID == id })
		targetIndex := slices.IndexFunc(newSiblings, func(item domain.Department) bool { return item.ID == targetID })
		if targetIndex < 0 {
			return coreerrors.ErrDepartmentInvalidParent.WithMessage("目标部门已不在预期上级下")
		}
		insertAt := targetIndex
		if position == "after" {
			insertAt++
		}
		newSiblings = slices.Insert(newSiblings, insertAt, *moving)

		if !sameGroup {
			newParentPath := domain.DepartmentRootPath
			if target.ParentID != nil {
				parent, err := s.loadParent(txctx, target.ParentID)
				if err != nil {
					return err
				}
				newParentPath = parent.TreePath
			}
			newPath := domain.DepartmentPath(newParentPath, moving.ID)
			subtree, err := s.deptRepo.ListSubtree(txctx, moving.TreePath)
			if err != nil {
				return err
			}
			deepest := domain.DepartmentDepth(moving.TreePath)
			for _, item := range subtree {
				deepest = max(deepest, domain.DepartmentDepth(item.TreePath))
			}
			if deepest-domain.DepartmentDepth(moving.TreePath)+domain.DepartmentDepth(newPath) > domain.MaxDepartmentDepth {
				return coreerrors.ErrDepartmentInvalidParent.WithMessage("移动后部门层级超过上限")
			}
			if err := s.checkUnique(txctx, moving.ID, target.ParentID, moving.Name, moving.Code); err != nil {
				return err
			}
			if err := s.deptRepo.Move(txctx, moving.ID, target.ParentID, moving.TreePath, newPath); err != nil {
				return err
			}
			oldSiblings = slices.DeleteFunc(oldSiblings, func(item domain.Department) bool { return item.ID == id })
		}

		if err := s.deptRepo.Reorder(txctx, departmentOrders(newSiblings)); err != nil {
			return err
		}
		if !sameGroup && len(oldSiblings) > 0 {
			if err := s.deptRepo.Reorder(txctx, departmentOrders(oldSiblings)); err != nil {
				return err
			}
		}
		updated, err = s.Get(txctx, id)
		return err
	})
	if err != nil {
		return nil, organizationWriteError(err)
	}
	return updated, nil
}

func departmentOrders(items []domain.Department) []domain.DepartmentOrder {
	orders := make([]domain.DepartmentOrder, len(items))
	for i, item := range items {
		orders[i] = domain.DepartmentOrder{ID: item.ID, SortOrder: (i + 1) * 10}
	}
	return orders
}

func sameParent(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func (s *departmentService) Reorder(ctx context.Context, items []domain.DepartmentOrder, expectedRevision int64) error {
	ordered := slices.Clone(items)
	slices.SortFunc(ordered, func(a, b domain.DepartmentOrder) int { return slices.Compare(a.ID[:], b.ID[:]) })
	for i := 1; i < len(ordered); i++ {
		if ordered[i].ID == ordered[i-1].ID {
			return coreerrors.ErrParamInvalid.WithMessage("部门排序 ID 不可重复")
		}
	}
	_, err := s.organization.Write(ctx, &expectedRevision, func(txctx context.Context) error {
		var parentID *uuid.UUID
		for i, item := range ordered {
			dept, err := s.Get(txctx, item.ID)
			if err != nil {
				return err
			}
			if i == 0 {
				parentID = dept.ParentID
			} else if !sameParent(parentID, dept.ParentID) {
				return coreerrors.ErrParamInvalid.WithMessage("一次排序只能调整同一上级下的部门")
			}
		}
		return s.deptRepo.Reorder(txctx, ordered)
	})
	return organizationWriteError(err)
}

func (s *departmentService) Delete(ctx context.Context, id uuid.UUID, expectedRevision int64) error {
	_, err := s.organization.Write(ctx, &expectedRevision, func(txctx context.Context) error {
		if _, err := s.Get(txctx, id); err != nil {
			return err
		}
		children, err := s.deptRepo.CountChildren(txctx, id)
		if err != nil {
			return err
		}
		if children > 0 {
			return coreerrors.ErrDepartmentHasChildren
		}
		members, err := s.userRepo.CountByDepartmentIDs(txctx, []uuid.UUID{id})
		if err != nil {
			return err
		}
		if members > 0 {
			return coreerrors.ErrDepartmentHasMembers
		}
		return s.deptRepo.Delete(txctx, id)
	})
	return organizationWriteError(err)
}
