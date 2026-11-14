package domain

import (
	"database/sql/driver"
	"fmt"
	"time"
)

// AssetDate is a calendar date, without a timezone or time of day.
type AssetDate string

func (d *AssetDate) Scan(value any) error {
	switch v := value.(type) {
	case time.Time:
		*d = AssetDate(v.Format(time.DateOnly))
	case string:
		parsed, err := time.Parse(time.DateOnly, v)
		if err != nil {
			return fmt.Errorf("scan asset date: %w", err)
		}
		*d = AssetDate(parsed.Format(time.DateOnly))
	case []byte:
		return d.Scan(string(v))
	case nil:
		*d = ""
	default:
		return fmt.Errorf("unsupported asset date type %T", value)
	}
	return nil
}

func (d AssetDate) Value() (driver.Value, error) {
	parsed, err := time.Parse(time.DateOnly, string(d))
	if err != nil {
		return nil, fmt.Errorf("encode asset date: %w", err)
	}
	return parsed.Format(time.DateOnly), nil
}
