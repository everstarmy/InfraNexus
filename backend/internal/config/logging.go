package config

import (
	"fmt"
	"slices"

	"github.com/spf13/viper"
)

// LoggingConfig controls independent application and SQL log streams.
type LoggingConfig struct {
	Format    string        `mapstructure:"format"`
	Output    string        `mapstructure:"output"`
	Level     string        `mapstructure:"level"`
	AddSource bool          `mapstructure:"add_source"`
	File      LogFileConfig `mapstructure:"file"`
	SQL       SQLLogConfig  `mapstructure:"sql"`
}

type LogFileConfig struct {
	Directory  string `mapstructure:"directory"`
	MaxSizeMB  int    `mapstructure:"max_size_mb"`
	MaxBackups int    `mapstructure:"max_backups"`
	MaxAgeDays int    `mapstructure:"max_age_days"`
	Compress   bool   `mapstructure:"compress"`
}

type SQLLogConfig struct {
	Enabled         bool   `mapstructure:"enabled"`
	Level           string `mapstructure:"level"`
	SlowThresholdMS int    `mapstructure:"slow_threshold_ms"`
	MaxSQLLength    int    `mapstructure:"max_sql_length"`
}

func DefaultLogging(debug bool, env string) LoggingConfig {
	c := LoggingConfig{
		Format: "json", Output: "stdout", Level: "info",
		File: LogFileConfig{Directory: "./logs", MaxSizeMB: 100, MaxBackups: 10, MaxAgeDays: 14, Compress: true},
		SQL:  SQLLogConfig{Enabled: true, Level: "warn", SlowThresholdMS: 200, MaxSQLLength: 4096},
	}
	if debug {
		c.Level, c.AddSource, c.SQL.Level = "debug", true, "info"
		if env != "production" {
			c.Format = "text"
		}
	}
	return c
}

// EffectiveLogging also supports callers constructing Config directly in tests.
func (c *Config) EffectiveLogging() LoggingConfig {
	if c.Logging == (LoggingConfig{}) {
		return DefaultLogging(c.App.Debug, c.App.Env)
	}
	return c.Logging
}

func (c LoggingConfig) Validate() error {
	if !slices.Contains([]string{"text", "json"}, c.Format) ||
		!slices.Contains([]string{"stdout", "file", "both"}, c.Output) ||
		!slices.Contains([]string{"debug", "info", "warn", "error"}, c.Level) ||
		!slices.Contains([]string{"silent", "error", "warn", "info"}, c.SQL.Level) {
		return fmt.Errorf("invalid logging format, output or level")
	}
	if c.File.Directory == "" || c.File.MaxSizeMB <= 0 || c.File.MaxBackups <= 0 || c.File.MaxAgeDays <= 0 ||
		c.SQL.SlowThresholdMS < 0 || c.SQL.MaxSQLLength <= 0 || c.SQL.MaxSQLLength > 4096 {
		return fmt.Errorf("invalid logging file limits, directory or SQL limits")
	}
	return nil
}

func setLoggingDefaults(v *viper.Viper) {
	c := DefaultLogging(v.GetBool("app.debug"), v.GetString("app.env"))
	// Register every leaf so AutomaticEnv values participate in Unmarshal even
	// when a logging key is absent from YAML. Explicit false/zero is preserved.
	for key, value := range map[string]any{
		"format": c.Format, "output": c.Output, "level": c.Level, "add_source": c.AddSource,
		"file.directory": c.File.Directory, "file.max_size_mb": c.File.MaxSizeMB,
		"file.max_backups": c.File.MaxBackups, "file.max_age_days": c.File.MaxAgeDays, "file.compress": c.File.Compress,
		"sql.enabled": c.SQL.Enabled, "sql.level": c.SQL.Level,
		"sql.slow_threshold_ms": c.SQL.SlowThresholdMS, "sql.max_sql_length": c.SQL.MaxSQLLength,
	} {
		v.SetDefault("logging."+key, value)
	}
}
