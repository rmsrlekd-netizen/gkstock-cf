// 과거 공시 채우기
//  ① 미국: SEC 일별 색인(daily-index)으로 하루씩 거슬러 올라가며 상장사 주요 공시 저장 → 8-K는 공시 색인 페이지에서 항목 번호·접수 시각 보강
//  ② 한국: DART 목록 API로 하루씩 거슬러 올라가며 상장사 공시 저장
//  ③ 기업 페이지를 열면 그 회사의 과거 공시를 한꺼번에 저장 (SEC 회사별 제출 목록 / DART 회사별 목록)
//  보도자료는 RSS 특성상 과거분을 받을 수 없어, 오늘부터 쌓이는 것만 보관됨
import { fetchWithTimeout, fetchTextCapped, sleep, kstDate } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';
import { classifyForm, ITEM_8K } from './sec-parse.mjs';
import { getTickerMap, SEC_HEADERS } from './sec-core.mjs';
import { classifyDart } from './dart-classify.mjs';
import { cleanTitle } from './dart-doc.mjs';
import { archiveItems, needEnrich, markEnriched } from './archive.mjs';

const DAYS = () => Math.max(7, Math.min(365, Number(process.env.BACKFILL_DAYS || 90)));
const BULK_FORMS = /^(8-K|8-K\/A|6-K|10-Q|10-K|20-F|40-F|S-1|F-1|S-3|F-3|424B\d|SC 13[DG]|SC 13[DG]\/A|SCHEDULE 13[DG]|SCHEDULE 13[DG]\/A|25|25-NSE)$/i;
const COMPANY_FORMS = /^(8-K|8-K\/A|6-K|10-Q|10-K|20-F|40-F|S-1|F-1|S-3|F-3|424B\d|SC 13[DG]|SC 13[DG]\/A|SCHEDULE 13[DG]|SCHEDULE 13[DG]\/A|25|25-NSE|4|144)$/i;

// ── 미국 동부시간 → UTC ms (서머타임 반영)
function etOffsetHours(y, m, d) {
  const nthSunday = (yy, mm, n) => { const first = new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (n - 1) * 7; };
  const start = nthSunday(y, 3, 2), end = nthSunday(y, 11, 1);
  const inDst = (m > 3 && m < 11) || (m === 3 && d >= start) || (m === 11 && d < end);
  return inDst ? 4 : 5;
}
function etToIso(dateStr, timeStr = '16:00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const off = etOffsetHours(y, m, d);
  return `${dateStr}T${timeStr}-0${off}:00`;
}

