let schemaPromise = null;

const SCHEMA = `
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
CREATE INDEX IF NOT EXISTS idx_visit_events_geo ON visit_events(country,region);
CREATE INDEX IF NOT EXISTS idx_calc_events_day ON calc_events(day);
CREATE INDEX IF NOT EXISTS idx_calc_events_month ON calc_events(month);
CREATE INDEX IF NOT EXISTS idx_calc_events_type ON calc_events(loan_type,repayment_method);
CREATE INDEX IF NOT EXISTS idx_export_events_day ON export_events(day);
CREATE INDEX IF NOT EXISTS idx_export_events_month ON export_events(month);
`;

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'cache-control': 'no-store'
    }
  });
}

function configuredOrigin(env) {
  return env.ALLOWED_ORIGIN || 'https://v0v0.github.io';
}

function requestOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return configuredOrigin(env);
  return origin === configuredOrigin(env) ? origin : null;
}

function timeParts() {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  return { ts: now.toISOString(), day, month: day.slice(0, 7) };
}

function geo(request) {
  const cf = request.cf || {};
  return {
    country: String(cf.country || 'UNKNOWN').slice(0, 32),
    region: String(cf.region || 'UNKNOWN').slice(0, 128)
  };
}

function text(value, max = 128) {
  return String(value ?? '').trim().slice(0, max);
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function visitorIdFrom(body) {
  const id = text(body?.visitorId, 128);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(id)) return '';
  return id;
}

async function ensureSchema(env) {
  if (!schemaPromise) schemaPromise = env.DB.exec(SCHEMA);
  try {
    await schemaPromise;
  } catch (error) {
    schemaPromise = null;
    throw error;
  }
}

async function recordVisit(request, env) {
  const body = await request.json().catch(() => ({}));
  const visitorId = visitorIdFrom(body);
  if (!visitorId) return { ok: false, status: 400, error: 'invalid visitor id' };
  const g = geo(request);
  const t = timeParts();

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO visitors(visitor_id,first_seen,last_seen,country,region,visit_count)
      VALUES(?,?,?,?,?,1)
      ON CONFLICT(visitor_id) DO UPDATE SET
        last_seen=excluded.last_seen,
        country=excluded.country,
        region=excluded.region,
        visit_count=visitors.visit_count+1`)
      .bind(visitorId, t.ts, t.ts, g.country, g.region),
    env.DB.prepare('INSERT INTO visit_events(ts,day,month,visitor_id,country,region) VALUES(?,?,?,?,?,?)')
      .bind(t.ts, t.day, t.month, visitorId, g.country, g.region)
  ]);

  return { ok: true };
}

function mortgagePayload(body) {
  const visitorId = visitorIdFrom(body);
  const cityId = text(body.city, 64);
  const cityName = text(body.cityName || cityId, 64);
  const housePriceWan = finite(body.housePriceWan, -1);
  const loanAmountWan = finite(body.loanAmountWan, -1);
  const loanRatio = finite(body.loanRatio, 0);
  const loanType = text(body.loanType, 32);
  const repaymentMethod = text(body.repaymentMethod, 32);
  const homeType = text(body.homeType, 16);
  const termYears = Math.max(0, Math.min(100, Math.round(finite(body.termYears, 0))));
  const providentAmountWan = Math.max(0, finite(body.providentAmountWan, 0));
  const commercialRate = Math.max(0, finite(body.commercialRate, 0));
  const providentRate = Math.max(0, finite(body.providentRate, 0));
  const prepaymentCount = Math.max(0, Math.min(100, Math.round(finite(body.prepaymentCount, 0))));
  const prepaymentTotalWan = Math.max(0, finite(body.prepaymentTotalWan, 0));

  if (!visitorId || !cityId || housePriceWan <= 0 || housePriceWan > 100000 ||
      loanAmountWan < 0 || loanAmountWan > housePriceWan ||
      !['commercial','provident','combined'].includes(loanType) ||
      !['equalPayment','equalPrincipal'].includes(repaymentMethod) ||
      !['first','second'].includes(homeType)) {
    return null;
  }

  return {
    visitorId, cityId, cityName, housePriceWan, loanAmountWan, loanRatio,
    loanType, repaymentMethod, homeType, termYears, providentAmountWan,
    commercialRate, providentRate, prepaymentCount, prepaymentTotalWan
  };
}

async function recordCalc(request, env) {
  const body = await request.json().catch(() => ({}));
  const p = mortgagePayload(body);
  if (!p) return { ok: false, status: 400, error: 'invalid payload' };
  const g = geo(request);
  const t = timeParts();

  await env.DB.prepare(`INSERT INTO calc_events(
      ts,day,month,visitor_id,country,region,city_id,city_name,
      house_price_wan,loan_amount_wan,loan_ratio,loan_type,repayment_method,
      home_type,term_years,provident_amount_wan,commercial_rate,provident_rate,
      prepayment_count,prepayment_total_wan)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      t.ts, t.day, t.month, p.visitorId, g.country, g.region, p.cityId, p.cityName,
      p.housePriceWan, p.loanAmountWan, p.loanRatio, p.loanType, p.repaymentMethod,
      p.homeType, p.termYears, p.providentAmountWan, p.commercialRate, p.providentRate,
      p.prepaymentCount, p.prepaymentTotalWan
    ).run();

  return { ok: true };
}

