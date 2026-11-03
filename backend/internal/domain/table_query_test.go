package domain

import "testing"

func TestUserQueryValidation(t *testing.T) {
	for _, raw := range []string{
		`{"version":1,"search":"","filter":{"logic":"and","children":[{"field":"password","op":"eq","value":"x"}]},"sorts":[]}`,
		`{"version":1,"search":"","filter":{"logic":"and","children":[{"field":"status","op":"eq","value":[]}]},"sorts":[]}`,
		`{"version":1,"search":"","filter":{"logic":"and","children":[{"field":"status","op":"eq","value":{}}]},"sorts":[]}`,
		`{"version":1,"search":"","filter":{"logic":"and","children":[{"field":"edit_revision","op":"between","value":[3,1]}]},"sorts":[]}`,
		`{"version":1,"search":"","filter":{"logic":"and","children":[{"field":"created_at","op":"eq","value":"2026-10-28"}]},"sorts":[]}`,
		`{"version":1,"search":"","filter":{"logic":"and","children":[]},"sorts":[{"field":"username;DROP TABLE users","desc":true}]}`,
		`{"version":1,"search":"","filter":{"logic":"and","children":[]},"sorts":[{"field":"username","desc":true},{"field":"username","desc":false}]}`,
		`{"version":1,"version":1,"search":"","filter":{"logic":"and"},"sorts":[]}`,
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ParseUserQuery(raw); err == nil {
				t.Fatalf("accepted invalid query: %s", raw)
			}
		})
	}
	good := `{"version":1,"search":"Alice","filter":{"logic":"and","children":[{"logic":"or","children":[{"field":"status","op":"eq","value":1},{"field":"last_login_at","op":"empty"}]}]},"sorts":[{"field":"created_at","desc":true}]}`
	if _, err := ParseUserQuery(good); err != nil {
		t.Fatal(err)
	}
	q := TableQuery{Version: 1, Filter: QueryNode{Logic: "and"}}
	for range 21 {
		q.Filter.Children = append(q.Filter.Children, QueryNode{Field: "status", Op: "eq", Value: float64(1)})
	}
	if err := q.Validate(UserQueryFields); err == nil {
		t.Fatal("accepted 21 conditions")
	}
}
