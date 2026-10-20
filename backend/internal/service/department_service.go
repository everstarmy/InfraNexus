package service

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

type departmentService struct {
	deptRepo domain.DepartmentRepository
	userRepo domain.UserRepository
}

func NewDepartmentService(deptRepo domain.DepartmentRepository, userRepo domain.UserRepository) domain.DepartmentService {
	return &departmentService{deptRepo: deptRepo, userRepo: userRepo}
}

func (s *departmentService) Tree(ctx context.Context) ([]*domain.DepartmentTreeDTO, error) {
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
	return BuildDepartmentTree(depts, counts, leaderNames), nil
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
	parent, err := s.loadParent(ctx, req.ParentID)
	if err != nil {
		return nil, err
	}
	parentPath := domain.DepartmentRootPath
	if parent != nil {
		parentPath = parent.TreePath
	}
	if domain.DepartmentDepth(parentPath)+1 > domain.MaxDepartmentDepth {
		return nil, coreerrors.ErrDepartmentInvalidParent.WithMessage("部门层级超过上限")
	}
	if err := s.checkLeader(ctx, req.LeaderID); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if err := s.checkUnique(ctx, uuid.Nil, req.ParentID, name, req.Code); err != nil {
		return nil, err
	}
	status := req.Status
	if status == 0 {
		status = domain.StatusEnabled
	}
	dept := domain.Department{
		ParentID:  req.ParentID,
		Name:      name,
		Code:      req.Code,
		SortOrder: req.SortOrder,
		LeaderID:  req.LeaderID,
		Phone:     req.Phone,
		Email:     req.Email,
		Status:    status,
		Source:    domain.SourceLocal,
	}
	dept.ID = uuid.New()
	dept.TreePath = domain.DepartmentPath(parentPath, dept.ID)
	if err := s.deptRepo.Create(ctx, &dept); err != nil {
		return nil, err
	}
	return &dept, nil
}

func (s *departmentService) Update(ctx context.Context, id uuid.UUID, req domain.UpdateDepartmentRequest) (*domain.Department, error) {
	dept, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.checkLeader(ctx, req.LeaderID); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if err := s.checkUnique(ctx, dept.ID, dept.ParentID, name, req.Code); err != nil {
		return nil, err
	}
	dept.Name = name
	dept.Code = req.Code
	dept.SortOrder = req.SortOrder
	dept.LeaderID = req.LeaderID
	dept.Phone = req.Phone
	dept.Email = req.Email
	dept.Status = req.Status
	if err := s.deptRepo.Update(ctx, dept); err != nil {
		return nil, err
	}
	return dept, nil
}

func (s *departmentService) Move(ctx context.Context, id uuid.UUID, parentID *uuid.UUID) (*domain.Department, error) {
	dept, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if sameParent(dept.ParentID, parentID) {
		return dept, nil
	}
	newParentPath := domain.DepartmentRootPath
	if parentID != nil {
		if *parentID == id {
			return nil, coreerrors.ErrDepartmentInvalidParent.WithMessage("不能将部门移动到自身之下")
		}
		parent, err := s.loadParent(ctx, parentID)
		if err != nil {
			return nil, err
		}
		if strings.HasPrefix(parent.TreePath+"/", dept.TreePath+"/") {
			return nil, coreerrors.ErrDepartmentInvalidParent.WithMessage("不能将部门移动到其下级部门之下")
		}
		newParentPath = parent.TreePath
	}
	newPath := domain.DepartmentPath(newParentPath, dept.ID)
	subtree, err := s.deptRepo.ListSubtree(ctx, dept.TreePath)
	if err != nil {
		return nil, err
	}
	deepest := domain.DepartmentDepth(dept.TreePath)
	for _, d := range subtree {
		deepest = max(deepest, domain.DepartmentDepth(d.TreePath))
	}
	if deepest-domain.DepartmentDepth(dept.TreePath)+domain.DepartmentDepth(newPath) > domain.MaxDepartmentDepth {
		return nil, coreerrors.ErrDepartmentInvalidParent.WithMessage("移动后部门层级超过上限")
	}
	if err := s.checkUnique(ctx, dept.ID, parentID, dept.Name, dept.Code); err != nil {
		return nil, err
	}
	if err := s.deptRepo.Move(ctx, dept.ID, parentID, dept.TreePath, newPath); err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

func sameParent(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func (s *departmentService) Reorder(ctx context.Context, items []domain.DepartmentOrder) error {
	return s.deptRepo.Reorder(ctx, items)
}

func (s *departmentService) Delete(ctx context.Context, id uuid.UUID) error {
	if _, err := s.Get(ctx, id); err != nil {
		return err
	}
	children, err := s.deptRepo.CountChildren(ctx, id)
	if err != nil {
		return err
	}
	if children > 0 {
		return coreerrors.ErrDepartmentHasChildren
	}
	members, err := s.userRepo.CountByDepartmentIDs(ctx, []uuid.UUID{id})
	if err != nil {
		return err
	}
	if members > 0 {
		return coreerrors.ErrDepartmentHasMembers
	}
	return s.deptRepo.Delete(ctx, id)
}
