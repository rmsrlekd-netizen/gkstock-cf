// DART·KRX 요청 중계 (Cloudflare Worker → 이 함수 → DART)
//  보안: RELAY_TOKEN 이 맞는 요청만, 허용된 한국 공시 사이트로만 전달
const ALLOW = /(^|\.)(fss\.or\.kr|krx\.co\.kr|naver\.com|globenewswire\.com|generativelanguage\.googleapis\.com)$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export default async (req) => {
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
    const out = new Headers();
    const ct = r.headers.get('content-type'); if (ct) out.set('content-type', ct);
    out.set('cache-control', 'no-store');
    return new Response(await r.arrayBuffer(), { status: r.status, headers: out });
  } catch (e) {
    return new Response('relay error: ' + (e.message || e), { status: 502 });
  } finally { clearTimeout(t); }
};

export const config = { path: '/relay' };
