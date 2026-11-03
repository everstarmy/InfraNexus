package config

import (
	"fmt"
	"net/netip"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	App       AppConfig       `mapstructure:"app"`
	Database  DatabaseConfig  `mapstructure:"database"`
	Redis     RedisConfig     `mapstructure:"redis"`
	Session   SessionConfig   `mapstructure:"session"`
	Security  SecurityConfig  `mapstructure:"security"`
	JWT       JWTConfig       `mapstructure:"jwt"`
	Storage   StorageConfig   `mapstructure:"storage"`
	Directory DirectoryConfig `mapstructure:"ldap"`
	Retention RetentionConfig `mapstructure:"retention"`
	Logging   LoggingConfig   `mapstructure:"logging"`
}

type RetentionConfig struct {
	Enabled     bool `mapstructure:"enabled"`
	OutboxDays  int  `mapstructure:"outbox_days"`
	SyncLogDays int  `mapstructure:"sync_log_days"`
}

type AppConfig struct {
	Name  string `mapstructure:"name"`
	Env   string `mapstructure:"env"`
	Port  string `mapstructure:"port"`
	Debug bool   `mapstructure:"debug"`
}

type DatabaseConfig struct {
	Driver   string         `mapstructure:"driver"` // "sqlite" | "postgres"
	SQLite   SQLiteConfig   `mapstructure:"sqlite"`
	Postgres PostgresConfig `mapstructure:"postgres"`
	Pool     PoolConfig     `mapstructure:"pool"`
}

type SQLiteConfig struct {
	DBPath string `mapstructure:"dbpath"`
}

type PostgresConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	DBName   string `mapstructure:"dbname"`
	SSLMode  string `mapstructure:"sslmode"`
}

type PoolConfig struct {
	MaxIdleConns    int `mapstructure:"max_idle_conns"`
	MaxOpenConns    int `mapstructure:"max_open_conns"`
	ConnMaxLifetime int `mapstructure:"conn_max_lifetime"`
}

type RedisConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
	PoolSize int    `mapstructure:"pool_size"`
}

type SessionConfig struct {
	CookieName     string `mapstructure:"cookie_name"`
	MaxAge         int    `mapstructure:"max_age"`
	AbsoluteMaxAge int    `mapstructure:"absolute_max_age"`
	Domain         string `mapstructure:"domain"`
	Secure         bool   `mapstructure:"secure"`
	SameSite       string `mapstructure:"same_site"`
}

type SecurityConfig struct {
	TrustedProxies []string `mapstructure:"trusted_proxies"`
	TrustedOrigins []string `mapstructure:"trusted_origins"`
	LoginRateLimit int      `mapstructure:"login_rate_limit"`
	EncryptionKey  string   `mapstructure:"encryption_key"`
}

type DirectoryConfig struct {
	Scheduler DirectorySchedulerConfig `mapstructure:"scheduler"`
}

type DirectorySchedulerConfig struct {
	Enabled     bool `mapstructure:"enabled"`
	TickSeconds int  `mapstructure:"tick_seconds"`
}

type JWTConfig struct {
	Secret             string `mapstructure:"secret"`
	AccessTokenExpire  int    `mapstructure:"access_token_expire"`
	RefreshTokenExpire int    `mapstructure:"refresh_token_expire"`
	Issuer             string `mapstructure:"issuer"`
}

type StorageConfig struct {
	Driver string   `mapstructure:"driver"` // "memory" | "sqlite3" | "postgres" | "redis" | "s3"
	S3     S3Config `mapstructure:"s3"`
}

type S3Config struct {
	Bucket    string `mapstructure:"bucket"`
	Endpoint  string `mapstructure:"endpoint"`
	Region    string `mapstructure:"region"`
	AccessKey string `mapstructure:"access_key"`
	SecretKey string `mapstructure:"secret_key"`
}

func LoadConfig(path ...string) (*Config, error) {
	v := viper.New()

	v.SetConfigName("config")
	v.SetConfigType("yaml")

	if len(path) > 0 && path[0] != "" {
		v.AddConfigPath(path[0])
	}
	v.AddConfigPath(".")
	v.AddConfigPath("./backend")

	// 环境变量支持 APP_
	v.SetEnvPrefix("APP")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("failed to read configuration: %w", err)
	}
	setLoggingDefaults(v)
	v.SetDefault("retention.enabled", true)
	v.SetDefault("retention.outbox_days", 30)
	v.SetDefault("retention.sync_log_days", 90)
	v.SetDefault("app.env", "development")
	v.SetDefault("session.max_age", 1800)
	v.SetDefault("session.absolute_max_age", 604800)
	v.SetDefault("jwt.access_token_expire", 900)
	v.SetDefault("jwt.refresh_token_expire", 604800)
	v.SetDefault("security.trusted_proxies", []string{})

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unable to decode into config struct: %w", err)
	}
	if err := cfg.ValidateRuntime(); err != nil {
		return nil, err
	}
	if cfg.Retention.OutboxDays < 1 || cfg.Retention.SyncLogDays < 1 {
		return nil, fmt.Errorf("retention periods must be positive days")
	}
	if cfg.Session.MaxAge <= 0 || cfg.Session.AbsoluteMaxAge < cfg.Session.MaxAge {
		return nil, fmt.Errorf("session lifetimes must be positive and absolute_max_age must be at least max_age")
	}
	if cfg.JWT.AccessTokenExpire <= 0 || cfg.JWT.RefreshTokenExpire < cfg.JWT.AccessTokenExpire {
		return nil, fmt.Errorf("JWT lifetimes must be positive and refresh lifetime must be at least access lifetime")
	}
	if err := cfg.Logging.Validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func MustLoad(path ...string) *Config {
	cfg, err := LoadConfig(path...)
	if err != nil {
		panic(fmt.Sprintf("Failed to load application config: %v", err))
	}
	return cfg
}

// ValidateRuntime rejects unsafe environment names and malformed proxy allowlists.
func (c *Config) ValidateRuntime() error {
	switch c.App.Env {
	case "development", "test", "production":
	default:
		return fmt.Errorf("app.env must be development, test or production")
	}
	for _, proxy := range c.Security.TrustedProxies {
		if _, err := netip.ParseAddr(proxy); err != nil {
			if _, err := netip.ParsePrefix(proxy); err != nil {
				return fmt.Errorf("security.trusted_proxies must contain IP addresses or CIDRs")
			}
		}
	}
	return nil
}
