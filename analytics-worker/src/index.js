let schemaPromise = null;

const SCHEMA = `
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
`;

function configuredOrigin(env) {
  return env.ALLOWED_ORIGIN || 'https://v0v0.github.io';
}

function json(data, status = 200, origin = 'https://v0v0.github.io') {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'cache-control': 'no-store',
      'vary': 'Origin'
    }
  });
}

function requestOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  return origin === configuredOrigin(env) ? origin : null;
}

function timeParts() {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  return { ts: now.toISOString(), day, month: day.slice(0, 7) };
}

function geo(request) {
  const cf = request.cf || {};
  return {
    country: String(cf.country || 'UNKNOWN').slice(0, 32),
    region: String(cf.region || 'UNKNOWN').slice(0, 128),
    city: String(cf.city || 'UNKNOWN').slice(0, 128)
  };
}

function text(value, max = 128) {
  return String(value ?? '').trim().slice(0, max);
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function visitorHash(request, env) {
  if (!env.UV_HASH_KEY) return '';
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return '';
  const userAgent = request.headers.get('User-Agent') || '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.UV_HASH_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${ip}\n${userAgent}`)
  );
  return hex(digest);
}

async function allowRate(request, env, bindingName) {
  const limiter = env[bindingName];
  if (!limiter?.limit) return true;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const result = await limiter.limit({ key: ip });
  return Boolean(result?.success);
}

async function recordVisit(request, env) {
  const g = geo(request);
  const t = timeParts();
  const hash = await visitorHash(request, env);
  let newDailyUv = 0;

  if (hash) {
    const dailyInsert = await env.DB.prepare(
      'INSERT OR IGNORE INTO visitor_daily(day,visitor_hash) VALUES(?,?)'
    ).bind(t.day, hash).run();
    newDailyUv = Number(dailyInsert?.meta?.changes || 0) > 0 ? 1 : 0;
  }

  const statements = [
    env.DB.prepare(`INSERT INTO daily_stats(day,pv,uv,calculations,exports)
      VALUES(?,?,?,0,0)
      ON CONFLICT(day) DO UPDATE SET
        pv=daily_stats.pv+1,
        uv=daily_stats.uv+excluded.uv`)
      .bind(t.day, 1, newDailyUv),
    env.DB.prepare(`INSERT INTO visit_location_daily(day,country,region,city,pv)
      VALUES(?,?,?,?,1)
      ON CONFLICT(day,country,region,city) DO UPDATE SET pv=visit_location_daily.pv+1`)
      .bind(t.day, g.country, g.region, g.city)
  ];

  if (hash) {
    statements.push(
      env.DB.prepare(`INSERT INTO visitor_global(visitor_hash,first_seen,last_seen)
        VALUES(?,?,?)
        ON CONFLICT(visitor_hash) DO UPDATE SET last_seen=excluded.last_seen`)
        .bind(hash, t.ts, t.ts)
    );
  }

  await env.DB.batch(statements);
  return { ok: true };
}

function mortgagePayload(body) {
  const cityId = text(body?.city, 64);
  const cityName = text(body?.cityName || cityId, 64);
  const loanAmountWan = finite(body?.loanAmountWan, -1);
  if (!cityId || loanAmountWan <= 0 || loanAmountWan > 100000) return null;
  return { cityId, cityName, loanAmountWan };
}

