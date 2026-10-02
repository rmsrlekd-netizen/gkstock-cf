// /api/stock — 종목 상세 수급
//  미국: ?src=US&t=AAPL        → 공매도 잔고(보름 단위)·내부자 거래·기관 보유 (Nasdaq)
//  한국: ?src=KR&t=005930&corp=00126380 → 투자자별 순매수·공매도 거래 (KIS), 임원·5% 지분 변동 (DART)
import { json, fetchWithTimeout, num, BROWSER_UA, kstYmd } from '../lib/util.mjs';
import { hasKis, kisGet } from '../lib/kis.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { shortVolOf } from '../lib/shortvol.mjs';
import { borrowOf } from '../lib/borrow.mjs';

const NQ = {
  'User-Agent': BROWSER_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

async function nq(path) {
  const r = await fetchWithTimeout('https://api.nasdaq.com' + path, { headers: NQ }, 8000);
  if (!r.ok) throw new Error('Nasdaq HTTP ' + r.status);
  const j = await r.json();
  if (!j?.data) throw new Error(j?.status?.bCodeMessage?.[0]?.errorMessage || 'Nasdaq 데이터 없음');
  return j.data;
}

async function us(t) {
  const T = encodeURIComponent(t.toUpperCase().replace('.', '/'));
  const [si, ins, inst] = await Promise.allSettled([
    nq(`/api/quote/${T}/short-interest?assetClass=stocks`),
    nq(`/api/company/${T}/insider-trades?limit=20&type=ALL&sortColumn=lastDate&sortOrder=DESC`),
    nq(`/api/company/${T}/institutional-holdings?limit=10&type=TOTAL&sortColumn=marketValue&sortOrder=DESC`),
  ]);
  const out = { src: 'US', ticker: t.toUpperCase(), errors: {} };

  if (si.status === 'fulfilled') {
    out.short = (si.value.shortInterestTable?.rows || []).slice(0, 8).map((r) => ({
      date: r.settlementDate, interest: num(r.interest), avgVol: num(r.avgDailyShareVolume), days: num(r.daysToCover),
    }));
  } else out.errors.short = si.reason.message;
  try { out.borrow = await borrowOf(t); } catch {} // IBKR 공매도 가능 수량 (15분마다)
  try { out.shortVol = await shortVolOf(t); } catch {} // FINRA 일별 공매도 거래 비중 (매일)

  if (ins.status === 'fulfilled') {
    const d = ins.value;
    const pick = (tbl, label) => (tbl?.rows || []).find((r) => r.insiderTrade === label) || {};
    out.insider = {
      buys3m: num(pick(d.numberOfTrades, 'Number of Open Market Buys').months3),
      sells3m: num(pick(d.numberOfTrades, 'Number of Sells').months3),
      net3m: num(String(pick(d.numberOfSharesTraded, 'Net Activity').months3 || '').replace(/\((.*)\)/, '-$1')),
      net12m: num(String(pick(d.numberOfSharesTraded, 'Net Activity').months12 || '').replace(/\((.*)\)/, '-$1')),
      rows: (d.transactionTable?.table?.rows || []).slice(0, 15).map((r) => ({
        who: r.insider, relation: r.relation, date: r.lastDate, type: r.transactionType, shares: num(r.sharesTraded), price: num(r.lastPrice), held: num(r.sharesHeld),
      })),
    };
  } else out.errors.insider = ins.reason.message;

  if (inst.status === 'fulfilled') {
    const d = inst.value;
    const pos = (label) => (d.activePositions?.rows || []).find((r) => r.positions === label) || {};
    const ns = (label) => (d.newSoldOutPositions?.rows || []).find((r) => r.positions === label) || {};
    out.inst = {
      pct: d.ownershipSummary?.SharesOutstandingPCT?.value || null,
      holders: num(pos('Total Institutional Shares').holders),
      increased: { holders: num(pos('Increased Positions').holders), shares: num(pos('Increased Positions').shares) },
      decreased: { holders: num(pos('Decreased Positions').holders), shares: num(pos('Decreased Positions').shares) },
      newPos: { holders: num(ns('New Positions').holders), shares: num(ns('New Positions').shares) },
      soldOut: { holders: num(ns('Sold Out Positions').holders), shares: num(ns('Sold Out Positions').shares) },
      top: (d.holdingsTransactions?.table?.rows || []).slice(0, 10).map((r) => ({
        name: r.ownerName, date: r.date, shares: num(r.sharesHeld), change: num(r.sharesChange), changePct: r.sharesChangePCT, value: num(r.marketValue),
      })),
    };
  } else out.errors.inst = inst.reason.message;
  return out;
}

async function kr(t, corp) {
  const out = { src: 'KR', ticker: t, errors: {} };
  const key = process.env.DART_API_KEY;
  const jobs = [];

  if (hasKis()) {
    jobs.push((async () => {
      try {
        const j = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-investor', 'FHKST01010900', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: t });
        out.investors = (j.output || []).slice(0, 20).map((x) => ({
          date: x.stck_bsop_date, close: num(x.stck_clpr), person: num(x.prsn_ntby_qty), foreign: num(x.frgn_ntby_qty), inst: num(x.orgn_ntby_qty),
        })).filter((x) => x.date);
      } catch (e) { out.errors.investors = e.message; }
      try {
        const j = await kisGet('/uapi/domestic-stock/v1/quotations/daily-short-sale', 'FHPST04830000', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: t, FID_INPUT_DATE_1: kstYmd(-40), FID_INPUT_DATE_2: kstYmd(0) });
        out.short = (j.output2 || []).slice(0, 20).map((x) => ({
          date: x.stck_bsop_date, close: num(x.stck_clpr), qty: num(x.ssts_cntg_qty), ratio: num(x.ssts_vol_rlim), amount: num(x.ssts_tr_pbmn),
        })).filter((x) => x.date);
      } catch (e) { out.errors.short = e.message; }
    })());
  } else {
    out.errors.investors = out.errors.short = 'KIS_APP_KEY 미설정';
  }

  if (key && corp) {
    const dart = async (ep) => {
      const r = await fetchWithTimeout(`https://opendart.fss.or.kr/api/${ep}.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${encodeURIComponent(corp)}`, {}, 8000);
      const j = await r.json();
      if (j.status !== '000') throw new Error(j.message || j.status);
      return (j.list || []).sort((a, b) => (a.rcept_no < b.rcept_no ? 1 : -1)).slice(0, 12);
    };
    jobs.push(dart('elestock').then((list) => {
      out.insider = list.map((x) => ({ rcpNo: x.rcept_no, date: x.rcept_dt, who: x.repror, role: x.isu_exctv_ofcps || x.isu_main_shrholdr, shares: num(x.sp_stock_lmp_cnt), change: num(x.sp_stock_lmp_irds_cnt), rate: num(x.sp_stock_lmp_rate) }));
    }).catch((e) => { out.errors.insider = e.message; }));
    jobs.push(dart('majorstock').then((list) => {
      out.major = list.map((x) => ({ rcpNo: x.rcept_no, date: x.rcept_dt, who: x.repror, type: x.report_tp, shares: num(x.stkqy), change: num(x.stkqy_irds), rate: num(x.stkrt), rateChange: num(x.stkrt_irds), reason: x.report_resn }));
    }).catch((e) => { out.errors.major = e.message; }));
  }
  await Promise.all(jobs);
  return out;
}

