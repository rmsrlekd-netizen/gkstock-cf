// 한국투자증권(KIS) Open API — 국내 수급·공매도·야간선물
// 환경변수: KIS_APP_KEY, KIS_APP_SECRET (KIS Developers에서 발급, 실전투자 앱키)
import { fetchWithTimeout, sleep, decodeText } from './util.mjs';
import { unzipFirst } from './krnames.mjs';
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

// 한국투자증권은 1초에 보낼 수 있는 요청 수가 정해져 있음(초과 시 "초당 거래건수를 초과하였습니다").
// → 요청을 한 줄로 세워 일정 간격으로 보내고, 초과 오류가 나면 잠시 쉬었다가 다시 시도
const GAP = 260; // ms (초당 약 4건)
let chain = Promise.resolve();
let lastAt = 0;
function slot() {
  const p = chain.then(async () => {
    const wait = lastAt + GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
  });
  chain = p.catch(() => {});
  return p;
}
const RATE = /초당|EGW00201|거래건수/;

export async function kisGet(path, trId, params) {
  const token = await kisToken();
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    await slot();
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
    if (j && j.rt_cd === '0') return j;
    lastErr = new Error(j ? `KIS ${trId}: ${j.msg1 || j.msg_cd}` : `KIS ${trId} HTTP ${r.status}`);
    if (!(RATE.test(`${j?.msg1 || ''} ${j?.msg_cd || ''}`) || r.status === 500 || r.status === 429)) break;
    await sleep(700 + attempt * 600); // 초과 → 잠깐 쉬고 재시도
  }
  throw lastErr;
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

// ─────────── 실제 종목코드 찾기 ───────────
// 한국투자증권이 매일 공개하는 지수선물 종목 마스터 파일(fo_idx_code_mts.mst)에서
// "코스피200 선물" 중 만기가 가장 가까운 종목의 단축코드를 찾는다. (12시간 저장)
async function masterFrontCode() {
  const r = await fetchWithTimeout('https://new.real.download.dws.co.kr/common/master/fo_idx_code_mts.mst.zip', {}, 10000);
  if (!r.ok) throw new Error('마스터 파일 HTTP ' + r.status);
  const text = decodeText(await unzipFirst(await r.arrayBuffer(), { bytes: true }), 'euc-kr');
  const k = new Date(Date.now() + 9 * 3600e3);
  const nowYm = k.getUTCFullYear() * 100 + k.getUTCMonth() + 1;
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.split('|').map((x) => x.trim());
    if (f.length < 4) continue;
    const [kind, code, , name] = f;
    // 예: "F 202612" (코스피200 선물). 미니·스프레드·옵션·다른 지수 제외
    const m = name.match(/^(?:코스피200\s*)?F\s*(20\d{2})(\d{2})$/);
    if (!m || /미니|SP|스프레드/.test(name) || /^[OCP]/i.test(kind)) continue;
    const ym = Number(m[1]) * 100 + Number(m[2]);
    if (ym >= nowYm) rows.push({ code, ym, name });
  }
  rows.sort((a, b) => a.ym - b.ym);
  if (!rows.length) throw new Error('마스터 파일에서 코스피200 선물을 찾지 못함');
  return rows.map((x) => x.code);
}

async function frontCodes() {
  if (process.env.KOSPI_FUT_CODE) return [process.env.KOSPI_FUT_CODE];
  const saved = await getJSON('kis/futcode');
  if (saved && Date.now() - saved.at < 12 * 3600e3 && saved.codes?.length) return saved.codes;
  let codes = [];
  try { codes = await masterFrontCode(); } catch (e) { console.warn('futcode', e.message); }
  const guess = kospiFrontCode();
  const out = [...new Set([...codes.slice(0, 2), guess])];
  if (codes.length) await setJSON('kis/futcode', { at: Date.now(), codes: out }).catch(() => {});
  return out;
}

async function futQuote(code, mkt) {
  const j = await kisGet('/uapi/domestic-futureoption/v1/quotations/inquire-price', 'FHMIF10000000', { FID_COND_MRKT_DIV_CODE: mkt, FID_INPUT_ISCD: code });
  const o = j.output1 || {};
  const n = (v) => (v === undefined || v === '' ? null : Number(v));
  const price = n(o.futs_prpr);
  if (!price) return null;
  const sign = ['4', '5'].includes(String(o.prdy_vrss_sign)) ? -1 : 1;
  const prev = n(o.futs_prdy_clpr);
  let chg = Math.abs(n(o.futs_prdy_vrss) || 0) * sign, pct = Math.abs(n(o.futs_prdy_ctrt) || 0) * sign;
  // 주말·장 시작 전엔 등락이 0으로 오는 경우가 있어 전일 종가 기준으로 직접 계산
  if (!chg && prev && price !== prev) { chg = price - prev; pct = (chg / prev) * 100; }
  return { code, name: o.hts_kor_isnm || '코스피200 선물', price, chg, pct, prev, volume: n(o.acml_vol), openInterest: n(o.hts_otst_stpl_qty) };
}

/** 코스피200 선물 시세. session: 'night'(야간, CM) | 'day'(주간, F) */
export async function kospiFutures(session = 'night') {
  const codes = await frontCodes();
  const mkt = session === 'night' ? 'CM' : 'F';
  for (const code of codes) {
    const q = await futQuote(code, mkt).catch(() => null);
    if (q) return { ...q, session };
  }
  throw new Error('시세 없음 (' + codes.join(', ') + ')');
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
