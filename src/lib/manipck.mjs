// 작전 레이더 — 체크리스트용 바깥 자료 + 장중 띄우기 알림 + 거래원 + 관심·매매 기록
//  · enrich(x): 최대주주 지분율·감사의견·자본잠식(DART) · 신용잔고율(한국투자증권) · 뉴스/종토방 글 수(네이버) ·
//               거래원 쏠림(mp/br 기록) · 업종 강세(mp/thm 기록) · 시장 20일 흐름 · 같은 세력 다른 종목 상태
//  · 실패한 자료는 err에 이유만 남기고 체크리스트에서 '자료 없음'으로 뺌 (지어내지 않음)
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout, BROWSER_UA, decodeText } from './util.mjs';
import { isTradingDay } from './schedule.mjs';

const DAY = 86400e3;
const kst = (ms = Date.now()) => { const d = new Date(ms + 9 * 3600e3); return { date: d.toISOString().slice(0, 10), m: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
const n0 = (s) => { const x = Number(String(s ?? '').replace(/[,%+\s]/g, '')); return String(s ?? '').trim() !== '' && s !== '-' && Number.isFinite(x) ? x : null; };
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const fmtW = (v) => (v == null ? '-' : Math.round(v).toLocaleString('ko-KR'));
const NH = { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/' };
async function html(url, ms = 9000) {
  const r = await fetchWithTimeout(url, { headers: NH }, ms);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ct = r.headers.get('content-type') || '';
  return decodeText(await r.arrayBuffer(), /utf-?8/i.test(ct) ? 'utf-8' : 'euc-kr');
}
const strip = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ───── DART: 최대주주 등 지분율 · 감사의견 · 자본잠식률 ─────
async function dartRaw(ep, params) {
  const key = process.env.DART_API_KEY;
  if (!key) throw new Error('DART 키 없음');
  const r = await fetchWithTimeout(`https://opendart.fss.or.kr/api/${ep}.json?crtfc_key=${encodeURIComponent(key)}&${new URLSearchParams(params)}`, {}, 8000);
  const j = await r.json();
  if (j.status === '013') return [];
  if (j.status !== '000') throw new Error(`DART ${j.status}`);
  return j.list || [];
}
async function corpOf(code) {
  const { getKrNames } = await import('./krnames.mjs');
  return (await getKrNames({ allowFetch: false })).find((x) => x.c === code)?.k || null;
}
const REPORTS = [['11014', '3분기'], ['11012', '반기'], ['11013', '1분기'], ['11011', '사업']];
async function dartFacts(code) {
  const corp = await corpOf(code);
  if (!corp) throw new Error('DART 고유번호 못 찾음');
  const y = Number(kst().date.slice(0, 4));
  const out = {};
  let errs = 0, oks = 0;
  const dart = (ep, p) => dartRaw(ep, p).then((r) => { oks++; return r; }).catch(() => { errs++; return []; });
  // 최근 보고서부터: 최대주주 현황
  outer: for (const yr of [y, y - 1]) for (const [rc, nm] of REPORTS) {
    const L = await dart('hyslrSttus', { corp_code: corp, bsns_year: String(yr), reprt_code: rc });
    const common = L.filter((r) => /보통/.test(r.stock_knd || ''));
    if (!common.length) continue;
    const tot = common.find((r) => /^계$|합계/.test(String(r.nm || '').trim()));
    const pct = tot ? n0(tot.trmend_posesn_stock_qota_rt) : common.reduce((a, r) => a + (n0(r.trmend_posesn_stock_qota_rt) || 0), 0);
    if (pct != null) { out.major = { pct: r1(pct), src: `${yr}년 ${nm}보고서`, top: common.find((r) => !/^계$/.test(r.nm))?.nm || null }; break outer; }
  }
  // 감사의견 (사업보고서)
  for (const yr of [y - 1, y - 2]) {
    const L = await dart('accnutAdtorNmNdAdtOpinion', { corp_code: corp, bsns_year: String(yr), reprt_code: '11011' });
    const row = L.find((r) => r.adt_opinion && r.adt_opinion !== '-');
    if (row) { out.audit = { op: String(row.adt_opinion).trim(), y: `${row.bsns_year || yr}년` }; break; }
  }
  // 자본잠식률 = (자본금 − 자본총계) ÷ 자본금
  for (const yr of [y, y - 1]) {
    let done = false;
    for (const [rc, nm] of REPORTS) {
      const L = await dart('fnlttSinglAcnt', { corp_code: corp, bsns_year: String(yr), reprt_code: rc });
      if (!L.length) continue;
      const pick = (names) => { for (const fs of ['CFS', 'OFS']) for (const n of names) { const r = L.find((x) => x.fs_div === fs && String(x.account_nm).replace(/\s/g, '') === n); if (r) return n0(r.thstrm_amount); } return null; };
      const eq = pick(['자본총계']), capital = pick(['자본금']);
      if (eq != null && capital) { out.cap = { imp: Math.max(0, Math.round(((capital - eq) / capital) * 100)), eq, capital, src: `${yr}년 ${nm}` }; done = true; break; }
    }
    if (done) break;
  }
  // v208 상장폐지·관리종목 요건용: 최근 사업보고서의 매출액·법인세비용차감전손익(3년)·자본총계(3년)
  for (const yr of [y - 1, y - 2]) {
    const L = await dart('fnlttSinglAcnt', { corp_code: corp, bsns_year: String(yr), reprt_code: '11011' });
    if (!L.length) continue;
    const row = (names) => { for (const fs of ['CFS', 'OFS']) for (const n of names) { const r = L.find((x) => x.fs_div === fs && String(x.account_nm).replace(/\s/g, '') === n); if (r) return r; } return null; };
    const three = (r) => (r ? [n0(r.thstrm_amount), n0(r.frmtrm_amount), n0(r.bfefrmtrm_amount)] : null);
    const rv = row(['매출액', '수익(매출액)', '영업수익']), pt = row(['법인세차감전순이익', '법인세차감전순손익', '법인세비용차감전순이익', '법인세비용차감전순손익', '법인세비용차감전계속사업이익', '법인세비용차감전계속영업이익']), eqr = row(['자본총계']);
    if (rv || pt || eqr) { out.fin = { y: yr, rev: rv ? n0(rv.thstrm_amount) : null, ptx: three(pt), eq: three(eqr) }; break; }
  }
  if (!Object.keys(out).length && errs && !oks) throw new Error('DART 응답 오류'); // 오류를 '자료 없음'으로 5일 저장하지 않게
  return out;
}

// ───── 한국투자증권: 신용잔고율 ─────
async function creditOf(code) {
  const { hasKis, kisGet } = await import('./kis.mjs');
  if (!hasKis()) throw new Error('한국투자증권 키 없음');
  const ymd = kst().date.replace(/-/g, '');
  const j = await kisGet('/uapi/domestic-stock/v1/quotations/daily-credit-balance', 'FHPST04760000', { FID_COND_MRKT_DIV_CODE: 'J', FID_COND_SCR_DIV_CODE: '20476', FID_INPUT_ISCD: code, FID_INPUT_DATE_1: ymd });
  const rows = j.output || j.output1 || [];
  const r = (Array.isArray(rows) ? rows : [rows]).find((x) => x && (x.whol_loan_rmnd_rate != null || x.whol_loan_rmnd_stcn != null));
  if (!r) throw new Error('신용잔고 응답 없음');
  const rate = n0(r.whol_loan_rmnd_rate);
  const d = String(r.deal_date || r.stlm_date || '');
  return { rate: rate == null ? null : r1(rate), qty: n0(r.whol_loan_rmnd_stcn), date: d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null };
}

// ───── 네이버: 뉴스 수 · 종토방 글 수 ─────
const dtRe = /(20\d{2})[.\-](\d{2})[.\-](\d{2})\.?\s+(\d{2}):(\d{2})/g;
const msOf = (m) => Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`);
async function buzzOf(code) {
  const now = Date.now(), out = {};
  // 뉴스: 최근 3페이지 기사 날짜 → 최근 3일 건수 vs 그 전 일평균
  try {
    const ts = [];
    // v255: 옛 finance.naver.com 뉴스 목록은 410(없어짐) → 모바일 증권 JSON (datetime 'YYYYMMDDHHmm')
    for (let p = 1; p <= 3; p++) {
      const r = await fetchWithTimeout(`https://m.stock.naver.com/api/news/stock/${code}?pageSize=20&page=${p}`, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json', Referer: 'https://m.stock.naver.com/' } }, 9000);
      if (!r.ok) throw new Error('뉴스 HTTP ' + r.status);
      const n0l = ts.length, txt = JSON.stringify(await r.json());
      for (const m of txt.matchAll(/"datetime":"(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/g)) ts.push(msOf(m));
      if (p === 1 && ts.length === n0l && txt.length > 50) throw new Error('뉴스 목록 형식을 읽지 못함');
      if (ts.length === n0l) break;
    }
    if (ts.length) {
      const n3 = ts.filter((t) => now - t <= 3 * DAY).length, old = ts.filter((t) => now - t > 3 * DAY);
      const span = old.length ? Math.max(1, (now - 3 * DAY - Math.min(...old)) / DAY) : null;
      out.news3 = n3; out.newsX = span && old.length >= 3 ? r1(n3 / 3 / (old.length / span)) : null;
    }
  } catch (e) { out.newsErr = e.message; }
  // 종토방: 최근 글 24시간 건수 (최대 5쪽=100개) + 하루 기록으로 평소 대비
  try {
    let n24 = 0, stop = false;
    for (let p = 1; p <= 5 && !stop; p++) {
      const h = await html(`https://finance.naver.com/item/board.naver?code=${code}&page=${p}`);
      const ts = [...h.matchAll(dtRe)].map(msOf);
      if (!ts.length) { if (p === 1) throw new Error('종토방 목록 형식을 읽지 못함'); break; } // 0건과 '못 읽음'을 구분
      for (const t of ts) { if (now - t <= DAY) n24++; else stop = true; }
    }
    out.boardN = n24;
    const hk = `mp/buzz/${code}`, hist = (await getJSON(hk)) || [];
    const today = kst().date, prev = hist.filter((h) => h.d !== today);
    if (prev.length >= 3) { const avg = prev.reduce((a, h) => a + h.n, 0) / prev.length; out.boardX = avg ? r1(n24 / avg) : null; }
    await setJSON(hk, [{ d: today, n: n24 }, ...prev].slice(0, 20)).catch(() => {});
  } catch (e) { out.boardErr = e.message; }
  return out;
}

// ───── 업종·테마 강세 (하루 한 번 전체 등락률 기록) ─────
async function nget(url) {
  const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' } }, 9000);
  if (!r.ok) throw new Error('네이버 HTTP ' + r.status);
  return r.json();
}
export async function themeWatch() {
  const z = kst();
  if (!isTradingDay('KR', z.date) || z.m < 15 * 60 + 40) return null;
  const hist = (await getJSON('mp/thm/hist')) || [];
  if (hist[0]?.d === z.date) return null;
  const grab = async (kind) => {
    const out = {};
    for (let p = 1; p <= 4; p++) {
      const j = await nget(`https://m.stock.naver.com/api/stocks/${kind}?page=${p}&pageSize=100`).catch(() => null);
      const g = j?.groups || [];
      for (const x of g) if (x.name) out[x.name] = n0(x.changeRate);
      if (g.length < 100) break;
    }
    return out;
  };
  const ind = await grab('industry'), th = await grab('theme');
  if (!Object.keys(ind).length && !Object.keys(th).length) return { err: '업종·테마 등락률을 못 받음' };
  await setJSON('mp/thm/hist', [{ d: z.date, ind, th }, ...hist.filter((h) => h.d !== z.date)].slice(0, 15));
  return { ind: Object.keys(ind).length, th: Object.keys(th).length };
}
const avg5 = (hist, kind, name) => { const v = hist.slice(0, 5).map((h) => h[kind]?.[name]).filter((x) => x != null); return v.length >= 3 ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
function themeOf(x, hist) {
  if (!hist.length) return null;
  const parts = [];
  let ok = false;
  const ind = x.ind ? String(x.ind).split(/[,·]/)[0].trim() : null;
  const indName = ind ? Object.keys(hist[0].ind || {}).find((n) => n === ind || n.includes(ind) || ind.includes(n)) : null;
  if (indName) { const a = avg5(hist, 'ind', indName); if (a != null) { parts.push(`업종 '${indName}' 최근 5일 평균 ${a > 0 ? '+' : ''}${a}%`); if (a >= 0.5) ok = true; } }
  // 사업목적 추가 공시 내용과 이름이 겹치는 테마
  const pur = (x.events || []).filter((e) => e.kind === 'purpose').map((e) => `${e.title} ${e.sum || ''}`).join(' ');
  if (pur) {
    const hits = Object.keys(hist[0].th || {}).filter((n) => n.replace(/\(.*\)/, '').split(/[/·,\s]/).some((w) => w.length >= 2 && pur.includes(w))).slice(0, 3);
    for (const n of hits) { const a = avg5(hist, 'th', n); if (a != null) { parts.push(`사업목적 관련 테마 '${n}' 5일 평균 ${a > 0 ? '+' : ''}${a}%`); if (a >= 1) ok = true; } }
  }
  if (!parts.length) return null;
  return { ok, t: parts.join(' · ') + (ok ? ' — 강세' : ' — 뚜렷한 강세 아님') };
}

// ───── 거래원(증권사 창구) — 장 마감 뒤 하루 한 번 매수·매도 상위 5곳 기록 ─────
const RETAIL = /키움|미래에셋|한국투자|삼성|NH투자|KB증권|신한|토스|카카오페이|대신|하나증권/;
export async function brokerOf(code) {
  const h = await html(`https://finance.naver.com/item/sise.naver?code=${code}`);
  const i = h.search(/거래원/);
  if (i < 0) throw new Error('거래원 표 없음');
  const seg = h.slice(i, i + 9000);
  const rows = (seg.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(strip));
  const sell = [], buy = [];
  for (const c of rows) {
    if (c.length < 4) continue;
    const [sn, sv, bn, bv] = c;
    if (sn && n0(sv) != null && !/외국계|합계/.test(sn)) sell.push({ nm: sn, v: n0(sv) });
    if (bn && n0(bv) != null && !/외국계|합계/.test(bn)) buy.push({ nm: bn, v: n0(bv) });
  }
  if (!buy.length) throw new Error('거래원 표를 읽지 못함');
  return { sell: sell.slice(0, 5), buy: buy.slice(0, 5) };
}
function brokerSum(hist) {
  const L = (hist || []).slice(0, 10);
  if (!L.length) return null;
  const m = {};
  for (const h of L) {
    for (const b of h.buy || []) { const o = (m[b.nm] ||= { nm: b.nm, days: 0, bv: 0, sv: 0 }); o.days++; o.bv += b.v; }
    for (const s of h.sell || []) { const o = (m[s.nm] ||= { nm: s.nm, days: 0, bv: 0, sv: 0 }); o.sv += s.v; }
  }
  const cand = Object.values(m).map((o) => ({ ...o, net: o.bv - o.sv, retail: RETAIL.test(o.nm) })).filter((o) => o.days >= Math.max(3, Math.ceil(L.length * 0.6)) && o.net > 0)
    .sort((a, b) => (a.retail - b.retail) || b.days - a.days || b.net - a.net);
  return { n: L.length, top: cand[0] || null, list: Object.values(m).sort((a, b) => b.days - a.days).slice(0, 6), last: L[0] };
}
/** 크론(3분마다): 장 마감 뒤(15:45~19:00) 관심 대상 종목의 거래원 기록 (한 번에 10종목) */
export async function brokerWatch() {
  const z = kst();
  if (!isTradingDay('KR', z.date) || z.m < 15 * 60 + 45 || z.m > 19 * 60) return null;
  const st = (await getJSON('mp/br/state')) || {};
  if (st.date !== z.date) { st.date = z.date; st.queue = await watchCodes(80); st.pos = 0; st.err = null; }
  if (st.pos >= (st.queue || []).length) return null;
  const part = st.queue.slice(st.pos, st.pos + 10);
  let ok = 0;
  for (const code of part) {
    try {
      const b = await brokerOf(code);
      const k = `mp/br/${code}`, hist = (await getJSON(k)) || [];
      await setJSON(k, [{ d: z.date, ...b }, ...hist.filter((h) => h.d !== z.date)].slice(0, 30));
      ok++;
    } catch (e) { st.err = `${code}: ${e.message}`.slice(0, 120); }
  }
  st.pos += part.length;
  await setJSON('mp/br/state', st);
  return { ok, pos: st.pos, n: st.queue.length };
}

/** 관심 대상: 매집·판 깔기·상승 가능성·손익비 상위 + 내 관심 목록 */
export async function watchCodes(max = 80) {
  const rank = (await getJSON('mp/rank')) || {};
  const wm = (await getJSON('mp/warn'))?.map || {};
  const my = ((await getJSON('mp/my'))?.items || []).filter((i) => !i.closed).map((i) => i.code);
  const rows = Object.entries(rank).filter(([c, r]) => !wm[c]?.halt && Date.now() - (r.up || 0) < 30 * DAY && (!r.ht && r.st !== '거래정지' && (['매집', '판 깔기'].includes(r.st) || r.d === 'up' || (r.rr?.v ?? 0) >= 2)))
    .sort((a, b) => (b[1].us || 0) - (a[1].us || 0)).map(([c]) => c);
  return [...new Set([...my, ...rows])].slice(0, max);
}

// ───── 종목 하나 바깥 자료 붙이기 ─────
export async function enrich(x, { fresh = false, ix = null, broker = false } = {}) {
  const code = x.code, now = Date.now();
  const ck = { at: now, err: {} };
  // DART (5일 보관)
  const dk = `mp/ckd/${code}`;
  let dd = fresh ? null : await getJSON(dk);
  if (!dd || now - (dd.at || 0) > 5 * DAY || !('fin' in dd)) { // fin: v208 추가 항목 (예전 저장분은 다시 받음)
    try { dd = { at: now, fin: null, ...(await dartFacts(code)) }; await setJSON(dk, dd).catch(() => {}); } catch (e) { ck.err.major = ck.err.fin = String(e.message).slice(0, 60); dd = dd || null; }
  }
  if (dd) { ck.major = dd.major || null; ck.audit = dd.audit || null; ck.cap = dd.cap || null; ck.fin = dd.fin || null; if (!dd.major) ck.err.major = ck.err.major || '최대주주 현황 없음'; }
  // 신용잔고 (하루 보관)
  const ckk = `mp/ckc/${code}`;
  let cr = fresh ? null : await getJSON(ckk);
  if (!cr || now - (cr.at || 0) > DAY) {
    try { cr = { at: now, ...(await creditOf(code)) }; await setJSON(ckk, cr).catch(() => {}); } catch (e) { ck.err.credit = String(e.message).slice(0, 60); }
  }
  if (cr) ck.credit = { rate: cr.rate ?? null, date: cr.date || null };
  // 뉴스·종토방 (6시간 보관)
  const bk = `mp/ckb/${code}`;
  let bz = fresh ? null : await getJSON(bk);
  if (!bz || now - (bz.at || 0) > 6 * 3600e3) {
    try { bz = { at: now, ...(await buzzOf(code)) }; await setJSON(bk, bz).catch(() => {}); } catch (e) { ck.err.buzz = String(e.message).slice(0, 60); }
  }
  if (bz && (bz.news3 != null || bz.boardN != null)) ck.buzz = bz;
  else if (bz) ck.err.buzz = [bz.newsErr, bz.boardErr].filter(Boolean).join(' / ').slice(0, 80) || '자료 없음';
  // 거래원 기록 요약 (검색 때 기록이 없으면 지금 한 번 받아 봄)
  let bh = (await getJSON(`mp/br/${code}`)) || [];
  if (!bh.length && (fresh || broker)) {
    try { const b = await brokerOf(code); bh = [{ d: kst().date, ...b }]; await setJSON(`mp/br/${code}`, bh); } catch (e) { ck.err.broker = String(e.message).slice(0, 60); }
  }
  ck.broker = brokerSum(bh);
  // 업종·테마
  const th = (await getJSON('mp/thm/hist')) || [];
  ck.theme = themeOf(x, th);
  // 시장 20일 흐름 (지수 일별 등락률 합)
  try {
    const ixd = ix || (await (await import('./manip.mjs')).indexDaily());
    const ds = Object.keys(ixd).sort().slice(-20);
    const key = x.mkt === 'P' ? 'P' : 'Q';
    const v = ds.map((d) => ixd[d]?.[key]).filter((y) => y != null);
    if (v.length >= 15) ck.mkt20 = r1((v.reduce((a, p) => a * (1 + p / 100), 1) - 1) * 100);
  } catch {}
  // 같은 세력 다른 종목 상태
  if ((x.links || []).length) {
    const rank = (await getJSON('mp/rank')) || {};
    ck.linkSt = x.links.flatMap((l) => l.others).slice(0, 8).map((o) => { const r = rank[o.c]; return { c: o.c, nm: o.nm || r?.n || null, st: r?.st || null, risk: !!r?.pn?.c || (r?.ds ?? 0) >= 6 }; });
  }
  x.ck = ck;
  return x;
}

// ───── 장중 띄우기 시작 알림 + 내 관심 종목 손절·목표 알림 (매분, 09:01~15:30) ─────
export async function intradayWatch(now = Date.now()) {
  const z = kst(now);
  if (!isTradingDay('KR', z.date) || z.m < 9 * 60 + 1 || z.m > 15 * 60 + 30) return null;
  const sk = `mp/live/${z.date}`;
  const st = (await getJSON(sk)) || { fired: {}, n: 0 };
  if (now - (st.at || 0) < 55e3) return null;
  st.at = now;
  const codes = (st.codes && now - (st.codesAt || 0) < 30 * 60e3) ? st.codes : await watchCodes(90);
  if (!st.codes || now - (st.codesAt || 0) >= 30 * 60e3) { st.codes = codes; st.codesAt = now; }
  if (!codes.length) { await setJSON(sk, st); return null; }
  const rank = (await getJSON('mp/rank')) || {};
  const my = ((await getJSON('mp/my'))?.items || []).filter((i) => !i.closed);
  const frac = Math.min(1, Math.max(0.05, (z.m - 9 * 60) / 390));
  const lines = [];
  for (let i = 0; i < codes.length; i += 45) {
    let j;
    try { const r = await fetchWithTimeout(`https://polling.finance.naver.com/api/realtime/domestic/stock/${codes.slice(i, i + 45).join(',')}`, { headers: { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' } }, 7000); j = await r.json(); } catch (e) { st.err = String(e.message).slice(0, 80); continue; }
    for (const q of j.datas || []) {
      const code = q.itemCode, r = rank[code] || {};
      const price = n0(q.closePriceRaw ?? q.closePrice), vol = n0(q.accumulatedTradingVolumeRaw ?? q.accumulatedTradingVolume);
      let pct = n0(q.fluctuationsRatio); if (pct != null && ['4', '5'].includes(String(q.compareToPreviousPrice?.code))) pct = -Math.abs(pct);
      const nm = q.stockName || r.n || code;
      // 띄우기 시작: 매집·판 깔기 단계에서 +4%↑ + 거래량이 이미 하루 평균의 1.5배(시간 비례 최소 기준)
      if (r.av && vol && price && pct != null && pct >= 4 && ['매집', '판 깔기'].includes(r.st) && !st.fired['s' + code]) {
        const need = r.av * Math.max(1.5, 4 * frac);
        if (vol >= need) { st.fired['s' + code] = now; lines.push(`🚀 ${nm} 띄우기 시작 의심 — ${r.st} 단계에서 +${pct}% · 거래량 ${fmtW(vol)}주(20일 평균의 ${r1(vol / r.av)}배) · ${String(z.m / 60 | 0).padStart(2, '0')}:${String(z.m % 60).padStart(2, '0')}`); }
      }
      for (const it of my.filter((m) => m.code === code)) {
        if (it.stop && price && price <= it.stop && !st.fired['ls' + it.id]) { st.fired['ls' + it.id] = now; lines.push(`⭐ ${nm} 손절 기준 ${fmtW(it.stop)}원 도달 (현재 ${fmtW(price)}원)`); }
        if (it.target && price && price >= it.target && !st.fired['lt' + it.id]) { st.fired['lt' + it.id] = now; lines.push(`⭐ ${nm} 목표 ${fmtW(it.target)}원 도달 (현재 ${fmtW(price)}원)`); }
      }
    }
  }
  if (lines.length) {
    const { radarAlert } = await import('./manipx.mjs');
    await radarAlert(lines).catch(() => {});
    st.n += lines.length; st.last = lines.slice(-5);
  }
  await setJSON(sk, st);
  return lines.length ? { n: lines.length } : null;
}

// ───── 내 관심 종목 · 매매 기록 (관리자) ─────
export async function myList() {
  const d = (await getJSON('mp/my')) || { items: [] };
  const rank = (await getJSON('mp/rank')) || {};
  const open = d.items.filter((i) => !i.closed).map((i) => i.code);
  let q = {};
  if (open.length) {
    try {
      const r = await fetchWithTimeout(`https://polling.finance.naver.com/api/realtime/domestic/stock/${[...new Set(open)].slice(0, 45).join(',')}`, { headers: { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' } }, 7000);
      for (const x of (await r.json()).datas || []) q[x.itemCode] = n0(x.closePriceRaw ?? x.closePrice);
    } catch {}
  }
  const items = d.items.map((i) => {
    const r = rank[i.code] || {};
    const cur = i.closed ? i.exit : q[i.code] ?? r.c ?? null;
    return { ...i, cur, live: !i.closed && q[i.code] != null, pl: cur && i.entry ? r1((cur / i.entry - 1) * 100) : null, st: r.st || null, d: r.d || null, us: r.us ?? null, ds: r.ds ?? null, rr: r.rr || null, ckg: r.ckg || null };
  });
  const closed = items.filter((i) => i.closed && i.pl != null);
  const pf = await myPortfolio(items).catch(() => null);
  return { items, pf, stats: closed.length ? { n: closed.length, win: Math.round((closed.filter((i) => i.pl > 0).length / closed.length) * 100), avg: r1(closed.reduce((a, i) => a + i.pl, 0) / closed.length) } : null };
}
export async function myEdit(op, p) {
  const d = (await getJSON('mp/my')) || { items: [] };
  const num = (v) => { const x = n0(v); return x && x > 0 ? x : null; };
  if (op === 'cfg') {
    d.cfg = { acct: num(p.acct), riskPct: Math.min(10, Math.max(0.2, Number(p.riskPct) || 1.5)) };
  } else if (op === 'add') {
    const code = String(p.code || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code)) throw new Error('종목코드가 필요해요');
    d.items.unshift({ id: Date.now().toString(36), code, name: String(p.name || code).slice(0, 30), entry: num(p.entry), stop: num(p.stop), target: num(p.target), qty: num(p.qty), memo: String(p.memo || '').slice(0, 200), at: Date.now() });
    d.items = d.items.slice(0, 200);
  } else {
    const it = d.items.find((i) => i.id === p.id);
    if (!it) throw new Error('기록을 찾지 못했어요');
    if (op === 'del') d.items = d.items.filter((i) => i !== it);
    else if (op === 'close') { it.closed = true; it.exit = num(p.exit); it.exitAt = Date.now(); }
    else if (op === 'set') { for (const k of ['entry', 'stop', 'target', 'qty']) if (p[k] != null && p[k] !== '') it[k] = num(p[k]); if (p.memo != null) it.memo = String(p.memo).slice(0, 200); }
  }
  await setJSON('mp/my', d);
  return myList();
}

// ───── 💼 포트폴리오 도우미 (관리자 · 내 세력주) ─────
//  · 버팀 손절선: 보이는 지지선이 아니라 '세력이 밀 수 있는 바닥'(CB 리픽싱 하한·3자배정 발행가 등) 아래 3%
//  · 나눠 사기: 1/3 지금 · 1/3 중간 · 1/3 바닥 근처 → 흔들기가 오면 손절이 아니라 평단을 낮추는 기회
//  · 살 금액: 계좌 × 한 종목 최대 손실% ÷ (평균 매수가 − 버팀 손절선)
export function holdPlan(p, cfg = {}) {
  const close = p?.close, lv = p?.dir?.levels || [], f = p?.f || {};
  if (!close) return null;
  // 현재가 −35%~−3% 안의 세력 원가만 바닥 후보 (그보다 깊으면 '버티기'로는 감당 못 할 폭이라 따로 경고)
  const below = lv.filter((l) => l.p < close * 0.97 && l.p >= close * 0.65);
  const pick = (re) => below.filter((l) => re.test(l.s)).sort((a, b) => a.p - b.p)[0];
  const floor = pick(/리픽싱 하한/) || pick(/3자배정 발행가|발행가|인수 단가/) || pick(/전환가/) || pick(/매집 구간 최저가|5% 신고자/) || null;
  const deep = lv.filter((l) => /리픽싱 하한/.test(l.s) && l.p < close * 0.65).sort((a, b) => a.p - b.p)[0];
  const base = floor ? floor.p : Math.round(close * 0.85);
  const stop = Math.round(base * 0.97);
  const b1 = close, b3 = Math.round(base * 1.02), b2 = Math.round((b1 + b3) / 2);
  const avg = (b1 + b2 + b3) / 3;
  const out = { floor: base, floorS: floor ? floor.s : '현재가 −15% (근거 가격 없음)', stop, stopPct: Math.round((stop / close - 1) * 1000) / 10, buys: [b1, b2, b3], avg: Math.round(avg) };
  if (deep) out.deep = `CB 리픽싱 하한 ${fmtW(deep.p)}원(현재가 ${Math.round((deep.p / close - 1) * 100)}%)까지 밀릴 수 있는 구조 — 비중을 더 작게`;
  if (p?.dir?.gap != null && p.dir.gap > 30) out.far = `현재가가 세력 평단보다 +${p.dir.gap}% 위 — 이미 오른 자리라 버티기 계획이 잘 안 맞음`;
  const acct = Number(cfg.acct) || 0, rp = Number(cfg.riskPct) || 0;
  if (acct > 0 && rp > 0 && avg > stop) {
    const maxLoss = acct * rp / 100, sh = Math.floor(maxLoss / (avg - stop));
    out.maxLoss = Math.round(maxLoss); out.shares = sh; out.amount = Math.round(sh * avg); out.each = Math.floor(sh / 3);
    out.acctPct = Math.round((out.amount / acct) * 1000) / 10;
    const tv = (f.avgV20 || 0) * close; // 하루 평균 거래대금
    if (tv) out.liq = Math.round((out.amount / tv) * 1000) / 10; // 하루 거래대금 대비 %
  }
  return out;
}
async function myCfg() { return ((await getJSON('mp/my'))?.cfg) || { acct: null, riskPct: 1.5 }; }
export async function myPlanOf(p) { try { return holdPlan(p, await myCfg()); } catch { return null; } }
// 보유 종목끼리 겹침(같은 세력·같은 업종·같은 물량 해제 달) 경고
function overlaps(rows) {
  const W = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (!a.p || !b.p || a.code === b.code) continue;
    const wa = new Set((a.p.links || []).map((l) => l.who)), sameP = (b.p.links || []).find((l) => wa.has(l.who)) || (a.p.links || []).flatMap((l) => l.others || []).find((o) => o.c === b.code);
    if (sameP) W.push(`🕸 ${a.name} · ${b.name} — 같은 세력 이름이 함께 나옴 (함께 무너질 수 있음)`);
    const ia = String(a.p.ind || '').split('|')[0], ib = String(b.p.ind || '').split('|')[0];
    if (ia && ia === ib) W.push(`🏭 ${a.name} · ${b.name} — 같은 업종(${ia})`);
    const na = (a.p.dir?.dates || []).find((z) => !z.past)?.d?.slice(0, 7), nb = (b.p.dir?.dates || []).find((z) => !z.past)?.d?.slice(0, 7);
    if (na && na === nb) W.push(`🗓 ${a.name} · ${b.name} — 물량 해제가 같은 달(${na})`);
  }
  return [...new Set(W)];
}
export async function myPortfolio(items) {
  const cfg = await myCfg();
  const open = items.filter((i) => !i.closed);
  const rows = [];
  for (const i of open.slice(0, 20)) { const p = await getJSON(`mp/prof/${i.code}`).catch(() => null); rows.push({ code: i.code, name: i.name, p, i }); }
  const now = Date.now();
  const plans = {}, notes = {};
  for (const r of rows) {
    if (!r.p) continue;
    plans[r.i.id] = holdPlan({ ...r.p, close: r.i.cur || r.p.close }, cfg);
    const n = [];
    const days = Math.round((now - (r.i.at || now)) / DAY);
    const nd = (r.p.dir?.dates || []).find((z) => !z.past), past = (r.p.dir?.dates || []).filter((z) => z.past).pop();
    if (days >= 84 && (r.i.pl ?? 0) < 10) n.push(`⏳ 보유 ${days}일째 +10% 미만 — 시간 손절(비중 줄이기) 검토`);
    if (past && r.i.at && Date.parse(past.d) > r.i.at) n.push(`🗓 기다리던 물량 해제일(${past.d})이 지남 — 재료가 끝났는지 확인`);
    if (nd) { const dd = Math.round((Date.parse(nd.d) - now) / DAY); if (dd <= 30) n.push(`🗓 물량 해제 ${dd}일 앞(${nd.d}) — 털기 주의`); }
    const bad = (r.p.cl?.red || []).filter((x) => x.ok === true && x.bomb).map((x) => x.t.slice(0, 50));
    if (bad.length) n.push(`💣 폭탄 신호: ${bad.join(' / ')} — 산 이유가 깨졌는지 확인`);
    notes[r.i.id] = n;
  }
  return { cfg, plans, notes, warn: overlaps(rows), total: rows.reduce((a, r) => a + (r.i.qty && r.i.cur ? r.i.qty * r.i.cur : 0), 0) };
}

// 📌 내 보유·관심 종목 새 공시 → 바로 텔레그램 (매분, 공시가 나오는 시간 아무 때나)
const BADK = ['conv', 'majsell', 'fail', 'risk', 'pledge'];
export async function myDiscWatch(now = Date.now()) {
  const d = (await getJSON('mp/my')) || { items: [] };
  const open = [...new Set(d.items.filter((i) => !i.closed).map((i) => i.code))];
  if (!open.length) return null;
  const st = (await getJSON('mp/mydisc')) || {};
  if (now - (st.at || 0) < 55e3) return null;
  const since = st.last || now - 30 * 60e3;
  const { sqlDB } = await import('./store.mjs');
  const db = await sqlDB().catch(() => null);
  if (!db) return null;
  const rows = [];
  for (const code of open.slice(0, 20)) {
    try {
      const r = await db.prepare("SELECT id, ms, name, title AS t, json_extract(data,'$.formKo') AS f, json_extract(data,'$.party') AS p, json_extract(data,'$.summary.title') AS st, json_extract(data,'$.summary.sub') AS ss FROM items WHERE market = 'KR' AND ticker = ? AND ms > ? ORDER BY ms DESC LIMIT 10").bind(code, since).all();
      for (const x of r.results || []) rows.push({ ...x, code });
    } catch {}
  }
  const seen = new Set(st.seen || []);
  const fresh = rows.filter((x) => !seen.has(x.id)).sort((a, b) => a.ms - b.ms);
  st.at = now; st.last = Math.max(since, ...rows.map((x) => x.ms), now - 5 * 60e3);
  if (!fresh.length) { await setJSON('mp/mydisc', st); return null; }
  const { evKind, EV } = await import('./manip.mjs');
  const nameOf = Object.fromEntries(d.items.map((i) => [i.code, i.name]));
  const lines = [], codes = [];
  for (const x of fresh.slice(0, 10)) {
    const k = evKind(`${x.f || ''} ${x.t || ''}`, x.p);
    const bad = BADK.includes(k) || /매도|처분|철회|해제|연기|정지|의견거절|부적정|자본잠식|횡령|배임/.test(`${x.f || ''} ${x.t || ''}`);
    const good = ['paid', 'cbbuy', 'rights3', 'fund5', 'purpose', 'contract'].includes(k);
    const exitK = ['conv', 'majsell', 'tsell'].includes(k) || (k === 'insider' && /매도|처분/.test(`${x.f || ''} ${x.t || ''} ${x.st || ''} ${x.ss || ''}`));
    const XL = exitK ? (st._xl ??= await getJSON('mp/exitlearn').catch(() => null)) : null; // v251 🏁 엑시트 해부 결과 (4년치 과거 재현 뒤 채워짐)
    const xm = XL ? (k === 'conv' ? XL.conv : XL.sell) : null;
    const tag = exitK ? `🏁 엑시트 신호 — 세력이 물량을 내놓기 시작했을 수 있음${xm?.med != null ? ` (과거 대세상승에서 이 공시는 보통 고점 ${xm.med > 0 ? xm.med + '일 뒤' : xm.med < 0 ? -xm.med + '일 전' : '그날'} · 고점 ±10일 안 ${xm.near}%)` : ''} → 목표가 근처면 나눠 팔기 검토` : bad ? '⚠ 털기·위험 신호일 수 있음' : good ? '✅ 판 깔기·자금 투입 쪽 신호' : 'ℹ️ 확인 필요';
    const sum = [x.st, x.ss].filter(Boolean).join(' · ').slice(0, 120);
    lines.push(`📌 ${nameOf[x.code] || x.name || x.code} 새 공시 — ${String(x.f || x.t || '').slice(0, 60)}${sum ? `\n   ${sum}` : ''}\n   ${tag}${k && EV?.[k] ? ` (${EV[k].ko})` : ''} · gk-stock.com/p/${x.id}`);
    codes.push(x.code);
  }
  st.seen = [...fresh.map((x) => x.id), ...(st.seen || [])].slice(0, 300); delete st._xl;
  await setJSON('mp/mydisc', st);
  const { radarAlert } = await import('./manipx.mjs');
  await radarAlert(lines, codes, { force: true, title: '💼 내 포트폴리오 알림' }).catch(() => {});
  return { n: lines.length };
}

// 💼 장 마감 뒤(15:45~) 하루 한 번: 보유 종목 하락이 '흔들기'인지 '털기'인지, 시간 손절·물량 해제·폭탄 신호
export async function myDailyCheck(now = Date.now()) {
  const z = kst(now);
  if (!isTradingDay('KR', z.date) || z.m < 15 * 60 + 45) return null;
  const d = (await getJSON('mp/my')) || { items: [] };
  const open = d.items.filter((i) => !i.closed);
  if (!open.length) return null;
  const st = (await getJSON('mp/mydaily')) || {};
  if (st.date === z.date) return null;
  st.date = z.date;
  await setJSON('mp/mydaily', st);
  const codes = [...new Set(open.map((i) => i.code))].slice(0, 45);
  const q = {};
  try {
    const r = await fetchWithTimeout(`https://polling.finance.naver.com/api/realtime/domestic/stock/${codes.join(',')}`, { headers: { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' } }, 8000);
    for (const x of (await r.json()).datas || []) { let pct = n0(x.fluctuationsRatio); if (pct != null && ['4', '5'].includes(String(x.compareToPreviousPrice?.code))) pct = -Math.abs(pct); q[x.itemCode] = { price: n0(x.closePriceRaw ?? x.closePrice), pct, vol: n0(x.accumulatedTradingVolumeRaw ?? x.accumulatedTradingVolume) }; }
  } catch (e) { st.err = String(e.message).slice(0, 80); }
  const cfg = await myCfg();
  const lines = [], cs = [];
  const sent = st.sent || {};
  for (const it of open) {
    const p = await getJSON(`mp/prof/${it.code}`).catch(() => null), x = q[it.code];
    if (!p || !x?.price) continue;
    const plan = holdPlan({ ...p, close: x.price }, cfg);
    const av = p.f?.avgV20 || 0, vx = av && x.vol ? r1(x.vol / av) : null;
    const recent = (p.events || []).filter((e) => now - e.ms < 5 * DAY && ['conv', 'majsell', 'fail', 'risk', 'pledge'].includes(e.kind));
    const ins = (p.px || []).some((y) => y.kind === 'insider' && y.ins && (y.ins.sq || 0) > (y.ins.bq || 0) && now - Date.parse(y.date) < 10 * DAY);
    const stageBad = ['털기', '엑시트 후', '거래정지'].includes(p.stage);
    const drop = (x.pct ?? 0) <= -4 || (it.stop && x.price <= it.stop * 1.05) || (plan && x.price <= plan.buys[1]);
    if (drop) {
      const dump = (vx != null && vx >= 2) || recent.length || ins || stageBad;
      const why = [vx != null ? `거래량 평소의 ${vx}배` : null, recent.length ? `최근 '${recent[0].title.slice(0, 30)}'` : null, ins ? '내부자 매도 우위' : null, stageBad ? `단계 '${p.stage}'` : null].filter(Boolean).join(' · ');
      lines.push(dump
        ? `🔻 ${it.name} ${x.pct}% (${fmtW(x.price)}원) — 털기 신호 가능: ${why}. 산 이유가 깨졌는지 확인하고 버팀 손절선 ${plan ? fmtW(plan.stop) + '원' : '-'} 아래 종가 2일이면 정리 검토`
        : `🌀 ${it.name} ${x.pct}% (${fmtW(x.price)}원) — 흔들기 가능성: 거래량 적음${vx != null ? `(평소의 ${vx}배)` : ''} · 나쁜 공시 없음 · 단계 '${p.stage}' 유지. 버팀 손절선 ${plan ? fmtW(plan.stop) + '원' : '-'} 위면 버티기, 나눠 사기 ${plan ? fmtW(plan.buys[1]) + '·' + fmtW(plan.buys[2]) + '원' : ''} 참고`);
      cs.push(it.code);
    }
    // 시간 손절·물량 해제·폭탄 신호 (같은 내용은 7일에 한 번)
    const days = Math.round((now - (it.at || now)) / DAY), pl = it.entry ? (x.price / it.entry - 1) * 100 : null;
    const once = (key, t) => { if (now - (sent[key] || 0) > 7 * DAY) { sent[key] = now; lines.push(t); cs.push(it.code); } };
    if (days >= 84 && (pl ?? 0) < 10) once(`t${it.id}`, `⏳ ${it.name} 보유 ${days}일째 ${pl != null ? (pl >= 0 ? '+' : '') + r1(pl) + '%' : ''} — 시간 손절(비중 줄이기) 검토`);
    const past = (p.dir?.dates || []).filter((z2) => z2.past).pop();
    if (past && it.at && Date.parse(past.d) > it.at) once(`u${it.id}${past.d}`, `🗓 ${it.name} 기다리던 물량 해제일(${past.d}) 지남 — 재료 소멸·털기 여부 확인`);
    const bomb = (p.cl?.red || []).filter((y) => y.ok === true && y.bomb);
    if (bomb.length) once(`b${it.id}${bomb.map((y) => y.k).join()}`, `💣 ${it.name} 폭탄 신호: ${bomb.map((y) => y.t.slice(0, 40)).join(' / ')}`);
  }
  st.sent = Object.fromEntries(Object.entries(sent).filter(([, t]) => now - t < 30 * DAY));
  st.n = lines.length;
  await setJSON('mp/mydaily', st);
  if (lines.length) { const { radarAlert } = await import('./manipx.mjs'); await radarAlert(lines, cs, { force: true, title: '💼 내 포트폴리오 장 마감 점검' }).catch(() => {}); }
  return { n: lines.length };
}
