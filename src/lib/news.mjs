// 뉴스·보도자료 수집 (미국·한국)
//  보도자료: GlobeNewswire(티커 포함), PR Newswire, 뉴스와이어(한국)
//  뉴스: 구글 뉴스 RSS(한국어), Finnhub(키가 있으면)
import { fetchWithTimeout, BROWSER_UA, decodeEntities } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';
import { getKrNames, matchKr, matchUsKo } from './krnames.mjs';

const H = { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' };

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const strip = (s) => decodeEntities(String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, n) => { const m = x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`)); return m ? m[1] : ''; };
const iso = (d) => { const t = Date.parse(d); return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(); };
const US_EX = /^(nasdaq|nyse|nyse american|nyse arca|nyse mkt|amex|otcqx|otcqb|otc|cboe)$/i;
const TICK_RE = /\((?:NYSE American|NYSE Arca|NYSE|NASDAQ|Nasdaq|OTCQX|OTCQB|OTC Markets|CBOE|Cboe)\s*(?:GS|GM|CM)?\s*:\s*([A-Z][A-Z.]{0,5})\)/;

async function rss(url, ms = 7000) {
  const r = await fetchWithTimeout(url, { headers: H }, ms);
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
  const xml = await r.text();
  return xml.split(/<item[\s>]/).slice(1).map((s) => s.split('</item>')[0]);
}

// ───────── 보도자료 ─────────
async function globeNewswire() {
  const items = await rss('https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies');
  return items.map((x) => {
    const cats = [...x.matchAll(/<category[^>]*domain="[^"]*\/rss\/stock"[^>]*>([^<]+)<\/category>/g)].map((m) => m[1].trim());
    const us = cats.map((c) => c.split(':')).find(([ex]) => US_EX.test(ex.trim()));
    const desc = strip(tag(x, 'description'));
    const ticker = us ? us[1].trim() : (desc.match(TICK_RE) || [])[1] || null;
    const link = strip(tag(x, 'link'));
    return { id: 'PR-' + hash(link), src: 'PR', market: 'US', title: strip(tag(x, 'title')), desc: desc.slice(0, 400), url: link, time: iso(strip(tag(x, 'pubDate'))), source: 'GlobeNewswire', company: strip(tag(x, 'dc:contributor')) || null, ticker, subject: strip(tag(x, 'dc:subject')) || null };
  }).filter((x) => x.ticker);
}

const PRN_FEEDS = ['financial-services', 'technology', 'health', 'energy', 'auto-transportation'].map((c) => `https://www.prnewswire.com/rss/${c}-latest-news/${c}-latest-news-list.rss`);
async function prNewswire() {
  const all = await Promise.allSettled(PRN_FEEDS.map((u) => rss(u)));
  const out = [];
  for (const r of all) {
    if (r.status !== 'fulfilled') continue;
    for (const x of r.value) {
      const desc = strip(tag(x, 'description'));
      const ticker = (desc.match(TICK_RE) || [])[1];
      if (!ticker) continue;
      const link = strip(tag(x, 'link'));
      out.push({ id: 'PR-' + hash(link), src: 'PR', market: 'US', title: strip(tag(x, 'title')), desc: desc.slice(0, 400), url: link, time: iso(strip(tag(x, 'pubDate'))), source: 'PR Newswire', company: null, ticker });
    }
  }
  return out;
}

async function newswireKr(names) {
  const items = await rss('https://api.newswire.co.kr/rss/all');
  const out = [];
  for (const x of items) {
    const title = strip(tag(x, 'title'));
    if (!/[가-힣]/.test(title)) continue; // 한국어 보도자료만 (영문 원문과 중복 방지)
    const desc = strip(tag(x, 'description'));
    const link = strip(tag(x, 'link')).replace(/&sourceType=rss/, '');
    const us = (desc.match(TICK_RE) || [])[1];
    const kr = us ? null : matchKr(title, names) || matchKr(desc.slice(0, 120), names);
    out.push({ id: 'PR-' + hash(link), src: 'PR', market: us ? 'US' : 'KR', title, desc: desc.slice(0, 400), url: link, time: iso(strip(tag(x, 'pubDate'))), source: '뉴스와이어', ticker: us || kr?.c || null, company: kr?.n || null, corpCode: kr?.k || null });
  }
  return out;
}

// ───────── 뉴스 ─────────
const GN = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
const KR_QUERIES = ['특징주 when:1d', '공시 주가 when:1d', '코스피 코스닥 마감 when:1d', '실적 발표 주가 when:1d'];
const US_QUERIES = ['뉴욕증시 when:1d', '미국 주식 특징주 when:1d', '나스닥 급등 when:1d'];

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
      out.push({ id: 'NEWS-' + hash(title), src: 'NEWS', market: mk, title, desc: '', url: link, time: iso(strip(tag(x, 'pubDate'))), source, ticker, company, corpCode, viaGoogle: true });
    }
  }
  return out;
}

