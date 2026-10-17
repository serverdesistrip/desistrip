// Vercel Routing Middleware (edge, no dependencies).
// If the requested path is in the Upstash Redis set "gone" -> respond 410 using /410 page.
// Otherwise (or on any error) -> continue normally.

export const config = {
  // Skip "/" and static assets so the DB is only hit for unknown paths.
  matcher: ['/((?!api/|favicon\\.ico|logo\\.svg|style\\.css|fonts/|robots\\.txt|sitemap\\.xml).+)'],
};

const REDIS_URL = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const FALLBACK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>410 – Gone | DesiStrip</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:15vh 24px"><h1 style="font-size:6rem;margin:0">410</h1><p>This page has been permanently removed.</p><p><a href="/">Go to homepage</a></p></body></html>`;

function normalize(pathname) {
  let p = pathname;
  try { p = decodeURI(p); } catch (_) {}
  p = p.toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

async function gonePage(request) {
  let html = FALLBACK_HTML;
  try {
    const r = await fetch(new URL('/410', request.url), { signal: AbortSignal.timeout(1500) });
    if (r.ok) html = await r.text();
  } catch (_) {}
  return new Response(request.method === 'HEAD' ? null : html, {
    status: 410,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export default async function middleware(request) {
  const proceed = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

  const url = REDIS_URL();
  const token = REDIS_TOKEN();
  if (!url || !token) return proceed();

  const path = normalize(new URL(request.url).pathname);
  if (path === '/410' || path === '/404' || path === '/410.html' || path === '/404.html') return proceed();

  try {
    const res = await fetch(`${url}/sismember/gone/${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return proceed();
    const data = await res.json();
    if (data.result === 1) return gonePage(request);
  } catch (_) {
    // fail open: never break the site because the DB is down
  }
  return proceed();
}
