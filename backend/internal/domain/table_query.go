package domain

import (
	"encoding/json/v2"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"
)

// TableQuery is versioned independently of legacy list parameters.
type TableQuery struct {
	Version int         `json:"version"`
	Search  string      `json:"search"`
	Filter  QueryNode   `json:"filter"`
	Sorts   []QuerySort `json:"sorts"`
}
type QuerySort struct {
	Field string `json:"field"`
	Desc  bool   `json:"desc"`
}
type QueryNode struct {
	Logic    string      `json:"logic,omitempty"`
	Children []QueryNode `json:"children,omitempty"`
	Field    string      `json:"field,omitempty"`
	Op       string      `json:"op,omitempty"`
	Value    any         `json:"value,omitempty"`
}
type QueryField struct {
	Kind     string
	Nullable bool
	Values   []any
}

// This allowlist intentionally excludes credentials, tokens and internal auth state.
var UserQueryFields = map[string]QueryField{
	"username": {Kind: "text"}, "nickname": {Kind: "text"}, "email": {Kind: "text"},
	"status":    {Kind: "enum", Values: []any{float64(1), float64(2)}},
	"auth_type": {Kind: "enum", Values: []any{"local", "ad", "ldap"}},
	"built_in":  {Kind: "boolean"}, "edit_revision": {Kind: "number"},
	"created_at": {Kind: "date"}, "last_login_at": {Kind: "date", Nullable: true},
}

func ParseUserQuery(raw string) (*TableQuery, error) {
	if raw == "" {
		return nil, nil
	}
	if len(raw) > 8192 {
		return nil, fmt.Errorf("query too long")
	}
	var q TableQuery
	if err := json.Unmarshal([]byte(raw), &q, json.RejectUnknownMembers(true)); err != nil {
		return nil, err
	}
	if err := q.Validate(UserQueryFields); err != nil {
		return nil, err
	}
	return &q, nil
}
func (q TableQuery) Validate(fields map[string]QueryField) error {
	if q.Version != 1 || len([]rune(q.Search)) > 200 || len(q.Sorts) > 3 || q.Filter.Logic == "" {
		return fmt.Errorf("invalid query")
	}
	seen := map[string]bool{}
	for _, sort := range q.Sorts {
		if _, ok := fields[sort.Field]; !ok || seen[sort.Field] {
			return fmt.Errorf("invalid sort")
		}
		seen[sort.Field] = true
	}
	count := 0
	var visit func(QueryNode, int) error
	visit = func(n QueryNode, depth int) error {
		if n.Logic != "" {
			if depth > 3 || (n.Logic != "and" && n.Logic != "or") || n.Field != "" || n.Op != "" || n.Value != nil || len(n.Children) > 20 {
				return fmt.Errorf("invalid group")
			}
			for _, child := range n.Children {
				if err := visit(child, depth+1); err != nil {
					return err
				}
			}
			return nil
		}
		count++
		f, ok := fields[n.Field]
		if !ok || count > 20 || len(n.Children) > 0 {
			return fmt.Errorf("invalid field")
		}
		if n.Op == "empty" || n.Op == "notEmpty" {
			if f.Nullable && n.Value == nil {
				return nil
			}
			return fmt.Errorf("invalid empty operator")
		}
		allowed := []string{"eq", "ne"}
		switch f.Kind {
		case "text":
			allowed = append(allowed, "contains")
		case "enum":
			allowed = append(allowed, "in")
		case "number", "date":
			allowed = append(allowed, "gt", "gte", "lt", "lte", "between")
		}
		if !slices.Contains(allowed, n.Op) {
			return fmt.Errorf("invalid operator")
		}
		scalar := func(v any) bool {
			switch f.Kind {
			case "text":
				s, ok := v.(string)
				return ok && len([]rune(s)) <= 200
			case "number":
				x, ok := v.(float64)
				return ok && !math.IsNaN(x) && !math.IsInf(x, 0) && math.Abs(x) <= 9007199254740991
			case "boolean":
				_, ok := v.(bool)
				return ok
			case "date":
				s, ok := v.(string)
				if !ok {
					return false
				}
				_, err := time.Parse(time.RFC3339Nano, s)
				return err == nil
			case "enum":
				switch v.(type) {
				case string, float64:
					return slices.Contains(f.Values, v)
				default:
					return false
				}
			}
			return false
		}
		if n.Op == "in" || n.Op == "between" {
			values, ok := n.Value.([]any)
			if !ok || len(values) == 0 || len(values) > 50 || (n.Op == "between" && len(values) != 2) {
				return fmt.Errorf("invalid range")
			}
			for _, v := range values {
				if !scalar(v) {
					return fmt.Errorf("invalid value")
				}
			}
			if n.Op == "between" {
				if f.Kind == "number" && values[0].(float64) > values[1].(float64) {
					return fmt.Errorf("reversed range")
				}
				if f.Kind == "date" {
					a, _ := time.Parse(time.RFC3339Nano, values[0].(string))
					b, _ := time.Parse(time.RFC3339Nano, values[1].(string))
					if a.After(b) {
						return fmt.Errorf("reversed range")
					}
				}
			}
		} else if !scalar(n.Value) {
			return fmt.Errorf("invalid value")
		}
		return nil
	}
	return visit(q.Filter, 1)
}

func (q TableQuery) TrimmedSearch() string { return strings.TrimSpace(q.Search) }
