// GK 공시레이더 — Cloudflare Worker 진입점
//  · /api/*  → src/functions/*.mjs (각 파일의 config.path 로 연결)
//  · 그 외   → public/ 정적 파일 (index.html, app.js, styles.css …)
//  · Cron    → 매분 SEC·DART, 3분마다 보도자료·뉴스 수집 (한가한 시간엔 10분에 한 번)
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
import * as spark from './functions/spark.mjs';
import * as verdicts from './functions/verdicts.mjs';
import * as news from './functions/news.mjs';
import * as popular from './functions/popular.mjs';
import * as sectors from './functions/sectors.mjs';
import * as quote from './functions/quote.mjs';
import * as translate from './functions/translate.mjs';
import * as translateDoc from './functions/translate-doc.mjs';
import * as earnings from './functions/earnings.mjs';
import * as search from './functions/search.mjs';
import * as sec from './functions/sec.mjs';
import * as stock from './functions/stock.mjs';
import * as views from './functions/views.mjs';
import * as track from './functions/track.mjs';
import * as admin from './functions/admin.mjs';
import * as item from './functions/item.mjs';
import * as archive from './functions/archive.mjs';
import * as why from './functions/why.mjs';
import * as themes from './functions/themes.mjs';
import * as econ from './functions/econ.mjs';
import * as issues from './functions/issues.mjs';
import * as schedule from './functions/schedule.mjs';
import * as halts from './functions/halts.mjs';
import * as reaction from './functions/reaction.mjs';
import { reactWatch } from './lib/react.mjs';
import { channelWatch, digestWatch, surgeWatch } from './lib/tgchannel.mjs';
import { haltsWatch } from './lib/halts.mjs';
import { scheduleWatch } from './lib/schedule.mjs';
import { briefWatch } from './lib/brief.mjs';
import { issuesWatch } from './lib/issues.mjs';
import { econWatch } from './lib/econ.mjs';
import { whyWatch } from './lib/why.mjs';
import { renderItemPage, renderIssuePage, sitemap } from './lib/page.mjs';
import { renderOgImage, renderIssueOg } from './lib/og.mjs';
import secWatch from './functions/sec-watch.mjs';
import dartWatch from './functions/dart-watch.mjs';
import newsWatch from './functions/news-watch.mjs';