async function recordExport(request, env) {
  const body = await request.json().catch(() => ({}));
  const p = mortgagePayload(body);
  if (!p) return { ok: false, status: 400, error: 'invalid payload' };
  const g = geo(request);
  const t = timeParts();
  const detailView = ['annual','monthly'].includes(body.detailView) ? body.detailView : 'annual';

  await env.DB.prepare(`INSERT INTO export_events(
      ts,day,month,visitor_id,country,region,city_id,city_name,
      house_price_wan,loan_amount_wan,loan_type,repayment_method,detail_view)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      t.ts, t.day, t.month, p.visitorId, g.country, g.region, p.cityId, p.cityName,
      p.housePriceWan, p.loanAmountWan, p.loanType, p.repaymentMethod, detailView
    ).run();

  return { ok: true };
}

async function stats(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.STATS_TOKEN || auth !== `Bearer ${env.STATS_TOKEN}`) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  const [
    totalVisits, uniqueVisitors, daily, monthly, geoRows,
    exportTotal, dailyExports, monthlyExports, loanTypes, methods,
    recentCalcs, recentExports
  ] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM visit_events').first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM visitors').first(),
    env.DB.prepare(`SELECT day,COUNT(*) AS visits,COUNT(DISTINCT visitor_id) AS unique_visitors
      FROM visit_events GROUP BY day ORDER BY day DESC LIMIT 90`).all(),
    env.DB.prepare(`SELECT month,COUNT(*) AS visits,COUNT(DISTINCT visitor_id) AS unique_visitors
      FROM visit_events GROUP BY month ORDER BY month DESC LIMIT 24`).all(),
    env.DB.prepare(`SELECT country,region,COUNT(*) AS visits,COUNT(DISTINCT visitor_id) AS unique_visitors
      FROM visit_events GROUP BY country,region ORDER BY visits DESC LIMIT 500`).all(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM export_events').first(),
    env.DB.prepare('SELECT day,COUNT(*) AS exports FROM export_events GROUP BY day ORDER BY day DESC LIMIT 90').all(),
    env.DB.prepare('SELECT month,COUNT(*) AS exports FROM export_events GROUP BY month ORDER BY month DESC LIMIT 24').all(),
    env.DB.prepare('SELECT loan_type,COUNT(*) AS count FROM calc_events GROUP BY loan_type ORDER BY count DESC').all(),
    env.DB.prepare('SELECT repayment_method,COUNT(*) AS count FROM calc_events GROUP BY repayment_method ORDER BY count DESC').all(),
    env.DB.prepare(`SELECT ts,country,region,city_id,city_name,house_price_wan,loan_amount_wan,
      loan_ratio,loan_type,repayment_method,home_type,term_years,provident_amount_wan,
      commercial_rate,provident_rate,prepayment_count,prepayment_total_wan
      FROM calc_events ORDER BY id DESC LIMIT 200`).all(),
    env.DB.prepare(`SELECT ts,country,region,city_name,house_price_wan,loan_amount_wan,
      loan_type,repayment_method,detail_view FROM export_events ORDER BY id DESC LIMIT 100`).all()
  ]);

  return {
    ok: true,
    totalVisits: Number(totalVisits?.count || 0),
    uniqueVisitors: Number(uniqueVisitors?.count || 0),
    daily: daily.results || [],
    monthly: monthly.results || [],
    visitsByLocation: geoRows.results || [],
    exportsTotal: Number(exportTotal?.count || 0),
    dailyExports: dailyExports.results || [],
    monthlyExports: monthlyExports.results || [],
    calculationsByLoanType: loanTypes.results || [],
    calculationsByRepaymentMethod: methods.results || [],
    recentCalculations: recentCalcs.results || [],
    recentExports: recentExports.results || []
  };
}

export default {
  async fetch(request, env) {
    const origin = requestOrigin(request, env);
    if (!origin) return json({ ok: false, error: 'origin not allowed' }, 403, configuredOrigin(env));
    if (request.method === 'OPTIONS') return json({ ok: true }, 204, origin);

    const url = new URL(request.url);
    try {
      await ensureSchema(env);
      if (request.method === 'POST' && url.pathname === '/v1/visit') {
        const result = await recordVisit(request, env);
        return json(result, result.status || 200, origin);
      }
      if (request.method === 'POST' && url.pathname === '/v1/calc') {
        const result = await recordCalc(request, env);
        return json(result, result.status || 200, origin);
      }
      if (request.method === 'POST' && url.pathname === '/v1/export') {
        const result = await recordExport(request, env);
        return json(result, result.status || 200, origin);
      }
      if (request.method === 'GET' && url.pathname === '/v1/stats') {
        const result = await stats(request, env);
        return json(result, result.status || 200, origin);
      }
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        return json({ ok: true }, 200, origin);
      }
      return json({ ok: false, error: 'not found' }, 404, origin);
    } catch (e) {
      console.error(e);
      return json({ ok: false, error: 'internal error' }, 500, origin);
    }
  }
};
