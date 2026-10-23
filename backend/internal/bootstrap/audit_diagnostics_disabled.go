//go:build !r09audit

package bootstrap

// StartAuditDiagnostics is a no-op in ordinary builds.
func StartAuditDiagnostics(*AppContainer) func() { return func() {} }
