// 기업 개요 + 핵심 재무 (매출·영업이익·순이익·PER·PBR·ROA·ROE)
//  한국: DART(기업개황·재무·주식수·사업의 개요) + 시세(한국투자증권 또는 구글 파이낸스)
//  미국: Nasdaq(개요·재무·시가총액) + (선택) Finnhub 지표
import { fetchWithTimeout, BROWSER_UA, num, kstYmd, decodeEntities, decodeText } from './util.mjs';
import { hasKis, kisGet } from './kis.mjs';
import { googleQuote } from './gfin.mjs';
import { htmlToLines } from './dart-doc.mjs';

const DART = 'https://opendart.fss.or.kr/api';
const dkey = () => process.env.DART_API_KEY;
async function dart(ep, params) {
  const r = await fetchWithTimeout(`${DART}/${ep}.json?crtfc_key=${encodeURIComponent(dkey())}&${new URLSearchParams(params)}`, {}, 7000);
  const j = await r.json();
  if (j.status === '013') return [];
  if (j.status !== '000') throw new Error(`DART ${ep} ${j.status} ${j.message || ''}`);
  return j.list || j;
}
const n0 = (s) => { const x = Number(String(s ?? '').replace(/[,\s]/g, '')); return Number.isFinite(x) && String(s ?? '').trim() !== '' && s !== '-' ? x : null; };
const ratio = (a, b) => (a !== null && b ? (a / b) * 100 : null);

// ───────────── 한국 ─────────────
function pickAcct(list, names) {
  for (const fs of ['CFS', 'OFS']) {
    for (const nm of names) {
      const r = list.find((x) => x.fs_div === fs && x.account_nm.replace(/\s/g, '') === nm);
      if (r) return { cur: n0(r.thstrm_amount), prev: n0(r.frmtrm_amount), fs };
    }
  }
  return null;
}

async function krFinancials(corp) {
  const y = Number(kstYmd(0).slice(0, 4));
  for (const year of [y - 1, y - 2]) {
    const list = await dart('fnlttSinglAcnt', { corp_code: corp, bsns_year: String(year), reprt_code: '11011' }).catch(() => []);
    if (!list.length) continue;
    const rev = pickAcct(list, ['매출액', '수익(매출액)', '영업수익', '매출']);
    const op = pickAcct(list, ['영업이익', '영업이익(손실)']);
    const ni = pickAcct(list, ['당기순이익', '당기순이익(손실)', '연결당기순이익']);
    const assets = pickAcct(list, ['자산총계']);
    const equity = pickAcct(list, ['자본총계']);
    const liab = pickAcct(list, ['부채총계']);
    return { year, basis: (rev || ni)?.fs === 'OFS' ? '별도' : '연결', rev, op, ni, assets, equity, liab };
  }
  return null;
}

async function krShares(corp, year) {
  const list = await dart('stockTotqySttus', { corp_code: corp, bsns_year: String(year), reprt_code: '11011' }).catch(() => []);
  const row = list.find((x) => /합계/.test(x.se)) || list.find((x) => /보통/.test(x.se));
  return row ? n0(row.istc_totqy) : null;
}

/** 최근 사업보고서의 'II. 사업의 내용 > 1. 사업의 개요' 앞부분 */
async function krBusinessOverview(corp) {
  const bgn = kstYmd(-730);
  let rcp = null;
  for (const ty of ['A001', 'A002', 'A003']) {
    const list = await dart('list', { corp_code: corp, bgn_de: bgn, pblntf_detail_ty: ty, page_count: '3' }).catch(() => []);
    if (list.length) { rcp = list[0].rcept_no; break; }
  }
  if (!rcp) return null;
  const H = { 'User-Agent': BROWSER_UA, Referer: 'https://dart.fss.or.kr/' };
  const main = await (await fetchWithTimeout(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcp}`, { headers: H }, 7000)).text();
  const i = main.search(/사업의\s*개요"/);
  if (i < 0) return null;
  const seg = main.slice(i, i + 700);
  const g = (k) => (seg.match(new RegExp(`\\['${k}'\\]\\s*=\\s*"([^"]*)"`)) || [])[1];
  const url = `https://dart.fss.or.kr/report/viewer.do?rcpNo=${g('rcpNo')}&dcmNo=${g('dcmNo')}&eleId=${g('eleId')}&offset=${g('offset')}&length=${g('length')}&dtd=${g('dtd')}`;
  const v = await fetchWithTimeout(url, { headers: H }, 7000);
  const html = decodeText(await v.arrayBuffer(), /utf-?8/i.test(v.headers.get('content-type') || '') ? 'utf-8' : 'euc-kr');
  const text = htmlToLines(html).join(' ').replace(/^1\.\s*사업의\s*개요\s*/, '').replace(/\s+/g, ' ');
  return { text: text.slice(0, 2000), rcp };
}

