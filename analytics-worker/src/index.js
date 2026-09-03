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

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = env.ALLOWED_ORIGIN || 'https://v0v0.github.io';
  return origin === configured ? origin : configured;
}

function chinaDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function geo(request) {
  const cf = request.cf || {};
  return {
    country: String(cf.country || 'UNKNOWN').slice(0, 32),
    region: String(cf.region || 'UNKNOWN').slice(0, 128),
    city: String(cf.city || 'UNKNOWN').slice(0, 128)
  };
}

async function recordVisit(request, env) {
  const g = geo(request);
  const day = chinaDay();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO counters(key,count) VALUES('visits_total',1) ON CONFLICT(key) DO UPDATE SET count=count+1"),
    env.DB.prepare('INSERT INTO daily_visits(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1').bind(day),
    env.DB.prepare('INSERT INTO geo_visits(country,region,city,count) VALUES(?,?,?,1) ON CONFLICT(country,region,city) DO UPDATE SET count=count+1').bind(g.country, g.region, g.city)
  ]);
  return { ok: true };
}

async function recordCalc(request, env) {
  const body = await request.json().catch(() => ({}));
  const cityId = String(body.city || '').slice(0, 64);
  const cityName = String(body.cityName || cityId).slice(0, 64);
  const housePriceWan = Number(body.housePriceWan);
  if (!cityId || !Number.isFinite(housePriceWan) || housePriceWan <= 0 || housePriceWan > 100000) {
    return { ok: false, status: 400, error: 'invalid payload' };
  }
  const bucketWan = Math.floor(housePriceWan / 10) * 10;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO calc_city(city_id,city_name,count) VALUES(?,?,1) ON CONFLICT(city_id) DO UPDATE SET city_name=excluded.city_name,count=count+1').bind(cityId, cityName),
    env.DB.prepare('INSERT INTO calc_amount_bucket(bucket_wan,count) VALUES(?,1) ON CONFLICT(bucket_wan) DO UPDATE SET count=count+1').bind(bucketWan)
  ]);
  return { ok: true, bucketWan };
}

async function stats(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.STATS_TOKEN || auth !== `Bearer ${env.STATS_TOKEN}`) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  const [total, daily, geoRows, cityRows, amountRows] = await Promise.all([
    env.DB.prepare("SELECT count FROM counters WHERE key='visits_total'").first(),
    env.DB.prepare('SELECT day,count FROM daily_visits ORDER BY day DESC LIMIT 90').all(),
    env.DB.prepare('SELECT country,region,city,count FROM geo_visits ORDER BY count DESC LIMIT 500').all(),
    env.DB.prepare('SELECT city_id,city_name,count FROM calc_city ORDER BY count DESC').all(),
    env.DB.prepare('SELECT bucket_wan,count FROM calc_amount_bucket ORDER BY bucket_wan').all()
  ]);
  return {
    ok: true,
    totalVisits: total?.count || 0,
    dailyVisits: daily.results || [],
    visitsByLocation: geoRows.results || [],
    calculationsByCity: cityRows.results || [],
    amountDistribution: (amountRows.results || []).map(x => ({
      fromWan: x.bucket_wan,
      toWanExclusive: x.bucket_wan + 10,
      count: x.count
    }))
  };
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === 'OPTIONS') return json({ ok: true }, 204, origin);
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/v1/visit') {
        return json(await recordVisit(request, env), 200, origin);
      }
      if (request.method === 'POST' && url.pathname === '/v1/calc') {
        const result = await recordCalc(request, env);
        return json(result, result.status || 200, origin);
      }
      if (request.method === 'GET' && url.pathname === '/v1/stats') {
        const result = await stats(request, env);
        return json(result, result.status || 200, origin);
      }
      return json({ ok: false, error: 'not found' }, 404, origin);
    } catch (e) {
      console.error(e);
      return json({ ok: false, error: 'internal error' }, 500, origin);
    }
  }
};
