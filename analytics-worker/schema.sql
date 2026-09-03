CREATE TABLE IF NOT EXISTS visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS visit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calc_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  city_id TEXT NOT NULL,
  city_name TEXT NOT NULL,
  house_price_wan REAL NOT NULL,
  loan_amount_wan REAL NOT NULL,
  loan_ratio REAL NOT NULL,
  loan_type TEXT NOT NULL,
  repayment_method TEXT NOT NULL,
  home_type TEXT NOT NULL,
  term_years INTEGER NOT NULL,
  provident_amount_wan REAL NOT NULL DEFAULT 0,
  commercial_rate REAL NOT NULL DEFAULT 0,
  provident_rate REAL NOT NULL DEFAULT 0,
  prepayment_count INTEGER NOT NULL DEFAULT 0,
  prepayment_total_wan REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS export_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  day TEXT NOT NULL,
  month TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  city_id TEXT NOT NULL,
  city_name TEXT NOT NULL,
  house_price_wan REAL NOT NULL,
  loan_amount_wan REAL NOT NULL,
  loan_type TEXT NOT NULL,
  repayment_method TEXT NOT NULL,
  detail_view TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visit_events_day ON visit_events(day);
CREATE INDEX IF NOT EXISTS idx_visit_events_month ON visit_events(month);
CREATE INDEX IF NOT EXISTS idx_visit_events_geo ON visit_events(country, region);
CREATE INDEX IF NOT EXISTS idx_calc_events_day ON calc_events(day);
CREATE INDEX IF NOT EXISTS idx_calc_events_month ON calc_events(month);
CREATE INDEX IF NOT EXISTS idx_calc_events_type ON calc_events(loan_type, repayment_method);
CREATE INDEX IF NOT EXISTS idx_export_events_day ON export_events(day);
CREATE INDEX IF NOT EXISTS idx_export_events_month ON export_events(month);
