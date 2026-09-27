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

async function rss(url, ms = 7000, opts = {}) {
  const r = await fetchWithTimeout(url, { headers: H, ...opts }, ms);
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
  const xml = await r.text();
  return xml.split(/<item[\s>]/).slice(1).map((s) => s.split('</item>')[0]);
}

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
let gnwViaRelay = false; // 직접 접속이 막히면 이후엔 서울 중계 서버로
async function gnwRss(url) {
  if (!gnwViaRelay) {
    try { return await rss(url, 8000); } catch (e) { if (!process.env.KR_RELAY_URL) throw e; gnwViaRelay = true; }
  }
  return rss(url, 10000, { relay: true });
}
async function globeNewswire(idx) {
  const first = await Promise.allSettled([gnwRss(GNW_FEEDS[0])]);
  const rest = await Promise.allSettled(GNW_FEEDS.slice(1).map(gnwRss));
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
async function prNewswire(idx) {
  const all = await Promise.allSettled(PRN_FEEDS.map((u) => rss(u)));
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
async function businessWire(idx) {
  const items = await rss('https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeGVtRWA==', 8000);
  const out = [];
  for (const x of items) {
    const desc = strip(tag(x, 'description'));
    const title = strip(tag(x, 'title'));
    const company = strip(tag(x, 'dc:creator')) || strip(tag(x, 'author')) || null;
    const ticker = tickerOf(desc + ' ' + title, company, idx);
    if (!ticker) continue;
    const link = strip(tag(x, 'link'));
    out.push({ id: 'PR-' + hash(link), src: 'PR', market: 'US', title, desc: desc.slice(0, 400), url: link, time: iso(strip(tag(x, 'pubDate'))), source: 'Business Wire', company, ticker });
  }
  return out;
}

// ACCESS Newswire (소형 상장사 보도자료가 많음)
async function accessWire(idx) {
  const items = await rss('https://www.accesswire.com/rssfeed.aspx', 8000);
  const out = [];
  for (const x of items) {
    const desc = strip(tag(x, 'description'));
    const title = strip(tag(x, 'title'));
    const company = strip(tag(x, 'dc:creator')) || strip(tag(x, 'author')) || null;
    const ticker = tickerOf(desc + ' ' + title, company, idx);
    if (!ticker) continue;
    const link = strip(tag(x, 'link'));
    out.push({ id: 'PR-' + hash(link), src: 'PR', market: 'US', title, desc: desc.slice(0, 400), url: link, time: iso(strip(tag(x, 'pubDate'))), source: 'ACCESS Newswire', company, ticker });
  }
  return out;
}

// 뉴스와이어: 미국 상장사 보도자료 (영문·한국어 모두, 나스닥·뉴욕 티커가 확인된 것만. 한국·비상장 기업은 제외)
const KO_TICK_RE = /(?:나스닥|뉴욕증권거래소|뉴욕증시|NYSE American|NYSE|NASDAQ|Nasdaq)\s*(?:GS|GM|CM|글로벌\s*셀렉트\s*마켓)?\s*[:：]\s*([A-Z][A-Z.]{0,5})\b/;
async function newswireUs(idx) {
  const items = await rss('https://api.newswire.co.kr/rss/all');
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
export async function collectNews() {
  const [names, idx] = await Promise.all([getKrNames({ allowFetch: false }), companyIndex()]);
  const jobs = {
    gnw: globeNewswire(idx), prn: prNewswire(idx), bw: businessWire(idx), aw: accessWire(idx),
    nw: newswireUs(idx), // 뉴스와이어는 미국 상장사 한국어 보도자료만 (한국 기업 보도자료는 수집 안 함 — 한국은 DART 공시가 그 역할)
    krnews: googleNews(KR_QUERIES, 'KR', names), usnews: googleNews(US_QUERIES, 'US', names), fh: finnhubNews(),
  };
  const errors = [];
  const fresh = [];
  await Promise.all(Object.entries(jobs).map(async ([k, p]) => {
    try { fresh.push(...(await p)); } catch (e) { errors.push(`${k}: ${e.message}`); }
  }));
  const prev = (await getJSON('news/feed')) || { items: [] };
  // 한국 보도자료는 저장하지 않음 (예전 저장분도 제거). 뉴스와이어는 미국 티커가 확인된 것만 남김
  const isKrPR = (x) => x.src === 'PR' && (x.market === 'KR' || (x.source === '뉴스와이어' && !x.usOk && !x.ko));
  const byId = new Map(prev.items.filter((x) => !isKrPR(x)).map((x) => [x.id, x]));
  for (const it of fresh) {
    if (isKrPR(it)) continue;
    const old = byId.get(it.id);
    byId.set(it.id, old ? { ...it, titleKo: old.titleKo, koTries: old.koTries, seenAt: old.seenAt } : { ...it, seenAt: new Date().toISOString() });
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
