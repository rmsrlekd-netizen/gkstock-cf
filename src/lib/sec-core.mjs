// SEC 수집 로직 (예약 함수와 /api/sec 대체 경로에서 공용)
import { fetchWithTimeout, sleep } from './util.mjs';
import { parseAtom, buildFeed, buildTickerMap, parseForm4 } from './sec-parse.mjs';
import { getJSON, setJSON } from './store.mjs';
import { fetchFilingText } from './sec-doc.mjs';
import { hasAI, koreanHeadlines } from './ai.mjs';

// SEC는 "이름 + 연락 이메일" 형식의 User-Agent를 요구합니다 (Cloudflare 변수 SEC_USER_AGENT).
// 환경변수는 요청이 들어온 뒤에 채워지므로 읽을 때마다 가져옴(getter)
export const SEC_HEADERS = {
  get 'User-Agent'() { return globalThis.process?.env?.SEC_USER_AGENT || 'GK Stock Terminal gkstock-admin@example.com'; },
};

// getcurrent의 type은 접두어 일치
export const SEC_TYPES = ['8-K', '6-K', '10-Q', '10-K', '20-F', 'S-1', 'F-1', 'S-3', '424B', 'SCHEDULE 13', 'SC 13', '4', '144', '13F-HR', '25'];

let tickerMem = { at: 0, map: null };

export async function getTickerMap() {
  if (tickerMem.map && Date.now() - tickerMem.at < 12 * 3600e3) return tickerMem.map;
  let raw = await getJSON('sec/tickers');
  if (!raw || Date.now() - (raw.at || 0) > 24 * 3600e3) {
    const r = await fetchWithTimeout('https://www.sec.gov/files/company_tickers_exchange.json', { headers: SEC_HEADERS }, 9000);
    if (!r.ok) {
      if (!raw) throw new Error('ticker map HTTP ' + r.status);
    } else {
      raw = { at: Date.now(), json: await r.json() };
      await setJSON('sec/tickers', raw).catch(() => {});
    }
  }
  tickerMem = { at: Date.now(), map: buildTickerMap(raw.json) };
  return tickerMem.map;
}

