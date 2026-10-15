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
async function dart(ep, params) {
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
  // 최근 보고서부터: 최대주주 현황
  outer: for (const yr of [y, y - 1]) for (const [rc, nm] of REPORTS) {
    const L = await dart('hyslrSttus', { corp_code: corp, bsns_year: String(yr), reprt_code: rc }).catch(() => []);
    const common = L.filter((r) => /보통/.test(r.stock_knd || ''));
    if (!common.length) continue;
    const tot = common.find((r) => /^계$|합계/.test(String(r.nm || '').trim()));
    const pct = tot ? n0(tot.trmend_posesn_stock_qota_rt) : common.reduce((a, r) => a + (n0(r.trmend_posesn_stock_qota_rt) || 0), 0);
    if (pct != null) { out.major = { pct: r1(pct), src: `${yr}년 ${nm}보고서`, top: common.find((r) => !/^계$/.test(r.nm))?.nm || null }; break outer; }
  }
  // 감사의견 (사업보고서)
  for (const yr of [y - 1, y - 2]) {
    const L = await dart('accnutAdtorNmNdAdtOpinion', { corp_code: corp, bsns_year: String(yr), reprt_code: '11011' }).catch(() => []);
    const row = L.find((r) => r.adt_opinion && r.adt_opinion !== '-');
    if (row) { out.audit = { op: String(row.adt_opinion).trim(), y: `${row.bsns_year || yr}년` }; break; }
  }
  // 자본잠식률 = (자본금 − 자본총계) ÷ 자본금
  for (const yr of [y, y - 1]) {
    let done = false;
    for (const [rc, nm] of REPORTS) {
      const L = await dart('fnlttSinglAcnt', { corp_code: corp, bsns_year: String(yr), reprt_code: rc }).catch(() => []);
      if (!L.length) continue;
      const pick = (names) => { for (const fs of ['CFS', 'OFS']) for (const n of names) { const r = L.find((x) => x.fs_div === fs && String(x.account_nm).replace(/\s/g, '') === n); if (r) return n0(r.thstrm_amount); } return null; };
      const eq = pick(['자본총계']), capital = pick(['자본금']);
      if (eq != null && capital) { out.cap = { imp: Math.max(0, Math.round(((capital - eq) / capital) * 100)), eq, capital, src: `${yr}년 ${nm}` }; done = true; break; }
    }
    if (done) break;
  }
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
    for (let p = 1; p <= 3; p++) { const h = await html(`https://finance.naver.com/item/news_news.naver?code=${code}&page=${p}&clusterId=`); for (const m of h.matchAll(dtRe)) ts.push(msOf(m)); }
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
      if (!ts.length) break;
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
  const my = ((await getJSON('mp/my'))?.items || []).filter((i) => !i.closed).map((i) => i.code);
  const rows = Object.entries(rank).filter(([, r]) => Date.now() - (r.up || 0) < 30 * DAY && (['매집', '판 깔기'].includes(r.st) || r.d === 'up' || (r.rr?.v ?? 0) >= 2))
    .sort((a, b) => (b[1].us || 0) - (a[1].us || 0)).map(([c]) => c);
  return [...new Set([...my, ...rows])].slice(0, max);
}

// ───── 종목 하나 바깥 자료 붙이기 ─────
export async function enrich(x, { fresh = false, ix = null } = {}) {
  const code = x.code, now = Date.now();
  const ck = { at: now, err: {} };
  // DART (5일 보관)
  const dk = `mp/ckd/${code}`;
  let dd = fresh ? null : await getJSON(dk);
  if (!dd || now - (dd.at || 0) > 5 * DAY) {
    try { dd = { at: now, ...(await dartFacts(code)) }; await setJSON(dk, dd).catch(() => {}); } catch (e) { ck.err.major = ck.err.fin = String(e.message).slice(0, 60); dd = dd || null; }
  }
  if (dd) { ck.major = dd.major || null; ck.audit = dd.audit || null; ck.cap = dd.cap || null; if (!dd.major) ck.err.major = ck.err.major || '최대주주 현황 없음'; }
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
  if (!bh.length && fresh) {
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
  return { items, stats: closed.length ? { n: closed.length, win: Math.round((closed.filter((i) => i.pl > 0).length / closed.length) * 100), avg: r1(closed.reduce((a, i) => a + i.pl, 0) / closed.length) } : null };
}
export async function myEdit(op, p) {
  const d = (await getJSON('mp/my')) || { items: [] };
  const num = (v) => { const x = n0(v); return x && x > 0 ? x : null; };
  if (op === 'add') {
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
