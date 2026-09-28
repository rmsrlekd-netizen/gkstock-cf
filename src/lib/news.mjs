// 뉴스·보도자료 수집 (미국·한국)
//  보도자료(미국만): GlobeNewswire, PR Newswire, Business Wire
//  뉴스: 구글 뉴스 RSS(한국어), Finnhub(키가 있으면)
import { fetchWithTimeout, BROWSER_UA, decodeEntities, decodeText } from './util.mjs';
import { sanitizeHtml } from './dart-doc.mjs';
import { getJSON, setJSON } from './store.mjs';
import { getKrNames, matchKr, matchUsKo } from './krnames.mjs';
import { getTickerMap } from './sec-core.mjs';

const H = { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' };

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const strip = (s) => decodeEntities(String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, n) => { const m = x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`)); return m ? m[1] : ''; };
const iso = (d) => { const t = Date.parse(d); return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(); };
const US_EX = /^(nasdaq|nyse|nyse american|nyse arca|nyse mkt|amex|otcqx|otcqb|otc|cboe)$/i;
// "(NASDAQ: ABCD)", "NYSE: XYZ", "(Nasdaq: AB, CD)", "(TSX: X, NYSE American: Y)" 등
const TICK_RE = /(?:NYSE American|NYSE Arca|NYSE MKT|NYSE|NASDAQ|Nasdaq|CBOE|Cboe)\s*(?:GS|GM|CM|Global Select|Capital Market|Global Market)?\s*:\s*"?([A-Z][A-Z.]{0,5})\b/;

// 회사명 → 티커 (SEC 상장사 목록, 나스닥·뉴욕만). 보도자료에 티커가 안 적혀 있어도 회사명으로 연결
const SUFFIX = /\b(the|inc|incorporated|corp|corporation|co|company|ltd|limited|plc|llc|lp|l p|holdings?|group|n v|nv|s a|sa|ag|se|class [a-z]|common stock|ordinary shares|ads)\b/g;
const normCo = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
let coIdx = null;
async function companyIndex() {
  if (coIdx && Date.now() - coIdx.at < 12 * 3600e3) return coIdx.map;
  const map = new Map();
  try {
    const tm = await getTickerMap();
    for (const v of tm.values()) {
      if (!v.ticker || !/nasdaq|nyse|cboe/i.test(v.exchange || '')) continue;
      const k = normCo(v.name);
      if (k.length >= 4 && !map.has(k)) map.set(k, v.ticker);
    }
  } catch {}
  coIdx = { at: Date.now(), map };
  return map;
}
function tickerOf(text, company, idx) {
  const m = String(text || '').match(TICK_RE);
  if (m) return m[1].replace(/\.$/, '');
  const k = normCo(company);
  return (k && idx.get(k)) || null;
}

// RSS 읽기: 너무 큰 피드는 앞부분(최신 글)만 읽어 속도 확보
async function rss(url, ms = 7000, opts = {}, maxBytes = 900000) {
  const r = await fetchWithTimeout(url, { headers: H, ...opts }, ms);
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
  let xml = '';
  if (r.body?.getReader) {
    const reader = r.body.getReader(), dec = new TextDecoder();
    const stop = Date.now() + ms;
    while (xml.length < maxBytes && Date.now() < stop) {
      // 서버가 중간에 멈춰도 기다리지 않게 (남은 시간 안에 안 오면 중단)
      const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ timeout: true }), Math.max(500, stop - Date.now())))]);
      if (chunk.timeout) { if (!xml) throw new Error(`${new URL(url).host} 응답 지연`); break; }
      const { done, value } = chunk;
      if (done) break;
      xml += dec.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
  } else xml = await r.text();
  return xml.split(/<item[\s>]/).slice(1).map((x) => x.split('</item>')[0]).filter((x) => x.includes('</title>'));
}

// ───────── 출처별 접속 경로 자동 전환 ─────────
// 각 출처마다 여러 경로(직접 접속 / 서울 중계 서버 / 다른 형식)를 준비해 두고,
// 막히거나 빈 응답이면 다음 경로로 자동 전환. 성공한 경로는 기억해 다음부터 먼저 사용.
const FEED_UA = 'Mozilla/5.0 (compatible; Feedly/1.0; +http://www.feedly.com/fetcher.html; like FeedFetcher-Google)';
const FEED_H = { 'User-Agent': FEED_UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' };
let routeMem = null, routeAt = 0;
async function viaRoutes(name, routes) {
  if (!routeMem || Date.now() - routeAt > 5 * 60e3) { routeMem = (await getJSON('src/route')) || {}; routeAt = Date.now(); }
  const pref = Math.min(routeMem[name] ?? 0, routes.length - 1);
  const order = [pref, ...routes.map((_, i) => i).filter((i) => i !== pref)];
  const errs = [];
  for (const i of order) {
    try {
      const r = await routes[i]();
      if (!r || (Array.isArray(r) && !r.length)) throw new Error('빈 응답 (형식 변경 가능성)');
      if (routeMem[name] !== i) { routeMem[name] = i; await setJSON('src/route', routeMem).catch(() => {}); }
      return r;
    } catch (e) { errs.push(`${routes[i].label || '경로' + i}: ${e.message}`); }
  }
  // 어느 경로에서 어떻게 실패했는지 전부 남김 (원인 파악용)
  throw new Error(errs.join(' / ') || name + ' 모든 경로 실패');
}
const L = (label, fn) => Object.assign(fn, { label });
const hasRelay = () => !!process.env.KR_RELAY_URL;
const rssRoutes = (url, ms, maxBytes, headers = H) => [
  L('직접', () => rss(url, ms, { headers }, maxBytes)),
  ...(hasRelay() ? [L('중계', () => rss(url, ms + 5000, { headers, relay: true }, maxBytes))] : []),
  L('우회', () => rss(url, ms, { headers: headers === H ? FEED_H : H }, maxBytes)), // 다른 이름표(User-Agent)로 한 번 더
];

// ───────── 보도자료 ─────────
// GlobeNewswire: 상장사 전체 + 주제별(실적·M&A·배당·IPO·규제공시) + 업종별(바이오·은행·에너지)
const GNW_FEEDS = [
  'orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies',
  'subjectcode/13-Earnings%20Releases%20and%20Operating%20Results',
  'subjectcode/27-Mergers%20and%20Acquisitions',
  'subjectcode/12-Dividend%20Reports%20and%20Estimates',
  'subjectcode/21-Initial%20Public%20Offerings',
  'subjectcode/10-Company%20Regulatory%20Filings',
  'industry/4573-Biotechnology',
  'industry/8355-Banks',
  'industry/1-Energy',
].map((f) => 'https://www.globenewswire.com/RssFeed/' + f);
// GlobeNewswire는 Cloudflare 서버에서 직접 접속하면 응답이 멈추는 경우가 많아 중계 서버 경로를 먼저 시도
async function gnwRss(url) {
  // 중계(일반 브라우저 이름표) → 중계(피드 리더 이름표) → 직접 → 직접(다른 이름표)
  // 중계로 브라우저에서 부르면 0.5초에 되는데 워커(옛 Chrome 126 이름표)는 시간 초과 → 최신 브라우저 이름표로
  const NEW_H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  const routes = [
    ...(hasRelay() ? [L('중계', () => rss(url, 15000, { headers: NEW_H, relay: true }, 900000)), L('중계2', () => rss(url, 12000, { headers: FEED_H, relay: true }, 900000))] : []),
    L('직접', () => rss(url, 8000, { headers: NEW_H }, 900000)),
    L('우회', () => rss(url, 8000, { headers: FEED_H }, 900000)),
  ];
  return viaRoutes('gnw2', routes);
}
async function globeNewswire(idx, full) {
  const first = await Promise.allSettled([gnwRss(GNW_FEEDS[0])]);
  const rest = full ? await Promise.allSettled(GNW_FEEDS.slice(1).map(gnwRss)) : [];
  const all = [...first, ...rest];
  if (all.every((r) => r.status === 'rejected')) throw all[0].reason;
  const out = [];
  for (const r of all) {
    if (r.status !== 'fulfilled') continue;
    for (const x of r.value) {
      const cats = [...x.matchAll(/<category[^>]*domain="[^"]*\/rss\/stock"[^>]*>([^<]+)<\/category>/g)].map((m) => m[1].trim());
      const us = cats.map((c) => c.split(':')).find(([ex]) => US_EX.test(ex.trim()));
      const desc = strip(tag(x, 'description'));
      const company = strip(tag(x, 'dc:contributor')) || null;
      const title = strip(tag(x, 'title'));
      const ticker = us ? us[1].trim() : tickerOf(desc + ' ' + title, company, idx);
      if (!ticker) continue;
      const link = strip(tag(x, 'link'));
      out.push({ id: 'PR-' + hash(link), src: 'PR', market: 'US', title, desc: desc.slice(0, 400), url: link, time: iso(strip(tag(x, 'pubDate'))), source: 'GlobeNewswire', company, ticker, subject: strip(tag(x, 'dc:subject')) || null });
    }
  }
  return out;
}

const PRN_FEEDS = [
  'https://www.prnewswire.com/rss/news-releases-list.rss', // 전체 최신
  ...['financial-services', 'technology', 'business-technology', 'health', 'energy', 'auto-transportation', 'consumer-technology', 'general-business', 'consumer-products-retail', 'heavy-industry-manufacturing', 'telecommunications', 'entertainment-media', 'environment', 'policy-public-interest', 'travel'].map((c) => `https://www.prnewswire.com/rss/${c}-latest-news/${c}-latest-news-list.rss`),
];
async function prNewswire(idx, full) {
  // 가끔 PRN 서버가 잠깐 404를 주면 1초 뒤 한 번 더
  const get = (u) => viaRoutes('prn', rssRoutes(u, 9000, 900000));
  const all = await Promise.allSettled((full ? PRN_FEEDS : PRN_FEEDS.slice(0, 1)).map(get));
  if (all.every((r) => r.status === 'rejected')) throw all[0].reason;
  const out = [];
  for (const r of all) {
    if (r.status !== 'fulfilled') continue;
    for (const x of r.value) {
      const desc = strip(tag(x, 'description'));
      const company = strip(tag(x, 'dc:contributor')) || null;
      const title = strip(tag(x, 'title'));
      const ticker = tickerOf(desc + ' ' + title, company, idx);
      if (!ticker) continue;
      const link = strip(tag(x, 'link'));
      out.push({ id: 'PR-' + hash(link), src: 'PR', market: 'US', title, desc: desc.slice(0, 400), url: link, time: iso(strip(tag(x, 'pubDate'))), source: 'PR Newswire', company, ticker });
    }
  }
  return out;
}

// Business Wire 전체 뉴스
// Business Wire: 공식 "전체 뉴스" RSS (최신순, 약 1주일치·수 MB) → 앞부분만 읽음
//  ※ 예전 주소(…WA==)는 '네트워크 기술' 분야 전용이라 비어 있었음. 뉴스룸 페이지는 봇 차단(HTTP 400)
const BW_ALL = 'https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJcFVJYWQ==';
async function businessWire(idx, { maxBytes = 350000 } = {}) {
  const items = await viaRoutes('bw', rssRoutes(BW_ALL, 12000, maxBytes));
  const out = [];
  for (const x of items) {
    const link = strip(tag(x, 'link'));
    const nid = (link.match(/\/news\/home\/(\d+)\//) || [])[1];
    if (!nid) continue;
    if (!/\/en\//.test(link)) continue; // 영문판만
    const title = strip(tag(x, 'title'));
    const desc = strip(tag(x, 'description'));
    const ticker = tickerOf(desc + ' ' + title, null, idx);
    if (!ticker || !title) continue;
    const url = `https://www.businesswire.com/news/home/${nid}/en/`;
    out.push({ id: 'PR-' + hash(url), src: 'PR', market: 'US', title, desc: desc.slice(0, 400), url, time: iso(strip(tag(x, 'pubDate'))), source: 'Business Wire', company: null, ticker });
  }
  return out;
}

// ── PR Newswire 웹페이지 직접 확인 (RSS보다 빠름) — 한국시간 저녁 7시~10시 30분(미국 장 시작 전 보도자료 몰리는 시간)에만
function etIsoFrom(label) {
  // "05:00 ET" (오늘) 또는 "Sep 26, 2026, 17:02 ET"
  const now = new Date();
  const et = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).reduce((o, x) => ((o[x.type] = x.value), o), {});
  const m = String(label).match(/(?:([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), )?(\d{1,2}):(\d{2}) ET/);
  if (!m) return null;
  let y = Number(et.year), mo = Number(et.month), d = Number(et.day);
  if (m[1]) { y = Number(m[3]); mo = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(m[1]) / 3 + 1; d = Number(m[2]); }
  const hh = Number(m[4]), mm = Number(m[5]);
  if (!m[1] && hh * 60 + mm > Number(et.hour) * 60 + Number(et.minute) + 5) { const t = new Date(Date.UTC(y, mo - 1, d) - 86400e3); y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate(); } // 어제 글
  const probe = new Date(Date.UTC(y, mo - 1, d, 12));
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(probe).find((x) => x.type === 'timeZoneName')?.value || 'GMT-4';
  const oh = Number((off.match(/GMT([+-]\d+)/) || [])[1] || -4);
  return new Date(Date.UTC(y, mo - 1, d, hh - oh, mm)).toISOString();
}
export async function prnDirect(idx) {
  const r = await fetchWithTimeout('https://www.prnewswire.com/news-releases/news-releases-list/?page=1&pagesize=50', { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } }, 9000);
  if (!r.ok) throw new Error('PRN 페이지 HTTP ' + r.status);
  const html = (await r.text()).slice(0, 900000);
  const seen = (await getJSON('prn/seen')) || {};
  const out = [];
  let fetched = 0;
  for (const part of html.split('newsreleaseconsolidatelink').slice(1)) {
    const href = (part.match(/href="(\/news-releases\/[^"]+\.html)"/) || [])[1];
    if (!href) continue;
    const url = 'https://www.prnewswire.com' + href;
    const id = 'PR-' + hash(url);
    const when = strip((part.match(/<small>([^<]+)<\/small>/) || [])[1]);
    const title = strip((part.match(/<\/small>([\s\S]*?)<\/h3>/) || [])[1]);
    const desc = strip((part.match(/<p class="remove-outline">([\s\S]*?)<\/p>/) || [])[1]);
    if (!title) continue;
    let ticker = seen[id] === undefined ? tickerOf(desc + ' ' + title, null, idx) : seen[id] || null;
    let company = null;
    if (seen[id] === undefined && !ticker && fetched < 12) {
      // 목록에 티커가 안 보이면 본문 앞부분을 읽어 확인 (한 번만)
      fetched++;
      try {
        const pr = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } }, 7000);
        const ph = (await pr.text()).slice(0, 400000);
        company = (ph.match(/<meta name="author" content="([^"]+)"/) || [])[1] || null;
        const bodyText = strip((ph.split(/release-body|class="col-lg-10/)[1] || ph).slice(0, 60000));
        ticker = tickerOf(bodyText, company ? company.split(';')[0] : null, idx);
      } catch {}
    }
    if (seen[id] === undefined) seen[id] = ticker || 0;
    if (!ticker) continue;
    out.push({ id, src: 'PR', market: 'US', title, desc: desc.slice(0, 400), url, time: etIsoFrom(when) || new Date().toISOString(), source: 'PR Newswire', company, ticker, direct: true });
  }
  const keys = Object.keys(seen);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete seen[k];
  await setJSON('prn/seen', seen).catch(() => {});
  return out;
}

// ACCESS Newswire (소형 상장사 보도자료가 많음)
//  ※ 2026-09 RSS 서비스 종료 확인 → 뉴스룸 페이지(한 쪽 20건)를 직접 읽음
const MON = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
function etWallToIso(y, mo, d, h, mi) {
  const probe = new Date(Date.UTC(y, mo - 1, d, 12));
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(probe).find((x) => x.type === 'timeZoneName')?.value || 'GMT-4';
  const oh = Number((off.match(/GMT([+-]\d+)/) || [])[1] || -4);
  return new Date(Date.UTC(y, mo - 1, d, h - oh, mi)).toISOString();
}
async function awPage(page, relay) {
  const url = `https://www.accessnewswire.com/newsroom${page > 1 ? '?page=' + page : ''}`;
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, ...(relay ? { relay: true } : {}) }, relay ? 15000 : 10000);
  if (!r.ok) throw new Error('ACCESS Newswire HTTP ' + r.status);
  const html = (await r.text()).slice(0, 600000);
  const cards = html.split('<article class="nr-card').slice(1).map((c) => {
    const href = (c.match(/href="(https:\/\/www\.accessnewswire\.com\/newsroom\/[^"]+)"/) || [])[1];
    const title = strip((c.match(/nr-card-title"><a[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
    const meta = strip((c.match(/nr-card-meta">([^<]+)/) || [])[1]);
    const sum = strip((c.match(/nr-card-summary">([\s\S]*?)<\/p>/) || [])[1]);
    const m = meta.match(/([A-Z][a-z]+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)/);
    let time = null;
    if (m && MON[m[1]]) { let h = Number(m[4]) % 12; if (m[6] === 'PM') h += 12; time = etWallToIso(Number(m[3]), MON[m[1]], Number(m[2]), h, Number(m[5])); }
    return href && title ? { href, title, sum, time } : null;
  }).filter(Boolean);
  if (!cards.length) throw new Error('ACCESS Newswire 목록 형식 변경');
  return cards;
}
async function accessWire(idx, { pages = 1 } = {}) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const cards = await viaRoutes('aw', [L('직접', () => awPage(p, false)), ...(hasRelay() ? [L('중계', () => awPage(p, true))] : [])]);
    for (const c of cards) {
      const ticker = tickerOf(c.sum + ' ' + c.title, null, idx);
      if (!ticker) continue;
      out.push({ id: 'PR-' + hash(c.href), src: 'PR', market: 'US', title: c.title, desc: c.sum.slice(0, 400), url: c.href, time: c.time || new Date().toISOString(), source: 'ACCESS Newswire', company: null, ticker });
    }
  }
  return out;
}

// 뉴스와이어: 미국 상장사 보도자료 (영문·한국어 모두, 나스닥·뉴욕 티커가 확인된 것만. 한국·비상장 기업은 제외)
const KO_TICK_RE = /(?:나스닥|뉴욕증권거래소|뉴욕증시|NYSE American|NYSE|NASDAQ|Nasdaq)\s*(?:GS|GM|CM|글로벌\s*셀렉트\s*마켓)?\s*[:：]\s*([A-Z][A-Z.]{0,5})\b/;
async function newswireUs(idx) {
  const items = await viaRoutes('nw', rssRoutes('https://api.newswire.co.kr/rss/all', 8000, 900000));
  const out = [];
  for (const x of items) {
    const title = strip(tag(x, 'title'));
    const desc = strip(tag(x, 'description'));
    let ticker = ((desc + ' ' + title).match(KO_TICK_RE) || [])[1] || null;
    let company = null;
    if (!ticker) {
      // "심포니AI(SymphonyAI)" 처럼 괄호 안 영문 회사명 → 미국 상장사 목록과 일치하면 연결
      for (const m of desc.slice(0, 300).matchAll(/\(([A-Z][A-Za-z0-9&.,' -]{2,60})\)/g)) {
        const t = idx.get(normCo(m[1]));
        if (t) { ticker = t; company = m[1]; break; }
      }
    }
    if (!ticker) continue;
    const link = strip(tag(x, 'link')).replace(/&sourceType=rss/, '');
    out.push({ id: 'PR-' + hash(link), src: 'PR', market: 'US', title, desc: desc.slice(0, 400), url: link, time: iso(strip(tag(x, 'pubDate'))), source: '뉴스와이어', company, ticker, usOk: true, ko: /[가-힣]/.test(title) });
  }
  return out;
}

// 같은 보도자료가 여러 곳에 올라오면 하나만 남김 (영문판 우선)
//  · 영문끼리: 같은 티커 + 제목이 같으면 원 배포처(Business Wire 등)만 남기고 뉴스와이어 사본은 숨김
//  · 한국어판: 같은 티커, 72시간 이내 영문판과 숫자·영문 고유명사가 2개 이상 겹치면 한국어판 숨김
const COMMON = new Set(['inc', 'corp', 'nasdaq', 'nyse', 'the', 'and', 'with', 'for', 'business', 'wire', 'globe', 'newswire', 'news', 'announces', 'today', 'company', 'from']);
const marks = (x) => new Set(((x.title + ' ' + (x.desc || '').slice(0, 200)).match(/[A-Za-z][A-Za-z0-9-]{3,}|\d[\d.,]*\d%?|\d{2,}/g) || []).map((w) => w.toLowerCase()).filter((w) => !COMMON.has(w)));
const normT = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim();
function markDupes(items) {
  const nw = items.filter((x) => x.src === 'PR' && x.source === '뉴스와이어' && x.ticker);
  for (const k of nw) {
    const km = k.ko ? marks(k) : null;
    for (const e of items) {
      if (e === k || e.src !== 'PR' || e.source === '뉴스와이어' || e.ticker !== k.ticker) continue;
      if (Math.abs(Date.parse(e.time) - Date.parse(k.time)) > 72 * 3600e3) continue;
      if (!k.ko) { if (normT(e.title) === normT(k.title)) { k.dupOf = e.id; break; } continue; }
      let n = 0;
      for (const w of marks(e)) if (km.has(w)) n++;
      if (n >= 2) { k.dupOf = e.id; break; }
    }
  }
}

// ───────── 뉴스 ─────────
const GN = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
const KR_QUERIES = ['특징주 when:1d', '공시 주가 when:1d', '코스피 코스닥 마감 when:1d', '실적 발표 주가 when:1d'];
const US_QUERIES = ['뉴욕증시 when:1d', '미국 주식 특징주 when:1d', '나스닥 급등 when:1d'];

// 구글 뉴스 링크 안에 실제 기사 주소가 들어 있으면 꺼내기 (구형 형식만 가능)
function gnRealUrl(link) {
  try {
    const id = (String(link).match(/\/articles\/([^?]+)/) || [])[1];
    if (!id) return null;
    const bin = atob(id.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((id.length + 3) % 4));
    const m = bin.match(/https?:\/\/[\x21-\x7e]+/);
    return m ? m[0].replace(/[\x00-\x1f].*$/, '') : null;
  } catch { return null; }
}

async function googleNews(queries, market, names) {
  const all = await Promise.allSettled(queries.map((q) => rss(GN(q))));
  const out = [];
  for (const r of all) {
    if (r.status !== 'fulfilled') continue;
    for (const x of r.value.slice(0, 40)) {
      const raw = strip(tag(x, 'title'));
      const cut = raw.lastIndexOf(' - ');
      const title = cut > 10 ? raw.slice(0, cut) : raw;
      const source = cut > 10 ? raw.slice(cut + 3) : strip(tag(x, 'source'));
      const link = strip(tag(x, 'link'));
      let ticker = null, company = null, corpCode = null, mk = market;
      const us = matchUsKo(title);
      const kr = market === 'KR' || !us ? matchKr(title, names) : null;
      if (kr && (market === 'KR' || !us)) { ticker = kr.c; company = kr.n; corpCode = kr.k; mk = 'KR'; }
      else if (us) { ticker = us.tk; company = us.n; mk = 'US'; }
      const real = gnRealUrl(link);
      out.push({ id: 'NEWS-' + hash(title), src: 'NEWS', market: mk, title, desc: '', url: real || link, time: iso(strip(tag(x, 'pubDate'))), source, ticker, company, corpCode, viaGoogle: !real });
    }
  }
  return out;
}

async function finnhubNews() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return [];
  const r = await fetchWithTimeout(`https://finnhub.io/api/v1/news?category=general&token=${key}`, {}, 9000);
  if (!r.ok) throw new Error('Finnhub HTTP ' + r.status);
  const arr = await r.json();
  return (Array.isArray(arr) ? arr : []).slice(0, 60).map((n) => ({
    id: 'NEWS-' + hash(n.url || n.headline), src: 'NEWS', market: 'US', title: n.headline, desc: (n.summary || '').slice(0, 400), url: n.url, time: new Date((n.datetime || 0) * 1000).toISOString(), source: n.source || 'Finnhub', ticker: (n.related || '').split(',')[0] || null, company: null,
  }));
}

/** 전체 수집 → 기존 저장분과 병합 */
// 보도자료 수집 (뉴스는 원문을 가져올 수 없어 수집하지 않음)
//  full=false: 가장 빠른 전체 최신 목록만 (1분마다) / full=true: 주제·업종별 목록까지 (5분마다)
export async function collectNews({ full = true, direct = false } = {}) {
  const idx = await companyIndex();
  const jobs = {
    ...(direct ? { prnd: prnDirect(idx) } : {}),
    gnw: globeNewswire(idx, full), prn: prNewswire(idx, full), bw: businessWire(idx, { maxBytes: full ? 700000 : 350000 }), aw: accessWire(idx, { pages: full ? 2 : 1 }),
    nw: newswireUs(idx), // 뉴스와이어는 미국 상장사 보도자료만 (한국 기업 보도자료는 수집 안 함 — 한국은 DART 공시가 그 역할)
  };
  const errors = [];
  const fresh = [];
  const got = {};
  await Promise.all(Object.entries(jobs).map(async ([k, p]) => {
    try { const r = await p; got[k] = r; fresh.push(...r); } catch (e) { errors.push(`${k}: ${e.message}`); got[k] = e; }
  }));
  const prev = (await getJSON('news/feed')) || { items: [] };
  // 출처별 건강 상태 (멈춤 감지용): 마지막 성공·실패, 마지막으로 '새 글'이 들어온 시각
  try {
    const hl = (await getJSON('news/srchealth')) || {};
    const known = new Set(prev.items.map((x) => x.id));
    const now = new Date().toISOString();
    for (const [k, r] of Object.entries(got)) {
      const h = hl[k] || {};
      if (r instanceof Error) { h.lastErr = String(r.message).slice(0, 160); h.errAt = now; h.fails = (h.fails || 0) + 1; }
      else {
        h.okAt = now; h.fails = 0; h.count = r.length;
        const newest = r.reduce((m, x) => Math.max(m, Date.parse(x.time) || 0), 0);
        if (newest) h.newest = new Date(newest).toISOString();
        if (r.some((x) => !known.has(x.id)) || !h.newAt) h.newAt = now;
      }
      hl[k] = h;
    }
    await setJSON('news/srchealth', hl);
  } catch {}
  // 한국 보도자료는 저장하지 않음 (예전 저장분도 제거). 뉴스와이어는 미국 티커가 확인된 것만 남김
  const isKrPR = (x) => x.src !== 'PR' || x.market === 'KR' || (x.source === '뉴스와이어' && !x.usOk && !x.ko); // 뉴스·한국 보도자료 제외
  const byId = new Map(prev.items.filter((x) => !isKrPR(x)).map((x) => [x.id, x]));
  const tr = (await getJSON('tr/map')) || {};
  for (const it of fresh) {
    if (isKrPR(it)) continue;
    if (!it.titleKo && tr[it.id]) it.titleKo = tr[it.id];
    const old = byId.get(it.id);
    byId.set(it.id, old ? { ...it, titleKo: old.titleKo || it.titleKo, koTries: old.koTries, seenAt: old.seenAt } : { ...it, seenAt: new Date().toISOString() });
  }
  const cutoff = Date.now() - 3 * 86400e3;
  const items = [...byId.values()].filter((x) => Date.parse(x.time) > cutoff).sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 1500);
  for (const x of items) delete x.dupOf;
  markDupes(items);
  const feed = { updatedAt: new Date().toISOString(), errors, items };
  await setJSON('news/feed', feed).catch(() => {});
  return feed;
}

// 보도자료 사이트별 본문 영역
const BODY_MARKERS = [
  /<div[^>]*id="main-body-container"[^>]*>/i, // GlobeNewswire
  /<section[^>]*class="[^"]*release-body[^"]*"[^>]*>/i, // PR Newswire
  /<section[^>]*class="[^"]*article_column[^"]*"[^>]*>/i, // 뉴스와이어
  /<div[^>]*class="[^"]*release-body2[^"]*"[^>]*>/i,
  /<[a-z]+[^>]*itemprop="articleBody"[^>]*>/i,
  /<article[^>]*>/i,
];
/** 여는 태그 위치에서 같은 태그의 짝이 맞는 닫는 태그까지 잘라내기 */
function block(html, re) {
  const m = html.match(re);
  if (!m) return null;
  const tag = m[0].match(/^<([a-z0-9]+)/i)[1].toLowerCase();
  const open = new RegExp(`<${tag}[\\s>]`, 'gi'), close = new RegExp(`</${tag}>`, 'gi');
  let depth = 1, i = m.index + m[0].length;
  while (depth > 0) {
    open.lastIndex = i; close.lastIndex = i;
    const o = open.exec(html), c = close.exec(html);
    if (!c) return html.slice(m.index + m[0].length);
    if (o && o.index < c.index) { depth++; i = o.index + 1; } else { depth--; i = c.index + c[0].length; if (!depth) return html.slice(m.index + m[0].length, c.index); }
  }
  return null;
}
const JUNK = /cookie|subscribe|javascript|all rights reserved|©|Sign up|로그인|구독하기|무단전재|재배포 금지|이 기사를|관련 기사|SOURCE /i;

/** 기사·보도자료 본문 (AI 분석·원문 보기용): 줄 배열 + 정리된 HTML */
export async function fetchArticleLines(it) {
  const base = [it.title, it.desc].filter(Boolean);
  if (it.viaGoogle || !it.url) return { lines: base, note: '뉴스 원문은 언론사 사이트 정책상 제목·요약만 제공됩니다.' };
  let r;
  try { r = await fetchWithTimeout(it.url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' } }, 8000); } catch { r = null; }
  if (!r || !r.ok) return { lines: base, note: '본문을 불러오지 못해 제목·요약만 표시합니다.' };
  const buf = await r.arrayBuffer();
  const ct = r.headers.get('content-type') || '';
  let html = decodeText(buf, /euc-kr|ks_c|ms949/i.test(ct) ? 'euc-kr' : 'utf-8');
  html = html.replace(/[\r\n\t]+/g, ' ').replace(/<(script|style|noscript|iframe|svg|form|nav|header|footer|aside|button)[\s\S]*?<\/\1>/gi, '');
  let body = null;
  for (const re of BODY_MARKERS) { body = block(html, re); if (body && body.replace(/<[^>]+>/g, '').trim().length > 200) break; body = null; }
  if (!body) body = (html.match(/<p[\s>][\s\S]*?<\/p>/gi) || []).join('');
  body = body.replace(/<img[^>]*>/gi, '');
  const lines = decodeEntities(body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr|table|section)>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ').replace(/<[^>]+>/g, ' '))
    .split('\n').map((x) => x.replace(/\s+/g, ' ').replace(/(\s\|\s*)+$/, '').trim()).filter((x) => x.length > 1 && !JUNK.test(x));
  if (lines.join(' ').length < 120) return { lines: base, note: '본문을 찾지 못해 제목·요약만 표시합니다.' };
  return { lines: [it.title, ...lines.slice(0, 400)], html: sanitizeHtml(body, 120000) };
}
