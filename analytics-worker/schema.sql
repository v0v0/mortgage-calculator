CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_visits (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS geo_visits (
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  city TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (country, region, city)
);

CREATE TABLE IF NOT EXISTS calc_city (
  city_id TEXT PRIMARY KEY,
  city_name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calc_amount_bucket (
  bucket_wan INTEGER PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_geo_visits_count ON geo_visits(count DESC);
CREATE INDEX IF NOT EXISTS idx_calc_city_count ON calc_city(count DESC);
CREATE INDEX IF NOT EXISTS idx_calc_amount_count ON calc_amount_bucket(count DESC);
