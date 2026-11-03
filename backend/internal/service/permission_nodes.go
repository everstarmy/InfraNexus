package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

// Nodes pages siblings only. Ancestors of matches remain visible; descendants do not consume root slots.
func (s *permissionService) Nodes(ctx context.Context, parent *uuid.UUID, keyword string, page, pageSize int) (*domain.PermissionNodePage, error) {
	if page < 1 || page > 100000 || pageSize < 1 || pageSize > 100 || len([]rune(keyword)) > 200 {
		return nil, coreerrors.ErrParamInvalid
	}
	tree, err := s.permRepo.GetTree(ctx)
	if err != nil {
		return nil, err
	}
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	result := &domain.PermissionNodePage{Items: []domain.PermissionNode{}, Page: page, PageSize: pageSize}
	var prune func([]domain.Permission) []domain.Permission
	prune = func(nodes []domain.Permission) []domain.Permission {
		out := []domain.Permission{}
		for _, node := range nodes {
			children := prune(node.Children)
			matches := keyword == "" || strings.Contains(strings.ToLower(node.Name+" "+node.Code+" "+node.Path), keyword)
			if matches {
				result.MatchedNodes++
			}
			if matches || len(children) > 0 {
				node.Children = children
				out = append(out, node)
				result.RetainedNodes++
			}
		}
		return out
	}
	filtered := prune(tree)
	result.RootTotal = len(filtered)
	siblings := filtered
	if parent != nil {
		if *parent == uuid.Nil {
			return nil, coreerrors.ErrParamInvalid
		}
		found := false
		var visit func([]domain.Permission)
		visit = func(nodes []domain.Permission) {
			for _, node := range nodes {
				if node.ID == *parent {
					siblings = node.Children
					found = true
					return
				}
				visit(node.Children)
				if found {
					return
				}
			}
		}
		visit(filtered)
		if !found {
			return nil, coreerrors.ErrPermissionNotFound
		}
	}
	result.Total = len(siblings)
	start := min((page-1)*pageSize, len(siblings))
	end := min(start+pageSize, len(siblings))
	for _, node := range siblings[start:end] {
		hasChildren := len(node.Children) > 0
		node.Children = nil
		result.Items = append(result.Items, domain.PermissionNode{Permission: node, HasChildren: hasChildren})
	}
	return result, nil
}