async function recordCalc(request, env) {
  const body = await request.json().catch(() => ({}));
  const p = mortgagePayload(body);
  if (!p) return { ok: false, status: 400, error: 'invalid payload' };

  const t = timeParts();
  const bucketStartWan = Math.floor(p.loanAmountWan / 10) * 10;

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO daily_stats(day,pv,uv,calculations,exports)
      VALUES(?,0,0,1,0)
      ON CONFLICT(day) DO UPDATE SET calculations=daily_stats.calculations+1`)
      .bind(t.day),
    env.DB.prepare(`INSERT INTO calc_city_daily(day,city_id,city_name,count)
      VALUES(?,?,?,1)
      ON CONFLICT(day,city_id) DO UPDATE SET
        city_name=excluded.city_name,
        count=calc_city_daily.count+1`)
      .bind(t.day, p.cityId, p.cityName),
    env.DB.prepare(`INSERT INTO calc_amount_daily(day,bucket_start_wan,count)
      VALUES(?,?,1)
      ON CONFLICT(day,bucket_start_wan) DO UPDATE SET count=calc_amount_daily.count+1`)
      .bind(t.day, bucketStartWan)
  ]);

  return { ok: true };
}

async function recordExport(request, env) {
  const body = await request.json().catch(() => ({}));
  const p = mortgagePayload(body);
  if (!p) return { ok: false, status: 400, error: 'invalid payload' };
  const t = timeParts();

  await env.DB.prepare(`INSERT INTO daily_stats(day,pv,uv,calculations,exports)
    VALUES(?,0,0,0,1)
    ON CONFLICT(day) DO UPDATE SET exports=daily_stats.exports+1`)
    .bind(t.day)
    .run();

  return { ok: true };
}

async function stats(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.STATS_TOKEN || auth !== `Bearer ${env.STATS_TOKEN}`) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  const [
    totals,
    totalUv,
    daily,
    monthly,
    geoRows,
    cityRows,
    amountRows
  ] = await Promise.all([
    env.DB.prepare(`SELECT
      COALESCE(SUM(pv),0) AS visits,
      COALESCE(SUM(calculations),0) AS calculations,
      COALESCE(SUM(exports),0) AS exports
      FROM daily_stats`).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM visitor_global').first(),
    env.DB.prepare(`SELECT day,pv AS visits,uv AS unique_visitors,calculations,exports
      FROM daily_stats ORDER BY day DESC LIMIT 90`).all(),
    env.DB.prepare(`SELECT
      m.month,
      m.visits,
      COALESCE(u.unique_visitors,0) AS unique_visitors,
      m.calculations,
      m.exports
      FROM (
        SELECT substr(day,1,7) AS month,
          SUM(pv) AS visits,
          SUM(calculations) AS calculations,
          SUM(exports) AS exports
        FROM daily_stats
        GROUP BY substr(day,1,7)
      ) m
      LEFT JOIN (
        SELECT substr(day,1,7) AS month,COUNT(DISTINCT visitor_hash) AS unique_visitors
        FROM visitor_daily
        GROUP BY substr(day,1,7)
      ) u ON u.month=m.month
      ORDER BY m.month DESC LIMIT 24`).all(),
    env.DB.prepare(`SELECT country,region,city,SUM(pv) AS visits
      FROM visit_location_daily
      GROUP BY country,region,city
      ORDER BY visits DESC LIMIT 500`).all(),
    env.DB.prepare(`SELECT city_id,city_name,SUM(count) AS count
      FROM calc_city_daily
      GROUP BY city_id,city_name
      ORDER BY count DESC LIMIT 100`).all(),
    env.DB.prepare(`SELECT bucket_start_wan,SUM(count) AS count
      FROM calc_amount_daily
      GROUP BY bucket_start_wan
      ORDER BY bucket_start_wan`).all()
  ]);

  return {
    ok: true,
    totalVisits: Number(totals?.visits || 0),
    uniqueVisitors: Number(totalUv?.count || 0),
    totalCalculations: Number(totals?.calculations || 0),
    exportsTotal: Number(totals?.exports || 0),
    daily: daily.results || [],
    monthly: monthly.results || [],
    visitsByLocation: geoRows.results || [],
    calculationsByCity: cityRows.results || [],
    loanAmountDistribution: amountRows.results || []
  };
}

export default {
  async fetch(request, env) {
    const allowedOrigin = requestOrigin(request, env);
    const responseOrigin = allowedOrigin || configuredOrigin(env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      if (!allowedOrigin) return json({ ok: false, error: 'origin not allowed' }, 403, responseOrigin);
      return json({}, 204, responseOrigin);
    }

    const isPublicWrite = request.method === 'POST' && ['/v1/visit', '/v1/calc', '/v1/export'].includes(url.pathname);
    if (isPublicWrite && !allowedOrigin) {
      return json({ ok: false, error: 'origin not allowed' }, 403, responseOrigin);
    }

    try {
      await ensureSchema(env);

      if (request.method === 'POST' && url.pathname === '/v1/visit') {
        if (!await allowRate(request, env, 'VISIT_RATE_LIMITER')) {
          return json({ ok: false, error: 'rate limited' }, 429, responseOrigin);
        }
        const result = await recordVisit(request, env);
        return json(result, result.status || 200, responseOrigin);
      }
      if (request.method === 'POST' && url.pathname === '/v1/calc') {
        if (!await allowRate(request, env, 'EVENT_RATE_LIMITER')) {
          return json({ ok: false, error: 'rate limited' }, 429, responseOrigin);
        }
        const result = await recordCalc(request, env);
        return json(result, result.status || 200, responseOrigin);
      }
      if (request.method === 'POST' && url.pathname === '/v1/export') {
        if (!await allowRate(request, env, 'EVENT_RATE_LIMITER')) {
          return json({ ok: false, error: 'rate limited' }, 429, responseOrigin);
        }
        const result = await recordExport(request, env);
        return json(result, result.status || 200, responseOrigin);
      }
      if (request.method === 'GET' && url.pathname === '/v1/stats') {
        const result = await stats(request, env);
        return json(result, result.status || 200, responseOrigin);
      }
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        return json({ ok: true }, 200, responseOrigin);
      }
      return json({ ok: false, error: 'not found' }, 404, responseOrigin);
    } catch (error) {
      console.error(error);
      return json({ ok: false, error: 'internal error' }, 500, responseOrigin);
    }
  }
};
