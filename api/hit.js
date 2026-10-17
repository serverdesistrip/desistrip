// POST /api/hit  -> counts a visit and returns { total, unique }
//   total  = every page load
//   unique = distinct visitors, each counted once per 24 hours
//
// Works behind Cloudflare: the real visitor IP comes from the "cf-connecting-ip" header.
// Raw IPs are never stored - only a salted SHA-256 hash that expires after 24 hours.
//
// Env vars (Vercel -> Settings -> Environment Variables):
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   (added automatically by the Upstash integration)
//   STATS_SALT   (optional, any random string - makes the hashes private)
//   CF_SECRET    (optional hardening, see README: only trust cf-connecting-ip when Cloudflare sends this secret)

const crypto = require('node:crypto');

const TTL_SECONDS = 86400; // 24 hours
const ALLOWED_HOSTS = ['desistrip.com', 'www.desistrip.com', 'localhost', '127.0.0.1'];
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|httpclient|facebookexternalhit/i;

// KEYS[1]=total  KEYS[2]=unique  KEYS[3]=visitor-hash key
const LUA = `
local t = redis.call('INCR', KEYS[1])
local fresh = redis.call('SET', KEYS[3], '1', 'NX', 'EX', tonumber(ARGV[1]))
if fresh then redis.call('INCR', KEYS[2]) end
return { t, tonumber(redis.call('GET', KEYS[2]) or '0') }
`;

async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('redis env missing');
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(3000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function visitorIp(req) {
  const h = req.headers;
  const secret = process.env.CF_SECRET;
  const cfTrusted = !secret || h['x-cf-secret'] === secret;
  const cf = cfTrusted && h['cf-connecting-ip'];
  const xff = (h['x-forwarded-for'] || '').split(',')[0].trim();
  return (cf || xff || h['x-real-ip'] || req.socket?.remoteAddress || 'unknown').trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('{"error":"method"}');
  }

  // same-site requests only
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).hostname; } catch (_) {}
    if (!ALLOWED_HOSTS.includes(host) && !host.endsWith('.vercel.app')) {
      res.statusCode = 403;
      return res.end('{"error":"origin"}');
    }
  }

  try {
    const ua = String(req.headers['user-agent'] || '');

    // bots: just read the numbers, don't count
    if (!ua || BOT_RE.test(ua)) {
      const [t, u] = await Promise.all([redis(['GET', 'stats:total']), redis(['GET', 'stats:unique'])]);
      return res.end(JSON.stringify({ total: Number(t) || 0, unique: Number(u) || 0 }));
    }

    const salt = process.env.STATS_SALT || 'desistrip-default-salt';
    const hash = crypto.createHash('sha256').update(`${salt}|${visitorIp(req)}|${ua}`).digest('hex').slice(0, 32);

    const [total, unique] = await redis(['EVAL', LUA, 3, 'stats:total', 'stats:unique', `v:${hash}`, TTL_SECONDS]);
    return res.end(JSON.stringify({ total, unique }));
  } catch (e) {
    res.statusCode = 503; // page hides the counters when this fails
    return res.end('{"error":"unavailable"}');
  }
};
