# DesiStrip – setup notes

## Files you add
fonts/display.woff2, fonts/body.woff2  (logo is text, favicon is already included)

## Vercel
1. Import repo (framework: Other, no build command).
2. Storage -> Marketplace -> Upstash Redis (free) -> connect. Env vars are added automatically.
3. Optional env var: STATS_SALT = any random string.
4. Add domain desistrip.com.

## Cloudflare (proxied / orange cloud)
- DNS: point desistrip.com to Vercel as Vercel shows; orange cloud ON.
- SSL/TLS mode: Full (strict).
- Do NOT add any "Cache Everything" rule for /api/*. (POST requests are never cached anyway.)
- The counter reads the real visitor IP from Cloudflare's `cf-connecting-ip` header.
- Optional hardening (stops people faking the IP by hitting the *.vercel.app URL directly):
  Cloudflare -> Rules -> Transform Rules -> Modify Request Header -> add header
  `x-cf-secret` = <random string>, and set the same string in Vercel as env var CF_SECRET.

## Visitor counter
POST /api/hit counts a visit. Total visits = every page load. Unique visitors = each visitor once per 24h
(salted hash of IP + browser, expires after 24h, raw IPs are never stored). Bots are not counted.
Counters live in Redis keys `stats:total` and `stats:unique`. To start from a number, set them in the Upstash console.

## 410 URLs
Put old URLs in urls.txt, then:  vercel env pull .env.local && node --env-file=.env.local add-gone.mjs
(--list shows all, --remove removes)
