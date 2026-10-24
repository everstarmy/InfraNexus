package bootstrap

import (
	"context"
	"time"

	"infranexus/internal/domain"
	"infranexus/internal/repository"
	"infranexus/internal/service"
)

// directoryModule owns directory persistence, services, events and scheduler lifecycle.
// Authentication and dashboard depend on its interfaces rather than its implementation.
type directoryModule struct {
	repo    domain.LDAPRepository
	service domain.LDAPService
	events  domain.SSEEventStore
}

func assembleDirectory(app *AppContainer, users domain.UserRepository, roles domain.RoleRepository, departments domain.DepartmentRepository, organization domain.OrganizationUnitOfWork) directoryModule {
	repo := repository.NewLDAPRepository(app.DB)
	events := repository.NewRedisEventStore(app.Redis)
	directory := service.NewLDAPService(service.LDAPServiceDeps{
		Repo: repo, Users: users, Roles: roles, Departments: departments, Organization: organization,
		Gateway: repository.NewLDAPGateway(), Cipher: app.Cipher, Events: events, Logger: app.Logger,
	})
	app.OnClose(directory.Close)
	if scheduler := app.Config.Directory.Scheduler; scheduler.Enabled {
		tick := time.Duration(scheduler.TickSeconds) * time.Second
		if tick <= 0 {
			tick = time.Minute
		}
		app.AddBackground(func(ctx context.Context) { service.RunDirectoryScheduler(ctx, directory, tick, app.Logger) })
	}
	return directoryModule{repo: repo, service: directory, events: events}
}
