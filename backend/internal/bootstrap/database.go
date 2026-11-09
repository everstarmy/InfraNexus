package bootstrap

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"infranexus/internal/config"
	"infranexus/internal/core/logger"
)

// InitDatabase opens the PostgreSQL database and configures its connection pool.
func InitDatabase(cfg *config.Config, log *slog.Logger) (*gorm.DB, error) {
	pg := cfg.Database
	dsn := pg.DSN
	if dsn == "" {
		conn := url.URL{
			Scheme:  "postgres",
			Host:    net.JoinHostPort(pg.Host, strconv.Itoa(pg.Port)),
			User:    url.UserPassword(pg.User, pg.Password),
			Path:    "/" + pg.DBName,
			RawPath: "/" + url.PathEscape(pg.DBName),
		}
		if pg.SSLMode != "" {
			conn.RawQuery = url.Values{"sslmode": {pg.SSLMode}}.Encode()
		}
		dsn = conn.String()
	}
	log.Info("Initializing PostgreSQL database")
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger:         logger.NewGORM(log, cfg.EffectiveLogging().SQL, "postgres"),
		TranslateError: true,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get sql.DB handle: %w", err)
	}

	// 配置连接池
	if pg.MaxIdleConns > 0 {
		sqlDB.SetMaxIdleConns(pg.MaxIdleConns)
	}
	if pg.MaxOpenConns > 0 {
		sqlDB.SetMaxOpenConns(pg.MaxOpenConns)
	}
	if pg.ConnMaxLifetime > 0 {
		sqlDB.SetConnMaxLifetime(time.Duration(pg.ConnMaxLifetime) * time.Second)
	}

	return db, nil
}
