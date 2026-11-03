package bootstrap

// StartupError carries an allowlisted diagnostic without exposing the underlying
// configuration or driver error. The original cause remains available via Unwrap.
type StartupError struct {
	Stage  string
	Reason string
	hint   string
	cause  error
}

func (e *StartupError) Error() string { return e.hint }
func (e *StartupError) Unwrap() error { return e.cause }

func startupFailure(stage, reason, hint string, cause error) error {
	return &StartupError{Stage: stage, Reason: reason, hint: hint, cause: cause}
}
