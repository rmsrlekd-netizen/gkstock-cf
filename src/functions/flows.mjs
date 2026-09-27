// /api/flows — 국내 기관·외국인 순매수/순매도 상위, 공매도 상위 (한국투자증권 API)
import { json } from '../lib/util.mjs';
import { hasKis, kisGet } from '../lib/kis.mjs';

const n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const signed = (v, sign) => {
  const x = Math.abs(n(v) || 0);
  return ['4', '5'].includes(String(sign)) ? -x : x;
};

async function instForeign(who, side) {
  // who: 1=외국인, 2=기관계 / side: 0=순매수 상위, 1=순매도 상위 / 금액 정렬
  const j = await kisGet('/uapi/domestic-stock/v1/quotations/foreign-institution-total', 'FHPTJ04400000', {
    FID_COND_MRKT_DIV_CODE: 'V',
    FID_COND_SCR_DIV_CODE: '16449',
    FID_INPUT_ISCD: '0000',
    FID_DIV_CLS_CODE: '1',
    FID_RANK_SORT_CLS_CODE: side,
    FID_ETC_CLS_CODE: who,
  });
  return (j.output || []).slice(0, 30).map((x) => ({
    name: x.hts_kor_isnm,
    ticker: x.mksc_shrn_iscd,
    price: n(x.stck_prpr),
    pct: signed(x.prdy_ctrt, x.prdy_vrss_sign),
    qty: n(who === '1' ? x.frgn_ntby_qty : x.orgn_ntby_qty),
    amount: n(who === '1' ? x.frgn_ntby_tr_pbmn : x.orgn_ntby_tr_pbmn),
  }));
}

async function shortTop() {
  const j = await kisGet('/uapi/domestic-stock/v1/ranking/short-sale', 'FHPST04820000', {
    FID_APLY_RANG_VOL: '',
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_COND_SCR_DIV_CODE: '20482',
    FID_INPUT_ISCD: '0000',
    FID_PERIOD_DIV_CODE: 'D',
    FID_INPUT_CNT_1: '0',
    FID_TRGT_EXLS_CLS_CODE: '',
    FID_TRGT_CLS_CODE: '',
    FID_APLY_RANG_PRC_1: '',
    FID_APLY_RANG_PRC_2: '',
  });
  return (j.output || []).slice(0, 30).map((x) => ({
    name: x.hts_kor_isnm,
    ticker: x.mksc_shrn_iscd,
    price: n(x.stck_prpr),
    pct: signed(x.prdy_ctrt, x.prdy_vrss_sign),
    shortQty: n(x.ssts_cntg_qty),
    shortRatio: n(x.ssts_vol_rlim),
    shortAmount: n(x.ssts_tr_pbmn),
    date: x.stnd_date2 || x.stnd_date1 || null,
  }));
}

export default async () => {
  if (!hasKis()) {
    return json({ ok: false, error: 'KIS_APP_KEY / KIS_APP_SECRET 환경변수가 없어 국내 수급을 불러올 수 없습니다.', needsKis: true }, { cdnSeconds: 60 });
  }
  const tasks = {
    instBuy: () => instForeign('2', '0'),
    instSell: () => instForeign('2', '1'),
    frgnBuy: () => instForeign('1', '0'),
    frgnSell: () => instForeign('1', '1'),
    short: () => shortTop(),
  };
  const out = {};
  const errors = {};
  // KIS 초당 호출 제한을 피하려고 순차 호출
  for (const [k, fn] of Object.entries(tasks)) {
    try { out[k] = await fn(); } catch (e) { out[k] = []; errors[k] = e.message; }
  }
  return json({ ok: true, fetchedAt: new Date().toISOString(), errors, ...out }, { cdnSeconds: 180, swr: 300 });
};

export const config = { path: '/api/flows' };
