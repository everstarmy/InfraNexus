package bootstrap

import (
	"fmt"
	stdlog "log"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"infranexus/internal/config"
)

// InitDatabase 初始化 GORM 双引擎 (SQLite / PostgreSQL)
func InitDatabase(cfg *config.Config, log *slog.Logger) (*gorm.DB, error) {
	var dialector gorm.Dialector

	logMode := gormlogger.Warn
	if cfg.App.Debug {
		logMode = gormlogger.Info
	}

	gormConfig := &gorm.Config{
		Logger: gormlogger.New(stdlog.New(os.Stdout, "\r\n", stdlog.LstdFlags), gormlogger.Config{
			SlowThreshold:             200 * time.Millisecond,
			LogLevel:                  logMode,
			IgnoreRecordNotFoundError: true,
			Colorful:                  cfg.App.Debug,
		}),
		TranslateError: true,
	}

	switch cfg.Database.Driver {
	case "sqlite":
		// 确保 SQLite 数据目录存在
		dbDir := filepath.Dir(cfg.Database.SQLite.DBPath)
		if err := os.MkdirAll(dbDir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create sqlite database directory: %w", err)
		}
		dialector = sqlite.Open(cfg.Database.SQLite.DBPath)
		log.Info("Initializing SQLite database", "path", cfg.Database.SQLite.DBPath)

	case "postgres":
		dsn := fmt.Sprintf(
			"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
			cfg.Database.Postgres.Host,
			cfg.Database.Postgres.Port,
			cfg.Database.Postgres.User,
			cfg.Database.Postgres.Password,
			cfg.Database.Postgres.DBName,
			cfg.Database.Postgres.SSLMode,
		)
		dialector = postgres.Open(dsn)
		log.Info("Initializing PostgreSQL database", "host", cfg.Database.Postgres.Host, "db", cfg.Database.Postgres.DBName)

	default:
		return nil, fmt.Errorf("unsupported database driver: %s", cfg.Database.Driver)
	}

	db, err := gorm.Open(dialector, gormConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to connect database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("failed to get sql.DB handle: %w", err)
	}

	// 配置连接池
	if cfg.Database.Pool.MaxIdleConns > 0 {
		sqlDB.SetMaxIdleConns(cfg.Database.Pool.MaxIdleConns)
	}
	if cfg.Database.Pool.MaxOpenConns > 0 {
		sqlDB.SetMaxOpenConns(cfg.Database.Pool.MaxOpenConns)
	}
	if cfg.Database.Pool.ConnMaxLifetime > 0 {
		sqlDB.SetConnMaxLifetime(time.Duration(cfg.Database.Pool.ConnMaxLifetime) * time.Second)
	}

	return db, nil
}
