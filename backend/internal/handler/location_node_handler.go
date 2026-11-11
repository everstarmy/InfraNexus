package handler

import (
	json "encoding/json/v2"
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
	"gorm.io/gorm"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/core/response"
	"infranexus/internal/domain"
)

func locationNodeError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return coreerrors.ErrResourceConflict.WithMessage("同级名称或机柜坐标已存在")
	}
	if errors.Is(err, gorm.ErrCheckConstraintViolated) {
		return coreerrors.ErrResourceConflict.WithMessage("节点状态或层级与其上级或子节点冲突")
	}
	return managedError(err)
}

func RegisterLocationNodeRoutes(router fiber.Router, svc domain.LocationTreeService, authz domain.AuthorizationService) {
	types := []domain.LocationType{domain.LocationDatacenter, domain.LocationBuilding, domain.LocationRoom, domain.LocationRack}
	allowed := func(c fiber.Ctx) ([]domain.LocationType, error) {
		p, err := currentPrincipal(c)
		if err != nil {
			return nil, err
		}
		codes, admin, err := authz.EffectivePermissions(c.Context(), p.Roles)
		if err != nil {
			return nil, err
		}
		if admin {
			return types, nil
		}
		var out []domain.LocationType
		for _, kind := range types {
			if slices.Contains(codes, "locations:nodes:type:"+string(kind)) {
				out = append(out, kind)
			}
		}
		return out, nil
	}
	check := func(c fiber.Ctx, id uuid.UUID) error {
		kinds, err := allowed(c)
		if err != nil {
			return err
		}
		kind, err := svc.GetType(c.Context(), id)
		if err != nil {
			return locationNodeError(err)
		}
		if !slices.Contains(kinds, kind) {
			return coreerrors.ErrPermissionDenied
		}
		return nil
	}

	list := func(search bool) fiber.Handler {
		return func(c fiber.Ctx) error {
			page, size := pageParams(c, 25)
			size = min(size, 100)
			filter, err := managedQuery(c)
			if err != nil {
				return err
			}
			kinds, err := allowed(c)
			if err != nil {
				return err
			}
			visibleKinds := kinds
			q := domain.LocationNodeQuery{VisibleTypes: visibleKinds, Status: filter.Status, Page: page, PageSize: size, Search: filter.Search, AcrossParents: search, Types: kinds}
			if raw := c.Query("parent"); raw != "" && raw != "root" {
				id, err := uuid.Parse(raw)
				if err != nil || id == uuid.Nil {
					return coreerrors.ErrParamInvalid
				}
				q.Parent = &id
			}
			if raw := c.Query("type"); raw != "" {
				kind := domain.LocationType(raw)
				if _, ok := kind.ParentType(); !ok {
					return coreerrors.ErrParamInvalid
				}
				if !slices.Contains(kinds, kind) {
					return coreerrors.ErrPermissionDenied
				}
				q.Types = []domain.LocationType{kind}
			}
			if raw := c.Query("floor"); raw != "" {
				floor, err := strconv.Atoi(raw)
				if err != nil || floor < -5 || floor > 100 {
					return coreerrors.ErrParamInvalid
				}
				q.Floor = &floor
			}
			if raw := c.Query("column"); raw != "" {
				column, err := strconv.Atoi(raw)
				if err != nil || column < 1 || column > 9999 {
					return coreerrors.ErrParamInvalid
				}
				q.Column = &column
			}
			q.Row = strings.ToUpper(strings.TrimSpace(c.Query("row")))
			if len(q.Row) > 2 {
				return coreerrors.ErrParamInvalid
			}
			items, total, err := svc.List(c.Context(), q)
			if err != nil {
				return locationNodeError(err)
			}
			return response.Page(c, items, total, page, size)
		}
	}
	router.Get("", list(false))
	router.Get("/search", list(true))
	router.Post("", func(c fiber.Ctx) error {
		var input domain.LocationFields
		if err := json.Unmarshal(c.Body(), &input, json.RejectUnknownMembers(true)); err != nil {
			return coreerrors.ErrParamInvalid
		}
		actor, err := managedActor(c)
		if err != nil {
			return err
		}
		kinds, err := allowed(c)
		if err != nil {
			return err
		}
		if _, ok := input.Type.ParentType(); !ok {
			return coreerrors.ErrParamInvalid
		}
		if !slices.Contains(kinds, input.Type) {
			return coreerrors.ErrPermissionDenied
		}
		node, err := svc.Create(c.Context(), actor, c.Get("Idempotency-Key"), input)
		if err != nil {
			return locationNodeError(err)
		}
		return response.Success(c, node)
	})
	router.Get("/:id/history", func(c fiber.Ctx) error {
		id, err := parseIDParam(c)
		if err != nil {
			return err
		}
		if err := check(c, id); err != nil {
			return err
		}
		q, err := managedQuery(c)
		if err != nil {
			return err
		}
		items, total, err := svc.History(c.Context(), id, q)
		if err != nil {
			return locationNodeError(err)
		}
		return response.Page(c, items, total, q.Page, q.PageSize)
	})
	router.Get("/:id", func(c fiber.Ctx) error {
		id, err := parseIDParam(c)
		if err != nil {
			return err
		}
		if err := check(c, id); err != nil {
			return err
		}
		node, err := svc.Get(c.Context(), id)
		if err != nil {
			return locationNodeError(err)
		}
		return response.Success(c, node)
	})
	router.Get("/:id/units", func(c fiber.Ctx) error {
		id, err := parseIDParam(c)
		if err != nil {
			return err
		}
		if err := check(c, id); err != nil {
			return err
		}
		units, err := svc.Units(c.Context(), id)
		if err != nil {
			return locationNodeError(err)
		}
		return response.Success(c, units)
	})
	router.Get("/:id/references", func(c fiber.Ctx) error {
		id, err := parseIDParam(c)
		if err != nil {
			return err
		}
		if err := check(c, id); err != nil {
			return err
		}
		refs, err := svc.References(c.Context(), id)
		if err != nil {
			return locationNodeError(err)
		}
		return response.Success(c, refs)
	})
	change := func(action string) fiber.Handler {
		return func(c fiber.Ctx) error {
			id, err := parseIDParam(c)
			if err != nil {
				return err
			}
			if err := check(c, id); err != nil {
				return err
			}
			input := domain.LocationChange{Action: action}
			if action == "delete" {
				input.Version, err = strconv.ParseInt(c.Query("version"), 10, 64)
			} else {
				err = json.Unmarshal(c.Body(), &input, json.RejectUnknownMembers(true))
			}
			if err != nil || input.Version < 1 {
				return coreerrors.ErrParamInvalid
			}
			actor, err := managedActor(c)
			if err != nil {
				return err
			}
			node, err := svc.Change(c.Context(), actor, id, input)
			if err != nil {
				return locationNodeError(err)
			}
			return response.Success(c, node)
		}
	}
	router.Put("/:id", change("update"))
	router.Patch("/:id/status", change("status"))
	router.Put("/:id/security-zone", change("security-zone"))
	router.Delete("/:id", change("delete"))
}
