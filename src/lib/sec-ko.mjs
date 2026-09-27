// SEC 8-K / 6-K → 한국어 "핵심 내용" 제목 (AI 없이 규칙 기반)
//  입력: 수집된 SEC 항목 (items[].code, pr.headline/deck/itemText, _excerpt)
//  출력: { title, sub } — AI 한국어 제목(it.ko)이 있으면 그쪽이 우선
import { ITEM_8K } from './sec-parse.mjs';

const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trim() + '…' : s || '');

/** "$1.2 billion" → 12억 달러, "$450 million" → 4.5억 달러, "$12.5 million" → 1,250만 달러 */
export function usdKo(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e12) return s + trim((a / 1e12).toFixed(2)) + '조 달러';
  if (a >= 1e8) return s + trim((a / 1e8).toFixed(a >= 1e10 ? 0 : 1)) + '억 달러';
  if (a >= 1e4) return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만 달러';
  return s + Math.round(a).toLocaleString('ko-KR') + '달러';
}
const trim = (x) => x.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
const MULT = { billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mm: 1e6, m: 1e6, thousand: 1e3, k: 1e3 };
function money(str) {
  const m = String(str || '').match(/\$\s?([\d,]+(?:\.\d+)?)\s*(billion|million|thousand|bn|mm)?\b/i);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, '')) * (MULT[(m[2] || '').toLowerCase()] || 1);
  return Number.isFinite(v) && v >= 1000 ? v : null;
}
function moneyNear(text, re, span = 140) {
  const m = text.match(re);
  if (!m) return null;
  return money(text.slice(m.index, m.index + span));
}
function pctNear(text, re, span = 160) {
  const m = text.match(re);
  if (!m) return null;
  const seg = text.slice(m.index, m.index + span);
  const p = seg.match(/\b(up|increase[sd]?|grew|growth of|rose|higher by|an increase of|down|decrease[sd]?|declined?|fell|lower by|a decrease of)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s?%/i);
  if (!p) return null;
  const neg = /down|decrease|decline|fell|lower/i.test(p[1]);
  return (neg ? -1 : 1) * Number(p[2]);
}
const pctStr = (p) => (p === null ? '' : `(${p > 0 ? '+' : ''}${trim(p.toFixed(1))}%)`);

function period(text) {
  const q = text.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th|Q[1-4])\b[ -]?(?:fiscal )?(?:quarter)?/i);
  const fy = /\b(full[- ]year|fiscal year|annual)\b/i.test(text.slice(0, 300));
  const map = { first: 1, '1st': 1, q1: 1, second: 2, '2nd': 2, q2: 2, third: 3, '3rd': 3, q3: 3, fourth: 4, '4th': 4, q4: 4 };
  if (q && /quarter|Q[1-4]/i.test(q[0])) return `${map[q[1].toLowerCase()]}분기`;
  if (fy) return '연간';
  return '';
}