async function finnhubNews() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return [];
  const r = await fetchWithTimeout(`https://finnhub.io/api/v1/news?category=general&token=${key}`, {}, 6000);
  if (!r.ok) throw new Error('Finnhub HTTP ' + r.status);
  const arr = await r.json();
  return (Array.isArray(arr) ? arr : []).slice(0, 60).map((n) => ({
    id: 'NEWS-' + hash(n.url || n.headline), src: 'NEWS', market: 'US', title: n.headline, desc: (n.summary || '').slice(0, 400), url: n.url, time: new Date((n.datetime || 0) * 1000).toISOString(), source: n.source || 'Finnhub', ticker: (n.related || '').split(',')[0] || null, company: null,
  }));
}

/** 전체 수집 → 기존 저장분과 병합 */
export async function collectNews() {
  const names = await getKrNames({ allowFetch: false });
  const jobs = {
    gnw: globeNewswire(), prn: prNewswire(), nwkr: newswireKr(names),
    krnews: googleNews(KR_QUERIES, 'KR', names), usnews: googleNews(US_QUERIES, 'US', names), fh: finnhubNews(),
  };
  const errors = [];
  const fresh = [];
  await Promise.all(Object.entries(jobs).map(async ([k, p]) => {
    try { fresh.push(...(await p)); } catch (e) { errors.push(`${k}: ${e.message}`); }
  }));
  const prev = (await getJSON('news/feed')) || { items: [] };
  const byId = new Map(prev.items.map((x) => [x.id, x]));
  for (const it of fresh) {
    const old = byId.get(it.id);
    byId.set(it.id, old ? { ...it, titleKo: old.titleKo, koTries: old.koTries, seenAt: old.seenAt } : { ...it, seenAt: new Date().toISOString() });
  }
  const cutoff = Date.now() - 3 * 86400e3;
  const items = [...byId.values()].filter((x) => Date.parse(x.time) > cutoff).sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 1500);
  const feed = { updatedAt: new Date().toISOString(), errors, items };
  await setJSON('news/feed', feed).catch(() => {});
  return feed;
}

/** 기사·보도자료 본문 텍스트 (AI 분석·원문 보기용) */
export async function fetchArticleLines(it) {
  const base = [it.title, it.desc].filter(Boolean);
  if (it.viaGoogle || !it.url) return { lines: base, note: '뉴스 제목·요약 기반' };
  const r = await fetchWithTimeout(it.url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } }, 7000);
  if (!r.ok) return { lines: base, note: '본문을 불러오지 못해 제목·요약 기반' };
  const html = await r.text();
  const body = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<(script|style|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, '');
  const lines = decodeEntities(body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 40 && !/cookie|subscribe|javascript|copyright|all rights reserved|©/i.test(s));
  return { lines: lines.length ? [it.title, ...lines.slice(0, 80)] : base };
}
