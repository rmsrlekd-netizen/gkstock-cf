// 로컬 테스트 서버: 실제 서버 함수를 실행하되 외부 API는 가짜 응답(fixture)으로 대체
// 실행: node test/server.mjs  → http://localhost:8787
import http from 'http';
import fs from 'fs';
import path from 'path';
const ISS = (kr) => JSON.stringify({ headline: kr ? '외국인·기관 4조 매도에 반도체 급락, 코스피 6900선 이탈' : '금리 부담 속 마이크론 실적 앞두고 반도체 관망', keywords: kr ? ['반도체 급락', 'LG그룹주', '배당락', '고금리'] : ['마이크론 실적', '10년물 5%', 'AI 인프라'], issues: Array.from({ length: 9 }, (_, i) => ({ tag: ['반도체', '거시경제', '전자', '바이오', '자동차', '방산', '2차전지', '금융', '조선'][i], title: kr ? ['삼전·닉스 5% 급락, 7000선 붕괴', '외국인·기관 4조 매도 폭탄', 'LG그룹주 엔비디아 파트너 선정', 'HLB 담관암 신약 FDA 허가', '현대차 관세 협상 기대', '방산 수주 기대 지속', '에코프로비엠 반등 시도', '분기말 리밸런싱 주의보', '조선 슈퍼사이클 기대'][i] : ['엔비디아 AI 인프라 수요 재확인', '10년물 금리 5.18% 부담', '마이크론 실적 D-2', '테슬라 인도량 발표 임박', '애플 신제품 판매 호조', '방산주 강세 지속', '바이오 FDA 일정 주목', '은행주 금리 수혜', '에너지 유가 반등'][i], sub: '자료 기반의 부연 설명 한 줄이 여기에 들어갑니다', points: ['첫 번째 핵심 내용 — 사실 위주로 짧게 정리', '두 번째 핵심 내용 — 수치는 자료에 있을 때만', '세 번째 핵심 내용 — 시장 반응과 의미'], check: '다음 주 실적 발표와 외국인 수급 전환 여부', tone: ['악재', '악재', '호재', '호재', '중립', '호재', '중립', '중립', '호재'][i], stocks: kr ? [[{ name: '삼성전자', code: '005930' }, { name: 'SK하이닉스', code: '000660' }], [], [{ name: 'LG전자', code: '066570' }], [{ name: 'HLB', code: '028300' }, { name: 'HLB제약', code: '047920' }], [{ name: '현대차', code: '005380' }], [], [{ name: '에코프로비엠', code: '247540' }], [], []][i] : [[{ name: 'NVIDIA', code: 'NVDA' }], [], [{ name: 'Micron', code: 'MU' }], [{ name: 'Tesla', code: 'TSLA' }], [{ name: 'Apple', code: 'AAPL' }], [], [], [{ name: 'JPMorgan', code: 'JPM' }], []][i] })) });
process.env.DART_API_KEY = 'test';
process.env.FINNHUB_API_KEY = 'test';
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
  if (url.includes('fnlttSinglAcnt')) return url.includes('bsns_year=2025') ? J({ status: '000', list: [['매출액', '333,605,938,000,000', '300,870,903,000,000', 'IS'], ['영업이익', '43,601,051,000,000', '32,725,961,000,000', 'IS'], ['당기순이익(손실)', '45,206,805,000,000', '34,451,351,000,000', 'IS'], ['자산총계', '514,531,948,000,000', '455,905,980,000,000', 'BS'], ['자본총계', '402,192,070,000,000', '363,677,865,000,000', 'BS'], ['자본금', '897,514,000,000', '897,514,000,000', 'BS']].map(([account_nm, thstrm_amount, frmtrm_amount, sj_div]) => ({ account_nm, thstrm_amount, frmtrm_amount, sj_div, fs_div: 'CFS' })) }) : J({ status: '013' });
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
  if (url.includes('interval=60m&range=5d')) { const now = Math.floor(Date.now() / 1000); const t = [], c = []; let v = 7700; for (let d = 4; d >= 0; d--) for (let h = 0; h < 7; h++) { t.push(now - d * 86400 - (6 - h) * 3600); v += Math.sin(t.length / 3) * 12 + (Math.random() - .5) * 10; c.push(v); } return J({ chart: { result: [{ meta: {}, timestamp: t, indicators: { quote: [{ close: c }] } }] } }); }
  if (url.includes('/v8/finance/chart/')) return J(chart(decodeURIComponent(url.split('/chart/')[1].split('?')[0])));
  if (url.includes('daily-credit-balance')) return J({ rt_cd: '0', output: [{ deal_date: '20261015', whol_loan_rmnd_stcn: '1234567', whol_loan_rmnd_rate: '4.85' }] });
  if (url.includes('opendart') && url.includes('hyslrSttus')) return url.includes('bsns_year=2026') ? J({ status: '000', list: [{ nm: '홍길동', stock_knd: '보통주', trmend_posesn_stock_qota_rt: '31.20' }, { nm: '에이투자조합', stock_knd: '보통주', trmend_posesn_stock_qota_rt: '13.90' }, { nm: '계', stock_knd: '보통주', trmend_posesn_stock_qota_rt: '45.10' }] }) : J({ status: '013' });
  if (url.includes('opendart') && url.includes('accnutAdtorNmNdAdtOpinion')) return J({ status: '000', list: [{ bsns_year: '2025', adt_opinion: '적정' }] });
  if (url.includes('finance.naver.com/item/news_news.naver')) { const n = Date.now(); const rows = Array.from({ length: 10 }, (_, i) => { const d = new Date(n + 9 * 3600e3 - (i < 6 ? i * 9 : 80 + i * 30) * 3600e3); return `<td class="date"> ${d.toISOString().slice(0, 10).replace(/-/g, '.')} ${d.toISOString().slice(11, 16)}</td>`; }).join(''); return new Response(`<table>${rows}</table>`, { headers: { 'content-type': 'text/html; charset=utf-8' } }); }
  if (url.includes('finance.naver.com/item/board.naver')) { const n = Date.now(); const rows = Array.from({ length: 20 }, (_, i) => { const d = new Date(n + 9 * 3600e3 - (i * 40) * 60e3); return `<td><span>${d.toISOString().slice(0, 10).replace(/-/g, '.')} ${d.toISOString().slice(11, 16)}</span></td>`; }).join(''); return new Response(`<table>${rows}</table>`, { headers: { 'content-type': 'text/html; charset=utf-8' } }); }
  if (url.includes('finance.naver.com/item/sise.naver')) return new Response(`<h4>거래원정보</h4><table summary="거래원정보"><tr><th>매도상위</th><th>거래량</th><th>매수상위</th><th>거래량</th></tr><tr><td>키움증권</td><td>120,000</td><td>유안타증권</td><td>210,000</td></tr><tr><td>미래에셋증권</td><td>90,000</td><td>키움증권</td><td>150,000</td></tr><tr><td>한국투자증권</td><td>60,000</td><td>상상인증권</td><td>80,000</td></tr><tr><td>NH투자증권</td><td>40,000</td><td>한국투자증권</td><td>50,000</td></tr><tr><td>삼성증권</td><td>30,000</td><td>KB증권</td><td>30,000</td></tr></table>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (url.includes('oauth2/tokenP')) return J({ access_token: 'tok', expires_in: 86400 });
  if (url.includes('inquire-price') && url.includes('futureoption')) return J({ rt_cd: '0', output1: { hts_kor_isnm: 'F 202612', futs_prpr: '452.35', futs_prdy_vrss: '3.15', prdy_vrss_sign: '2', futs_prdy_ctrt: '0.70', futs_prdy_clpr: '449.20', acml_vol: '58213', hts_otst_stpl_qty: '301234' } });
  if (url.includes('inquire-index-price')) return J({ rt_cd: '0', output: url.includes('ISCD=0001') ? { bstp_nmix_prpr: '3512.34', bstp_nmix_prdy_vrss: '21.5', prdy_vrss_sign: '2', bstp_nmix_prdy_ctrt: '0.62' } : { bstp_nmix_prpr: '868.12', bstp_nmix_prdy_vrss: '3.1', prdy_vrss_sign: '5', bstp_nmix_prdy_ctrt: '0.36' } });
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
    { t: 'Rosen Law Firm Encourages Oklo Inc. Investors to Inquire About Securities Class Action Investigation - OKLO', l: 'https://www.globenewswire.com/news-release/law1', d: 'NEW YORK -- Rosen Law Firm ... (NYSE: OKLO)', m: 6, c: 'NYSE:OKLO', co: 'Rosen Law Firm' },
    { t: 'Mission Success: Rocket Lab Launches 97th Electron Mission', l: 'https://www.globenewswire.com/news-release/a1', d: 'LONG BEACH, Calif. -- Rocket Lab (Nasdaq: RKLB) today launched its 97th Electron mission, deploying a satellite for a commercial customer.', m: 4, c: 'Nasdaq:RKLB', co: 'Rocket Lab' },
    { t: 'SoundHound AI Wins Multi-Year Contract with Major Automaker', l: 'https://www.globenewswire.com/news-release/a2', d: 'SoundHound AI, Inc. (Nasdaq: SOUN) announced a multi-year agreement to deploy its voice AI across 5 million vehicles.', m: 22, c: 'Nasdaq:SOUN', co: 'SoundHound AI' },
    { t: 'Oklo Announces Pricing of $400 Million Public Offering of Class A Common Stock', l: 'https://www.globenewswire.com/news-release/a3', d: 'Oklo Inc. (NYSE: OKLO) announced the pricing of an underwritten public offering.', m: 55, c: 'NYSE:OKLO', co: 'Oklo' },
  ]);
  if (url.includes('prnewswire.com/rss/health')) return rssOf([{ t: 'Palantir and Partner Receive FDA Breakthrough Device Designation for AI Diagnostic', l: 'https://www.prnewswire.com/news-releases/p1.html', d: 'DENVER -- Palantir Technologies Inc. (NYSE: PLTR) announced the FDA granted Breakthrough Device designation.', m: 9 }]);
  if (url.includes('prnewswire.com/rss/')) return rssOf(url.includes('technology') ? [{ t: 'Robinhood Reports Record September Operating Data', l: 'https://www.prnewswire.com/news-releases/p2.html', d: 'MENLO PARK -- Robinhood Markets, Inc. (NASDAQ: HOOD) reported record funded customers and assets.', m: 31 }] : []);
  if (url.includes('accessnewswire.com/newsroom') && !/newsroom\/[a-z]/.test(url)) {
    const et = (m) => new Date(Date.now() - m * 60e3).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).replace(' at ', ' ').replace(/, (\d{4}),/, ', $1');
    const card = (h, t, sm, m) => `<article class="nr-card x"><h3 class="nr-card-title"><a href="https://www.accessnewswire.com/newsroom/en/${h}">${t}</a></h3><div class="nr-card-meta">${et(m)}</div><p class="nr-card-summary">${sm}</p></article>`;
    return new Response('<html><body>' + card('rklb-1', 'Rocket Lab Signs Launch Agreement', 'Rocket Lab (NASDAQ:RKLB) signed a multi-launch agreement.', 9) + card('x-2', 'Private Co News', 'No ticker here.', 30) + '</body></html>');
  }
  if (url.includes('newswire.co.kr/rss')) return rssOf([
    { t: 'SK하이닉스, 차세대 HBM4E 샘플 공급 개시', l: 'https://www.newswire.co.kr/newsRead.php?no=1', d: 'SK하이닉스가 주요 고객사에 HBM4E 샘플 공급을 시작했다고 밝혔다.', m: 12 },
    { t: 'SK hynix begins HBM4E sampling', l: 'https://www.newswire.co.kr/newsRead.php?no=2', d: 'English version', m: 12 },
    { t: 'Oklo Announces Pricing of $400 Million Public Offering of Class A Common Stock', l: 'https://www.newswire.co.kr/newsRead.php?no=6', d: 'Oklo Inc. (NYSE: OKLO) announced the pricing.', m: 50 },
    { t: 'YY Group Reports First Half 2026 Results', l: 'https://www.newswire.co.kr/newsRead.php?no=7', d: 'SINGAPORE--(BUSINESS WIRE)--YY Group Holding Limited (NASDAQ: YYGH) reported revenue up 26.8%.', m: 55 },
    { t: '셀트리온, 유럽서 신규 바이오시밀러 품목허가 획득', l: 'https://www.newswire.co.kr/newsRead.php?no=3', d: '셀트리온이 유럽 집행위원회로부터 품목허가를 받았다.', m: 40 },
    { t: '로빈후드, 9월 사상 최대 운영 지표 발표', l: 'https://www.newswire.co.kr/newsRead.php?no=4', d: '멘로파크--(Business Wire/뉴스와이어)--로빈후드 마켓(Robinhood Markets, Inc.)(나스닥: HOOD)가 Record September Operating Data 를 발표했다.', m: 20 },
    { t: '심포니AI, 에이전트 기반 리스크 관리 플랫폼 출시', l: 'https://www.newswire.co.kr/newsRead.php?no=5', d: '팔로 알토--(Business Wire/뉴스와이어)--심포니AI(SymphonyAI)는 새 플랫폼을 출시했다.', m: 22 },
  ]);
  if (url.includes('news.google.com/rss')) {
    const q = decodeURIComponent(url.split('q=')[1].split('&')[0]);
    const kr = [['[특징주] 삼성전자, 외국인 순매수에 3%대 강세 - 한국경제', 6], ['에코프로비엠, 유상증자 결정에 주가 급락 - 머니투데이', 18], ['현대차, 美 관세 우려에 약세…실적 하향 우려 - 연합뉴스', 26], ['코스피, 반도체 강세에 7,000선 회복 마감 - 조선비즈', 70]];
    const us = [['엔비디아, 사상 최대 실적 기대에 신고가 - 서울경제', 15], ['뉴욕증시, 기술주 반등에 나스닥 1% 상승 마감 - 연합뉴스', 95], ['테슬라, 로보택시 확대 발표 후 급등 - 매일경제', 48]];
    const list = /뉴욕|미국|나스닥/.test(q) ? us : /특징주/.test(q) ? kr : [];
    return rssOf(list.map(([t, m], i) => ({ t, l: 'https://news.google.com/rss/articles/' + encodeURIComponent(t).slice(0, 20) + i, m })));
  }
  if (/globenewswire\.com\/news-release|prnewswire\.com\/news-releases|newswire\.co\.kr\/newsRead/.test(url)) return new Response('<html><body><article><p>This is the body of the press release, which describes the announcement in detail for investors and customers alike.</p><p>The company expects the agreement to contribute meaningfully to revenue growth over the next three years according to management.</p></article></body></html>');

  // ── 네이버 증권 JSON ──
  if (url.includes('api.stock.naver.com/news/stock/')) { const code = url.split('/news/stock/')[1].split('?')[0]; const now = new Date(Date.now() + 9 * 3600e3); const dt = (m) => new Date(now - m * 60e3).toISOString().replace(/[-T:]/g, '').slice(0, 12); return J([{ total: 6, items: [{ id: code + '1', officeId: '009', articleId: '0005740573', officeName: '매일경제', datetime: dt(15), title: code === '028300' || code === '047920' ? 'HLB, 담관암 신약 ‘리픽투’ FDA 허가 소식에 그룹주 줄줄이 상한가' : '삼성전기, AI 서버용 MLCC 수요 급증 기대', body: '28일 오전 9시 20분 현재 주가가 급등하고 있다.', mobileNewsUrl: 'https://n.news.naver.com/mnews/article/009/0005740573' }] }, { total: 1, items: [{ id: code + '2', officeId: '081', articleId: '0003683870', officeName: '서울신문', datetime: dt(40), title: '[서울데이터랩]개장 직후 인기 검색 종목 20選', body: '', mobileNewsUrl: 'https://n.news.naver.com/mnews/article/081/0003683870' }] }]); }
  if (url.includes('api.stock.naver.com/news/worldStock/')) { const rc = url.split('/worldStock/')[1].split('?')[0]; const dt = new Date(Date.now() + 9 * 3600e3 - 30 * 60e3).toISOString().replace(/[-T:]/g, '').slice(0, 14); return J(rc.endsWith('.O') || rc.endsWith('.N') ? [{ type: 0, oid: 'fnGuide', aid: '1' + rc, ohnm: '로이터', tit: `${rc.split('.')[0]}, 대형 공급 계약 체결 소식에 급등`, subcontent: '회사는 대형 고객사와 다년 공급 계약을 체결했다고 밝혔다.', dt }] : []); }
  if (/m\.stock\.naver\.com\/api\/stocks\/(up|down)\/all/.test(url)) { const dn = url.includes('/down/'); return J({ stocks: [['047920','HLB제약',9620,30.0,3155e8],['003580','HLB글로벌',2055,29.82,1041e8],['028300','HLB',41300,29.95,52880e8],['099999','초소형',500,29.9,50e8],['042700','한미반도체',154300,12.4,14e12],['005930','삼성전자',285500,3.1,1705e12],['000660','SK하이닉스',612000,2.5,445e12],['247540','에코프로비엠',98700,6.1,9.6e12],['068270','셀트리온',201500,1.7,43e12],['005380','현대차',233000,4.4,48e12],['035420','NAVER',221000,5.2,35e12],['012450','한화에어로스페이스',1012000,7.3,51e12]].map(([itemCode, stockName, p, r, mv]) => ({ stockType: 'domestic', stockEndType: 'stock', itemCode, stockName, closePriceRaw: String(p), compareToPreviousClosePriceRaw: String(Math.round(p * r / 100)), compareToPreviousPrice: { code: dn ? '5' : '2' }, fluctuationsRatio: String(dn ? -r : r), marketValueRaw: String(mv), marketValueHangeul: '1조', accumulatedTradingValueKrwHangeul: '100억원' })) }); }
  if (/api\.stock\.naver\.com\/stock\/nation\/USA\/(up|down)/.test(url)) { const dn = url.includes('/down'); return J({ stocks: [['MSGY','MSGY.O','메이슨글로리',8.07,309.6,2e7],['AESI','AESI.N','아틀라스 에너지 솔루션스',12.3,13.47,1.56e9],['PPLI','PPLI.O','피플 인코포레이티드',22.1,11.33,2.98e9],['WNC','WNC.N','와바시 내셔널',12.1,11.27,5.31e8],['GENI','GENI.N','지니어스 스포츠',8.8,11.03,1.79e9],['ALM','ALM.O','알몬티 인더스트리스',9.9,10.65,3.95e9],['MXL','MXL.O','맥스리니어',12.2,10.0,8.51e9],['VECO','VECO.O','비코 인스트루먼츠',33.2,9.28,3.04e9],['VIAV','VIAV.O','비아비 솔루션스',14.6,9.27,1e10],['NVDA','NVDA.O','엔비디아',225.07,5.1,5e12],['TSLA','TSLA.O','테슬라',372.1,4.8,1.2e12],['AMD','AMD.O','AMD',230.6,4.2,3.7e11]].map(([symbolCode, reutersCode, stockName, p, r, mv]) => ({ stockType: 'worldstock', stockEndType: 'stock', symbolCode, reutersCode, stockName, closePriceRaw: String(p), compareToPreviousClosePriceRaw: String((p * r / 100).toFixed(2)), compareToPreviousPrice: { code: dn ? '5' : '2' }, fluctuationsRatio: String(dn ? -r : r), marketValueRaw: String(mv), marketValueHangeul: '10억 USD' })) }); }
  if (url.includes('m.stock.naver.com/api/stocks/searchTop')) return J({ stocks: [['005930', '삼성전자', '285,500', '9,000', '3.25', '2', '1,705조 2,113억'], ['000660', 'SK하이닉스', '612,000', '12,000', '2.00', '2', '445조'], ['247540', '에코프로비엠', '98,700', '4,300', '-4.18', '5', '9조 6,500억'], ['068270', '셀트리온', '201,500', '1,500', '0.75', '2', '43조'], ['005380', '현대차', '233,000', '3,500', '-1.48', '5', '48조'], ['035420', 'NAVER', '221,000', '0', '0.00', '3', '35조'], ['042700', '한미반도체', '154,300', '7,100', '4.82', '2', '14조'], ['034020', '두산에너빌리티', '71,200', '900', '1.28', '2', '45조'], ['012450', '한화에어로스페이스', '1,012,000', '21,000', '-2.03', '5', '51조'], ['373220', 'LG에너지솔루션', '402,500', '2,500', '0.63', '2', '94조']].map(([itemCode, stockName, closePrice, cmp, fluctuationsRatio, code, marketValueHangeul]) => ({ stockType: 'domestic', itemCode, stockName, closePrice, closePriceRaw: closePrice.replace(/,/g, ''), compareToPreviousClosePrice: cmp, compareToPreviousPrice: { code }, fluctuationsRatio: fluctuationsRatio.replace('-', ''), marketValueHangeul })) });
  if (url.includes('stock.naver.com/api/domestic/market/searchTop')) return J(['NVDA.O', 'TSLA.O', 'PLTR.O', 'AAPL.O', 'SOUN.O', 'OKLO.N', 'RGTI.O', 'HOOD.O', 'AVGO.O', 'CPNG.N'].map((reutersCode) => ({ nationType: 'USA', reutersCode })));
  if (url.includes('polling.finance.naver.com/api/realtime/worldstock/stock/')) {
    const KO = { NVDA: '엔비디아', TSLA: '테슬라', PLTR: '팔란티어', AAPL: '애플', SOUN: '사운드하운드 AI', OKLO: '오클로', RGTI: '리게티 컴퓨팅', HOOD: '로빈후드', AVGO: '브로드컴', CPNG: '쿠팡' };
    const codes = decodeURIComponent(url.split('/stock/')[1].split('?')[0]).split(',');
    return J({ datas: codes.map((rc) => { const t = rc.split('.')[0]; const h = [...t].reduce((a, c) => a + c.charCodeAt(0), 0); const pct = ((h % 13) - 6) * 0.91; return { reutersCode: rc, symbolCode: t, stockName: KO[t] || t, closePrice: (50 + h % 400).toFixed(2), compareToPreviousClosePrice: Math.abs(pct).toFixed(2), fluctuationsRatio: Math.abs(pct).toFixed(2), compareToPreviousPrice: { code: pct < 0 ? '5' : pct > 0 ? '2' : '3' } }; }) });
  }
  if (url.includes('polling.finance.naver.com/api/realtime/domestic/stock/')) {
    const codes = decodeURIComponent(url.split('/stock/')[1].split('?')[0]).split(',');
    return J({ datas: codes.map((c) => { const h = [...c].reduce((a, x) => a + x.charCodeAt(0) * 7, 0); const pct = ((h % 15) - 7) * 0.87; return { itemCode: c, stockName: c, closePrice: String(10000 + h * 13), closePriceRaw: String(10000 + h * 13), fluctuationsRatio: Math.abs(pct).toFixed(2), compareToPreviousPrice: { code: pct < 0 ? '5' : '2' } }; }) });
  }
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
  if (url.includes('api/calendar/economicevents')) { const d = url.split('date=')[1]; const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); const done = d < today || d === today; const rows = [['08:30', 'Core CPI (MoM)', '0.4%', '0.3%', '0.3%'], ['08:30', 'CPI (YoY)', '3.1%', '3.0%', '2.9%'], ['08:30', 'Initial Jobless Claims', '197K', '201K', '198K'], ['10:00', 'JOLTS Job Openings', '7.10M', '7.23M', '7.27M'], ['10:00', 'CB Consumer Confidence', '88.2', '90.1', '89.4'], ['14:00', 'Fed Interest Rate Decision', '4.25%', '4.25%', '4.50%'], ['13:00', 'FOMC Member Barkin Speaks', '', '', '']].map(([gmt, eventName, a, c, p], i) => ({ gmt, country: 'United States', eventName, actual: done && (d < today || i < 3) ? a : '&nbsp;', consensus: c || ' ', previous: p || '&nbsp;', description: '' })); return J({ data: { rows: [...rows, { gmt: '02:00', country: 'Germany', eventName: 'GfK', actual: '1', consensus: '', previous: '' }, { gmt: '19:00', country: 'South Korea', eventName: 'CPI', actual: '&nbsp;', consensus: '2.1%', previous: '2.0%' }, { gmt: '19:00', country: 'South Korea', eventName: 'Industrial Production', actual: '&nbsp;', consensus: '0.5%', previous: '-0.3%' }, { gmt: '21:30', country: 'China', eventName: 'Manufacturing PMI', actual: '&nbsp;', consensus: '49.8', previous: '49.5' }] } }); }
  if (url.includes('api.nasdaq.com/api/quote/watchlist')) { const syms = [...url.matchAll(/symbol=([a-z]+)%7Cetf/gi)].map((m) => m[1].toUpperCase()); return J({ data: syms.map((s, i) => ({ symbol: s, lastSalePrice: '$' + (50 + i * 3).toFixed(2), percentageChange: ((i * 37 % 11) - 5) / 2.3 + '%' })) }); }
  if (/m\.stock\.naver\.com\/api\/stocks\/(theme|industry)\?/.test(url)) { const th = url.includes('/theme?'); const names = th ? ['의료AI', '유전자 치료제/분석', 'HLB그룹', '반도체 장비', '2차전지', '원자력발전', '조선', '방산', '로봇', '우주항공', '엔터', '게임', '화장품', '건설', '은행', '보험', '철강', '해운', '항공', '음식료'] : ['건강관리기술', '건강관리장비와용품', '반도체와반도체장비', '전자장비와기기', '조선', '은행', '화학', '철강', '건설', '자동차', '통신장비', '제약', '보험', '증권', '항공사']; return J({ groups: names.map((name, i) => ({ no: 500 + i, name, totalCount: 10 + i, changeRate: (8 - i * 0.9).toFixed(2), riseCount: Math.max(0, 10 - i), fallCount: Math.min(10 + i, i + 1), steadyCount: 0 })) }); }
  if (/m\.stock\.naver\.com\/api\/stocks\/(theme|industry)\/\d+/.test(url)) { return J({ stocks: [['394800', '쓰리빌리언', 7540, 30, '1'], ['028300', 'HLB', 41300, 29.95, '1'], ['005930', '삼성전자', 285500, 3.1, '2'], ['000660', 'SK하이닉스', 612000, -1.5, '5'], ['068270', '셀트리온', 201500, 1.7, '2']].map(([itemCode, stockName, p, r, code]) => ({ stockType: 'domestic', itemCode, stockName, closePriceRaw: String(p), fluctuationsRatio: String(Math.abs(r)), compareToPreviousPrice: { code }, accumulatedTradingValueKrwHangeul: '100억원' })) }); }
  if (url.includes('api/calendar/earnings')) { const d = url.split('date=')[1]; const h = [...d].reduce((a, c) => a + c.charCodeAt(0), 0); return J({ data: { rows: [['NVDA', 'NVIDIA Corporation', '$4,600,000,000,000', '$1.05', 'time-after-hours'], ['CCL', 'Carnival Corporation', '$29,844,654,100', '$1.36', 'time-pre-market'], ['KMX', 'CarMax Inc', '$7,998,109,200', '$0.67', 'time-pre-market'], ['UEC', 'Uranium Energy Corp.', '$4,686,441,500', '($0.04)', 'time-pre-market'], ['TINY', 'Tiny Co', '$98,000,000', '', 'time-not-supplied']].slice(0, 2 + (h % 4)).map(([symbol, name, marketCap, epsForecast, time]) => ({ symbol, name, marketCap, epsForecast, time, noOfEsts: '5', lastYearEPS: '$1.00', fiscalQuarterEnding: 'Aug/2026' })) } }); }
  // ── 현재가 ──
  if (url.includes('/info?assetclass=')) { const t = url.split('/quote/')[1].split('/')[0]; const h = [...t].reduce((a, c) => a + c.charCodeAt(0), 0); return J({ data: { primaryData: { lastSalePrice: '$' + (50 + h % 400).toFixed(2), netChange: ((h % 7) - 3).toFixed(2), percentageChange: (((h % 9) - 4) * 0.83).toFixed(2) + '%' } } }); }
  if (url.includes('api.stock.naver.com/news/mainnews')) { const n = Date.now() + 9 * 3600e3; const dt = (m) => new Date(n - m * 60e3).toISOString().replace(/[-T:]/g, '').slice(0, 14); return J([['외인·기관 4조 매도 폭탄…삼전닉스 5% 폭락에 6900선 붕괴', 5], ['[속보] 엔비디아 짝꿍…약세장서 LG그룹주 날았다', 9], ['HLB, 담관암 신약 FDA 허가…그룹주 상한가', 30]].map(([t, m], i) => ({ tit: t, subcontent: t + ' 관련 기사 요약', ohnm: '한국경제', oid: '015', aid: String(i), dt: dt(m) }))); }
  if (url.includes('api.stock.naver.com/news/worldNews')) { const n = Date.now() + 9 * 3600e3; const dt = (m) => new Date(n - m * 60e3).toISOString().replace(/[-T:]/g, '').slice(0, 14); return J([{ tit: '마이크론 실적 앞두고 뉴욕증시 반도체 관망', subcontent: '뉴욕 로이터', dt: dt(20), relatedItems: [{ reutersCode: 'MU.O', itemName: '마이크론', fluctuationsRatio: '-1.2' }] }, { tit: '프랑스 대선 관련 보도', subcontent: '파리', dt: dt(30), relatedItems: [] }]); }
  if (url.includes('38.co.kr/html/fund/index.htm?o=k')) return new Response(fs.readFileSync(new URL('./fx/38k.html', import.meta.url)));
  if (url.includes('38.co.kr/html/fund/index.htm?o=nw')) return new Response(fs.readFileSync(new URL('./fx/38nw.html', import.meta.url)));
  if (url.includes('api.nasdaq.com/api/ipo/calendar')) { const t = new Date(Date.now() + 86400e3); const md = `${t.getMonth() + 1}/${t.getDate()}/${t.getFullYear()}`; return J({ data: { upcoming: { upcomingTable: { rows: [{ proposedTickerSymbol: 'OURA', companyName: 'Oura Inc.', proposedExchange: 'NASDAQ Global Select', proposedSharePrice: '40.00-44.00', expectedPriceDate: md, dollarValueOfSharesOffered: '$2,530,000,000' }, { proposedTickerSymbol: 'TLACU', companyName: 'Three Lions Acquisition Corp.', proposedExchange: 'NASDAQ Global', proposedSharePrice: '10.00', expectedPriceDate: md, dollarValueOfSharesOffered: '$100,000,000' }] } }, priced: { rows: [] } } }); }
  if (url.includes('fchart.stock.naver.com/sise.nhn')) { // 가짜 일봉 170개 (박스권 → 최근 거래 증가)
    if (url.includes('symbol=007610')) { // 급등→급락 (선도전기 비슷)
      const rows = []; let t = Date.now() - 300 * 86400e3; const P = (c, v) => { const ymd = new Date(t).toISOString().slice(0, 10).replace(/-/g, ''); t += 1.4 * 86400e3; rows.push(`<item data="${ymd}|${c}|${Math.round(c * 1.04)}|${Math.round(c * 0.96)}|${c}|${v}" />`); };
      for (let i = 0; i < 60; i++) P(3100 + (i % 5) * 40, 150000 + (i % 3) * 30000 + i * 1500);
      for (let i = 0; i < 40; i++) P(Math.round(3300 * Math.pow(1.042, i)), 3000000);
      for (let i = 0; i < 110; i++) P(Math.round(16000 * Math.pow(0.986, i)), i < 30 ? 1500000 : 300000);
      for (let i = 0; i < 15; i++) P(Math.round(3440 * (1 + i * 0.025)), 700000 + i * 30000); // 바닥 뒤 반등
      return new Response(`<protocol><chartdata>${rows.join('')}</chartdata></protocol>`);
    }
    const rows = []; let c = 5000; const t0 = Date.now() - 250 * 86400e3;
    for (let i = 0; i < 170; i++) { const d = new Date(t0 + i * 1.45 * 86400e3); const ymd = d.toISOString().slice(0, 10).replace(/-/g, ''); c = Math.round(c * (1 + Math.sin(i / 7) * 0.012)); const v = i > 120 ? 400000 + (i % 5) * 90000 : 150000 + (i % 7) * 20000; if (i === 140) { const o = Math.round(c * 0.97); c = Math.round(c * 1.07); rows.push(`<item data="${ymd}|${o}|${Math.round(c * 1.01)}|${Math.round(o * 0.995)}|${c}|${v * 6}" />`); continue; } rows.push(`<item data="${ymd}|${c}|${Math.round(c * 1.03)}|${Math.round(c * 0.97)}|${c}|${v}" />`); }
    return new Response(`<protocol><chartdata>${rows.join('')}</chartdata></protocol>`);
  }
  // ── Gemini ──
  if (url.includes('generativelanguage.googleapis.com')) {
    const prompt = JSON.parse(opts.body).contents[0].parts[0].text;
    let text;
    if (prompt.includes('사실 목록')) text = JSON.stringify({ stage: '매집', level: '중간', summary: '박스권에서 거래량이 늘어난 흐름이 확인됨 [F3]. 공시 근거는 확인되지 않음 [F1].', upWhy: ['박스권 거래 증가 흐름 [F3]'], downWhy: [], counter: ['특별한 공시가 없어 정상 거래일 가능성 [F1]'], acc: { period: '', refs: [] }, cost: { refs: [] }, watch: ['CB·3자배정 공시 여부'] });
    else if (prompt.includes('빠르게 알려줘라'))
 text = JSON.stringify({ headline: '3분기 매출 사상 최대, 가이던스 상향', summary: ['3분기 매출 467억달러로 전년 대비 +56%', '데이터센터 부문이 성장 견인', '4분기 매출 가이던스 상향'], verdict: '긍정' });
    else if (prompt.includes('장 마감 브리핑을 쓴다')) text = JSON.stringify({ headline: prompt.includes('미국 증시') ? '금리 부담 속 반도체 강세, 나스닥 0.5% 상승' : '외국인 4조 매도에 코스피 6900선 붕괴', summary: ['나스닥·S&P500 동반 상승, 반도체지수 1.4% 강세', '10년물 금리 5.18%로 부담 지속됐지만 AI주 매수세', '장 마감 후 마이크론 실적 기대감 선반영'], sectors: { up: [{ name: '반도체', why: 'AI 서버 수요 기대' }, { name: '전력기기', why: '데이터센터 투자' }], down: [{ name: '리츠', why: '금리 부담' }] }, movers: [{ name: 'NVIDIA', code: 'NVDA', why: 'AI 인프라 수요 재확인' }, { name: 'Micron', code: 'MU', why: '실적 발표 앞두고 기대' }], next: [{ title: '반도체 대형주 반등 여부', desc: '미 반도체 강세가 삼성전자·SK하이닉스 수급 개선으로 이어질지', targets: ['삼성전자', 'SK하이닉스', '한미반도체'] }, { title: '전력기기 강세 연동', desc: '미국 데이터센터 전력 투자 수혜주 흐름', targets: ['HD현대일렉트릭', 'LS ELECTRIC'] }, { title: '환율 1,360원대 수급', desc: '달러 강세 지속 시 외국인 매도 압력', targets: ['외국인 수급'] }], risk: '미 10년물 금리 추가 상승 시 성장주 부담' });
    else if (prompt.includes('주요 일정을 찾아라')) text = JSON.stringify({ events: [{ time: '10:00', title: '대통령 주재 메가프로젝트 3차 민관합동 점검회의', desc: 'AI·반도체·에너지 대형 프로젝트 지원책 발표 가능성', tag: '정부', stocks: ['반도체', '전력기기'], imp: 3 }, { time: '09:00', title: '빅웨이브로보틱스·글로벌테크놀로지 신규 상장', desc: '공모주 첫날 흐름이 IPO 시장 분위기 가늠자', tag: '기업', stocks: ['빅웨이브로보틱스'], imp: 2 }, { time: null, title: '분기말 배당 기준일', desc: '배당주 막차 수요와 배당락 영향', tag: '지표', stocks: [], imp: 2 }] });
    else if (prompt.includes('꼭 챙겨볼 일정')) text = JSON.stringify({ headline: '물가·실적·대형 IPO가 겹친 하루', points: [{ title: '소비자물가(CPI) 발표', why: '금리 인하 기대를 좌우할 핵심 물가 지표라 장 초반 변동성 확대 가능' }, { title: '대형 IPO 상장', why: '올해 최대 규모 공모주로 신규 상장주 투자심리 가늠자' }, { title: '반도체 대형주 실적', why: 'AI 수요 가이던스에 따라 업종 전체 방향성 결정' }] });
    else if (prompt.includes('주요 이슈 6')) text = ISS(prompt.includes('국장'));
    else if (prompt.includes('[[0]]')) { const ps = [...prompt.matchAll(/\[\[(\d+)\]\] (.*)/g)]; text = ps.map((m) => `[[${m[1]}]] (번역) ${m[2].length > 40 ? '이 문단은 영어 원문을 한국어로 옮긴 번역문입니다. 회사는 투자자와 고객에게 이번 발표 내용을 자세히 설명했습니다.' : m[2]}`).join('\n'); }
    else if (prompt.includes('"positive"')) text = JSON.stringify({ summary: ['핵심 내용: 회사가 발표한 주요 사항을 요약한 첫 번째 줄', '매출·이익 등 숫자가 포함된 두 번째 줄 (+56%)', '계약 금액과 기간을 설명하는 세 번째 줄', '향후 일정과 조건을 설명하는 네 번째 줄', '투자자가 유의할 점을 정리한 다섯 번째 줄'], positive: ['사상 최대 매출로 성장세 확인', '신규 계약으로 향후 매출 가시성 확보'], negative: ['높은 기대치로 차익 실현 가능성', '거시 경기 둔화 리스크'], verdict: '긍정', analyst: '데이터센터 매출이 전년 대비 +56% 늘며 시장 기대를 웃돌았고, 마진 개선이 동반돼 이익의 질도 좋아졌습니다. 다만 높아진 기대치가 이미 주가에 반영돼 단기 상승 폭은 제한될 수 있습니다.', points: [{ t: '숫자로 본 의미', d: '매출 467억달러는 연매출 1,305억달러의 36% 수준으로, 분기 기준 사상 최대입니다.' }, { t: '섹터 관점', d: '반도체 업종에서 가이던스 상향은 통상 1~2주 추가 상승으로 이어졌습니다.' }, { t: '시장이 놓치기 쉬운 점', d: '중국向 매출 비중 언급이 빠져 있어 수출 규제 영향 확인이 필요합니다.' }, { t: '시나리오', d: '상방: 3분기 가이던스 추가 상향. 하방: 고객사 설비투자 둔화 시 재고 조정.' }], impact: { size: '큼', short: '실적 서프라이즈로 강세 가능', mid: '가이던스 달성 여부가 관건' }, overview: '이 회사는 반도체·AI 솔루션을 만드는 글로벌 기술 기업입니다.' });
    else if (prompt.includes('"ko"')) { const ids = [...prompt.matchAll(/"id":"((?:PR|NEWS)-[a-z0-9]+)","title":"([^"]+)"/g)]; text = JSON.stringify(ids.map((m) => ({ id: m[1], ko: '[번역] ' + m[2].slice(0, 30) }))); }
    else if (prompt.includes('"good"')) text = JSON.stringify({ headline: '물가 예상 상회로 금리 인하 기대 후퇴', surprise: '예상 상회', summary: ['근원 CPI가 전월비 0.4%로 예상(0.3%)을 웃돌았습니다.', '연준의 연내 추가 인하 기대가 줄어들 수 있습니다.'], stock: '악재', impact: { size: '보통', text: '장 초반 기술·성장주 중심으로 약세 압력이 예상됩니다.' }, rates: '10년물 금리와 달러가 오를 가능성이 큽니다.', good: [{ sector: '에너지', why: '인플레이션 헤지 수요' }, { sector: '대형 은행', why: '금리 상승 시 이자이익 기대' }], bad: [{ sector: '기술·성장주', why: '할인율 상승 부담' }, { sector: '주택건설·리츠', why: '모기지 금리 상승' }], korea: '원·달러 환율 상승 압력, 외국인 수급 부담.', watch: '다음 주 PCE 물가와 연준 위원 발언.' });
    else if (prompt.includes('"reason"')) text = JSON.stringify(/HLB/.test(prompt) ? { reason: '담관암 신약 FDA 허가 소식에 그룹주 동반 상한가', confidence: '높음', basis: [1] } : { reason: '뚜렷한 개별 뉴스 없음 — 수급·테마 영향 추정', confidence: '낮음', basis: [] });
    else if (prompt.includes('"headline"')) { const ids = [...prompt.matchAll(/"id":"([A-Z]+-[a-z0-9\-]+)"/g)].slice(0, 5).map((m) => m[1]); text = JSON.stringify({ headline: '반도체 실적 호조와 바이오 허가 소식이 오늘 시장을 이끌었습니다', items: ids.map((id, i) => ({ id, title: '핵심 공시 ' + (i + 1), why: '매출과 이익에 직접 영향', verdict: i % 3 === 2 ? '부정' : '긍정' })) }); }
    else { const ids = [...prompt.matchAll(/"id":"(SEC-[^"]+)"/g)].map((m) => m[1]); text = JSON.stringify(ids.map((id) => ({ id, title: '2분기 매출 467억달러(+56%)·사상 최대', sub: '' }))); }
    return J({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: Math.round(prompt.length / 2), candidatesTokenCount: Math.round(String(text).length / 2), thoughtsTokenCount: 300 } });
  }
  if (url.includes('finnhub.io/api/v1/stock/recommendation')) return J([{ period: '2026-09-01', strongBuy: 22, buy: 30, hold: 8, sell: 1, strongSell: 0, symbol: 'NVDA' }, { period: '2026-08-01', strongBuy: 20, buy: 29, hold: 10, sell: 1, strongSell: 0 }, { period: '2026-07-01', strongBuy: 20, buy: 28, hold: 11, sell: 2, strongSell: 0 }, { period: '2026-06-01', strongBuy: 19, buy: 27, hold: 12, sell: 2, strongSell: 1 }]);
  if (url.includes('finnhub.io/api/v1/stock/earnings')) return J([{ actual: 1.3, estimate: 1.23, period: '2026-07-31', quarter: 2, year: 2027, surprisePercent: 5.69 }, { actual: 1.05, estimate: 1.07, period: '2026-04-30', quarter: 1, year: 2027, surprisePercent: -1.87 }, { actual: 0.96, estimate: 0.93, period: '2026-01-31', quarter: 4, year: 2026, surprisePercent: 3.2 }, { actual: 0.81, estimate: 0.81, period: '2025-10-31', quarter: 3, year: 2026, surprisePercent: 0 }]);
  if (url.includes('finnhub.io/api/v1/stock/insider-sentiment')) return J({ data: [4, 5, 6, 7, 8, 9].map((m, i) => ({ year: 2026, month: m, change: [-12000, 3000, -45000, 0, 8000, -2000][i], mspr: [-40, 12, -80, 0, 25, -8][i] })) });
  if (url.includes('finnhub.io/api/v1/stock/metric')) return J({ metric: { peTTM: 45.2 } });
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
await setJSON('kr/names2', { at: Date.now(), list: [{ n: 'SK하이닉스', c: '000660', k: '00164779' }, { n: '에코프로비엠', c: '247540', k: '01160363' }, { n: '삼성전자', c: '005930', k: '00126380' }, { n: '셀트리온', c: '068270', k: '00413046' }, { n: '현대차', c: '005380', k: '00164742' }].sort((a, b) => b.n.length - a.n.length) });
const nw = (await import('../src/functions/news-watch.mjs')).default;
await nw();
await (await import('../src/functions/sec-watch.mjs')).default();
await (await import('../src/functions/dart-watch.mjs')).default();
console.log('econ-watch', JSON.stringify(await (await import('../src/lib/econ.mjs')).econWatch()));
console.log('why-watch', JSON.stringify(await (await import('../src/lib/why.mjs')).whyWatch()));
console.log('issues-watch', JSON.stringify(await (await import('../src/lib/issues.mjs')).issuesWatch()));
await setJSON('react/stats/KR', { at: Date.now(), mk: 'KR', total: 1234, types: [
  { k: 'kr_rights', label: '유상증자', n: 212, avg1: -4.12, med1: -3.1, up1: 24, avg5: -7.8, med5: -6.2, up5: 21 },
  { k: 'kr_supply', label: '공급계약 체결', n: 180, avg1: 2.31, med1: 0.8, up1: 58, avg5: 1.2, med5: -0.4, up5: 47 },
  { k: 'kr_bonus', label: '무상증자', n: 41, avg1: 9.8, med1: 6.1, up1: 78, avg5: 4.4, med5: 2.2, up5: 61 },
  { k: 'kr_cb', label: '전환사채(CB) 발행', n: 150, avg1: -2.2, med1: -1.5, up1: 31, avg5: -4.6, med5: -3.9, up5: 30 } ] });
await setJSON('react/stats/US', { at: Date.now(), mk: 'US', total: 800, types: [ { k: 'us_bio', label: 'FDA·임상 발표', n: 90, avg1: 6.5, med1: 1.2, up1: 55, avg5: 3.1, med5: -1.4, up5: 44 }, { k: 'us_offer', label: '유상증자·공모', n: 120, avg1: -9.1, med1: -7.5, up1: 18, avg5: -14.2, med5: -12, up5: 16 } ] });
{ // VI·서킷 시험 데이터
  const kd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()), ud = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  await setJSON('halts/kr/' + kd, { date: kd, at: Date.now(), items: [
    { id: '028300|09:01:12', code: '028300', name: 'HLB', kind: '동적', on: '09:01:12', off: null, price: 47900, base: 43500, gap: 10.11, dir: 'up' },
    { id: '047920|09:00:05', code: '047920', name: 'HLB제약', kind: '정적', on: '09:00:05', off: '09:02:05', price: 12190, base: 11050, gap: 10.32, dir: 'up' },
    { id: '394800|09:12:40', code: '394800', name: '쓰리빌리언', kind: '동적', on: '09:12:40', off: '09:14:40', price: 6450, base: 7120, gap: -9.41, dir: 'down' },
    { id: '047920|09:25:31', code: '047920', name: 'HLB제약', kind: '동적', on: '09:25:31', off: '09:27:31', price: 12890, base: 11700, gap: 10.17, dir: 'up' } ] });
  await setJSON('halts/us/' + ud, { date: ud, at: Date.now(), items: [
    { id: 'KNRX|x|10:31:02', sym: 'KNRX', name: 'Kneron Holdings', market: 'NASDAQ', date: ud, on: '10:31:02', code: 'LUDP', reason: '급등락 일시정지 (LULD 5분)', rdate: ud, rquote: '10:31:02', off: '10:36:02', luld: true },
    { id: 'SLXN|x|09:45:10', sym: 'SLXN', name: 'Silexion Therapeutics', market: 'NASDAQ', date: ud, on: '09:45:10', code: 'T1', reason: '중요 뉴스 대기', rdate: null, rquote: null, off: null },
    { id: 'NVDA|x|11:02:00', sym: 'NVDA', name: 'NVIDIA Corp', market: 'NASDAQ', date: ud, on: '11:02:00', code: 'LUDP', reason: '급등락 일시정지 (LULD 5분)', rdate: ud, off: '11:07:00', luld: true } ] });
}
console.log('sched-watch', JSON.stringify(await (await import('../src/lib/schedule.mjs')).scheduleWatch()));
for (const f of ['sec', 'dart', 'market', 'flows', 'stock', 'views', 'health', 'logo', 'company', 'doc', 'analyze', 'news', 'quote', 'digest', 'search', 'popular', 'sectors', 'translate', 'translate-doc', 'earnings', 'track', 'admin', 'item', 'archive', 'why', 'themes', 'econ', 'issues', 'schedule', 'halts', 'reaction', 'spark', 'verdicts', 'push', 'earnv', 'cact', 'guru', 'candles']) fns['/api/' + f] = (await import(`../src/functions/${f}.mjs`)).default;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
process.env.ADMIN_KEY = 'test1234';
{ const { setJSON } = await import('../src/lib/store.mjs'); const d = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
  await setJSON('cact/kr', { boot: 1, done: {}, ev: {
    'DART-1': { kind: 'split', mk: 'KR', id: 'DART-1', t: '005930', name: '삼성전자', before: 5000, after: 500, haltFrom: d(2), haltTo: d(6), list: d(7), date: d(7) },
    'DART-2': { kind: 'merge', mk: 'KR', id: 'DART-2', t: '123456', name: '어떤바이오', before: 100, after: 1000, list: d(3), date: d(3), fix: true },
    'DART-3': { kind: 'div', mk: 'KR', id: 'DART-3', t: '000660', name: 'SK하이닉스', record: d(5), date: d(4), amount: 375, kindNote: '분기배당', yield: 0.2 },
    'DART-4': { kind: 'bonus', mk: 'KR', id: 'DART-4', t: '247540', name: '에코프로비엠', record: d(1), date: d(0), ratio: 1, list: d(20) },
    'DART-5': { kind: 'rights', mk: 'KR', id: 'DART-5', t: '068270', name: '셀트리온', method: '주주배정후 실권주 일반공모', price: 12300, record: d(9), date: d(8), sub: [d(30), d(31)], pay: d(36), list: d(45) } } });
  await setJSON('cact/us', { at: Date.now(), split: [{ mk: 'US', kind: 'split', t: 'NVDA', name: 'NVIDIA', ratio: '10 : 1', date: d(3) }, { mk: 'US', kind: 'merge', t: 'SOUN', name: 'SoundHound', ratio: '1 : 20', date: d(1) }], div: [{ mk: 'US', kind: 'div', t: 'AAPL', name: 'Apple', date: d(2), amount: 0.26, pay: d(10), annual: 1.04 }] }); }
{ // 새 기능 가짜 데이터: 컨센서스 TOP · 투자 대가 · 대차잔고
  const { setJSON } = await import('../src/lib/store.mjs');
  const now = Date.now();
  const H = (id, t, n, mk, v, pct, line, b) => [id, { id, t, n, mk, v, pct, b, line, at: now - 3600e3, period: mk === 'KR' ? '26년 3Q' : null }];
  await setJSON('earn/hist', Object.fromEntries([
    H('SEC-1', 'NVDA', 'NVIDIA', 'US', '상회', 12.4, 'EPS $0.92 · 예상 $0.82 (+12.4%) / 매출 $46.7B · 예상 $45.9B (+1.7%)', 'EPS'),
    H('SEC-2', 'AAPL', 'Apple', 'US', '상회', 4.1, 'EPS $1.66 · 예상 $1.59 (+4.1%)', 'EPS'),
    H('SEC-3', 'NKE', 'Nike', 'US', '하회', -18.2, 'EPS $0.45 · 예상 $0.55 (-18.2%)', 'EPS'),
    H('SEC-4', 'INTC', 'Intel', 'US', '하회', -40, 'EPS $0.06 · 예상 $0.10 (-40.0%)', 'EPS'),
    H('DART-9', '005930', '삼성전자', 'KR', '상회', 8.3, '영업이익 12.1조 · 예상 11.2조 (+8.3%)', '영업이익'),
    H('DART-8', '066570', 'LG전자', 'KR', '하회', -12.5, '영업이익 6,889억 · 예상 7,873억 (-12.5%)', '영업이익'),
  ]));
  const rows = [
    { c: '037833100', nm: 'APPLE INC', cls: 'COM', v: 64e9, sh: 280e6, pc: null, pct: 22.3, chg: 'cut', dsh: -20e6, dp: -6.7 },
    { c: '025816109', nm: 'AMERICAN EXPRESS CO', cls: 'COM', v: 45e9, sh: 151e6, pc: null, pct: 15.7, chg: 'same', dsh: 0, dp: 0 },
    { c: '060505104', nm: 'BANK AMER CORP', cls: 'COM', v: 30e9, sh: 600e6, pc: null, pct: 10.4, chg: 'cut', dsh: -80e6, dp: -11.8 },
    { c: '191216100', nm: 'COCA COLA CO', cls: 'COM', v: 28e9, sh: 400e6, pc: null, pct: 9.7, chg: 'same', dsh: 0, dp: 0 },
    { c: '166764100', nm: 'CHEVRON CORP NEW', cls: 'COM', v: 18e9, sh: 120e6, pc: null, pct: 6.3, chg: 'add', dsh: 3e6, dp: 2.6 },
    { c: '91324P102', nm: 'UNITEDHEALTH GROUP INC', cls: 'COM', v: 1.6e9, sh: 5e6, pc: null, pct: 0.6, chg: 'new', dsh: 0, dp: null },
    { c: '999999999', nm: 'SOME PRIVATE HOLDCO', cls: 'COM', v: 0.5e9, sh: 3e6, pc: null, pct: 0.2, chg: 'same', dsh: 0, dp: 0 },
  ];
  await setJSON('guru/h/buffett', { id: 'buffett', acc: 'x', date: '2026-06-30', filed: '2026-08-14', prevDate: '2026-03-31', total: 287e9, n: 41, cnt: { new: 1, add: 1, cut: 2, sold: 1 }, rows, sold: [{ c: '254687106', nm: 'DAVITA INC', cls: 'COM', v: 4e9, sh: 30e6, pc: null, chg: 'sold' }], at: now });
  await setJSON('guru/h/druck', { id: 'druck', acc: 'y', date: '2026-06-30', filed: '2026-08-14', prevDate: '2026-03-31', total: 3.9e9, n: 60, cnt: { new: 12, add: 8, cut: 10, sold: 9 }, rows: [
    { c: '67066G104', nm: 'NVIDIA CORPORATION', cls: 'COM', v: 0.4e9, sh: 2.2e6, pc: null, pct: 10.2, chg: 'new', dp: null },
    { c: '91324P102', nm: 'UNITEDHEALTH GROUP INC', cls: 'COM', v: 0.2e9, sh: 0.6e6, pc: null, pct: 5.1, chg: 'add', dp: 40 },
    { c: '67066G104', nm: 'NVIDIA CORPORATION', cls: 'COM', v: 0.05e9, sh: 0.3e6, pc: 'CALL', pct: null, chg: 'new', dp: null }], sold: [], at: now });
  await setJSON('guru/cusip', { '037833100': 'AAPL', '025816109': 'AXP', '060505104': 'BAC', '191216100': 'KO', '166764100': 'CVX', '91324P102': 'UNH', '67066G104': 'NVDA', '254687106': 'DVA', '999999999': '' });
  await setJSON('loan/kr', { at: now, date: '20261012', items: [
    { t: '005930', name: '삼성전자', bal: 120e6, amt: 120e6 * 61000, d1: 1e6, d5: 4e6, d5p: 3.4, price: 61000, pct: -1.2 },
    { t: '000660', name: 'SK하이닉스', bal: 30e6, amt: 30e6 * 230000, d1: -2e5, d5: 2.5e6, d5p: 9.1, price: 230000, pct: 2.1 },
    { t: '247540', name: '에코프로비엠', bal: 9e6, amt: 9e6 * 113400, d1: 3e5, d5: -1e5, d5p: -1.1, price: 113400, pct: -1.9 },
    { t: '030200', name: 'KT', bal: 20e6, amt: 20e6 * 49400, d1: 5e5, d5: 3e6, d5p: 17.6, price: 49400, pct: -1.0 },
  ] });
  await setJSON('vnote/KR/2026-10-15', { v: 2, mk: 'KR', date: '2026-10-15', at: now, edId: null, summary: '양대 지수 7%대 폭락과 서킷브레이커 발동 속 대형주 급락', overview: '코스피·코스닥이 동반 7%대 급락하며 양 시장에 서킷브레이커가 발동됨. 외국인 대규모 순매도와 반도체 대형주 급락이 지수 하락을 주도함. 신용잔고 급증으로 반대매매 우려가 커짐.', ix: [{ label: '코스피', price: 5554.22, pct: -7.57 }, { label: '코스닥', price: 760.82, pct: -7.65 }],
    sections: [{ title: '양대 지수 동반 서킷브레이커', body: '코스피·코스닥 모두 7%대 급락하며 거래가 일시 중단됨. 4월 이후 최저치.', facts: ['코스피 5,554.22 (-7.57%)', '코스닥 760.82 (-7.65%)'], stocks: [] }, { title: '반도체 투톱 두 자릿수 안팎 급락', body: 'AI 회의론과 외국인 매도가 반도체 대표주에 집중됨.', facts: ['삼성전자 -9.70%', 'SK하이닉스 -11.28%'], stocks: ['삼성전자', 'SK하이닉스'] }, { title: '에스원 대규모 자사주 소각', body: '폭락장 속 4,500억 원 규모 주주환원 발표로 13%대 급등.', facts: ['자사주 공개매수 4,500억 원'], stocks: ['에스원'] }],
    themes: { strong: ['방어주·주주환원주 — 하락장 피난처'], weak: ['반도체 기판 -13.7% — AI 투자 우려'] }, earnings: ['삼성전자 · 컨센서스 부합 · 영업이익 12.1조'], checks: ['미국 금리·AI 관련 뉴스', '신용 반대매매 물량'], up: [], down: [] });
  await setJSON('vnote/KR/2026-10-12', { mk: 'KR', date: '2026-10-12', at: now, edId: null, summary: '반도체 강세 속 코스피 2% 상승, 조선주 차익실현', hook: '오늘 코스피가 2% 넘게 올랐는데, 진짜 주인공은 따로 있었습니다.', topics: [
    { title: '삼성전자 실적 서프라이즈', why: '영업이익이 예상보다 8% 높게 나와 반도체 전체가 들썩였습니다', facts: ['영업이익 12.1조 · 예상 11.2조 (+8.3%)', '주가 +3.2%'], angle: '메모리 가격 반등이 진짜인지 숫자로 확인', tickers: ['삼성전자', 'SK하이닉스'] },
    { title: '조선주 차익실현', why: '수주 기대가 선반영되며 대형 조선주가 일제히 하락', facts: ['HD현대중공업 -4.1%'], angle: '조정인지 추세 전환인지', tickers: ['HD현대중공업'] },
    { title: '2차전지 반등', why: '에코프로비엠 대차잔고 감소와 함께 숏커버링 기대', facts: ['에코프로비엠 +5.2%'], angle: '숏커버링 신호 읽는 법', tickers: ['에코프로비엠'] } ],
    titles: ['삼성전자 실적 서프라이즈, 반도체 다시 간다?', '코스피 2% 급등의 진짜 이유'], thumbs: ['삼전 서프라이즈', '반도체 귀환'], shorts: ['삼성전자 실적 30초 정리', '대차잔고로 숏커버링 찾는 법'], ix: [], up: [], down: [] });
  { const D = 86400e3; const ev = (k, kind, title, sum) => ({ ms: now - k * D, kind, title, sum, id: 'DART-20260' + k + kind.length });
    const x1 = { code: '123450', name: '어떤테크', mkt: 'Q', close: 1450, pct: 3.2, mcap: 450, score: 20.5, es: 16.5, vs: 4, by: { mna: 2, rights3: 3, cb: 4, refix: 2, fund5: 3, conv: 3 }, sig: ['거래량 급증 (평소의 9배)', '60일 저점 대비 +126%'], stage: '털기', streak: 3,
      f: { vwapAcc: 999, vwapHeavy: 1663, vwap120: 1120, fromLow60: 125.5, offHigh20: -12.1, volX5: 4.2, volX20: 3.1, maxVolX10: 9.4, box60: 18, spikeDate: '2026-09-30', hiPre: 2600, hiPreD: '2026-05-12', hiAll: 3100, hiAllD: '2026-10-08', accLow: 900, accStart: '2026-07-01', accEnd: '2026-09-29' },
      px: [{ p: 980, label: '전환가', kind: 'cb', date: '2026-08-16' }, { p: 870, label: '조정 전환가', kind: 'refix', date: '2026-09-15' }, { p: 1050, label: '발행가', kind: 'rights3', date: '2026-07-17' }],
      events: [ev(2, 'conv', '전환청구권행사', '전환가액 870원 · 1,200,000주'), ev(30, 'refix', '전환가액의조정', ''), ev(40, 'cb', '주요사항보고서(전환사채권발행결정)', '사모 전환사채(CB) 30억 발행 · 전환가 980원'), ev(50, 'fund5', '주식등의대량보유상황보고서(일반)', ''), ev(90, 'rights3', '주요사항보고서(유상증자결정)', '제3자배정 유상증자 50억 결정'), ev(100, 'mna', '최대주주변경을수반하는주식양수도계약체결', '')],
      ai: { stage: '털기', level: '높음', summary: '투자조합 대상 3자배정 증자와 사모 CB 연속 발행 뒤 전환가 리픽싱, 급등 직후 전환청구가 나와 전형적인 털기 단계와 비슷해 보입니다.', evidence: ['최대주주 변경 후 3개월 안에 3자배정 증자·CB 2회', '전환가 980→870원 하향 조정', '저점 대비 +126% 급등 직후 전환청구'], counter: ['운영자금 목적의 정상적 자금조달일 수 있음'], watch: ['추가 상장일 전후 매도 물량', '최대주주·조합 지분 변동 공시'], cost: { low: 870, high: 1050, basis: '조정 전환가 870원·3자배정 발행가 1,050원·매집 구간 평균가 999원' }, gap: '현재가가 추정 평단보다 40~65% 높아 차익 실현 유인이 큼' }, hist: [{ d: '2026-10-15', s: 20.5, st: '털기' }, { d: '2026-10-14', s: 18, st: '띄우기' }, { d: '2026-10-13', s: 14, st: '매집' }] };
    const x2 = { code: '234560', name: '바이오에이', mkt: 'Q', close: 3200, pct: -0.5, score: 9, es: 7, vs: 2, by: { cb: 4, purpose: 2, rights: 1 }, sig: ['박스권에서 최근 거래 증가'], stage: '판 깔기', streak: 1, f: { vwapAcc: 3150 }, px: [], events: [ev(20, 'purpose', '주주총회소집결의(정관 일부 변경)', '')], ai: null };
    await setJSON('mp/day/2026-10-15', { date: '2026-10-15', at: now, n: 2, list: [x1, x2], done: now });
    await setJSON('mp/day/2026-10-14', { date: '2026-10-14', at: now, n: 1, list: [x1], done: now });
    await setJSON('mp/idx', ['2026-10-15', '2026-10-14']);
    x1.f.accStart = '2026-07-20'; x1.f.accEnd = '2026-09-29'; x1.f.accDays = 50; x1.f.accObv = 31.5; x1.f.accLow = 940; x1.f.accHigh = 1080;
    x1.ai.acc = { period: '2026년 7월 하순 ~ 9월 말', basis: 'OBV 최저점(7/20) 이후 박스권 순매수 + 8/26 조합 5% 신고' };
    x1.px.push({ p: 1012, label: '장내 취득 평균 (2026-08-04~2026-08-22, 6건)', kind: 'fund5', date: '2026-08-26', buys: [{ d: '2026-08-04', q: 120000, p: 980 }, { d: '2026-08-11', q: 90000, p: 1010 }, { d: '2026-08-22', q: 150000, p: 1040 }] });
    x1.log = [{ at: now - 3600e3, msg: '새 공시 반영: 전환청구권행사 · 점수 15→20.5 · 띄우기→털기 · 의심 높음' }, { at: now - 86400e3, msg: '2026-10-14 장 마감 정기 분석 · 점수 -→15 · -→띄우기' }];
    const MP = await import('../src/lib/manip.mjs');
    x1.links = [{ who: '에이비씨투자조합', others: [{ c: '234560', nm: '바이오에이', d: '2026-03-29', k: 'fund5' }, { c: '345670', nm: '조용한소재', d: '2026-09-15', k: 'mna' }] }];
    x1.warn = { m: 2, lv: '투자경고', date: '2026-10-12' }; x1.ind = '전자부품'; x1.capPct = 0.18;
    x1.px.push({ p: null, label: 'CB 조건', kind: 'cb', date: '2026-09-05', cbx: { start: '2027-09-05', end: '2029-08-05', floor: 686, call: true, callPct: 30 }, ref: 'DART-20260403' });
    x1.events = x1.events.map((e) => (e.kind === 'cb' ? { ...e, id: 'DART-20260403' } : e));
    x1.events.push({ ms: now - 25 * D, kind: 'risk', title: '불성실공시법인지정(공시번복)', id: 'DART-20269001' });
    x1.px.push({ p: null, pen: { p: 7.5, cum: 12, pre: false }, kind: 'risk', label: '불성실공시 벌점', date: new Date(now - 25 * D + 9 * 3600e3).toISOString().slice(0, 10), ref: 'DART-20269001' });
    x1.dir = MP.direction(x1); x2.dir = MP.direction(x2);
    x1.ai = { ...x1.ai, upWhy: [], downWhy: [{ t: '전환청구 공시가 나와 추가 상장 물량이 생길 수 있음', refs: ['F2'] }, { t: '현재가가 추정 평단 대비 높은 수준', refs: ['F14'] }], counter: [{ t: '운영자금 목적의 정상적 자금조달일 수 있음', refs: ['F4'] }], dropped: 2, facts: MP.factsOf(x1).map((f) => ({ id: f.id, t: f.t, src: f.src })) };
    await setJSON('mp/prof/123450', x1);
    { const b = []; let p = 5000; const d0 = Date.parse('2025-06-02'); for (let i = 0; i < 400; i++) { const o = p; p = Math.max(500, p * (1 + (i > 200 && i < 230 ? 0.04 : -0.002) + (Math.sin(i * 1.7) * 0.03))); const d = new Date(d0 + Math.floor(i * 7 / 5) * 864e5).toISOString().slice(0, 10); b.push([d, Math.round(o), Math.round(Math.max(o, p) * 1.02), Math.round(Math.min(o, p) * 0.98), Math.round(p), 100000 + (i % 13) * 20000]); } await setJSON('cd/123450', { at: Date.now() + 864e5, b }); }
    const rr = (x) => { const d = x.dir; return { rr: d.rr ? { v: d.rr.v, t: d.rr.t, ts: d.rr.ts, s: d.rr.s, ss: d.rr.ss, up: d.rr.up, dn: d.rr.dn } : null, d: d.dir, us: d.upS, ds: d.downS, ur: d.up.slice(0, 2).map((r) => r.t), dr: d.down.slice(0, 2).map((r) => r.t), gap: d.gap, tg: d.tgt ? d.tgt.map((t) => ({ p: t.p, s: t.s })) : null, nd: '2026-10-27 추가 상장' }; };
    const xb = { code: '345670', name: '조용한소재', mkt: 'Q', close: 2100, pct: 0.4, f: { vwapAcc: 2050, box60: 22, volX20: 2.1, fromLow60: 12, accObv: 24, accStart: '2026-08-10', accEnd: '2026-10-15', accLow: 1880, hiPre: 2780, hiPreD: '2026-06-03', hiAll: 3350, hiAllD: '2026-04-20', vwapHeavy: 2400 }, events: [{ ms: now - 30 * D, kind: 'mna', title: '최대주주변경을수반하는주식양수도계약체결', id: 'DART-777' }, { ms: now - 20 * D, kind: 'cb', title: '전환사채권발행결정', id: 'DART-778' }], px: [{ p: 2000, label: '전환가', kind: 'cb', date: '2026-09-25', ref: 'DART-778', cbx: { floor: 1400, start: '2027-09-25' } }, { p: 2350, label: '양수도 단가', kind: 'mna', date: '2026-09-15', ref: 'DART-777' }] };
    xb.dir = MP.direction(xb); xb.stage = '매집'; xb.score = 11; await setJSON('mp/prof/345670', xb);
    // v201: 1차 띄우기 뒤 −64% 대형주 (지난 판 평단 표시 확인)
    const xc = { code: '214150', name: '클래시스', mkt: 'Q', close: 27700, pct: 1.65, capPct: 0.97, xnotes: ['시가총액 상위 3% 대형주 — 작전 가능성을 낮게 봄 (점수 ×0.6)'], score: 7.2, es: 4, vs: 3, by: { pledge: 1 }, sig: ['1차 띄우기: 2025-11-20 저점 → 2026-01-29 고점 (+52%, 42거래일 · 거래 폭증 2026-01-26) → 지금 고점 대비 -64%'],
      f: { close: 27700, cyc: null, wf: null, pump1: { low: 50500, lowD: '2025-11-20', pumpD: '2026-01-26', top: 77000, topD: '2026-01-29', rise: 52, drop: -64, since: 170, days: 42 }, vwapAcc: 52000, accLow: 47000, accStart: '2025-10-23', accEnd: '2026-01-23', accDays: 64, accObv: 20, fromLow60: 5, low20: { p: 26550, d: '2026-10-15' }, vwapHeavy: 40675, marks: [], hiAll: 77000, hiAllD: '2026-01-29' },
      events: [{ ms: now - 150 * D, kind: 'pledge', title: '최대주주변경을수반하는주식담보제공계약체결', id: 'DART-2026C1' }], px: [{ p: 58000, kind: 'mna', date: '2025-12-01', ref: 'DART-2025C0', label: '양수도 단가' }], streak: 1, ai: null };
    xc.stage = MP.stageOf(xc.by, xc.f, xc.events); xc.dir = MP.direction(xc); await setJSON('mp/prof/214150', xc); globalThis.__xc = xc;
    const xn = { code: '351320', name: '넥사다이내믹스', mkt: 'Q', close: 4920, pct: 1.76, score: 15, es: 8, vs: 7, by: { rights3: 3 }, sig: [], f: { close: 4920, cyc: null, wf: null, marks: [{ ok: true, k: 'acc', d: '2026-10-05', h: 'held', lvl: 3600, vx: 2 }], rb: { topD: '2026-09-10', top: 5690, lowD: '2026-09-29', low: 3400, fall: -40, up: 44, days: 13, udv: 2.1, volX: 1.2, wick: 0, volMed: 1.5 }, pump1: { low: 799, lowD: '2026-08-03', pumpD: '2026-08-03', top: 5690, topD: '2026-09-10', rise: 612, drop: -13, since: 25, days: 27 }, fromLow60: 521 }, events: [{ ms: now - 26 * D, kind: 'rights3', title: '유상증자결정(제3자배정)', id: 'DART-NX1' }], px: [], streak: 1, ai: null };
    xn.stage = MP.stageOf(xn.by, xn.f, xn.events); xn.rbk = MP.reboundOf(xn); xn.dir = MP.direction(xn); await setJSON('mp/prof/351320', xn);
    { const X = await import('../src/lib/manipx.mjs'); const groups = {}, rows = [];
      for (let k = 0; k < 40; k++) { const row = { c: String(100000 + k), n: '테스트' + k, d: '2026-0' + (5 + (k % 4)) + '-1' + (k % 9), st: ['매집', '판 깔기', '털기'][k % 3], dir: k % 2 ? 'up' : 'down', ck: 'ABCD'[k % 4], rr: (k % 5) / 2, pk: k % 7 === 0 ? 1 : 0, vd: 'gyr'[k % 3], gp: (k % 5) - 2, r5: k % 9 - 4, u5: k % 11, d5: -(k % 6), r20: (k % 13) - 6, u20: k % 31, d20: -(k % 17), x20: (k % 7) - 3, r60: (k % 15) - 8, u60: k % 41, d60: -(k % 23), ft: 'wln'[k % 3], ftd: 6, ft2: 'wl'[k % 2], u120: k % 53, r120: (k % 19) - 9, pd20: 1 + (k % 19), pd60: 2 + (k * 7) % 58, pd120: 3 + (k * 11) % 117, m20: (k % 9) - 4, wy: k % 3 === 0 ? ['s:news', 's:vol'] : k % 3 === 1 ? ['f:conv', 'f:mkt'] : undefined };
        for (const g of X.perfGroupKeys(row)) X.perfAdd(groups, g, row); rows.push(row); }
      await setJSON('mp/bt/state', { v: 19, queue: ['a'], pos: 1, done: true, doneAt: now, samples: 80, kept: 40, groups, wait: { since: now, deep: { day: '2025-02-11', limit: '2023-10-14', rows: 48210 } } }); { const BS = await import('../src/lib/btstore.mjs'); await BS.partsReset('mp/bt/rows', 20); await BS.partsAppend('mp/bt/rows', rows, { per: 15, v: 20 }); } }
    { const TS = await import('../src/lib/tradesim.mjs'); const { RULE_V } = await import('../src/lib/manip.mjs'); const nm = ['대원전선', '에이프로젠', '시선AI', '유티아이', '넥사다이내믹스', '이연제약']; const codes = {}, tlc = {}, bt = [], bfw = [];
      let sd = 5; const R = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; }; const d0 = Date.parse('2025-12-01'); let dates = null;
      const CL = await import('../src/lib/caselab.mjs'); const bigR = [], bigB = []; const ELB = await import('../src/lib/entrylab.mjs'); const entR = [];
      for (let c = 0; c < 120; c++) { const B = []; let p = 1000; const good = R() < 0.3;
        for (let i = 0; i < 230; i++) { const o = p; p = p * (1 + (good && i > 40 ? 0.004 : -0.0005) + (R() - 0.5) * 0.08); B.push({ d: new Date(d0 + Math.floor(i * 7 / 5) * 864e5).toISOString().slice(0, 10), o, h: Math.max(o, p) * 1.02, l: Math.min(o, p) * 0.98, c: p, v: 50000 + R() * 300000 }); }
        dates = dates || B.map((x) => x.d);
        const tl = []; for (let i = 20; i < 225; i += 1) if (R() < 0.25) { const g = good ? R() < 0.6 : R() < 0.15; const r = { vd: g ? 'g' : R() < 0.1 ? 'r' : 'y', ck: g ? 'A' : 'C', st: g ? '매집' : '관찰', rr: R() * 4, gp: R() * 60, cm: R() < 0.5 ? 1 : 0, dir: g ? 'up' : 'none', pk: g && R() < 0.5 ? 1 : 0, s: (good ? 8 : 5) + R() * 6, ws: R(), ev: [good && R() < 0.7 ? 'rights3' : null, R() < 0.4 ? 'cb' : null, R() < 0.2 ? 'conv' : null].filter(Boolean), lo60: R() * 90, bx: 20 + R() * 70, cy: R() < 0.3 ? 1 : 0, p1: R() < 0.3 ? 1 : 0, mk2: Math.floor(R() * 3) }; tl.push({ di: i, d: B[i].d, f: TS.flagsOf(r), tp: B[i].c * 1.25, sp: B[i].c * 0.9, a: TS.attrsOf(r), rv: i > 150 ? RULE_V : 207, v: { s: r.s, ws: r.ws, rr: r.rr, gp: r.gp } }); }
        const code = String(200000 + c), n = nm[c % 6] + (c > 5 ? c : '');
        const IX = Object.fromEntries(B.map((x, i) => [x.d, { Q: Math.sin(i / 15) * 0.6, P: 0 }])); const L = TS.simTrades(B, tl, { last: B[200].d, now: Date.parse(B[229].d) + 864e5, ix: IX }); const fw = TS.fwdOf(B, tl, {});
        codes[code] = { chk: '2026-10-17', need: 0, t: L.trades.map((t) => TS.pack(code, n, t)), fw }; tlc[code] = { n, m: 'Q', p: tl.map((q) => [q.di, q.f, q.tp, q.sp, q.a, q.rv, q.v]) };
        for (const t of TS.simTrades(B, tl, { final: true, now: Date.parse(B[229].d), ix: IX, mkt: 'Q' }).trades) bt.push(TS.pack(code, n, t));
        { const BB = []; let q = 1000; for (let i = 0; i < 400; i++) { const o = q; const pump = c % 4 === 0 && i > 250 && i < 300; q = q * (1 + (pump ? 0.025 : -0.0008) + (R() - 0.5) * 0.06); BB.push({ d: new Date(Date.parse('2024-06-01') + Math.floor(i * 7 / 5) * 864e5).toISOString().slice(0, 10), o, h: Math.max(o, q) * 1.02, l: Math.min(o, q) * 0.98, c: q, v: 50000 + R() * 300000 }); }
          const ev = c % 4 === 0 ? [{ ms: Date.parse(BB[200].d), kind: 'rights3', title: '제3자배정 유상증자 결정' }, { ms: Date.parse(BB[210].d), kind: 'mna', title: '최대주주 변경' }, { ms: Date.parse(BB[262].d), kind: 'contract', title: '단일판매 공급계약' }] : (R() < 0.3 ? [{ ms: Date.parse(BB[150].d), kind: 'cb', title: '전환사채권 발행결정' }] : []);
          const br = CL.bigRuns(BB, ev); for (const r of br.runs) bigR.push({ c: code, n, ...r }); for (const k of br.base) bigB.push(k); for (const e of ELB.entryEvents(BB, { code, evs: ev, mkt: 'Q' })) entR.push(e); }
        for (const r of TS.fwdOf(B, tl.filter((q) => q.di % 10 === 0), {})) { const q = tl.find((z) => z.di === r[0]); bfw.push([r[0], q.v.s, q.v.ws, q.v.rr, q.v.gp, r[1], r[2], r[3]]); } }
      await setJSON('mp/sim/tl', { v: 10, dates, codes: tlc }); await setJSON('mp/sim/tr', { v: 10, codes, at: 1 }); { const BS = await import('../src/lib/btstore.mjs'); await BS.partsReset('mp/bt/ent', 24); await BS.partsAppend('mp/bt/ent', entR, { per: 1000, v: 24 }); await ELB.entSummary({ force: true });
        await BS.partsReset('mp/bt/big', 21); await BS.partsAppend('mp/bt/big', bigR, { per: 50, v: 21 }); await BS.partsReset('mp/bt/bigb', 21); await BS.partsAppend('mp/bt/bigb', bigB, { per: 500, v: 21 });
        const pts = []; for (let i = 0; i < 40; i++) { const d = new Date(Date.parse('2022-06-01') + i * 14 * 864e5).toISOString().slice(0, 10); pts.push({ d, s: i > 12 ? 5 : 2, c: 2000 * (i > 14 ? 1 + (i - 14) * 0.9 : 1), st: i > 12 ? '판 깔기' : '관찰', vd: 'y', ck: 'C', mv: ['mnaFund'] }); }
        await CL.saveCase('006740', { pts, runs: [], evFrom: '2022-01-03', from: '2022-03-02' }); await CL.saveCase('004690', { pts: pts.map((p) => ({ ...p, s: 1 })), runs: [], evFrom: '2022-01-03' }); }
      { const BS = await import('../src/lib/btstore.mjs'); await BS.partsReset('mp/bt/trades', 20, { nf: {} }); await BS.partsAppend('mp/bt/trades', bt, { per: 100, v: 20 }); await BS.partsReset('mp/bt/fw', 20); await BS.partsAppend('mp/bt/fw', bfw, { per: 500, v: 20 }); }
      const aim = {}; for (const [code, z] of Object.entries(codes).slice(0, 40)) for (const a of z.t.slice(0, 3)) { const t = TS.unpack(a); if (t.T) aim[`l|${code}|${t.d}`] = { t: t.T.r > 0 ? `${t.d} 직후 3자배정 증자 납입 완료 공시가 나온 뒤 거래량이 늘며 1차 목표가까지 올랐어요. 같은 기간 시장도 함께 올라 흐름을 도왔어요.` : `산 뒤 전환청구 공시가 연달아 나오면서 추가 상장 물량 부담이 커졌고, 손절선을 깨고 내려가 손실로 끝났어요.`, w: t.T.r > 0 ? 1 : 0, k: [] }; }
      await setJSON('mp/sim/ai', { m: aim }); await setJSON('mp/sim/gai', { m: { 'l|g': { t: '수익 거래는 납입 완료·공급계약 공시 뒤 거래량이 붙은 경우가 많았고, 손실 거래는 전환청구·대주주 매도 공시가 나온 뒤 손절선을 깬 경우가 많았어요. 아직 거래가 30번이 안 돼 우연일 수 있어요. 전환청구가 시작된 종목은 피하는 게 좋아 보여요.', n: 99, at: 1 } } }); }
    await setJSON('mp/perf/2026-10-14', { done: false, rows: { '123450': { st: '털기', dir: 'down', lv: '높음', r5: -8.2, r20: -21.5 }, '234560': { st: '판 깔기', dir: 'up', r5: 3.1, r20: 12.4 }, '345670': { st: '매집', dir: 'up', r5: 6.5 } } });
    await setJSON('mp/warn', { at: now - 3600e3, n: 12, err: null, map: {} }); await setJSON('mp/party', { at: now - 7200e3, idx: { A: {}, B: {} } });
    await setJSON('mp/rank', { '214150': { ...MP.rankRow(globalThis.__xc), up: now - 3600e3 }, '345670': { ...rr(xb), n: '조용한소재', m: 'Q', s: 11, st: '매집', lv: '중간', c: 2100, pct: 0.4, cl: 2000, ch: 2050, va: 2050, acc: '2026-08-10 ~ 2026-10-15', up: now - 1800e3 }, '123450': { ...rr(x1), pn: { c: 12, pd: false }, wn: '투자경고', lk: 1, n: '어떤테크', m: 'Q', s: 20.5, st: '털기', lv: '높음', c: 1450, pct: 3.2, cl: 870, ch: 1050, va: 999, acc: '2026년 7월 하순 ~ 9월 말', up: now - 3600e3, sum: x1.ai.summary }, '234560': { ...rr(x2), n: '바이오에이', m: 'Q', s: 9, st: '판 깔기', lv: null, c: 3200, pct: -0.5, va: 3150, acc: '2026-08-01 ~ 2026-10-14', up: now - 2 * 3600e3 } }); }
    await setJSON('mp/entnow', { day: '2026-10-16', pos: 999, m: { '214150': { s: ['brk', 'nh60'], ent: [{ s: 'brk', d: '2026-10-16', ago: 0 }, { s: 'nh60', d: '2026-10-16', ago: 0 }], at: now }, '345670': { s: ['pull'], ent: [{ s: 'pull', d: '2026-10-15', ago: 1 }], at: now } } }); // v239 테스트
  await setJSON('vnote/idx', [{ mk: 'KR', date: '2026-10-15', at: now, summary: '폭락' }, { mk: 'KR', date: '2026-10-12', at: now - 3 * 86400e3, summary: '반도체 강세' }]);
}
const { renderItemPage, renderIssuePage, renderStockPage, renderSectionPage, rssFeed, SECTIONS, sitemap } = await import('../src/lib/page.mjs');
const fakeEnv = { ASSETS: { fetch: async () => new Response(fs.readFileSync(path.join(root, 'index.html'), 'utf8')) } };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const ipm = u.pathname.match(/^\/i\/((?:kr|us)-\d{8}-\d{1,2})$/);
  if (ipm) { const r = await renderIssuePage(fakeEnv, new Request('http://x' + req.url), ipm[1]); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return; }
  if (/^\/gurus\/[a-z]+$/.test(u.pathname)) { const r = await renderSectionPage(fakeEnv, new Request('http://x' + req.url), 'gurus'); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return; }
  if (SECTIONS[u.pathname.slice(1)] || u.pathname === '/rss.xml') { const r = u.pathname === '/rss.xml' ? await rssFeed() : await renderSectionPage(fakeEnv, new Request('http://x' + req.url), u.pathname.slice(1)); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return; }
  const spm = u.pathname.match(/^\/s\/(KR|US)\/([A-Za-z0-9.\-]+)$/);
  if (spm) { const r = await renderStockPage(fakeEnv, new Request('http://x' + req.url), spm[1], spm[2]); res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return; }
  const pm = u.pathname.match(/^\/p\/([A-Za-z0-9-]+)$/);
  if (pm || u.pathname === '/sitemap-pages.xml') {
    const r = pm ? await renderItemPage(fakeEnv, new Request('http://x' + req.url), pm[1]) : await sitemap();
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  if (fns[u.pathname]) {
    let body; if (req.method === 'POST') { body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); }); }
    const r = await fns[u.pathname](new Request('http://x' + req.url, { method: req.method, body, headers: { 'content-type': 'application/json', 'user-agent': req.headers['user-agent'] || '' } }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  const p = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p));
}).listen(process.env.PORT || 8787, () => console.log('listening', process.env.PORT || 8787));
