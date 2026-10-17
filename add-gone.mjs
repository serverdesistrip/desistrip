// Bulk-add old URLs to the 410 list.
// 1) Put old URLs (full URLs or paths), one per line, in urls.txt
// 2) vercel env pull .env.local
// 3) node --env-file=.env.local add-gone.mjs          (add)
//    node --env-file=.env.local add-gone.mjs --remove (remove)
//    node --env-file=.env.local add-gone.mjs --list   (show all)
import { readFileSync } from 'node:fs';

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (!url || !token) { console.error('Missing Redis env vars. Run: vercel env pull .env.local'); process.exit(1); }

async function redis(cmd) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function normalize(line) {
  let p = line.trim();
  if (!p || p.startsWith('#')) return null;
  try { p = new URL(p).pathname; } catch (_) { if (!p.startsWith('/')) p = '/' + p; }
  p = p.split('?')[0].split('#')[0];
  try { p = decodeURI(p); } catch (_) {}
  p = p.toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

if (process.argv.includes('--list')) {
  const all = await redis(['SMEMBERS', 'gone']);
  console.log(all.sort().join('\n') || '(empty)');
  console.log(`\n${all.length} total`);
  process.exit(0);
}

const paths = [...new Set(readFileSync('urls.txt', 'utf8').split(/\r?\n/).map(normalize).filter(Boolean))];
if (!paths.length) { console.error('urls.txt is empty'); process.exit(1); }

const remove = process.argv.includes('--remove');
for (let i = 0; i < paths.length; i += 500) {
  const chunk = paths.slice(i, i + 500);
  await redis([remove ? 'SREM' : 'SADD', 'gone', ...chunk]);
}
console.log(`${remove ? 'Removed' : 'Added'} ${paths.length} path(s).`);