// 계약 종류 번역
const AGREEMENTS = [
  [/merger/i, '합병'], [/securities purchase|subscription/i, '증권 매입(투자 유치)'], [/stock purchase|share purchase|equity purchase/i, '지분 인수'],
  [/asset purchase/i, '자산 인수'], [/purchase and sale|purchase agreement/i, '매매'], [/underwriting/i, '공모 인수'],
  [/equity distribution|sales agreement|at[- ]the[- ]market|ATM/i, 'ATM(시장가 주식 매도)'], [/credit|revolving|term loan|loan/i, '대출·신용공여'],
  [/guarantee/i, '지급 보증'], [/indenture|notes?\b/i, '채권 발행'], [/license/i, '라이선스'], [/supply|purchase order/i, '공급'],
  [/collaboration|partnership|joint development|strategic/i, '협력·제휴'], [/lease/i, '임대차'], [/employment|separation|consulting|severance/i, '임원 고용·퇴직'],
  [/warrant/i, '워런트'], [/exchange agreement/i, '교환'], [/registration rights/i, '등록권'], [/amend/i, '계약 변경'], [/settlement/i, '합의'],
  [/distribution/i, '유통'], [/services?/i, '서비스'],
];
function agreementKo(text) {
  const m = text.match(/\b((?:[A-Z][A-Za-z-]+\s){0,5}(?:Agreement|Amendment|Facility|Indenture|Contract))\b/);
  const src = m ? m[1] : text.slice(0, 300);
  for (const [re, ko] of AGREEMENTS) if (re.test(src)) return ko;
  return '';
}
function counterparty(text) {
  const m = text.match(/\b(?:with|by and among[^,]{0,80}?and|by and between[^,]{0,80}?and)\s+([A-Z][^()“”"]{1,70}?)\s*(\([^)]{0,40}\)|,|\.\s|\s(?:pursuant|under|to|for|dated|which|as|in)\b)/);
  if (!m) return /institutional investors?/i.test(text) ? '기관 투자자' : '';
  const ab = (m[2] || '').match(/[“"]([A-Z][\w&.-]{1,15})[”"]/);
  let cp = (ab && !/Company|Agreement|Lender|Purchaser/.test(ab[1]) ? ab[1] : m[1]).replace(/,\s*$/, '').trim();
  if (/^(the|The)\s|Company|Registrant|Lenders?\b|Purchasers?\b|Investors?\b|Buyer|Seller|Agent/.test(cp) || cp.length < 2) return /institutional investors?/i.test(text) ? '기관 투자자' : '';
  return clip(cp, 28);
}

// 보도자료 헤드라인 키워드 → 한국어 요지
const PR_RULES = [
  [/topline|phase\s?(1|2|3|i{1,3})\b.*(result|data)|(result|data).*phase\s?(1|2|3|i{1,3})\b/i, () => '임상 결과 발표'],
  [/FDA.*(approv|clear)|(approv|clear).*FDA/i, () => 'FDA 승인'],
  [/breakthrough therapy|fast track|orphan drug/i, () => 'FDA 지정 획득'],
  [/(IND|BLA|NDA|PMA)\b.*(submi|accept|clear)/i, () => 'FDA 신청·접수'],
  [/pric(es|ed|ing).*(offering|placement)/i, (t) => `공모·사모 가격 결정${money(t) ? ' · ' + usdKo(money(t)) : ''}`],
  [/(proposed|launch(es)?).*(offering)/i, () => '증자(공모) 추진'],
  [/(closes?|closing|completes?).*(offering|placement)/i, (t) => `증자 완료${money(t) ? ' · ' + usdKo(money(t)) : ''}`],
  [/reverse (stock )?split/i, (t) => { const r = t.match(/1[- ]for[- ](\d+)/i); return `주식 병합(액면병합)${r ? ` 1:${r[1]}` : ''}`; }],
  [/(stock|share) (repurchase|buyback)|buyback/i, (t) => `자사주 매입${money(t) ? ' ' + usdKo(money(t)) : ''}`],
  [/dividend/i, () => '배당 결정'],
  [/definitive agreement to (acquire|be acquired|merge)|to acquire|acquisition of|will acquire|agrees? to acquire/i, (t) => `인수·합병 발표${money(t) ? ' · ' + usdKo(money(t)) : ''}`],
  [/completes? (the )?(acquisition|merger|sale)/i, () => '인수·합병 완료'],
  [/(financial|operating|quarter|fiscal).*(results)|reports? .*(quarter|results)/i, null], // 실적 → 아래 전용 처리
  [/(raises?|increases?|lifts?).*guidance|guidance.*(raise|increase)/i, () => '가이던스 상향'],
  [/(lowers?|cuts?|reduces?).*guidance/i, () => '가이던스 하향'],
  [/guidance|outlook/i, () => '실적 전망 발표'],
  [/(conference call|webcast|to report|will report|to announce).*(results|earnings)/i, () => '실적 발표 일정 안내'],
  [/(awarded|wins?|secures?|receives?).*(contract|order|award)|contract (award|win)/i, (t) => `계약 수주${money(t) ? ' · ' + usdKo(money(t)) : ''}`],
  [/(partnership|collaborat|strategic alliance|teams? up)/i, () => '전략적 제휴·협력'],
  [/mission success|launch(es|ed)? .*mission/i, () => '발사 임무 성공'],
  [/(launch(es)?|unveils?|introduces?|debuts?)/i, () => '신제품·서비스 출시'],
  [/(appoints?|names?|elects?|hires?).*(CEO|Chief|President|Director|Board|CFO|COO)/i, () => '경영진 선임'],
  [/(resign|retire|step(s)? down|depart)/i, () => '경영진 사임'],
  [/(noncompliance|non-compliance|deficiency|delist)/i, () => '상장 유지 기준 미달 통보'],
  [/regains? compliance/i, () => '상장 유지 기준 충족 회복'],
  [/(lawsuit|litigation|settle)/i, () => '소송·합의'],
  [/bankruptcy|chapter 11/i, () => '파산 보호 신청'],
  [/(investor (day|presentation)|presentation|conference)/i, () => '투자설명회·IR 참가'],
  [/(record|all-time high)/i, () => '사상 최대 기록 발표'],
];

function earnings(text) {
  const per = period(text);
  const rev = moneyNear(text, /\b(total revenues?|net revenues?|revenues?|net sales|total sales|sales)\b/i);
  const revP = pctNear(text, /\b(total revenues?|net revenues?|revenues?|net sales|sales)\b/i);
  const eps = text.match(/(?:diluted )?(?:EPS|earnings per (?:diluted )?share)[^$]{0,40}\$\s?(\(?-?\d+\.\d{2}\)?)|\$\s?(\(?\d+\.\d{2}\)?)\s+per (?:diluted )?share/i);
  const epsV = eps ? (eps[1] || eps[2]) : null;
  const loss = /net loss/i.test(text.slice(0, 900));
  const ni = moneyNear(text, /\bnet (income|loss)\b/i);
  const parts = [`${per ? per + ' ' : ''}실적 발표`];
  if (rev) parts.push(`매출 ${usdKo(rev)}${pctStr(revP)}`);
  if (epsV) parts.push(`EPS ${epsV.replace(/[()]/g, '').startsWith('-') || /\(/.test(epsV) ? '-' : ''}${epsV.replace(/[()-]/g, '')}달러`);
  else if (ni) parts.push(`순${loss ? '손실' : '이익'} ${usdKo(ni)}`);
  if (/raise[sd]?.{0,30}guidance|guidance.{0,30}rais/i.test(text)) parts.push('가이던스 상향');
  else if (/(lower|cut|reduce)[sd]?.{0,30}guidance/i.test(text)) parts.push('가이던스 하향');
  return parts.join(' · ');
}

function officers(text) {
  const roles = [];
  const R = [[/Chief Executive Officer|\bCEO\b/, 'CEO'], [/Chief Financial Officer|\bCFO\b/, 'CFO'], [/Chief Operating Officer|\bCOO\b/, 'COO'], [/Chief Technology Officer|\bCTO\b/, 'CTO'], [/Chief (Medical|Scientific) Officer/, 'CMO'], [/\bPresident\b/, '사장'], [/Chair(man|woman|person)?\b/, '의장'], [/\b(director|Board of Directors)\b/i, '이사']];
  for (const [re, ko] of R) if (re.test(text) && !roles.includes(ko)) roles.push(ko);
  const out = /(resign|retire|step(ped|s)? down|depart|terminat|separation|will not stand)/i.test(text);
  const inn = /(appoint|elect|named|hire|promot|succeed)/i.test(text);
  const who = roles.slice(0, 2).join('·') || '임원';
  if (out && inn) return `${who} 교체 (사임·후임 선임)`;
  if (out) return `${who} 사임·퇴임`;
  if (inn) return `${who} 선임`;
  if (/compensat|bonus|equity award|salary/i.test(text)) return '임원 보수·보상 변경';
  return `${who} 변경`;
}

/** 핵심 제목 만들기 */
export function koHeadline(it) {
  if (!/^(8-K|6-K)/.test(it.form || '')) return null;
  const codes = (it.items || []).map((x) => x.code);
  const pr = it.pr || {};
  const head = pr.headline || '';
  const body = [head, pr.deck, pr.itemText, it._excerpt].filter(Boolean).join(' ');
  const has = (c) => codes.includes(c);
  let title = '';

  if (has('2.02') || (/results/i.test(head) && /(quarter|fiscal|year)/i.test(head))) title = earnings(body);
  else if (has('1.03') || /chapter 11|bankruptcy/i.test(body.slice(0, 400))) title = '파산 보호(회생) 절차 신청';
  else if (has('3.01')) {
    const ex = (body.match(/\b(Nasdaq|NYSE American|NYSE)\b/) || [])[1];
    title = /regain/i.test(body) ? '상장 유지 기준 충족 회복' : /transfer/i.test(body) ? `상장 이전${ex ? ` (${ex})` : ''}` : `상장 유지 기준 미달 통보${ex ? ` (${ex})` : ''}`;
    const why = /bid price|minimum bid/i.test(body) ? '주가 1달러 미만' : /stockholders'? equity|equity requirement/i.test(body) ? '자본 요건 미달' : /periodic|10-[KQ]|timely file/i.test(body) ? '정기보고서 지연' : /market value/i.test(body) ? '시가총액 요건 미달' : '';
    if (why && !/회복/.test(title)) title += ` · ${why}`;
  } else if (has('4.02')) title = '과거 재무제표 정정 예정 (신뢰 불가)';
  else if (has('5.01')) title = '경영권(최대주주) 변경';
  else if (has('2.01')) { const v = money(body); title = `자산·기업 인수/매각 완료${v ? ' · ' + usdKo(v) : ''}`; }
  else if (has('1.01')) {
    const t = agreementKo(body), cp = counterparty(body), v = money(body);
    title = `${t ? t + ' ' : '주요 '}계약 체결${cp ? ` (${cp})` : ''}${v ? ' · ' + usdKo(v) : ''}`;
  } else if (has('1.02')) title = `주요 계약 해지${agreementKo(body) ? ' · ' + agreementKo(body) : ''}`;
  else if (has('3.02')) { const v = money(body); const sh = body.match(/([\d,]{4,})\s+shares/); title = `사모 증권 발행(지분 희석)${v ? ' · ' + usdKo(v) : sh ? ` · ${sh[1]}주` : ''}`; }
  else if (has('2.03')) { const v = money(body); title = `차입·채무 발생${agreementKo(body) ? ' (' + agreementKo(body) + ')' : ''}${v ? ' · ' + usdKo(v) : ''}`; }
  else if (has('2.05')) title = '구조조정·사업 철수 결정';
  else if (has('2.06')) title = '자산 손상차손 인식';
  else if (has('4.01')) title = '외부 감사인(회계법인) 변경';
  else if (has('1.05')) title = '사이버보안 사고 발생';
  else if (has('5.02')) title = officers(body);
  else if (has('5.03')) { const r = body.match(/1[- ]for[- ](\d+)/i); title = /reverse (stock )?split/i.test(body) ? `주식 병합(액면병합)${r ? ` 1:${r[1]}` : ''} 정관 변경` : '정관·회계연도 변경'; }
  else if (has('5.07')) title = '주주총회 결과';

  // 보도자료 키워드 (8.01, 7.01, 6-K 등)
  for (const src of [head, (pr.itemText || '').slice(0, 260)]) {
    if (title || !src) continue;
    for (const [re, fn] of PR_RULES) {
      if (!re.test(src)) continue;
      title = fn ? fn(body) : earnings(body);
      break;
    }
  }
  if (!title && codes.length) {
    const main = codes.find((c) => c !== '9.01') || codes[0];
    title = ITEM_8K[main]?.[0] || '';
  }
  if (!title) title = it.form.startsWith('6-K') ? '해외기업 수시 보고' : '수시 보고';

  // 부제: 원문 헤드라인(영문) 또는 본문 첫 문장
  const sub = head ? clip(head, 140) : clip(pr.itemText || '', 140);
  return { title: clip(title, 60), sub };
}
