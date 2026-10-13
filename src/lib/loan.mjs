// 국내 대차잔고 — 빌려 간(대차) 주식이 얼마나 쌓여 있는지 (공매도 대기 물량으로 많이 봄)
//  · '국내 공매도' 탭은 그날 거래 중 공매도 비중(거래량)이고, 여기는 쌓여 있는 '잔고'
//  · 한국투자증권 '종목별 일별 대차거래추이' (HHPST074500C0) — 종목마다 따로 조회해야 해서
//    대형주 + 공매도 상위 종목(약 80개)을 하루 두 번(아침·저녁) 크론에서 조금씩 채움
//  · 결과: loan/kr { at, date, items:[{ t, name, bal, amt, d1, d5, price, pct }] }
import { getJSON, setJSON } from './store.mjs';
import { hasKis, kisGet } from './kis.mjs';
import { kstYmd } from './util.mjs';

// 시가총액 상위권 + 공매도가 자주 몰리는 종목 (공매도 상위는 매번 자동으로 더함)
export const LOAN_BASE = [
  ['005930', '삼성전자'], ['000660', 'SK하이닉스'], ['373220', 'LG에너지솔루션'], ['207940', '삼성바이오로직스'], ['005380', '현대차'],
  ['000270', '기아'], ['068270', '셀트리온'], ['105560', 'KB금융'], ['055550', '신한지주'], ['035420', 'NAVER'],
  ['005490', 'POSCO홀딩스'], ['006400', '삼성SDI'], ['051910', 'LG화학'], ['035720', '카카오'], ['012330', '현대모비스'],
  ['028260', '삼성물산'], ['032830', '삼성생명'], ['086790', '하나금융지주'], ['012450', '한화에어로스페이스'], ['329180', 'HD현대중공업'],
  ['042660', '한화오션'], ['009540', 'HD한국조선해양'], ['034020', '두산에너빌리티'], ['011200', 'HMM'], ['010130', '고려아연'],
  ['003670', '포스코퓨처엠'], ['066570', 'LG전자'], ['034730', 'SK'], ['096770', 'SK이노베이션'], ['015760', '한국전력'],
  ['017670', 'SK텔레콤'], ['030200', 'KT'], ['018260', '삼성에스디에스'], ['009150', '삼성전기'], ['010140', '삼성중공업'],
  ['064350', '현대로템'], ['047810', '한국항공우주'], ['272210', '한화시스템'], ['267260', 'HD현대일렉트릭'], ['010120', 'LS ELECTRIC'],
  ['323410', '카카오뱅크'], ['377300', '카카오페이'], ['259960', '크래프톤'], ['352820', '하이브'], ['003550', 'LG'],
  ['034220', 'LG디스플레이'], ['000810', '삼성화재'], ['316140', '우리금융지주'], ['024110', '기업은행'], ['011170', '롯데케미칼'],
  ['247540', '에코프로비엠'], ['086520', '에코프로'], ['196170', '알테오젠'], ['028300', 'HLB'], ['277810', '레인보우로보틱스'],
  ['058470', '리노공업'], ['039030', '이오테크닉스'], ['240810', '원익IPS'], ['042700', '한미반도체'], ['328130', '루닛'],
];

const n = (v) => (v === undefined || v === null || v === '' ? null : Number(String(v).replace(/,/g, '')));
const RUN = 14; // 한 번(3분)에 조회할 종목 수

