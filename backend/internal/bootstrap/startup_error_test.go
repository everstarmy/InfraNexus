package bootstrap

import (
	"errors"
	"fmt"
	"testing"
)

func TestStartupFailurePreservesCause(t *testing.T) {
	cause := errors.New("CREDENTIAL_SENTINEL")
	err := fmt.Errorf("initialize: %w", startupFailure("database", "database_initialization_failed", "Check database configuration, credentials and connectivity", cause))
	failure, ok := errors.AsType[*StartupError](err)
	if !ok || failure.Stage != "database" || failure.Reason != "database_initialization_failed" {
		t.Fatal("missing startup classification")
	}
	if !errors.Is(err, cause) {
		t.Fatal("lost original cause")
	}
	if failure.Error() != "Check database configuration, credentials and connectivity" {
		t.Fatal("diagnostic must contain only fixed safe text")
	}
}