async function krPrice(ticker, exchange) {
  if (hasKis()) {
    try {
      const o = (await kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: ticker })).output || {};
      return { price: n0(o.stck_prpr), per: n0(o.per), pbr: n0(o.pbr), eps: n0(o.eps), bps: n0(o.bps), mcap: n0(o.hts_avls) !== null ? n0(o.hts_avls) * 1e8 : null, sector: o.bstp_kor_isnm || null, src: 'KIS' };
    } catch {}
  }
  const ex = /KOSDAQ/i.test(exchange || '') ? 'KOSDAQ' : 'KRX';
  for (const e of [ex, ex === 'KRX' ? 'KOSDAQ' : 'KRX']) {
    const q = await googleQuote(`${ticker}:${e}`).catch(() => null);
    if (q && q.price) return { price: q.price, src: 'Google' };
  }
  return null;
}

export async function krCompany(ticker, corp, exchange) {
  if (!dkey()) throw new Error('DART_API_KEY 미설정');
  const [info, fin, ov, px] = await Promise.all([
    dart('company', { corp_code: corp }).catch(() => null),
    krFinancials(corp).catch(() => null),
    krBusinessOverview(corp).catch(() => null),
    ticker ? krPrice(ticker, exchange).catch(() => null) : Promise.resolve(null),
  ]);
  const shares = fin ? await krShares(corp, fin.year).catch(() => null) : null;
  const mcap = px?.mcap ?? (px?.price && shares ? px.price * shares : null);
  const niV = fin?.ni?.cur ?? null, eqV = fin?.equity?.cur ?? null, asV = fin?.assets?.cur ?? null;
  const liV = fin?.liab?.cur ?? (asV !== null && eqV !== null ? asV - eqV : null);
  return {
    src: 'KR',
    name: info?.corp_name || null,
    nameEn: info?.corp_name_eng || null,
    ceo: info?.ceo_nm || null,
    founded: info?.est_dt ? `${info.est_dt.slice(0, 4)}.${info.est_dt.slice(4, 6)}.${info.est_dt.slice(6, 8)}` : null,
    homepage: info?.hm_url ? (/^https?:/.test(info.hm_url) ? info.hm_url : 'http://' + info.hm_url) : null,
    address: info?.adres || null,
    sector: px?.sector || null,
    overviewRaw: ov?.text || null,
    overviewSource: ov?.rcp ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${ov.rcp}` : null,
    currency: 'KRW',
    price: px?.price ?? null,
    marketCap: mcap,
    fin: fin ? {
      period: `${fin.year}년 (${fin.basis})`,
      revenue: fin.rev?.cur ?? null, revenuePrev: fin.rev?.prev ?? null,
      opIncome: fin.op?.cur ?? null, opIncomePrev: fin.op?.prev ?? null,
      netIncome: niV, netIncomePrev: fin.ni?.prev ?? null,
    } : null,
    ratios: {
      per: px?.per ?? (mcap && niV > 0 ? mcap / niV : null),
      pbr: px?.pbr ?? (mcap && eqV > 0 ? mcap / eqV : null),
      roe: ratio(niV, eqV),
      roa: ratio(niV, asV),
      debt: eqV > 0 ? ratio(liV, eqV) : null,
      eps: px?.eps ?? (niV !== null && shares ? niV / shares : null),
      bps: px?.bps ?? (eqV !== null && shares ? eqV / shares : null),
      basis: px?.per != null ? '현재가 기준 (한국투자증권)' : `시가총액 ÷ ${fin?.year ?? ''}년 실적`,
    },
  };
}

// ───────────── 미국 ─────────────
const NQ_H = { 'User-Agent': BROWSER_UA, Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
async function nq(path) {
  const r = await fetchWithTimeout('https://api.nasdaq.com' + path, { headers: NQ_H }, 7000);
  const j = await r.json();
  if (!j?.data) throw new Error('Nasdaq 데이터 없음');
  return j.data;
}
const rowVals = (tbl, label) => {
  const r = (tbl?.rows || []).find((x) => x.value1 === label);
  if (!r) return [];
  return [r.value2, r.value3, r.value4, r.value5].map((v) => { const x = num(String(v || '').replace(/\((.*)\)/, '-$1')); return x === null ? null : x * 1000; }); // 단위: 천 달러
};

export async function usCompany(ticker) {
  const T = encodeURIComponent(ticker.toUpperCase().replace('.', '/'));
  const fkey = process.env.FINNHUB_API_KEY;
  const [summary, profile, annual, quarterly, fh] = await Promise.all([
    nq(`/api/quote/${T}/summary?assetclass=stocks`).catch(() => null),
    nq(`/api/company/${T}/company-profile`).catch(() => null),
    nq(`/api/company/${T}/financials?frequency=1`).catch(() => null),
    nq(`/api/company/${T}/financials?frequency=2`).catch(() => null),
    fkey ? fetchWithTimeout(`https://finnhub.io/api/v1/stock/metric?symbol=${T}&metric=all&token=${fkey}`, {}, 6000).then((r) => r.json()).then((j) => j.metric || null).catch(() => null) : Promise.resolve(null),
  ]);
  const sd = summary?.summaryData || {};
  const mcap = num(sd.MarketCap?.value);
  const inc = annual?.incomeStatementTable, bal = annual?.balanceSheetTable;
  const qInc = quarterly?.incomeStatementTable, qBal = quarterly?.balanceSheetTable;
  const sum4 = (arr) => (arr.length === 4 && arr.every((x) => x !== null) ? arr.reduce((a, b) => a + b, 0) : null);
  const ttmNI = sum4(rowVals(qInc, 'Net Income'));
  const ttmRev = sum4(rowVals(qInc, 'Total Revenue'));
  const ttmOp = sum4(rowVals(qInc, 'Operating Income'));
  const eq = rowVals(qBal, 'Total Equity')[0] ?? rowVals(bal, 'Total Equity')[0] ?? null;
  const assets = rowVals(qBal, 'Total Assets')[0] ?? rowVals(bal, 'Total Assets')[0] ?? null;
  const liab = rowVals(qBal, 'Total Liabilities')[0] ?? rowVals(bal, 'Total Liabilities')[0] ?? (assets !== null && eq !== null ? assets - eq : null);
  const prevClose = num(String(sd.PreviousClose?.value || '').replace('$', ''));
  const shares = mcap && prevClose ? mcap / prevClose : null;
  const epsSd = num(String(sd.EarningsPerShare?.value || '').replace(/[$()]/g, (c) => (c === '(' ? '-' : '')));
  const aRev = rowVals(inc, 'Total Revenue'), aOp = rowVals(inc, 'Operating Income'), aNI = rowVals(inc, 'Net Income');
  const fyEnd = inc?.headers?.value2 || null;
  const useTTM = ttmRev !== null;
  const ni = useTTM ? ttmNI : aNI[0] ?? null;
  const pd = (k) => profile?.[k]?.value || null;
  return {
    src: 'US',
    name: pd('CompanyName'),
    sector: pd('Sector') || sd.Sector?.value || null,
    industry: pd('Industry') || sd.Industry?.value || null,
    overviewRaw: pd('CompanyDescription'),
    homepage: pd('CompanyUrl'),
    currency: 'USD',
    price: prevClose,
    marketCap: mcap,
    fin: {
      period: fyEnd ? `최근 회계연도 (${fyEnd} 결산)` : '최근 회계연도',
      revenue: aRev[0] ?? null, revenuePrev: aRev[1] ?? null,
      opIncome: aOp[0] ?? null, opIncomePrev: aOp[1] ?? null,
      netIncome: aNI[0] ?? null, netIncomePrev: aNI[1] ?? null,
      ttm: { revenue: ttmRev, opIncome: ttmOp, netIncome: ttmNI },
    },
    ratios: {
      per: fh?.peTTM ?? fh?.peBasicExclExtraTTM ?? (mcap && ni > 0 ? mcap / ni : null),
      pbr: fh?.pbQuarterly ?? fh?.pbAnnual ?? (mcap && eq > 0 ? mcap / eq : null),
      roe: fh?.roeTTM ?? ratio(ni, eq),
      roa: fh?.roaTTM ?? ratio(ni, assets),
      debt: eq > 0 ? ratio(liab, eq) : null,
      eps: fh?.epsTTM ?? epsSd ?? (ni !== null && shares ? ni / shares : null),
      bps: fh?.bookValuePerShareQuarterly ?? (eq !== null && shares ? eq / shares : null),
      basis: fh ? 'Finnhub 지표' : useTTM ? '시가총액 ÷ 최근 4분기(TTM) 실적' : '시가총액 ÷ 최근 회계연도 실적',
    },
  };
}
