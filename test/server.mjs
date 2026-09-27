// 로컬 테스트 서버: 실제 서버 함수를 실행하되 외부 API는 가짜 응답(fixture)으로 대체
// 실행: node test/server.mjs  → http://localhost:8787
import http from 'http';
import fs from 'fs';
import path from 'path';
process.env.DART_API_KEY = 'test';
process.env.KIS_APP_KEY = process.env.NO_KIS ? '' : 'k';
process.env.KIS_APP_SECRET = process.env.NO_KIS ? '' : 's';
process.env.GK_MEMORY_STORE = '1';
if (process.env.AI) process.env.GEMINI_API_KEY = 'AIzaTEST';
const root = new URL('../public/', import.meta.url).pathname;
const fx = (f) => fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8');

const cos = [
  [1045810, 'NVIDIA CORP', 'NVDA', 'Nasdaq'], [320193, 'Apple Inc.', 'AAPL', 'Nasdaq'], [1318605, 'Tesla, Inc.', 'TSLA', 'Nasdaq'],
  [1321655, 'Palantir Technologies Inc.', 'PLTR', 'Nasdaq'], [1730168, 'Broadcom Inc.', 'AVGO', 'Nasdaq'], [1834584, 'SoundHound AI, Inc.', 'SOUN', 'Nasdaq'],
  [1754301, 'Rigetti Computing, Inc.', 'RGTI', 'Nasdaq'], [1837240, 'Oklo Inc.', 'OKLO', 'NYSE'], [1834518, 'Coupang, Inc.', 'CPNG', 'NYSE'], [1783879, 'Robinhood Markets, Inc.', 'HOOD', 'Nasdaq']];
