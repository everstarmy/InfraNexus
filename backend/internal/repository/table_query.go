package repository

import (
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infranexus/internal/domain"
)

// Inputs have been validated against UserQueryFields before reaching this compiler.
// Identifiers are never taken from arbitrary request text; values are always bound.
func userQueryExpression(node domain.QueryNode) clause.Expression {
	if node.Logic != "" {
		expressions := make([]clause.Expression, 0, len(node.Children))
		for _, child := range node.Children {
			expressions = append(expressions, userQueryExpression(child))
		}
		if len(expressions) == 0 {
			return clause.Expr{SQL: "1 = 1"}
		}
		if node.Logic == "or" {
			return clause.Or(expressions...)
		}
		return clause.And(expressions...)
	}
	field := domain.UserQueryFields[node.Field]
	column := clause.Column{Table: "users", Name: node.Field}
	value := node.Value
	if field.Kind == "date" {
		convert := func(v any) time.Time { t, _ := time.Parse(time.RFC3339Nano, v.(string)); return t.UTC() }
		if values, ok := value.([]any); ok {
			value = []any{convert(values[0]), convert(values[1])}
		} else if value != nil {
			value = convert(value)
		}
	}
	switch node.Op {
	case "empty":
		return clause.Eq{Column: column, Value: nil}
	case "notEmpty":
		return clause.Neq{Column: column, Value: nil}
	case "contains":
		return clause.Expr{SQL: `LOWER(?) LIKE LOWER(?) ESCAPE '\'`, Vars: []any{column, containsPattern(value.(string))}}
	case "in":
		return clause.IN{Column: column, Values: value.([]any)}
	case "between":
		v := value.([]any)
		return clause.And(clause.Gte{Column: column, Value: v[0]}, clause.Lte{Column: column, Value: v[1]})
	case "gt":
		return clause.Gt{Column: column, Value: value}
	case "gte":
		return clause.Gte{Column: column, Value: value}
	case "lt":
		return clause.Lt{Column: column, Value: value}
	case "lte":
		return clause.Lte{Column: column, Value: value}
	}
	if field.Kind == "text" {
		operator := "="
		if node.Op == "ne" {
			operator = "<>"
		}
		return clause.Expr{SQL: "LOWER(?) " + operator + " LOWER(?)", Vars: []any{column, value}}
	}
	if node.Op == "ne" {
		return clause.Neq{Column: column, Value: value}
	}
	return clause.Eq{Column: column, Value: value}
}
func applyUserQuery(db *gorm.DB, q *domain.TableQuery) *gorm.DB {
	db = db.Where(userQueryExpression(q.Filter))
	if search := strings.TrimSpace(q.Search); search != "" {
		like := containsPattern(search)
		db = db.Where(`LOWER(users.username) LIKE LOWER(?) ESCAPE '\' OR LOWER(users.email) LIKE LOWER(?) ESCAPE '\' OR LOWER(users.nickname) LIKE LOWER(?) ESCAPE '\'`, like, like, like)
	}
	return db
}
func orderUserQuery(db *gorm.DB, q *domain.TableQuery) *gorm.DB {
	parts := make([]string, 0, len(q.Sorts)*2+1)
	vars := make([]any, 0, len(q.Sorts)*2)
	for _, sort := range q.Sorts {
		column := clause.Column{Table: "users", Name: sort.Field}
		direction := "ASC"
		if sort.Desc {
			direction = "DESC"
		}
		parts = append(parts, "? IS NULL ASC", "? "+direction)
		vars = append(vars, column, column)
	}
	if len(q.Sorts) == 0 {
		parts = append(parts, "users.created_at DESC")
	}
	parts = append(parts, "users.id ASC")
	return db.Order(clause.OrderBy{Expression: clause.Expr{SQL: strings.Join(parts, ", "), Vars: vars}})
}
