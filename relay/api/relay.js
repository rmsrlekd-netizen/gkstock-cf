// Vercel용 DART·KRX 중계 (주소: https://프로젝트.vercel.app/api/relay)
//  Cloudflare Worker → 이 함수(서울 리전) → DART
// 보도자료 사이트는 Cloudflare에서 막힐 때 우회용
const ALLOW = /(^|\.)(fss\.or\.kr|krx\.co\.kr|naver\.com|globenewswire\.com|generativelanguage\.googleapis\.com|businesswire\.com|prnewswire\.com|accessnewswire\.com|newswire\.co\.kr)$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function handle(req) {
  const token = process.env.RELAY_TOKEN || '';
  if (!token || req.headers.get('x-relay-token') !== token) return new Response('forbidden', { status: 403 });
  const target = new URL(req.url).searchParams.get('u') || '';
  let host = '';
  try { host = new URL(target).hostname; } catch {}
  if (!ALLOW.test(host)) return new Response('host not allowed', { status: 400 });
  const headers = { 'User-Agent': req.headers.get('user-agent') || UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };
  for (const k of ['content-type', 'referer', 'accept', 'x-requested-with', 'x-goog-api-key']) { const v = req.headers.get(k); if (v) headers[k] = v; }
  const init = { method: req.method, headers, redirect: 'follow' };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.arrayBuffer();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 28000);
  try {
    const r = await fetch(target, { ...init, signal: ctrl.signal });
    const out = new Headers({ 'cache-control': 'no-store' });
    const ct = r.headers.get('content-type'); if (ct) out.set('content-type', ct);
    return new Response(await r.arrayBuffer(), { status: r.status, headers: out });
  } catch (e) {
    return new Response('relay error: ' + (e.message || e), { status: 502 });
  } finally { clearTimeout(t); }
}

export const GET = handle;
export const POST = handle;
