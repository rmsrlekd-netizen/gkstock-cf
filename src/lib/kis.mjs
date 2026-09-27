// 한국투자증권(KIS) Open API — 국내 수급·공매도·야간선물
// 환경변수: KIS_APP_KEY, KIS_APP_SECRET (KIS Developers에서 발급, 실전투자 앱키)
import { fetchWithTimeout, sleep } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';

const BASE = 'https://openapi.koreainvestment.com:9443';
export const hasKis = () => !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);

let mem = null; // { token, exp }

async function issueToken() {
  const r = await fetchWithTimeout(`${BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: process.env.KIS_APP_KEY, appsecret: process.env.KIS_APP_SECRET }),
  }, 8000);
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error('KIS 토큰 발급 실패: ' + (j.error_description || j.msg1 || r.status));
  const exp = Date.now() + (Number(j.expires_in) || 86400) * 1000 - 30 * 60e3;
  return { token: j.access_token, exp };
}

export async function kisToken() {
  if (mem && mem.exp > Date.now()) return mem.token;
  const saved = await getJSON('kis/token');
  if (saved && saved.exp > Date.now()) { mem = saved; return mem.token; }
  try {
    mem = await issueToken();
  } catch (e) {
    // 토큰 발급은 1분에 1회 제한 → 다른 함수가 방금 발급했을 수 있으니 잠시 후 저장본 재확인
    await sleep(1500);
    const again = await getJSON('kis/token');
    if (again && again.exp > Date.now()) { mem = again; return mem.token; }
    throw e;
  }
  await setJSON('kis/token', mem).catch(() => {});
  return mem.token;
}

export async function kisGet(path, trId, params) {
  const token = await kisToken();
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const r = await fetchWithTimeout(url, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: trId,
      custtype: 'P',
    },
  }, 8000);
  const j = await r.json().catch(() => null);
  if (!j) throw new Error(`KIS ${trId} HTTP ${r.status}`);
  if (j.rt_cd !== '0') throw new Error(`KIS ${trId}: ${j.msg1 || j.msg_cd}`);
  return j;
}

// ─────────── 코스피200 선물 종목코드 (근월물) ───────────
// 예) 2025년 9월물 = 101W09. 연도 문자는 2025=W 기준으로 한 글자씩 증가.
// 코드 규칙이 바뀌면 Cloudflare 변수 KOSPI_FUT_CODE 로 직접 지정하세요.
export function kospiFrontCode(now = new Date()) {
  if (process.env.KOSPI_FUT_CODE) return process.env.KOSPI_FUT_CODE;
  const k = new Date(now.getTime() + 9 * 3600e3); // KST
  let y = k.getUTCFullYear();
  let m = k.getUTCMonth() + 1;
  const d = k.getUTCDate();
  const secondThu = (yy, mm) => {
    const first = new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay();
    return 1 + ((4 - first + 7) % 7) + 7;
  };
  let qm = Math.ceil(m / 3) * 3;
  if (m === qm && d > secondThu(y, qm)) qm += 3;
  if (qm > 12) { qm -= 12; y += 1; }
  const letters = 'WXYZ';
  const letter = letters[y - 2025] || process.env.KOSPI_FUT_YEAR_LETTER || '?';
  return `101${letter}${String(qm).padStart(2, '0')}`;
}

/** 코스피200 선물 시세. session: 'night'(CM) | 'day'(F) */
export async function kospiFutures(session = 'night') {
  const code = kospiFrontCode();
  const mkt = session === 'night' ? 'CM' : 'F';
  const j = await kisGet('/uapi/domestic-futureoption/v1/quotations/inquire-price', 'FHMIF10000000', {
    FID_COND_MRKT_DIV_CODE: mkt,
    FID_INPUT_ISCD: code,
  });
  const o = j.output1 || {};
  const n = (v) => (v === undefined || v === '' ? null : Number(v));
  const price = n(o.futs_prpr);
  if (!price) throw new Error('시세 없음 (' + code + ')');
  const sign = ['4', '5'].includes(String(o.prdy_vrss_sign)) ? -1 : 1;
  const chg = Math.abs(n(o.futs_prdy_vrss) || 0) * sign;
  const pct = Math.abs(n(o.futs_prdy_ctrt) || 0) * sign;
  return { code, session, name: o.hts_kor_isnm || '코스피200 선물', price, chg, pct, prev: n(o.futs_prdy_clpr), volume: n(o.acml_vol), openInterest: n(o.hts_otst_stpl_qty) };
}

/** 국내 업종 지수 (0001 코스피, 1001 코스닥) */
export async function kisIndex(code) {
  const j = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-index-price', 'FHPUP02100000', { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: code });
  const o = j.output || {};
  const sign = ['4', '5'].includes(String(o.prdy_vrss_sign)) ? -1 : 1;
  const price = Number(o.bstp_nmix_prpr);
  if (!price) throw new Error('지수 시세 없음');
  const chg = Math.abs(Number(o.bstp_nmix_prdy_vrss) || 0) * sign;
  return { price, chg, pct: Math.abs(Number(o.bstp_nmix_prdy_ctrt) || 0) * sign, prev: price - chg };
}