const forms = [['8-K', ['2.02', '9.01']], ['4', []], ['8-K', ['1.01', '9.01']], ['424B5', []], ['SCHEDULE 13D', []], ['4', []], ['10-Q', []], ['8-K', ['3.01']], ['S-3', []], ['4', []], ['6-K', []], ['8-K', ['8.01']], ['SCHEDULE 13G', []], ['13F-HR', []], ['144', []]];
const IT = { '2.02': 'Results of Operations and Financial Condition', '9.01': 'Financial Statements and Exhibits', '1.01': 'Entry into a Material Definitive Agreement', '3.01': 'Notice of Delisting or Failure to Satisfy a Continued Listing Rule', '8.01': 'Other Events' };
const T0 = Date.now();
function atom(type) {
  let out = '<?xml version="1.0"?><feed>';
  forms.forEach(([f, items], i) => {
    if (!f.startsWith(type)) return;
    const c = cos[i % cos.length]; const acc = `00000${String(i).padStart(2, '0')}234-26-0000${String(i).padStart(2, '0')}`;
    const t = new Date(T0 - i * 7 * 60e3 - 13e3).toISOString().replace('Z', '-00:00');
    const sum = ` &lt;b&gt;Filed:&lt;/b&gt; 2026-09-25 &lt;b&gt;AccNo:&lt;/b&gt; ${acc} &lt;b&gt;Size:&lt;/b&gt; 120 KB` + items.map((k) => `&lt;br&gt;Item ${k}: ${IT[k]}`).join('');
    const is13F = f === '13F-HR';
    const role = f === '4' || f === '144' ? 'Issuer' : f.startsWith('SCHEDULE') ? 'Subject' : 'Filer';
    const nm = is13F ? 'CITADEL ADVISORS LLC' : c[1].toUpperCase();
    const cik = is13F ? '0001423053' : String(c[0]).padStart(10, '0');
    out += `<entry><title>${f} - ${nm} (${cik}) (${role})</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${acc}-index.htm"/><summary type="html">${sum}</summary><updated>${t}</updated><id>urn:tag:sec.gov,2008:accession-number=${acc}</id></entry>`;
    if (f === '4' || f === '144') out += `<entry><title>${f} - HUANG JEN HSUN (0001197649) (Reporting)</title><link href="x"/><summary>x</summary><updated>${t}</updated><id>urn:tag:sec.gov,2008:accession-number=${acc}</id></entry>`;
    if (f.startsWith('SCHEDULE')) out += `<entry><title>${f} - ARK INVESTMENT MANAGEMENT LLC (0001697748) (Filed by)</title><link href="x"/><summary>x</summary><updated>${t}</updated><id>urn:tag:sec.gov,2008:accession-number=${acc}</id></entry>`;
  });
  return out + '</feed>';
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const DL = [['삼성전자', '005930', '00126380', 'Y', '연결재무제표기준영업(잠정)실적(공정공시)', '유', '09:05'], ['SK하이닉스', '000660', '00164779', 'Y', '임원ㆍ주요주주특정증권등소유상황보고서', '', '09:12'], ['에코프로비엠', '247540', '01160363', 'K', '주요사항보고서(유상증자결정)', '코', '10:31'], ['알테오젠', '196170', '00980122', 'K', '단일판매ㆍ공급계약체결', '코', '11:02'], ['현대차', '005380', '00164742', 'Y', '주식등의대량보유상황보고서(일반)', '', '13:47'], ['한미반도체', '042700', '00161383', 'Y', '자기주식취득결정', '유', '14:20'], ['두산에너빌리티', '034020', '00159616', 'Y', '[기재정정]단일판매ㆍ공급계약체결', '유정', '15:40']];
const dartList = () => ({ status: '000', message: '정상', list: DL.map(([corp_name, stock_code, corp_code, corp_cls, report_nm, rm], i) => ({ corp_name, stock_code, corp_code, corp_cls, report_nm, rm, rcept_no: today.replace(/-/g, '') + String(800100 - i).padStart(6, '0'), rcept_dt: today.replace(/-/g, ''), flr_nm: i === 4 ? '국민연금공단' : corp_name })) });
const dsac = () => '<tbody>' + DL.slice().reverse().map(([nm, , cc, cls, rep, , hm], j) => { const i = DL.length - 1 - j; return `<tr><td>${hm}</td><td class="tL"><span class="innerWrap"><span class="tagCom_${cls === 'Y' ? 'kospi' : 'kosdaq'}">유</span><a href="javascript:openCorpInfoNew('${cc}', 'w', '/x');">${nm}</a></span></td><td class="tL"><a href="/dsaf001/main.do?rcpNo=${today.replace(/-/g, '') + String(800100 - i).padStart(6, '0')}">${rep}</a></td><td class="tL" title="x">${nm}</td><td>${today.replace(/-/g, '.')}</td><td></td></tr>`; }).join('') + '</tbody>';
function chart(sym) {
  const base = { '^GSPC': 6640, '^IXIC': 22480, '^DJI': 46200, 'NQ=F': 24650, '^VIX': 16.2, '^SOX': 6100, '^KS11': 3410, '^KQ11': 850, 'KRW=X': 1398.5, '^TNX': 4.17, EWY: 78.2 }[sym] || 100;
  const closes = Array.from({ length: 78 }, (_, i) => base * (1 + Math.sin(i / 9 + sym.length) / 300 + (i / 78) * 0.004 * (sym.length % 2 ? 1 : -1)));
  return { chart: { result: [{ meta: { regularMarketPrice: closes.at(-1), chartPreviousClose: base, regularMarketTime: (Date.now() / 1000) | 0 }, indicators: { quote: [{ close: closes }] } }] } };
}
const kisOut = (who) => ({ rt_cd: '0', msg1: '정상', output: DL.slice(0, 6).map(([n, t], i) => ({ hts_kor_isnm: n, mksc_shrn_iscd: t, stck_prpr: String(70000 - i * 9000), prdy_vrss_sign: i % 3 ? '2' : '5', prdy_ctrt: String(1.2 + i / 3), frgn_ntby_qty: String((who === 'sell' ? -1 : 1) * (500000 - i * 70000)), orgn_ntby_qty: String((who === 'sell' ? -1 : 1) * (300000 - i * 40000)), frgn_ntby_tr_pbmn: '35000', orgn_ntby_tr_pbmn: '21000', ssts_cntg_qty: String(120000 - i * 10000), ssts_vol_rlim: String(18.5 - i * 2), ssts_tr_pbmn: '8000' })) });

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const J = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url.includes('company_tickers_exchange')) return J({ fields: ['cik', 'name', 'ticker', 'exchange'], data: cos });
  if (url.includes('browse-edgar')) return new Response(atom(decodeURIComponent(url.match(/type=([^&]*)/)[1])));
  if (url.endsWith('index.json')) return J({ directory: { item: [{ name: 'x-index.html' }, { name: 'form4.xml' }] } });
  if (url.endsWith('form4.xml')) return new Response(url.includes('0000001') ? fx('form4.xml') : fx('form4.xml').replace(/<transactionCode>S</g, '<transactionCode>P<').replace(/HUANG JEN HSUN/, 'SMITH JOHN'));
  if (url.includes('opendart') && url.includes('list.json') && url.includes('pblntf_detail_ty')) return J({ status: '000', list: [{ rcept_no: '20260310002820' }] });
  if (url.includes('opendart') && url.includes('company.json')) return J({ status: '000', corp_name: '삼성전자(주)', corp_name_eng: 'SAMSUNG ELECTRONICS CO,.LTD', stock_code: '005930', ceo_nm: '전영현, 노태문', corp_cls: 'Y', est_dt: '19690113', hm_url: 'www.samsung.com/sec', adres: '경기도 수원시 영통구 삼성로 129' });
  if (url.includes('fnlttSinglAcnt')) return url.includes('bsns_year=2025') ? J({ status: '000', list: [['매출액', '333,605,938,000,000', '300,870,903,000,000', 'IS'], ['영업이익', '43,601,051,000,000', '32,725,961,000,000', 'IS'], ['당기순이익(손실)', '45,206,805,000,000', '34,451,351,000,000', 'IS'], ['자산총계', '514,531,948,000,000', '455,905,980,000,000', 'BS'], ['자본총계', '402,192,070,000,000', '363,677,865,000,000', 'BS']].map(([account_nm, thstrm_amount, frmtrm_amount, sj_div]) => ({ account_nm, thstrm_amount, frmtrm_amount, sj_div, fs_div: 'CFS' })) }) : J({ status: '013' });
  if (url.includes('stockTotqySttus')) return J({ status: '000', list: [{ se: '합계', istc_totqy: '5,919,637,922' }] });
  if (url.includes('google.com/finance/quote/')) return new Response('data:[[[["/m/04w0nf",["KOSPI","KRX"],"KOSPI",1,null,[7080.92,63.009766,0.8978423,2,2,2],null,7017.91,null]]]] [["/m/x",[".INX","INDEXSP"],"S\\u0026P 500",1,null,[7743.41,39.28,0.50986,2,2,2],null,7704.13]] [["/m/y",[".DJI","INDEXDJX"],"Dow",1,null,[51828.62,478.64,0.932,2,2,2],null,51349.98]] [["/m/z",[".IXIC","INDEXNASDAQ"],"Nasdaq Composite",1,null,[27068.72,129.34,0.48,2,2,2],null,26939.37]] [["/m/v",["VIX","INDEXCBOE"],"VIX",1,null,[14.87,-0.8,-5.1,2,2,2],null,15.67]] [["/m/s",["SOX","INDEXNASDAQ"],"PHLX Semi",1,null,[12668.93,176.39,1.41,2,2,2],null,12492.54]] [["/m/n",["NQW00","CME_EMINIS"],"E-mini NASDAQ 100",1,null,[30921.75,155,0.5,2,2,2],null,30766.75]] [["/m/t",["TNX","INDEXCBOE"],"10Y",1,null,[41.84,0.22,0.52,2,2,2],null,41.62]] [["/m/r",["RUT","INDEXRUSSELL"],"Russell 2000",1,null,[2837.55,10.1,0.36,2,2,2],null,2827.45]] [["/m/e",["EWY","NYSEARCA"],"EWY",0,"USD",[187.18,4.65,2.55,2,2,2],null,182.53]] [["/m/k",["005930","KRX"],"삼성전자",0,"KRW",[285500,9000,3.25,2,2,2],null,276500]] [["/g/x",null,"USD / KRW",3,null,[1354.79,-13.57,-0.99,4,4,2],null,1368.36,null]]');
  if (url.includes('/summary?assetclass=stocks')) return J({ data: { summaryData: { Sector: { value: 'Technology' }, Industry: { value: 'Semiconductors' }, MarketCap: { value: '4,600,000,000,000' } } } });
  if (url.includes('company-profile')) return J({ data: { CompanyName: { value: 'NVIDIA Corporation' }, Sector: { value: 'Technology' }, Industry: { value: 'Semiconductors' }, CompanyDescription: { value: 'NVIDIA Corporation provides graphics, compute and networking solutions. The company operates through Compute & Networking and Graphics segments. It was founded in 1993.' } } });
  if (url.includes('/financials?frequency=')) { const q = url.includes('frequency=2'); const v = (a) => a.map((x) => '$' + x.toLocaleString('en-US')); return J({ data: { incomeStatementTable: { headers: { value2: q ? '7/27/2026' : '1/25/2026' }, rows: [{ value1: 'Total Revenue', ...Object.fromEntries(v(q ? [46743000, 44062000, 39331000, 35082000] : [130497000, 60922000, 26974000, 26914000]).map((x, i) => ['value' + (i + 2), x])) }, { value1: 'Operating Income', ...Object.fromEntries(v(q ? [28440000, 21638000, 24034000, 21869000] : [81453000, 32972000, 4224000, 10041000]).map((x, i) => ['value' + (i + 2), x])) }, { value1: 'Net Income', ...Object.fromEntries(v(q ? [26422000, 18775000, 22091000, 19309000] : [72880000, 29760000, 4368000, 9752000]).map((x, i) => ['value' + (i + 2), x])) }] }, balanceSheetTable: { rows: [{ value1: 'Total Assets', value2: '$161,148,000' }, { value1: 'Total Equity', value2: '$100,129,000' }] } } }); }
  if (url.includes('api.anthropic.com') && opts.body && opts.body.includes('positive')) return J({ content: [{ type: 'text', text: JSON.stringify({ summary: ['2분기(26년) 연결 영업이익 89.4조원, 전년 대비 +1,810%', '매출 171조원으로 전년 대비 +129% 증가', '전분기 대비 영업이익 +56% 성장', '잠정치로 확정 실적과 다를 수 있음'], positive: ['AI 메모리 수요로 사상 최대 이익', '전분기 대비 성장세 지속'], negative: ['잠정치로 확정치와 차이 가능', '높은 기저로 향후 성장률 둔화 우려'], verdict: '긍정', overview: '삼성전자는 반도체(DS)와 스마트폰·가전(DX)을 만드는 글로벌 전자기업입니다. 메모리 반도체 세계 1위입니다.' }) }] });
  if (url.includes('opendart') && url.includes('list.json')) return url.includes('page_no=1') ? J(dartList()) : J({ status: '013', message: '없음' });
  if (url.includes('opendart') && url.includes('elestock')) return J({ status: '000', list: [{ rcept_no: today.replace(/-/g, '') + '800099', rcept_dt: today, repror: '곽노정', isu_exctv_ofcps: '대표이사', sp_stock_lmp_cnt: '12,500', sp_stock_lmp_irds_cnt: '2,500', sp_stock_lmp_rate: '0.00', sp_stock_lmp_irds_rate: '0.00' }] });
  if (url.includes('opendart') && url.includes('majorstock')) return J({ status: '000', list: [{ rcept_no: today.replace(/-/g, '') + '800096', rcept_dt: today, repror: '국민연금공단', report_tp: '일반', stkqy: '15,000,000', stkqy_irds: '1,200,000', stkrt: '7.12', stkrt_irds: '1.05', report_resn: '보유주식등의 수 변동' }] });
  if (url.includes('dsac001/search.ax')) return new Response(dsac());
  if (url.includes('fearandgreed')) return J({ fear_and_greed: { score: 37, rating: 'fear', timestamp: new Date().toISOString(), previous_close: 36.1, previous_1_week: 30.4, previous_1_month: 59.6, previous_1_year: 50.6 }, fear_and_greed_historical: { data: [] } });
  if (url.includes('/v8/finance/chart/')) return J(chart(decodeURIComponent(url.split('/chart/')[1].split('?')[0])));
  if (url.includes('oauth2/tokenP')) return J({ access_token: 'tok', expires_in: 86400 });
  if (url.includes('inquire-price') && url.includes('futureoption')) return J({ rt_cd: '0', output1: { hts_kor_isnm: 'F 202612', futs_prpr: '452.35', futs_prdy_vrss: '3.15', prdy_vrss_sign: '2', futs_prdy_ctrt: '0.70', futs_prdy_clpr: '449.20', acml_vol: '58213', hts_otst_stpl_qty: '301234' } });
  if (url.includes('foreign-institution-total')) return J(kisOut(url.includes('RANK_SORT_CLS_CODE=1') ? 'sell' : 'buy'));
  if (url.includes('ranking/short-sale')) return J(kisOut('buy'));
  if (url.includes('inquire-investor')) return J({ rt_cd: '0', output: Array.from({ length: 8 }, (_, i) => ({ stck_bsop_date: '202609' + String(23 - i).padStart(2, '0'), stck_clpr: String(71000 - i * 300), prsn_ntby_qty: String(-120000 + i * 30000), frgn_ntby_qty: String(90000 - i * 25000), orgn_ntby_qty: String(30000 - i * 5000) })) });
  if (url.includes('daily-short-sale')) return J({ rt_cd: '0', output1: {}, output2: Array.from({ length: 8 }, (_, i) => ({ stck_bsop_date: '202609' + String(23 - i).padStart(2, '0'), stck_clpr: String(71000 - i * 300), ssts_cntg_qty: String(210000 - i * 9000), ssts_vol_rlim: String(4.2 + i / 5) })) });
  if (url.includes('short-interest')) return J({ data: { shortInterestTable: { rows: [{ settlementDate: '09/15/2026', interest: '128,753,092', avgDailyShareVolume: '45,135,477', daysToCover: 2.85 }, { settlementDate: '08/31/2026', interest: '139,749,097', avgDailyShareVolume: '39,537,335', daysToCover: 3.53 }] } } });
  if (url.includes('insider-trades')) return J({ data: { numberOfTrades: { rows: [{ insiderTrade: 'Number of Open Market Buys', months3: '0', months12: '0' }, { insiderTrade: 'Number of Sells', months3: '7', months12: '37' }] }, numberOfSharesTraded: { rows: [{ insiderTrade: 'Net Activity', months3: '(24,860)', months12: '(1,217,466)' }] }, transactionTable: { table: { rows: [{ insider: 'NEWSTEAD JENNIFER', relation: 'Officer', lastDate: '9/15/2026', transactionType: 'Automatic Sell', sharesTraded: '1,438', lastPrice: '$330.19', sharesHeld: '32,914' }] } } } });
  if (url.includes('institutional-holdings')) return J({ data: { ownershipSummary: { SharesOutstandingPCT: { value: '76.57%' } }, activePositions: { rows: [{ positions: 'Increased Positions', holders: '2,882', shares: '331,504,107' }, { positions: 'Decreased Positions', holders: '3,203', shares: '240,666,268' }, { positions: 'Total Institutional Shares', holders: '6,494', shares: '11,174,454,106' }] }, newSoldOutPositions: { rows: [{ positions: 'New Positions', holders: '193', shares: '1' }, { positions: 'Sold Out Positions', holders: '104', shares: '1' }] }, holdingsTransactions: { table: { rows: [{ ownerName: 'Vanguard Group Inc', date: '6/30/2026', sharesHeld: '1,426,283,914', sharesChange: '26,856,752', sharesChangePCT: '1.919%', marketValue: '$479,117,292' }] } } } });
  if (url.includes('api.anthropic.com') && !opts.body.includes('positive')) {
    const body = JSON.parse(opts.body); const ids = [...body.messages[0].content.matchAll(/"id":"(SEC-[^"]+)"/g)].map((m) => m[1]);
    const arr = ids.map((id, k) => ({ id, title: k === 0 ? '2분기 매출 467억달러(+56%)·사상 최대' : 'CFO 10월 말 사임, 후임 선임', sub: k === 0 ? '데이터센터 매출 호조, 3분기 가이던스 상향' : '' }));
    return J({ content: [{ type: 'text', text: JSON.stringify(arr) }] });
  }
  if (url.includes('main.do?rcpNo=20260310002820')) return new Response(`node2['text'] = "1. 사업의 개요";\n node2['rcpNo'] = "20260310002820";\n node2['dcmNo'] = "11104488";\n node2['eleId'] = "10";\n node2['offset'] = "203605";\n node2['length'] = "2305";\n node2['dtd'] = "dart4.xsd";`);
  if (url.includes('viewer.do?rcpNo=20260310002820')) return new Response('<html><body><p>1. 사업의 개요</p><p>당사는 본사를 거점으로 한국과 해외 308개 종속기업으로 구성된 글로벌 전자 기업입니다. DX 부문은 TV, 스마트폰 등을, DS 부문은 DRAM, NAND Flash 등을 생산·판매합니다.</p></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (url.includes('dsaf001/main.do?rcpNo=')) { const rcp = url.split('rcpNo=')[1]; return new Response(`<script>viewDoc("${rcp}", "1234", "0", "0", "0", "dart4.xsd", "");</script>`); }
  if (url.includes('report/viewer.do')) {
    const rcp = url.match(/rcpNo=(\d+)/)[1]; const i = 800100 - Number(rcp.slice(8));
    const f = { 0: 'earn', 2: 'piic', 3: 'supply', 5: 'tsaq', 6: 'corr' }[i];
    if (!f) return new Response('<html><body><table><tr><td>내용 없음</td></tr></table></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const html = '<html><head><title>x</title></head><body><table>' + fx('dart/' + f + '.txt').split('\n').map((l) => `<tr><td><span>${l}</span></td></tr>`).join('') + '</table></body></html>';
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (url.endsWith('-index.htm')) {
    const withEx = /0000000234-26-000000|0000002234-26-000002/.test(url);
    return new Response(withEx
      ? '<table><tr><td>1</td><td><a href="/Archives/x/main8k.htm">main8k.htm</a></td><td>8-K</td></tr><tr><td>2</td><td>PRESS RELEASE</td><td><a href="/Archives/x/ex991.htm">ex991.htm</a></td><td>EX-99.1</td></tr></table>'
      : '<table><tr><td>1</td><td><a href="/Archives/x/main8k.htm">main8k.htm</a></td><td>8-K</td></tr></table>');
  }
  if (url.endsWith('ex991.htm')) return new Response('<html><body><p>Exhibit 99.1</p><p>NVIDIA Announces Financial Results for Second Quarter Fiscal 2027</p><p>Record revenue of $46.7 billion, up 56% from a year ago</p><p>SANTA CLARA, Calif., Aug. 27, 2026 (GLOBE NEWSWIRE) -- NVIDIA reported revenue for the second quarter ended July 27, 2026, of $46.7 billion, up 6% from the previous quarter and up 56% from a year ago.</p></body></html>');
  if (url.endsWith('main8k.htm')) return new Response('<html><body><p>Item 5.02 Departure of Directors or Certain Officers.</p><p>On September 23, 2026, Tesla, Inc. (the "Company") announced that its Chief Financial Officer will step down effective October 31, 2026, and the Board appointed a successor.</p><p>Item 9.01 Financial Statements</p></body></html>');

  // ── 뉴스·보도자료 ──
  const ago = (m) => new Date(Date.now() - m * 60e3).toUTCString();
  const rssOf = (items) => new Response(`<?xml version="1.0"?><rss><channel>${items.map((x) => `<item><title><![CDATA[${x.t}]]></title><link>${x.l}</link><description><![CDATA[${x.d || ''}]]></description><pubDate>${ago(x.m)}</pubDate>${x.c ? `<category domain="https://www.globenewswire.com/rss/stock">${x.c}</category>` : ''}${x.co ? `<dc:contributor>${x.co}</dc:contributor>` : ''}</item>`).join('')}</channel></rss>`);
  if (url.includes('globenewswire.com/RssFeed')) return rssOf([
    { t: 'Mission Success: Rocket Lab Launches 97th Electron Mission', l: 'https://www.globenewswire.com/news-release/a1', d: 'LONG BEACH, Calif. -- Rocket Lab (Nasdaq: RKLB) today launched its 97th Electron mission, deploying a satellite for a commercial customer.', m: 4, c: 'Nasdaq:RKLB', co: 'Rocket Lab' },
    { t: 'SoundHound AI Wins Multi-Year Contract with Major Automaker', l: 'https://www.globenewswire.com/news-release/a2', d: 'SoundHound AI, Inc. (Nasdaq: SOUN) announced a multi-year agreement to deploy its voice AI across 5 million vehicles.', m: 22, c: 'Nasdaq:SOUN', co: 'SoundHound AI' },
    { t: 'Oklo Announces Pricing of $400 Million Public Offering of Class A Common Stock', l: 'https://www.globenewswire.com/news-release/a3', d: 'Oklo Inc. (NYSE: OKLO) announced the pricing of an underwritten public offering.', m: 55, c: 'NYSE:OKLO', co: 'Oklo' },
  ]);
  if (url.includes('prnewswire.com/rss/health')) return rssOf([{ t: 'Palantir and Partner Receive FDA Breakthrough Device Designation for AI Diagnostic', l: 'https://www.prnewswire.com/news-releases/p1.html', d: 'DENVER -- Palantir Technologies Inc. (NYSE: PLTR) announced the FDA granted Breakthrough Device designation.', m: 9 }]);
  if (url.includes('prnewswire.com/rss/')) return rssOf(url.includes('technology') ? [{ t: 'Robinhood Reports Record September Operating Data', l: 'https://www.prnewswire.com/news-releases/p2.html', d: 'MENLO PARK -- Robinhood Markets, Inc. (NASDAQ: HOOD) reported record funded customers and assets.', m: 31 }] : []);
  if (url.includes('newswire.co.kr/rss')) return rssOf([
    { t: 'SK하이닉스, 차세대 HBM4E 샘플 공급 개시', l: 'https://www.newswire.co.kr/newsRead.php?no=1', d: 'SK하이닉스가 주요 고객사에 HBM4E 샘플 공급을 시작했다고 밝혔다.', m: 12 },
    { t: 'SK hynix begins HBM4E sampling', l: 'https://www.newswire.co.kr/newsRead.php?no=2', d: 'English version', m: 12 },
    { t: '셀트리온, 유럽서 신규 바이오시밀러 품목허가 획득', l: 'https://www.newswire.co.kr/newsRead.php?no=3', d: '셀트리온이 유럽 집행위원회로부터 품목허가를 받았다.', m: 40 },
  ]);
  if (url.includes('news.google.com/rss')) {
    const q = decodeURIComponent(url.split('q=')[1].split('&')[0]);
    const kr = [['[특징주] 삼성전자, 외국인 순매수에 3%대 강세 - 한국경제', 6], ['에코프로비엠, 유상증자 결정에 주가 급락 - 머니투데이', 18], ['현대차, 美 관세 우려에 약세…실적 하향 우려 - 연합뉴스', 26], ['코스피, 반도체 강세에 7,000선 회복 마감 - 조선비즈', 70]];
    const us = [['엔비디아, 사상 최대 실적 기대에 신고가 - 서울경제', 15], ['뉴욕증시, 기술주 반등에 나스닥 1% 상승 마감 - 연합뉴스', 95], ['테슬라, 로보택시 확대 발표 후 급등 - 매일경제', 48]];
    const list = /뉴욕|미국|나스닥/.test(q) ? us : /특징주/.test(q) ? kr : [];
    return rssOf(list.map(([t, m], i) => ({ t, l: 'https://news.google.com/rss/articles/' + encodeURIComponent(t).slice(0, 20) + i, m })));
  }
  if (/globenewswire\.com\/news-release|prnewswire\.com\/news-releases|newswire\.co\.kr\/newsRead/.test(url)) return new Response('<html><body><article><p>This is the body of the press release, which describes the announcement in detail for investors and customers alike.</p><p>The company expects the agreement to contribute meaningfully to revenue growth over the next three years according to management.</p></article></body></html>');

  // ── 인기 종목·섹터 ──
  if (url.includes('finance.naver.com/sise/lastsearch2')) {
    const rows = [['005930', '삼성전자', '12.3%', '285,500', '9,000', '+3.25%'], ['000660', 'SK하이닉스', '8.1%', '612,000', '12,000', '+2.00%'], ['247540', '에코프로비엠', '5.2%', '98,700', '4,300', '-4.18%'], ['068270', '셀트리온', '4.0%', '201,500', '1,500', '+0.75%'], ['005380', '현대차', '3.1%', '233,000', '3,500', '-1.48%'], ['035420', 'NAVER', '2.9%', '221,000', '0', '0.00%'], ['042700', '한미반도체', '2.5%', '154,300', '7,100', '+4.82%'], ['034020', '두산에너빌리티', '2.2%', '71,200', '900', '+1.28%'], ['012450', '한화에어로스페이스', '2.0%', '1,012,000', '21,000', '-2.03%'], ['373220', 'LG에너지솔루션', '1.8%', '402,500', '2,500', '+0.63%']];
    const html = '<table class="type_5"><tr><th>순위</th><th>종목명</th></tr>' + rows.map((r, i) => `<tr><td class="no">${i + 1}</td><td><a href="/item/main.naver?code=${r[0]}" class="tltle">${r[1]}</a></td><td class="number">${r[2]}</td><td class="number">${r[3]}</td><td class="number"><span class="tah p11">${r[4]}</span></td><td class="number"><span class="tah p11 red01">${r[5]}</span></td><td class="number">1,234,567</td></tr>`).join('') + '</table>';
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (url.includes('api.stocktwits.com')) return J({ symbols: [['QNT.X', 'CRYPTO', 'CRYPTO', 'Quant'], ['PGEN', 'NASDAQ', 'Stock', 'Precigen Inc'], ['B', 'NYSE', 'Stock', 'Barrick Mining Corp'], ['HL', 'NYSE', 'Stock', 'Hecla Mining Co'], ['NVDA', 'NASDAQ', 'Stock', 'NVIDIA Corp'], ['TSLA', 'NASDAQ', 'Stock', 'Tesla Inc'], ['TSM', 'NYSE', 'DepositoryReceipt', 'Taiwan Semiconductor - ADR'], ['LLY', 'NYSE', 'Stock', 'Eli Lilly'], ['TQQQ', 'NASDAQ', 'ExchangeTradedFund', 'ProShares'], ['PLTR', 'NASDAQ', 'Stock', 'Palantir'], ['RKLB', 'NASDAQ', 'Stock', 'Rocket Lab'], ['SOUN', 'NASDAQ', 'Stock', 'SoundHound AI'], ['OKLO', 'NYSE', 'Stock', 'Oklo Inc']].map(([symbol, exchange, instrument_class, title], i) => ({ symbol, exchange, instrument_class, title, rank: i + 1, trends: { summary: i === 1 ? 'Traders are cheering FDA approval news and heavy call buying.' : null } })) });
  if (url.includes('api/screener/stocks')) return J({ data: { rows: [['NVDA', 'Technology', 'Semiconductors'], ['AAPL', 'Technology', 'Computer Manufacturing'], ['TSLA', 'Consumer Discretionary', 'Auto Manufacturing'], ['PLTR', 'Technology', 'Computer Software: Prepackaged Software'], ['AVGO', 'Technology', 'Semiconductors'], ['SOUN', 'Technology', 'Computer Software: Prepackaged Software'], ['RGTI', 'Technology', 'Semiconductors'], ['OKLO', 'Utilities', 'Electric Utilities: Central'], ['CPNG', 'Consumer Discretionary', 'Catalog/Specialty Distribution'], ['HOOD', 'Finance', 'Investment Bankers/Brokers/Service'], ['RKLB', 'Industrials', 'Aerospace'], ['PGEN', 'Health Care', 'Biotechnology: Pharmaceutical Preparations']].concat(Array.from({ length: 1200 }, (_, i) => ['Z' + i, 'Finance', 'Blank Checks'])).map(([symbol, sector, industry]) => ({ symbol, sector, industry })) } });
  if (url.includes('kind.krx.co.kr')) {
    const rows = [['삼성전자', '005930', '통신 및 방송 장비 제조업', '휴대폰, 반도체, TV'], ['SK하이닉스', '000660', '반도체 제조업', 'DRAM, NAND'], ['에코프로비엠', '247540', '일차전지 및 축전지 제조업', '양극재'], ['셀트리온', '068270', '기초 의약물질 제조업', '바이오시밀러'], ['현대차', '005380', '자동차용 엔진 및 자동차 제조업', '자동차'], ['두산에너빌리티', '034020', '구조용 금속제품 제조업', '발전설비'], ['한미반도체', '042700', '특수 목적용 기계 제조업', '반도체 장비'], ['알테오젠', '196170', '자연과학 및 공학 연구개발업', '바이오']].concat(Array.from({ length: 1200 }, (_, i) => ['X' + i, String(900000 + i), '기타 금융업', '']));
    const html = '<table><tr><th>회사명</th><th>시장구분</th><th>종목코드</th><th>업종</th><th>주요제품</th></tr>' + rows.map((r) => `<tr><td>${r[0]}</td><td>유가</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('') + '</table>';
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (url.includes('api/calendar/earnings')) { const d = url.split('date=')[1]; const h = [...d].reduce((a, c) => a + c.charCodeAt(0), 0); return J({ data: { rows: [['NVDA', 'NVIDIA Corporation', '$4,600,000,000,000', '$1.05', 'time-after-hours'], ['CCL', 'Carnival Corporation', '$29,844,654,100', '$1.36', 'time-pre-market'], ['KMX', 'CarMax Inc', '$7,998,109,200', '$0.67', 'time-pre-market'], ['UEC', 'Uranium Energy Corp.', '$4,686,441,500', '($0.04)', 'time-pre-market'], ['TINY', 'Tiny Co', '$98,000,000', '', 'time-not-supplied']].slice(0, 2 + (h % 4)).map(([symbol, name, marketCap, epsForecast, time]) => ({ symbol, name, marketCap, epsForecast, time, noOfEsts: '5', lastYearEPS: '$1.00', fiscalQuarterEnding: 'Aug/2026' })) } }); }
  // ── 현재가 ──
  if (url.includes('/info?assetclass=')) { const t = url.split('/quote/')[1].split('/')[0]; const h = [...t].reduce((a, c) => a + c.charCodeAt(0), 0); return J({ data: { primaryData: { lastSalePrice: '$' + (50 + h % 400).toFixed(2), netChange: ((h % 7) - 3).toFixed(2), percentageChange: (((h % 9) - 4) * 0.83).toFixed(2) + '%' } } }); }
  // ── Gemini ──
  if (url.includes('generativelanguage.googleapis.com')) {
    const prompt = JSON.parse(opts.body).contents[0].parts[0].text;
    let text;
    if (prompt.includes('"positive"')) text = JSON.stringify({ summary: ['핵심 내용: 회사가 발표한 주요 사항을 요약한 첫 번째 줄', '매출·이익 등 숫자가 포함된 두 번째 줄 (+56%)', '계약 금액과 기간을 설명하는 세 번째 줄', '향후 일정과 조건을 설명하는 네 번째 줄', '투자자가 유의할 점을 정리한 다섯 번째 줄'], positive: ['사상 최대 매출로 성장세 확인', '신규 계약으로 향후 매출 가시성 확보'], negative: ['높은 기대치로 차익 실현 가능성', '거시 경기 둔화 리스크'], verdict: '긍정', overview: '이 회사는 반도체·AI 솔루션을 만드는 글로벌 기술 기업입니다.' });
    else if (prompt.includes('"ko"')) { const ids = [...prompt.matchAll(/"id":"((?:PR|NEWS)-[a-z0-9]+)","title":"([^"]+)"/g)]; text = JSON.stringify(ids.map((m) => ({ id: m[1], ko: '[번역] ' + m[2].slice(0, 30) }))); }
    else if (prompt.includes('"headline"')) { const ids = [...prompt.matchAll(/"id":"([A-Z]+-[a-z0-9\-]+)"/g)].slice(0, 5).map((m) => m[1]); text = JSON.stringify({ headline: '반도체 실적 호조와 바이오 허가 소식이 오늘 시장을 이끌었습니다', items: ids.map((id, i) => ({ id, title: '핵심 공시 ' + (i + 1), why: '매출과 이익에 직접 영향', verdict: i % 3 === 2 ? '부정' : '긍정' })) }); }
    else { const ids = [...prompt.matchAll(/"id":"(SEC-[^"]+)"/g)].map((m) => m[1]); text = JSON.stringify(ids.map((id) => ({ id, title: '2분기 매출 467억달러(+56%)·사상 최대', sub: '' }))); }
    return J({ candidates: [{ content: { parts: [{ text }] } }] });
  }
  if (/financialmodelingprep|parqet|finnhub|toss\.im|alphasquare|pstatic\.net\/imgstock/.test(url)) {
    const known = /AAPL|NVDA|TSLA|PLTR|005930|000660/.test(url);
    return known ? new Response(new Uint8Array(600), { headers: { 'content-type': 'image/png' } }) : new Response('nf', { status: 404 });
  }
  return new Response('nope', { status: 404 });
};

const { runSecWatch } = await import('../src/lib/sec-core.mjs');
const { runDartWatch } = await import('../src/lib/dart-core.mjs');
console.log('sec-watch', await runSecWatch());
console.log('dart-watch', await runDartWatch());
console.log('dart-watch #2', await runDartWatch());

const fns = {};
const { setJSON } = await import('../src/lib/store.mjs');
await setJSON('kr/names', { at: Date.now(), list: [{ n: 'SK하이닉스', c: '000660', k: '00164779' }, { n: '에코프로비엠', c: '247540', k: '01160363' }, { n: '삼성전자', c: '005930', k: '00126380' }, { n: '셀트리온', c: '068270', k: '00413046' }, { n: '현대차', c: '005380', k: '00164742' }].sort((a, b) => b.n.length - a.n.length) });
const nw = (await import('../src/functions/news-watch.mjs')).default;
await nw();
for (const f of ['sec', 'dart', 'market', 'flows', 'stock', 'views', 'health', 'logo', 'company', 'doc', 'analyze', 'news', 'quote', 'digest', 'search', 'popular', 'sectors', 'translate', 'earnings']) fns['/api/' + f] = (await import(`../src/functions/${f}.mjs`)).default;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (fns[u.pathname]) {
    let body; if (req.method === 'POST') { body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); }); }
    const r = await fns[u.pathname](new Request('http://x' + req.url, { method: req.method, body, headers: { 'content-type': 'application/json' } }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  const p = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p));
}).listen(process.env.PORT || 8787, () => console.log('listening', process.env.PORT || 8787));
