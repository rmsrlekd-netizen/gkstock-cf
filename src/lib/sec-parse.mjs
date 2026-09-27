import { decodeEntities } from './util.mjs';

// 8-K 항목 → [한국어, 중요도(0~5)]
export const ITEM_8K = {
  '1.01': ['중요 계약 체결', 4],
  '1.02': ['중요 계약 해지', 4],
  '1.03': ['파산·회생 절차', 5],
  '1.04': ['광산 안전 관련', 1],
  '1.05': ['사이버보안 사고', 4],
  '2.01': ['자산 인수·처분 완료', 4],
  '2.02': ['실적 발표', 5],
  '2.03': ['채무·차입 발생', 3],
  '2.04': ['채무 조기상환 사유 발생', 4],
  '2.05': ['구조조정·사업철수 비용', 3],
  '2.06': ['자산 손상차손', 3],
  '3.01': ['상장폐지·상장요건 미달 통지', 5],
  '3.02': ['사모 증권 발행(희석)', 4],
  '3.03': ['주주 권리 변경', 3],
  '4.01': ['회계법인 변경', 3],
  '4.02': ['과거 재무제표 신뢰 불가', 5],
  '5.01': ['경영권 변경', 5],
  '5.02': ['임원·이사 변경', 3],
  '5.03': ['정관·회계연도 변경', 2],
  '5.04': ['퇴직연금 거래 정지', 1],
  '5.05': ['윤리강령 변경', 1],
  '5.06': ['쉘컴퍼니 지위 변경', 3],
  '5.07': ['주주총회 결과', 2],
  '5.08': ['주주 이사후보 추천', 1],
  '7.01': ['IR 자료 공개(Reg FD)', 2],
  '8.01': ['기타 주요 사항', 2],
  '9.01': ['재무제표·첨부서류', 0],
};

// 서식 → [한국어, 카테고리, 기본 중요도]
// 카테고리: earnings 실적 / current 수시·계약 / offering 증자·희석 / insider 내부자 / inst 기관·5%지분 / periodic 정기 / other
export function classifyForm(form) {
  const f = form.toUpperCase();
  if (f.startsWith('8-K')) return ['수시공시', 'current', 2];
  if (f.startsWith('6-K')) return ['해외기업 수시공시', 'current', 2];
  if (f.startsWith('10-Q')) return ['분기보고서', 'periodic', 3];
  if (f.startsWith('10-K')) return ['연간보고서', 'periodic', 3];
  if (f.startsWith('20-F') || f.startsWith('40-F')) return ['해외기업 연간보고서', 'periodic', 3];
  if (f.startsWith('S-1') || f.startsWith('F-1')) return ['증권신고서(신규상장·공모)', 'offering', 4];
  if (f.startsWith('S-3') || f.startsWith('F-3')) return ['일괄신고서(증자 대기)', 'offering', 3];
  if (f.startsWith('424B')) return ['증권 발행 확정(희석)', 'offering', 4];
  if (/13D/.test(f)) return ['5% 이상 지분(경영참여)', 'inst', 4];
  if (/13G/.test(f)) return ['5% 이상 지분(단순투자)', 'inst', 2];
  if (f.startsWith('13F')) return ['기관 포트폴리오 보고(13F)', 'inst', 2];
  if (f === '4' || f === '4/A') return ['내부자 거래', 'insider', 2];
  if (f === '144' || f === '144/A') return ['내부자 매도 예정 신고', 'insider', 3];
  if (f.includes('14A')) return ['주총 위임장', 'other', 1];
  if (f.startsWith('25')) return ['상장폐지 신청', 'current', 4];
  return [form, 'other', 1];
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
}

/** EDGAR "getcurrent" Atom XML → 원시 엔트리 배열 */
export function parseAtom(xml) {
  const out = [];
  for (const raw of xml.split('<entry>').slice(1)) {
    const e = raw.split('</entry>')[0];
    const title = decodeEntities(tag(e, 'title'));
    const m = title.match(/^(.+?) - (.+) \((\d{6,10})\) \(([^)]+)\)\s*$/);
    if (!m) continue;
    const [, form, name, cik, role] = m;
    const href = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const updated = tag(e, 'updated');
    const id = tag(e, 'id');
    const acc = (id.match(/accession-number=([\d-]+)/) || href.match(/(\d{10}-\d{2}-\d{6})/) || [])[1] || '';
    const summary = decodeEntities(tag(e, 'summary')).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    const items = [];
    const seen = new Set();
    for (const im of summary.matchAll(/Item\s+(\d\.\d{2})\s*:?\s*([^\n]*)/g)) {
      if (seen.has(im[1])) continue;
      seen.add(im[1]);
      items.push({ code: im[1], en: im[2].trim() });
    }
    const size = (summary.match(/Size:\s*([\d.]+\s*[KMG]?B)/i) || [])[1] || '';
    out.push({ form: form.trim(), name: name.trim(), cik: String(Number(cik)), role: role.trim(), href, updated, acc, items, size });
  }
  return out;
}

