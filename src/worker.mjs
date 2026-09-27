// GK 공시레이더 — Cloudflare Worker 진입점
//  · /api/*  → src/functions/*.mjs (각 파일의 config.path 로 연결)
//  · 그 외   → public/ 정적 파일 (index.html, app.js, styles.css …)
//  · Cron    → 10분마다 SEC / DART / 뉴스 수집 (서로 3분씩 어긋나게 실행)
import { setDB } from './lib/store.mjs';

import * as analyze from './functions/analyze.mjs';
import * as company from './functions/company.mjs';
import * as dart from './functions/dart.mjs';
import * as digest from './functions/digest.mjs';
import * as doc from './functions/doc.mjs';
import * as flows from './functions/flows.mjs';
import * as health from './functions/health.mjs';
import * as logo from './functions/logo.mjs';
import * as market from './functions/market.mjs';
import * as news from './functions/news.mjs';
import * as popular from './functions/popular.mjs';
import * as sectors from './functions/sectors.mjs';
import * as quote from './functions/quote.mjs';
import * as translate from './functions/translate.mjs';
import * as earnings from './functions/earnings.mjs';
import * as search from './functions/search.mjs';
import * as sec from './functions/sec.mjs';
import * as stock from './functions/stock.mjs';
import * as views from './functions/views.mjs';
import secWatch from './functions/sec-watch.mjs';
import dartWatch from './functions/dart-watch.mjs';
import newsWatch from './functions/news-watch.mjs';

const ROUTES = {};
for (const m of [analyze, company, dart, digest, doc, flows, health, logo, market, news, popular, sectors, quote, translate, earnings, search, sec, stock, views]) {
  ROUTES[m.config.path] = m.default;
}

// Cloudflare 변수·비밀(Variables and Secrets)을 기존 코드가 쓰는 process.env 로 복사
function init(env) {
  if (!globalThis.process) globalThis.process = { env: {} };
  if (!globalThis.process.env) globalThis.process.env = {};
  for (const [k, v] of Object.entries(env || {})) if (typeof v === 'string') globalThis.process.env[k] = v;
  setDB(env?.DB);
}

// 엣지 캐시: 함수가 붙인 x-gk-edge-ttl(초) 동안 같은 요청은 Cloudflare 캐시에서 바로 응답
// (workers.dev 주소에서는 캐시가 동작하지 않을 수 있음 → 그냥 매번 함수 실행)
async function cached(req, ctx, run) {
  const cache = globalThis.caches?.default;
  const key = new Request(new URL(req.url).toString(), { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const h = new Headers(hit.headers);
        h.set('cache-control', 'public, max-age=0, must-revalidate');
        h.set('x-gk-cache', 'HIT');
        return new Response(hit.body, { status: hit.status, headers: h });
      }
    } catch {}
  }
  const res = await run();
  const ttl = Number(res.headers.get('x-gk-edge-ttl') || 0);
  if (cache && ttl > 0 && (res.status === 200 || res.status === 302 || res.status === 404)) {
    try {
      const copy = res.clone();
      const h = new Headers(copy.headers);
      h.set('cache-control', `public, max-age=${ttl}`);
      ctx.waitUntil(cache.put(key, new Response(copy.body, { status: copy.status, headers: h })).catch(() => {}));
    } catch {}
  }
  return res;
}

export default {
  async fetch(req, env, ctx) {
    init(env);
    const url = new URL(req.url);
    const handler = ROUTES[url.pathname];
    if (!handler) {
      if (url.pathname.startsWith('/api/')) return new Response(JSON.stringify({ ok: false, error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
      return env.ASSETS.fetch(req);
    }
    try {
      if (req.method === 'GET') return await cached(req, ctx, () => handler(req, ctx));
      return await handler(req, ctx);
    } catch (e) {
      console.error(url.pathname, e);
      return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
  },

  async scheduled(event, env, ctx) {
    init(env);
    const cron = event.cron || '';
    const job = cron.startsWith('3-') ? dartWatch : cron.startsWith('6-') ? newsWatch : secWatch;
    ctx.waitUntil(job());
  },
};
