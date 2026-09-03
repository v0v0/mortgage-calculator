CREATE TABLE IF NOT EXISTS visitor_global (
  visitor_hash TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visitor_daily (
  day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);

CREATE TABLE IF NOT EXISTS daily_stats (
  day TEXT PRIMARY KEY,
  pv INTEGER NOT NULL DEFAULT 0,
  uv INTEGER NOT NULL DEFAULT 0,
  calculations INTEGER NOT NULL DEFAULT 0,
  exports INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visit_location_daily (
  day TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  city TEXT NOT NULL,
  pv INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, country, region, city)
);

CREATE TABLE IF NOT EXISTS calc_city_daily (
  day TEXT NOT NULL,
  city_id TEXT NOT NULL,
  city_name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, city_id)
);

CREATE TABLE IF NOT EXISTS calc_amount_daily (
  day TEXT NOT NULL,
  bucket_start_wan INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket_start_wan)
);

CREATE INDEX IF NOT EXISTS idx_visitor_daily_day ON visitor_daily(day);
CREATE INDEX IF NOT EXISTS idx_location_daily_day ON visit_location_daily(day);
CREATE INDEX IF NOT EXISTS idx_calc_city_daily_day ON calc_city_daily(day);
CREATE INDEX IF NOT EXISTS idx_calc_amount_daily_day ON calc_amount_daily(day);