const ROUTES = {};
for (const m of [analyze, company, dart, digest, doc, flows, health, logo, market, spark, verdicts, news, popular, sectors, quote, translate, translateDoc, earnings, search, sec, stock, views, track, admin, item, archive, why, themes, econ, issues, schedule, halts, reaction]) {
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

// 공시가 몰리는 시간인지 (SEC: 미국 동부 평일 4:00~20:30 / DART: 한국 평일 7:00~20:30 / 뉴스: 두 시간대 중 하나)
function zoned(now, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { wd: p.weekday, m: Number(p.hour) * 60 + Number(p.minute) };
}
function busy(kind, now) {
  const us = zoned(now, 'America/New_York'); const kr = zoned(now, 'Asia/Seoul');
  const usB = !['Sat', 'Sun'].includes(us.wd) && us.m >= 240 && us.m <= 1230;
  const krB = !['Sat', 'Sun'].includes(kr.wd) && kr.m >= 420 && kr.m <= 1230;
  return kind === 'sec' ? usB : kind === 'dart' ? krB : usB || krB;
}

export default {
  async fetch(req, env, ctx) {
    init(env);
    const url = new URL(req.url);
    // 공시별 고유 주소 페이지 (/p/SEC-…, /p/DART-…, /p/PR-…) · 사이트맵
    const pm = url.pathname.match(/^\/p\/((?:SEC|DART)-[\d-]+|(?:NEWS|PR)-[a-z0-9]+)\/?$/);
    if (pm && req.method === 'GET') return cached(req, ctx, () => renderItemPage(env, req, pm[1]));
    const om = url.pathname.match(/^\/og\/((?:SEC|DART)-[\d-]+|(?:NEWS|PR)-[a-z0-9]+)\.png$/);
    if (om && req.method === 'GET') return cached(req, ctx, () => renderOgImage(ctx, om[1]).catch((e) => { console.error('og', e); return env.ASSETS.fetch(new Request(new URL('/img/icon-512.png', req.url))); }));
    // 오늘 주요 이슈 회차별 공유 주소 (/i/kr-20260928-2) · 공유 이미지
    const im = url.pathname.match(/^\/i\/((?:kr|us)-\d{8}-(?:\d{4}|\d{1,2}))\/?$/);
    if (im && req.method === 'GET') return cached(req, ctx, () => renderIssuePage(env, req, im[1]));
    const iom = url.pathname.match(/^\/og\/i\/((?:kr|us)-\d{8}-(?:\d{4}|\d{1,2}))\.png$/);
    if (iom && req.method === 'GET') return cached(req, ctx, () => renderIssueOg(ctx, iom[1]).catch((e) => { console.error('og-i', e); return env.ASSETS.fetch(new Request(new URL('/img/icon-512.png', req.url))); }));
    if (url.pathname === '/sitemap-pages.xml') return cached(req, ctx, () => sitemap());
    // www 주소로 들어오면 대표 주소로
    if (url.hostname === 'www.gk-stock.com') return Response.redirect('https://gk-stock.com' + url.pathname + url.search, 301);
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
    const now = new Date(event.scheduledTime || Date.now());
    const min = now.getUTCMinutes();
    if (cron.startsWith('*/3')) {
      const jobs3 = [];
      if (busy('news', now) || min % 10 <= 2) jobs3.push(newsWatch({ mode: 'maint' })); // 번역·AI·고장 감시
      // 인기·상승·하락 종목의 "오늘 움직임 이유" (한국·미국 장 시간엔 3분마다, 그 외엔 30분마다)
      const krz = zoned(now, 'Asia/Seoul'), usz = zoned(now, 'America/New_York');
      const krOpen = !['Sat', 'Sun'].includes(krz.wd) && krz.m >= 8 * 60 + 50 && krz.m <= 16 * 60;
      const usOpen = !['Sat', 'Sun'].includes(usz.wd) && usz.m >= 4 * 60 && usz.m <= 20 * 60;
      if (krOpen || usOpen || min % 30 < 3) jobs3.push(whyWatch().then((r) => console.log('why', JSON.stringify(r))).catch((e) => console.warn('why', e.message)));
      // 내일 일정 (20분마다 새로 모으고, 새 거래일이 되면 AI 요약)
      // (장 마감 브리핑은 메인 화면 AI 요약과 겹쳐서 중지)
      // 공시 반응 통계: 지난 공시의 발표 후 1일·5일 주가를 조금씩 계산 (9분마다)
      if (min % 9 < 3) jobs3.push(reactWatch().then((r) => { if (r) console.log('react', JSON.stringify(r)); }).catch((e) => console.warn('react', e.message)));
      if (min % 6 < 3) jobs3.push(scheduleWatch().then((r) => console.log('sched', JSON.stringify(r))).catch((e) => console.warn('sched', e.message)));
      if (jobs3.length) ctx.waitUntil(Promise.allSettled(jobs3));
      return;
    }
    // 매분: SEC·DART를 함께 (한가한 시간엔 각각 10분에 한 번)
    // 과거 공시 채우기는 실행 시간이 길어지지 않게 SEC는 짝수 분, DART는 홀수 분에만
    const jobs = [];
    if (busy('sec', now) || min % 10 === 0) jobs.push(secWatch({ backfillMs: min % 2 === 0 ? 12000 : 0 }));
    if (busy('dart', now) || min % 10 === 1) jobs.push(dartWatch({ backfillMs: min % 2 === 1 ? 12000 : 0 }));
    // 보도자료: 매분 가장 빠른 전체 목록, 5분마다 주제·업종별 목록까지 (한가한 시간엔 5분에 한 번)
    // 미국 동부 평일 6:00~20:00에는 PR Newswire 웹 목록(100건)을 매분 직접 확인
    // PR Newswire 웹 목록 직접 확인: 미국 동부 평일 6:00~20:00 매분 (RSS는 최신 20건뿐이라 몰릴 때 놓침)
    const ny = zoned(now, 'America/New_York');
    const direct = !['Sat', 'Sun'].includes(ny.wd) && ny.m >= 6 * 60 && ny.m <= 20 * 60;
    if (busy('news', now) || direct || min % 5 === 0) jobs.push(newsWatch({ mode: 'pr', full: min % 5 === 0, direct }));
    // 미국 경제지표: 발표가 몰리는 미국 동부 평일 7:00~16:30엔 매분, 그 외엔 30분마다 (발표되면 AI 해석 + 달력 갱신)
    const usz = zoned(now, 'America/New_York');
    const econBusy = !['Sat', 'Sun'].includes(usz.wd) && usz.m >= 7 * 60 && usz.m <= 16 * 60 + 30;
    if (econBusy || min % 30 === 0) jobs.push(econWatch().then(async (r) => { if (r.ai || econBusy) { const { econCalendar } = await import('./lib/econ.mjs'); const { setJSON } = await import('./lib/store.mjs'); await setJSON('econ/v1', await econCalendar()); } }).catch((e) => console.warn('econ', e.message)));
    // 텔레그램 채널: 중요 공시 자동 게시 (채널이 설정돼 있을 때만)
    jobs.push(channelWatch().then((r) => { if (r?.sent) console.log('tgch', JSON.stringify(r)); }).catch((e) => console.warn('tgch', e.message)));
    if (min % 2 === 0) jobs.push(surgeWatch().then((r) => { if (r?.n) console.log('tgsurge', JSON.stringify(r)); }).catch((e) => console.warn('tgsurge', e.message)));
    jobs.push(digestWatch().then((r) => { if (r && Object.keys(r).length) console.log('tgdg', JSON.stringify(r)); }).catch((e) => console.warn('tgdg', e.message)));
    // VI·서킷: 국장 VI 발동·해제 (장중) · 미장 거래정지·재개 (뉴욕 4:00~20:00) 매분 기록
    // 코스피200 야간선물 1분 간격 기록 (야간 18:00~05:00, 주간 08:45~15:45 · 한국 평일)
    { const kz = zoned(now, 'Asia/Seoul'); const wd = kz.wd, m = kz.m;
      const night = (m >= 18 * 60 && !['Sat', 'Sun'].includes(wd)) || (m < 5 * 60 + 5 && !['Sun', 'Mon'].includes(wd));
      const day = !['Sat', 'Sun'].includes(wd) && m >= 8 * 60 + 45 && m <= 15 * 60 + 45;
      if (night || day) jobs.push(import('./functions/market.mjs').then((x) => x.sampleNight()).catch((e) => console.warn('night', e.message))); }
    if (min % 15 === 4) jobs.push(import('./lib/borrow.mjs').then((x) => x.borrowWatch()).then(async (r) => { console.log('borrow', JSON.stringify(r)); const { setJSON } = await import('./lib/store.mjs'); await setJSON('borrow/status', { at: new Date().toISOString(), ok: true, ...r }); }).catch(async (e) => { console.warn('borrow', e.message); const { setJSON } = await import('./lib/store.mjs'); await setJSON('borrow/status', { at: new Date().toISOString(), ok: false, error: String(e.message || e).slice(0, 200) }).catch(() => {}); })); // IBKR 공매도 가능 수량 (15분마다)
    if (min % 10 === 7) jobs.push(import('./lib/shortvol.mjs').then((x) => x.shortVolWatch()).then(async (r) => { const { setJSON } = await import('./lib/store.mjs'); await setJSON('shvol/status', { at: new Date().toISOString(), ok: true, ...r }); }).catch(async (e) => { console.warn('shvol', e.message); const { setJSON } = await import('./lib/store.mjs'); await setJSON('shvol/status', { at: new Date().toISOString(), ok: false, error: String(e.message || e).slice(0, 200) }).catch(() => {}); })); // FINRA 일별 공매도 (30분마다 확인)
    jobs.push(haltsWatch(now).then((r) => { if (r.kr || r.us) console.log('halts', JSON.stringify(r)); }).catch((e) => console.warn('halts', e.message)));
    // 오늘 주요 이슈: 회차 시각이 되면 AI가 새로 만듦 (한국 4회·미국 4회)
    jobs.push(issuesWatch(now, ctx).then((r) => { if (Object.keys(r).length) console.log('issues', JSON.stringify(r)); }).catch((e) => console.warn('issues', e.message)));
    if (jobs.length) ctx.waitUntil(Promise.allSettled(jobs));
  },
};
