package domain

import "context"

type HealthRepository interface{ Check(context.Context) error }
type HealthService interface{ Ready(context.Context) error }
type HealthStatus struct {
	Status string `json:"status"`
}