export default async (req) => {
  const u = new URL(req.url);
  const src = u.searchParams.get('src');
  const t = (u.searchParams.get('t') || '').trim();
  const corp = u.searchParams.get('corp');
  if (!t || !/^[A-Za-z0-9.\-]{1,12}$/.test(t)) return json({ ok: false, error: '종목코드가 올바르지 않습니다' }, { status: 400, cdnSeconds: 60 });
  try {
    // 같은 종목은 저장해 두고 재사용 (한국 5분·미국 30분) → 한국투자증권 호출 횟수 절약
    const ck = `stock/${src === 'KR' ? 'KR' : 'US'}/${t.toUpperCase()}`;
    const c = await getJSON(ck);
    let data;
    if (c && Date.now() - c.at < (src === 'KR' ? 5 : 30) * 60e3) data = c.data;
    else {
      data = src === 'KR' ? await kr(t, corp && /^\d{8}$/.test(corp) ? corp : null) : await us(t);
      const bad = Object.values(data.errors || {}).some((e) => /초당|거래건수/.test(e));
      if (!bad) await setJSON(ck, { at: Date.now(), data }).catch(() => {});
      else if (c) data = c.data; // 호출 제한에 걸렸으면 직전 저장본 사용
    }
    return json({ ok: true, fetchedAt: new Date().toISOString(), ...data }, { cdnSeconds: src === 'KR' ? 300 : 600, swr: 600 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, { cdnSeconds: 30, status: 502 });
  }
};

export const config = { path: '/api/stock' };