function secItem({ cik, name, tk, form, acc, date, acceptedEt, items }) {
  const [formKo, cat, baseImpact] = classifyForm(form);
  let impact = baseImpact, category = cat;
  const its = (items || []).map((code) => { const ko = ITEM_8K[code]; if (ko) impact = Math.max(impact, ko[1]); return { code, en: '', ko: ko ? ko[0] : `Item ${code}` }; });
  if (its.some((i) => i.code === '2.02')) category = 'earnings';
  else if (its.some((i) => i.code === '3.02')) category = 'offering';
  if (/\/A$/.test(form)) impact = Math.max(0, impact - 1);
  const time = acceptedEt ? etToIso(acceptedEt.slice(0, 10), acceptedEt.slice(11, 19)) : etToIso(date);
  return {
    id: 'SEC-' + acc, src: 'SEC', form, formKo, category, impact,
    name: tk?.name || name, filerName: name, cik: String(cik).padStart(10, '0'), ticker: tk?.ticker || null, exchange: tk?.exchange || null,
    party: null, items: its.filter((i) => i.code !== '9.01' || its.length === 1),
    time, url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${acc}-index.htm`,
    archived: true, ...(acceptedEt ? {} : { approxTime: true }),
  };
}

// ── ① 미국: 일별 색인
async function secDay(dateStr, tmap) {
  const [y, m, d] = dateStr.split('-');
  const q = Math.ceil(Number(m) / 3);
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${y}${m}${d}.idx`;
  let txt;
  try { txt = await fetchTextCapped(url, { headers: SEC_HEADERS }, 15000, 12_000_000); }
  catch (e) { if (/HTTP 404|HTTP 403/.test(e.message)) return { none: true }; throw e; }
  const out = [];
  for (const line of txt.split('\n')) {
    const mm = line.match(/^(.+?)\s+(\d{1,10})\s+(\d{8})\s+(edgar\/data\/\S+?\/(\d{10}-\d{2}-\d{6})\.txt)\s*$/);
    if (!mm) continue;
    const fm = mm[1].match(/^(SCHEDULE 13[DG](?:\/A)?|SC 13[DG](?:\/A)?|SC TO-[CIT](?:\/A)?|\S+)\s+(.+)$/);
    if (!fm) continue;
    const form = fm[1].trim();
    if (!BULK_FORMS.test(form)) continue;
    const tk = tmap.get(String(Number(mm[2])));
    if (!tk) continue; // 상장사만
    const name = fm[2].trim();
    out.push(secItem({ cik: mm[2], name, tk, form, acc: mm[5], date: `${y}-${m}-${d}` }));
  }
  return { items: out };
}

// 8-K·6-K: 공시 색인 페이지에서 항목 번호와 정확한 접수 시각 읽기
async function secEnrichOne(it) {
  const html = await fetchTextCapped(it.url, { headers: SEC_HEADERS }, 8000, 200000);
  const acc = (html.match(/Accepted<\/div>\s*<div class="info">([\d-]+ [\d:]+)</) || [])[1];
  const items = [...html.matchAll(/Item\s+(\d{1,2}\.\d{2})\s*:/g)].map((m) => m[1]);
  const upd = secItem({ cik: it.cik, name: it.filerName, tk: it.ticker ? { ticker: it.ticker, name: it.name, exchange: it.exchange } : null, form: it.form, acc: it.id.slice(4), date: it.time.slice(0, 10), acceptedEt: acc ? acc.replace(' ', 'T') : null, items: [...new Set(items)] });
  return upd;
}

// ── ② 한국: DART 하루치 목록 (상장사만)
const CLS = { Y: 'KOSPI', K: 'KOSDAQ', N: 'KONEX' };
export function dartItem(b) {
  const title = (b.report_nm || '').replace(/\s+/g, ' ').trim();
  const [category, impact] = classifyDart(title);
  const d = b.rcept_dt || '';
  const date = d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
  const seqPart = Number(String(b.rcept_no).slice(-6)) || 0;
  return {
    id: 'DART-' + b.rcept_no, titleClean: cleanTitle(title), src: 'DART',
    form: title.replace(/\[.*?\]/g, '').split('(')[0].trim(), formKo: title, category, impact,
    name: b.corp_name, ticker: b.stock_code || null, corpCode: b.corp_code || null, exchange: CLS[b.corp_cls] || null,
    party: b.flr_nm && b.flr_nm !== b.corp_name ? b.flr_nm : null, remark: b.rm || '', date, seq: b.rcept_no,
    url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${b.rcept_no}`,
    // 접수 시각을 모르는 과거 공시: 접수번호 순서대로 그날 안에서 정렬되도록 대략적인 시각
    approxMs: (Date.parse(`${date}T08:00:00+09:00`) || 0) + Math.min(seqPart, 36000) * 1000, archived: true,
  };
}
async function dartDay(key, ymd, page) {
  const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${encodeURIComponent(key)}&bgn_de=${ymd}&end_de=${ymd}&page_no=${page}&page_count=100&sort=date&sort_mth=desc`;
  const r = await fetchWithTimeout(url, {}, 9000);
  const j = await r.json();
  if (j.status === '013') return { list: [], total: 0 };
  if (j.status !== '000') throw new Error(`DART ${j.status}: ${j.message}`);
  return { list: j.list || [], totalPage: Number(j.total_page) || 1 };
}

/** 과거 채우기 한 단계 (수집기 실행 뒤 남는 시간에 조금씩). which: 'sec' | 'dart' */
// Cloudflare D1 무료 한도: 하루 10만 행 쓰기 (한국시간 오전 9시 초기화)
// 과거 채우기는 하루 이 만큼만 씀 → 실시간 수집이 쓸 몫을 남겨둠. 유료(Workers Paid)면 BACKFILL_DAILY_ROWS를 크게 (예: 2000000)
const DAILY_ROWS = () => Math.max(0, Number(process.env.BACKFILL_DAILY_ROWS) || 25000);
const utcDay = () => new Date().toISOString().slice(0, 10);

export async function backfillStep(which, { budgetMs = 20000 } = {}) {
  const until = Date.now() + budgetMs;
  const st = (await getJSON('backfill/state')) || {};
  if (!st.quota || st.quota.day !== utcDay()) st.quota = { day: utcDay(), rows: 0 };
  if (st.quota.rows >= DAILY_ROWS()) { st.quota.full = true; return 0; } // 오늘 몫 다 씀 → 내일 이어서
  const count = () => { st.quota.rows += archiveItems.lastWritten || 0; archiveItems.lastWritten = 0; };
  const limitDay = kstDate(-DAYS());
  let saved = 0;
  if (which === 'sec') {
    const s = st.sec || { day: kstDate(-3) };
    if (s.done && s.day >= limitDay) s.done = false; // BACKFILL_DAYS를 늘리면 이어서 더 과거로
    const tmap = await getTickerMap();
    // 1) 8-K 항목·시각 보강 (먼저 쌓인 것부터)
    const todo = await needEnrich(12);
    const done = [];
    for (const it of todo) {
      if (Date.now() > until - 4000) break;
      try { done.push(await secEnrichOne(it)); } catch { done.push({ ...it, enrichFail: true }); }
      await sleep(130);
    }
    if (done.length) { await markEnriched(done); count(); }
    // 2) 하루치 색인
    if (!s.done && Date.now() < until - 6000) {
      if (s.day < limitDay) s.done = true;
      else {
        const r = await secDay(s.day, tmap);
        if (r.items?.length) {
          const needs = r.items.filter((x) => /^(8-K|6-K)/.test(x.form));
          const rest = r.items.filter((x) => !/^(8-K|6-K)/.test(x.form));
          saved += await archiveItems(needs, { mode: 'ignore', enrich: 1 }); count();
          saved += await archiveItems(rest, { mode: 'ignore' }); count();
        }
        s.log = `${s.day}: ${r.none ? '휴장·색인 없음' : (r.items?.length || 0) + '건'}`;
        s.day = shiftDay(s.day, -1);
      }
    }
    st.sec = { ...s, at: Date.now() };
  } else {
    const key = process.env.DART_API_KEY;
    if (!key) return 0;
    const s = st.dart || { day: kstDate(-3), page: 1 };
    if (s.done && s.day >= limitDay) s.done = false; // BACKFILL_DAYS를 늘리면 이어서 더 과거로
    while (!s.done && Date.now() < until - 3000 && st.quota.rows < DAILY_ROWS()) {
      if (s.day < limitDay) { s.done = true; break; }
      const r = await dartDay(key, s.day.replace(/-/g, ''), s.page);
      const listed = r.list.filter((x) => CLS[x.corp_cls] && x.stock_code);
      if (listed.length) { saved += await archiveItems(listed.map(dartItem), { mode: 'ignore' }); count(); }
      if (!r.list.length || s.page >= (r.totalPage || 1) || s.page >= 60) { s.log = `${s.day}: ${s.page}쪽 완료`; s.day = shiftDay(s.day, -1); s.page = 1; }
      else s.page++;
    }
    st.dart = { ...s, at: Date.now() };
  }
  await setJSON('backfill/state', st).catch(() => {});
  return saved;
}
function shiftDay(d, n) { return new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10); }

// ── ③ 기업별 과거 공시 (기업 페이지·종목 필터를 열 때)
export async function companyHistory(market, ticker, corpCode) {
  const key = `hist/${market}/${String(ticker || corpCode).toUpperCase()}`;
  const mark = await getJSON(key);
  if (mark && Date.now() - mark.at < 12 * 3600e3) return { cached: true, n: mark.n };
  let items = [];
  if (market === 'US') {
    const tmap = await getTickerMap();
    let cik = null, tk = null;
    for (const [c, v] of tmap) if (String(v.ticker).toUpperCase() === String(ticker).toUpperCase()) { cik = c; tk = v; break; }
    if (!cik) return { n: 0 };
    const r = await fetchWithTimeout(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, { headers: SEC_HEADERS }, 12000);
    if (!r.ok) throw new Error('SEC submissions HTTP ' + r.status);
    const j = await r.json();
    const f = j.filings?.recent || {};
    for (let i = 0; i < (f.accessionNumber || []).length && items.length < 600; i++) {
      const form = f.form[i];
      if (!COMPANY_FORMS.test(form)) continue;
      const acc = f.accessionNumber[i];
      const accepted = String(f.acceptanceDateTime?.[i] || '').replace(/\.\d+Z?$/, '').replace('Z', ''); // EDGAR는 동부시간 값을 표기
      const its = String(f.items?.[i] || '').split(',').map((x) => x.trim()).filter(Boolean);
      items.push(secItem({ cik, name: j.name || tk.name, tk, form, acc, date: f.filingDate[i], acceptedEt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(accepted) ? accepted : null, items: its }));
    }
  } else {
    const dkey = process.env.DART_API_KEY;
    if (!dkey || !corpCode) return { n: 0 };
    const bgn = kstDate(-3 * 365).replace(/-/g, '');
    for (let p = 1; p <= 4; p++) {
      const r = await fetchWithTimeout(`https://opendart.fss.or.kr/api/list.json?crtfc_key=${encodeURIComponent(dkey)}&corp_code=${corpCode}&bgn_de=${bgn}&page_no=${p}&page_count=100&sort=date&sort_mth=desc`, {}, 9000);
      const j = await r.json();
      if (j.status !== '000') break;
      items.push(...(j.list || []).filter((x) => x.stock_code).map(dartItem));
      if ((j.list || []).length < 100) break;
    }
  }
  const n = await archiveItems(items, { mode: 'ignore' });
  await setJSON(key, { at: Date.now(), n: items.length }).catch(() => {});
  return { n: items.length, saved: n };
}
