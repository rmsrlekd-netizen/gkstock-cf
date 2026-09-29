// VI·서킷 — 국장 변동성완화장치(VI) 발동·해제 / 미장 거래정지(서킷브레이커·LULD) 발동·재개 내역
//  국장: 한국투자증권 Open API "변동성완화장치(VI) 현황" (장중 1분마다)
//  미장: 나스닥 공식 거래정지 목록(Nasdaq Trader Trade Halts, 나스닥·뉴욕·아멕스 전체) (뉴욕 4:00~20:00 1분마다)
import { fetchWithTimeout } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';
import { hasKis, kisGet } from './kis.mjs';

const clean = (s) => String(s ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const n0 = (s) => { const x = Number(String(s ?? '').replace(/[,%+\s]/g, '')); return Number.isFinite(x) ? x : null; };
function zoned(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, m: Number(p.hour) * 60 + Number(p.minute), hms: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}` };
}
const hms = (s) => { const d = String(s || '').replace(/\D/g, ''); if (!/^\d{6}$/.test(d) || d === '000000') return null; return `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4, 6)}`; };

// ───────── 국장 VI ─────────
const VI_KIND = { 1: '정적', 2: '동적', 3: '정적·동적' };
async function kisVi(date) {
  const ymd = date.replace(/-/g, '');
  const j = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-vi-status', 'FHPST01390000', {
    FID_DIV_CLS_CODE: '0', FID_COND_SCR_DIV_CODE: '20139', FID_MRKT_CLS_CODE: '0', FID_INPUT_ISCD: '', FID_RANK_SORT_CLS_CODE: '0',
    FID_INPUT_DATE_1: ymd, FID_TRGT_CLS_CODE: '', FID_TRGT_EXLS_CLS_CODE: '',
  });
  const rows = Array.isArray(j.output) ? j.output : Array.isArray(j.output1) ? j.output1 : [];
  return { rows, keys: rows[0] ? Object.keys(rows[0]) : [] };
}
function viRow(x) {
  const code = String(x.mksc_shrn_iscd || x.stck_shrn_iscd || '').trim();
  const on = hms(x.cntg_vi_hour || x.vi_hour || x.stnd_hour);
  if (!/^[0-9A-Z]{6}$/.test(code) || !on) return null;
  const price = n0(x.vi_prc);
  const base = n0(x.vi_dmc_stnd_prc) || n0(x.vi_stnd_prc) || null;
  let gap = n0(x.vi_dmc_dprt) ?? n0(x.vi_dprt);
  if (gap == null && price && base) gap = Math.round(((price - base) / base) * 10000) / 100;
  return {
    id: `${code}|${on}`, code, name: clean(x.hts_kor_isnm) || code, kind: VI_KIND[String(x.vi_kind_code)] || null,
    on, off: hms(x.vi_cncl_hour), price, base, gap, dir: gap == null ? null : gap >= 0 ? 'up' : 'down', count: n0(x.vi_count),
  };
}
export async function krViWatch(now = new Date()) {
  const z = zoned(now, 'Asia/Seoul');
  if (['Sat', 'Sun'].includes(z.wd) || z.m < 8 * 60 + 58 || z.m > 15 * 60 + 35 || !hasKis()) return null;
  const key = `halts/kr/${z.date}`;
  const doc = (await getJSON(key)) || { date: z.date, items: [] };
  let got;
  try { got = await kisVi(z.date); } catch (e) { doc.err = String(e.message || e).slice(0, 200); doc.errAt = Date.now(); await setJSON(key, doc); return { err: doc.err }; }
  const rows = got.rows.map(viRow).filter(Boolean);
  const byId = new Map(doc.items.map((x) => [x.id, x]));
  const seenNow = new Set();
  for (const r of rows) { seenNow.add(r.id); const old = byId.get(r.id); byId.set(r.id, old ? { ...old, ...r, off: r.off || old.off, est: r.off ? false : old.est } : r); }
  // 목록에서 사라졌는데 해제 시각이 없던 건 '확인된 시각'으로 해제 처리 (대략)
  for (const x of byId.values()) if (!x.off && !seenNow.has(x.id) && rows.length) { x.off = z.hms; x.est = true; }
  doc.items = [...byId.values()].sort((a, b) => (b.on < a.on ? -1 : 1));
  doc.at = Date.now(); doc.keys = got.keys.slice(0, 40); delete doc.err;
  await setJSON(key, doc);
  await setJSON('halts/kr/last', { date: z.date, at: doc.at }).catch(() => {});
  return { n: doc.items.length, active: doc.items.filter((x) => !x.off).length };
}

// ───────── 미장 거래정지 ─────────
export const HALT_REASON = {
  LUDP: '급등락 일시정지 (LULD 5분)', LUDS: '급등락 일시정지 (LULD)', M: '급등락 일시정지', T1: '중요 뉴스 대기', T2: '뉴스 발표', T3: '뉴스·재개 시각 발표', T5: '단일 종목 거래정지', T6: '이상 거래 활동', T7: '호가만 제출 가능', T8: 'ETF 관련 정지', T12: '추가 정보 요청',
  H4: '상장 요건 미충족', H9: '공시 미제출', H10: 'SEC 거래정지', H11: '규제 관련 정지', O1: '운영상 정지', IPO1: '신규 상장 대기', IPOQ: '신규 상장 호가', IPOE: '신규 상장 거래', M1: '기업 이벤트', M2: '호가 없음', D: '상장 폐지',
  MWC0: '시장 전체 서킷브레이커', MWC1: '시장 서킷브레이커 1단계 (S&P500 −7%)', MWC2: '시장 서킷브레이커 2단계 (−13%)', MWC3: '시장 서킷브레이커 3단계 (−20%)', MWCQ: '시장 서킷브레이커 재개 호가',
};
const tag = (s, t) => clean((s.match(new RegExp(`<(?:ndaq:)?${t}>([\\s\\S]*?)</(?:ndaq:)?${t}>`, 'i')) || [])[1]);
const mdy = (s) => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
const tm = (s) => { const m = String(s || '').match(/(\d{1,2}):(\d{2}):(\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}` : null; };
async function nasdaqHalts() {
  const url = 'https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts';
  let r = await fetchWithTimeout(url, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } }, 8000).catch(() => null);
  if (!r?.ok && globalThis.process?.env?.KR_RELAY_URL) r = await fetchWithTimeout(url, { relay: true, headers: { Accept: 'application/rss+xml, application/xml, text/xml' } }, 9000);
  if (!r?.ok) throw new Error('나스닥 거래정지 목록 HTTP ' + (r?.status || '오류'));
  const xml = await r.text();
  return (xml.match(/<item>[\s\S]*?<\/item>/gi) || []).map((s) => {
    const sym = tag(s, 'IssueSymbol').toUpperCase(), date = mdy(tag(s, 'HaltDate')), on = tm(tag(s, 'HaltTime'));
    if (!sym || !date || !on) return null;
    const code = tag(s, 'ReasonCode').toUpperCase();
    const rdate = mdy(tag(s, 'ResumptionDate'));
    return {
      id: `${sym}|${date}|${on}`, sym, name: tag(s, 'IssueName'), market: tag(s, 'Market'), date, on, code, reason: HALT_REASON[code] || code || '기타',
      price: n0(tag(s, 'PauseThresholdPrice')), rdate, rquote: tm(tag(s, 'ResumptionQuoteTime')), off: tm(tag(s, 'ResumptionTradeTime')),
      mwc: /^MWC/.test(code), luld: /^LUD|^M$/.test(code),
    };
  }).filter(Boolean);
}
export async function usHaltWatch(now = new Date()) {
  const z = zoned(now, 'America/New_York');
  if (['Sat', 'Sun'].includes(z.wd) || z.m < 3 * 60 + 55 || z.m > 20 * 60 + 10) return null;
  const key = `halts/us/${z.date}`;
  const doc = (await getJSON(key)) || { date: z.date, items: [] };
  let rows;
  try { rows = await nasdaqHalts(); } catch (e) { doc.err = String(e.message || e).slice(0, 200); doc.errAt = Date.now(); await setJSON(key, doc); return { err: doc.err }; }
  const byId = new Map(doc.items.map((x) => [x.id, x]));
  // 오늘 정지된 것 + 전날 정지됐다가 오늘 재개된 것
  for (const r of rows) if (r.date === z.date || r.rdate === z.date || (!r.off && r.date >= z.date.slice(0, 8) + '01')) { const old = byId.get(r.id); byId.set(r.id, old ? { ...old, ...r, off: r.off || old.off } : r); }
  doc.items = [...byId.values()].sort((a, b) => (b.date + b.on < a.date + a.on ? -1 : 1)).slice(0, 400);
  doc.at = Date.now(); delete doc.err;
  await setJSON(key, doc);
  await setJSON('halts/us/last', { date: z.date, at: doc.at }).catch(() => {});
  return { n: doc.items.length, active: doc.items.filter((x) => !x.off).length };
}

/** 크론(매분) */
export async function haltsWatch(now = new Date()) {
  const [kr, us] = await Promise.all([krViWatch(now).catch((e) => ({ err: e.message })), usHaltWatch(now).catch((e) => ({ err: e.message }))]);
  return { kr, us };
}