async function getCurrent(type, count, ms = 9000) {
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(type)}&company=&dateb=&owner=include&start=0&count=${count}&output=atom`;
  const r = await fetchWithTimeout(url, { headers: SEC_HEADERS }, ms);
  if (!r.ok) throw new Error(`${type} HTTP ${r.status}`);
  return parseAtom(await r.text());
}

/** 최신 공시 목록 수집 (초당 10회 제한을 지키도록 간격을 둠) */
// 자주 나오는 서식은 매번, 드문 서식은 3분에 한 번만 조회 (SEC 부하·시간 절약)
export const FAST_TYPES = ['8-K', '4', '6-K', 'SCHEDULE 13', '424B', '144'];
const SLOW_TYPES = ['10-Q', '10-K', '20-F', 'S-1', 'F-1', 'S-3', '13F-HR', '25', 'SC 13'];

export async function collectSec({ spacing = 120, all = false, budget = 12000, fastOnly = false, first = [], fastMs = 20000 } = {}) {
  const map = await getTickerMap();
  const raw = [];
  const errors = [];
  const minute = Math.floor(Date.now() / 60e3);
  let slow = fastOnly ? [] : all ? [...SLOW_TYPES] : SLOW_TYPES.filter((_, i) => (minute + i) % 3 === 0);
  // 지난번에 시간이 모자라 못 본 서식을 먼저 조회
  if (first.length) slow = [...first.filter((t) => slow.includes(t)), ...slow.filter((t) => !first.includes(t))];
  const types = [...FAST_TYPES, ...slow];
  const until = Date.now() + budget;
  let skipped = [];
  const ok = [], failed = new Map();
  const one = async (t, ms) => {
    try { raw.push(...(await getCurrent(t, t === '4' ? 100 : 60, ms))); ok.push(t); failed.delete(t); }
    catch (e) { failed.set(t, `${t}: ${e.name === 'AbortError' ? '응답 지연' : e.message}`); }
  };
  // 자주 나오는 서식(8-K·Form 4 등)은 SEC가 느릴 때(10~15초) 대비해 한꺼번에 넉넉히 기다림 (0.15초 간격으로 출발 → 초당 10회 제한 안)
  const fast = types.filter((t) => FAST_TYPES.includes(t)), rest = types.filter((t) => !FAST_TYPES.includes(t));
  await Promise.all(fast.map((t, i) => sleep(i * 150).then(() => one(t, fastMs))));
  const until2 = Math.max(until, Date.now() + 6000); // 드문 서식도 최소 6초는 조회
  // 드문 서식은 남은 시간 안에서 세 개씩
  for (let i = 0; i < rest.length; i += 3) {
    if (Date.now() > until2) { skipped = rest.slice(i); break; }
    await Promise.all(rest.slice(i, i + 3).map((t) => one(t, 9000)));
    await sleep(spacing);
  }
  // SEC 서버가 잠깐 느려서 놓친 서식은 남은 시간 안에 한 번 더 (자주 나오는 서식 먼저)
  const retry = [...failed.keys()].filter((t) => !FAST_TYPES.includes(t));
  for (let i = 0; i < retry.length && until2 + 4000 - Date.now() > 3000; i += 3) {
    await Promise.all(retry.slice(i, i + 3).map((t) => one(t, Math.min(8000, until2 + 4000 - Date.now()))));
  }
  errors.push(...failed.values());
  if (!raw.length && errors.length) throw new Error(errors.join(' / '));
  return { items: buildFeed(raw, map), errors, skipped: [...new Set([...failed.keys(), ...skipped])], ok };
}

/** Form 4 원문을 읽어 매수/매도 수량·금액을 붙임 */
export async function enrichForm4(items, { max = 20, deadline = Date.now() + 15000 } = {}) {
  let n = 0;
  for (const it of items) {
    if (n >= max || Date.now() > deadline) break;
    if (!/^4(\/A)?$/.test(it.form) || it.tx || (it.txTries || 0) >= 2 || !it.url) continue;
    n++;
    try {
      const folder = it.url.replace(/\/[^/]*$/, '/');
      const idx = await (await fetchWithTimeout(folder + 'index.json', { headers: SEC_HEADERS }, 5000)).json();
      const xmlName = (idx?.directory?.item || []).map((x) => x.name).find((nm) => /\.xml$/i.test(nm) && !/^(xsl|FilingSummary)/i.test(nm));
      if (!xmlName) throw new Error('no xml');
      await sleep(110);
      const xml = await (await fetchWithTimeout(folder + xmlName, { headers: SEC_HEADERS }, 5000)).text();
      const tx = parseForm4(xml);
      it.tx = tx;
      if (tx.main) {
        // 헤드라인 중요도: 임원의 장내 매수는 강한 신호
        if (tx.main.code === 'P') it.impact = Math.max(it.impact, tx.main.value >= 1e6 ? 5 : 4);
        else if (tx.main.code === 'S' && tx.main.value >= 1e7) it.impact = Math.max(it.impact, 3);
      }
      await sleep(110);
    } catch (e) {
      it.txTries = (it.txTries || 0) + 1;
    }
  }
  return n;
}

/** 8-K·6-K 원문(보도자료/본문)에서 핵심 문장 추출 + (선택) 한국어 요약 */
export async function enrichDocs(items, { max = 8, deadline = Date.now() + 12000 } = {}) {
  const fetcher = async (url) => {
    await sleep(110);
    const r = await fetchWithTimeout(url, { headers: SEC_HEADERS }, 7000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  };
  let n = 0;
  for (const it of items) {
    if (n >= max || Date.now() > deadline) break;
    if (!/^(8-K|6-K)/.test(it.form) || it.pr || (it.docTries || 0) >= 2 || !it.url) continue;
    n++;
    try {
      const r = await fetchFilingText(it.url, fetcher);
      it.pr = { headline: r.headline || null, deck: r.deck || null, itemText: r.itemText || null, doc: r.doc || null };
      if (r.excerpt) it._excerpt = r.excerpt;
    } catch {
      it.docTries = (it.docTries || 0) + 1;
    }
  }
  // 한국어 요약 (ANTHROPIC_API_KEY 있을 때만)
  if (hasAI() && Date.now() < deadline + 1500) {
    const batch = items.filter((x) => x.pr && !x.ko && (x.aiTries || 0) < 2 && (x.pr.headline || x.pr.itemText)).slice(0, 12);
    if (batch.length) {
      try {
        const res = await koreanHeadlines(batch.map((x) => ({ id: x.id, company: x.name, ticker: x.ticker, form: x.form, items: (x.items || []).map((i) => i.ko), headline: x.pr.headline || '', excerpt: x._excerpt || x.pr.itemText || '' })));
        for (const x of batch) { if (res[x.id]) { x.ko = res[x.id]; delete x._excerpt; } else x.aiTries = (x.aiTries || 0) + 1; }
      } catch (e) {
        batch.forEach((x) => (x.aiTries = (x.aiTries || 0) + 1));
        items._aiError = String(e.message || e).slice(0, 300);
        console.warn('AI 요약 실패', e.message);
      }
    }
  }
  return n;
}

/** 기존 저장분과 병합 (최근 4일, 최대 1500건) */
export function mergeFeed(prev = [], next = []) {
  const byId = new Map(prev.map((x) => [x.id, x]));
  for (const it of next) {
    const old = byId.get(it.id);
    byId.set(it.id, old ? { ...it, tx: old.tx, txTries: old.txTries, pr: old.pr, docTries: old.docTries, ko: old.ko, aiTries: old.aiTries, _excerpt: old._excerpt, impact: Math.max(it.impact, old.impact || 0) } : it);
  }
  const cutoff = Date.now() - 4 * 86400e3;
  return [...byId.values()]
    .filter((x) => (Date.parse(x.time) || 0) > cutoff)
    .sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0))
    .slice(0, 1500);
}

/** 예약 함수 1회 실행: 수집 → 병합 → Form 4 보강 → 저장 */
export async function runSecWatch() {
  const started = Date.now();
  const prev = (await getJSON('sec/feed')) || { items: [] };
  const first = (await getJSON('sec/skipped'))?.types || [];
  const { items, errors, skipped, ok } = await collectSec({ all: true, budget: 14000, first });
  await setJSON('sec/skipped', { types: skipped, at: Date.now() }).catch(() => {});
  // 서식별 마지막 성공 시각 (잠깐 느린 것과 계속 막힌 것을 구분하는 고장 감시용)
  const tok = (await getJSON('sec/typeok')) || {};
  for (const t of ok || []) tok[t] = Date.now();
  await setJSON('sec/typeok', tok).catch(() => {});
  const merged = mergeFeed(prev.items, items);
  const t1 = Date.now(); // 목록 조회가 오래 걸렸어도 보강 작업 시간은 확보
  const enriched = await enrichForm4(merged, { max: 20, deadline: t1 + 8000 });
  const docs = await enrichDocs(merged, { max: 14, deadline: t1 + 14000 });
  const aiError = merged._aiError || null;
  delete merged._aiError;
  await setJSON('sec/feed', { updatedAt: new Date().toISOString(), errors, skipped, aiError, items: merged });
  return { count: merged.length, fresh: items.length, enriched, docs, errors, ms: Date.now() - started };
}
