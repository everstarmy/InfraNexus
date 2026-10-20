package config

import (
	"fmt"
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

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unable to decode into config struct: %w", err)
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