/** 한 종목 최근 대차거래 (최신순 [{date, bal, amt, newQ, repQ, close, pct}]) */
async function loanOf(code, st = {}) {
  const params = { MKSC_SHRN_ISCD: code, START_DATE: kstYmd(-14), END_DATE: kstYmd(0), CTS: '' };
  let lastErr = null;
  const order = [...new Set([st.div, '3', '1', '2'].filter(Boolean))]; // 한 번 맞은 조회구분을 먼저
  for (const div of order) {
    let j;
    try { j = await kisGet('/uapi/domestic-stock/v1/quotations/daily-loan-trans', 'HHPST074500C0', { MRKT_DIV_CLS_CODE: div, ...params }); } catch (e) { lastErr = e; continue; }
    const rows = (j.output1 || j.output || []).filter((r) => n(r.rmnd_stcn) != null && r.bsop_date);
    if (rows.length) {
      if (div === '3' || div === '1') st.div = div;
      return rows.map((r) => {
        const sign = ['4', '5'].includes(String(r.prdy_vrss_sign)) ? -1 : 1;
        return { date: r.bsop_date, bal: n(r.rmnd_stcn), amt: n(r.rmnd_amt), newQ: n(r.new_stcn), repQ: n(r.rdmp_stcn), close: n(r.stck_prpr), pct: r.prdy_ctrt != null ? Math.abs(n(r.prdy_ctrt)) * sign : null };
      }).sort((a, b) => (a.date < b.date ? 1 : -1));
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

function kstNow() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return { ymd: d.toISOString().slice(0, 10), h: d.getUTCHours(), wd: d.getUTCDay() };
}

/** 크론(3분마다): 아침 7~9시·저녁 18~21시에 하루치를 새로 채움 */
export async function loanWatch({ force = false } = {}) {
  if (!hasKis()) return null;
  const k = kstNow();
  const st = (await getJSON('loan/state')) || {};
  let slot = k.h >= 7 && k.h < 10 ? 'am' : k.h >= 18 && k.h < 22 ? 'pm' : null;
  if (!slot && !st.doneKey) slot = 'boot'; // 처음 올린 날은 시간과 상관없이 한 번 채움
  const runKey = `${k.ymd}-${slot}`;
  if (!force && (!slot || k.wd === 0 || st.doneKey === runKey)) return null;
  // 새 회차 시작: 조회할 종목 목록 만들기 (대형주 + 그날 공매도 상위)
  if (st.runKey !== runKey || !Array.isArray(st.queue)) {
    const fl = await getJSON('flows/kr').catch(() => null);
    const extra = (fl?.body?.short || []).map((x) => [x.ticker, x.name]);
    const seen = new Set();
    st.queue = [...LOAN_BASE, ...extra].filter(([t]) => /^\d{6}$/.test(t) && !seen.has(t) && seen.add(t));
    st.runKey = runKey; st.pos = 0; st.rows = {};
  }
  const part = st.queue.slice(st.pos, st.pos + RUN);
  let ok = 0, err = 0;
  for (const [t, name] of part) {
    try {
      const h = await loanOf(t, st);
      if (h.length) {
        const c = h[0], p1 = h[1], p5 = h[Math.min(5, h.length - 1)];
        st.rows[t] = { t, name, date: c.date, bal: c.bal, amt: c.amt, d1: p1 ? c.bal - p1.bal : null, d5: h.length > 1 ? c.bal - p5.bal : null, d5p: h.length > 1 && p5.bal ? Math.round(((c.bal - p5.bal) / p5.bal) * 1000) / 10 : null, price: c.close, pct: c.pct };
        ok++;
      }
    } catch (e) { err++; st.err = String(e.message || e).slice(0, 160); }
  }
  st.pos += part.length;
  if (st.pos >= st.queue.length) {
    const items = Object.values(st.rows);
    if (items.length >= 10) {
      // 금액이 없으면 잔고 주수 × 종가로 계산
      for (const x of items) if (!x.amt && x.bal && x.price) x.amt = x.bal * x.price;
      const date = items.map((x) => x.date).sort().pop();
      await setJSON('loan/kr', { at: Date.now(), date, items });
    }
    st.doneKey = runKey; st.queue = null; st.rows = {};
  }
  await setJSON('loan/state', st).catch(() => {});
  return { ok, err, pos: st.pos };
}

/** 화면용 (잔고 금액 상위·5일 증가 상위) */
export async function loanList() {
  const d = await getJSON('loan/kr').catch(() => null);
  if (!d?.items?.length) return null;
  const items = d.items.filter((x) => x.bal > 0);
  return {
    at: d.at, date: d.date,
    top: items.slice().sort((a, b) => (b.amt || 0) - (a.amt || 0)).slice(0, 40),
    up: items.filter((x) => (x.d5 || 0) > 0).sort((a, b) => (b.d5p || 0) - (a.d5p || 0)).slice(0, 40),
  };
}