/** 같은 접수번호의 엔트리(발행사/보고자)를 합쳐 피드 아이템으로 변환 */
export function buildFeed(rawEntries, tickerMap, { listedOnly = true } = {}) {
  const byAcc = new Map();
  for (const r of rawEntries) {
    if (!r.acc) continue;
    if (!byAcc.has(r.acc)) byAcc.set(r.acc, []);
    const g = byAcc.get(r.acc);
    if (!g.some((x) => x.cik === r.cik && x.role === r.role)) g.push(r);
  }
  const feed = [];
  for (const [acc, group] of byAcc) {
    const pick =
      group.find((g) => g.role === 'Issuer') ||
      group.find((g) => g.role === 'Subject') ||
      group.find((g) => g.role === 'Filer') ||
      group.find((g) => tickerMap.has(g.cik)) ||
      group[0];
    const party = group.find((g) => g !== pick && (g.role === 'Reporting' || g.role === 'Filed by'));
    const tk = tickerMap.get(pick.cik);
    const is13F = /^13F/i.test(pick.form);
    if (listedOnly && !tk && !is13F) continue; // 13F는 제출자가 운용사(비상장)라 예외
    const [formKo, cat, baseImpact] = classifyForm(pick.form);
    let impact = baseImpact;
    const items = pick.items.map((it) => {
      const ko = ITEM_8K[it.code];
      if (ko) impact = Math.max(impact, ko[1]);
      return { code: it.code, en: it.en, ko: ko ? ko[0] : it.en };
    });
    let category = cat;
    if (items.some((i) => i.code === '2.02')) category = 'earnings';
    else if (items.some((i) => i.code === '3.02')) category = 'offering';
    if (/\/A$/.test(pick.form)) impact = Math.max(0, impact - 1);
    feed.push({
      id: 'SEC-' + acc,
      src: 'SEC',
      form: pick.form,
      formKo,
      category,
      impact,
      name: tk?.name || pick.name,
      filerName: pick.name,
      cik: pick.cik,
      ticker: tk?.ticker || null,
      exchange: tk?.exchange || null,
      party: party ? party.name : null,
      items: items.filter((i) => i.code !== '9.01' || items.length === 1),
      time: pick.updated, // SEC 접수(accept) 시각, 초 단위
      url: pick.href,
      size: pick.size,
    });
  }
  feed.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
  return feed;
}

/** company_tickers_exchange.json → Map(cik -> {ticker,name,exchange}) */
export function buildTickerMap(j) {
  const map = new Map();
  const f = j.fields || ['cik', 'name', 'ticker', 'exchange'];
  const ci = f.indexOf('cik'), ni = f.indexOf('name'), ti = f.indexOf('ticker'), ei = f.indexOf('exchange');
  for (const row of j.data || []) {
    const cik = String(row[ci]);
    if (map.has(cik)) continue;
    map.set(cik, { ticker: row[ti], name: row[ni], exchange: row[ei] });
  }
  return map;
}

// Form 4 거래코드 → 한국어
export const TX_CODE = {
  P: '장내 매수', S: '장내 매도', A: '주식 보상(부여)', M: '옵션 행사', F: '세금 납부용 처분', G: '증여',
  D: '회사에 반환', C: '전환', X: '옵션 행사', J: '기타', W: '상속', I: '재량 거래', V: '자발적 보고', K: '스왑',
};

/** Form 4 원문 XML → 거래 요약 */
export function parseForm4(xml) {
  const v = (s, name) => {
    const m = s.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
    if (!m) return '';
    const inner = m[1].match(/<value>([\s\S]*?)<\/value>/);
    return decodeEntities((inner ? inner[1] : m[1].replace(/<[^>]+>/g, '')).trim());
  };
  const owner = v(xml, 'rptOwnerName');
  const rel = [];
  if (v(xml, 'isDirector') === '1' || v(xml, 'isDirector') === 'true') rel.push('이사');
  const title = v(xml, 'officerTitle');
  if (v(xml, 'isOfficer') === '1' || v(xml, 'isOfficer') === 'true') rel.push(title || '임원');
  if (v(xml, 'isTenPercentOwner') === '1' || v(xml, 'isTenPercentOwner') === 'true') rel.push('10% 주주');
  const tenb51 = v(xml, 'aff10b5One') === '1' || v(xml, 'aff10b5One') === 'true';
  const txs = [];
  for (const block of xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) || []) {
    const code = v(block, 'transactionCode');
    const shares = parseFloat(v(block, 'transactionShares')) || 0;
    const price = parseFloat(v(block, 'transactionPricePerShare')) || 0;
    const ad = v(block, 'transactionAcquiredDisposedCode');
    const after = parseFloat(v(block, 'sharesOwnedFollowingTransaction')) || null;
    const date = v(block, 'transactionDate');
    txs.push({ code, shares, price, ad, after, date });
  }
  // 요약: 장내 매수(P)/매도(S)를 우선, 없으면 가장 큰 거래
  const sum = (c) => txs.filter((t) => t.code === c).reduce((a, t) => ({ sh: a.sh + t.shares, val: a.val + t.shares * t.price }), { sh: 0, val: 0 });
  const buy = sum('P'), sell = sum('S');
  let main = null;
  if (buy.sh || sell.sh) {
    const isBuy = buy.val >= sell.val;
    const s = isBuy ? buy : sell;
    main = { code: isBuy ? 'P' : 'S', label: isBuy ? '장내 매수' : '장내 매도', shares: s.sh, value: s.val, price: s.sh ? s.val / s.sh : 0 };
  } else if (txs.length) {
    const t = txs.slice().sort((a, b) => b.shares * (b.price || 1) - a.shares * (a.price || 1))[0];
    main = { code: t.code, label: TX_CODE[t.code] || t.code, shares: t.shares, value: t.shares * t.price, price: t.price };
  }
  const after = txs.length ? txs[txs.length - 1].after : null;
  return { owner, relation: rel.join(', '), tenb51, main, after, count: txs.length, date: txs[0]?.date || '' };
}
