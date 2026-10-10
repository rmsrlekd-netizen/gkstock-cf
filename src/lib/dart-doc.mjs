// DART 공시 원문을 읽어 "핵심 내용" 제목을 만든다 (규칙 기반, 무료)
import { fetchWithTimeout, BROWSER_UA, decodeEntities, decodeText } from './util.mjs';

const H = { 'User-Agent': BROWSER_UA, Referer: 'https://dart.fss.or.kr/' };

/** 공시 원문 HTML */
export async function fetchDartHtml(rcpNo) {
  const r = await fetchWithTimeout(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`, { headers: H }, 7000);
  if (!r.ok) throw new Error('main HTTP ' + r.status);
  const main = await r.text();
  const m = main.match(/viewDoc\(\s*["'](\d+)["']\s*,\s*["'](\d+)["']\s*,\s*["']([^"']*)["']\s*,\s*["']([^"']*)["']\s*,\s*["']([^"']*)["']\s*,\s*["']([^"']*)["']/);
  if (!m) throw new Error('viewDoc not found');
  const url = `https://dart.fss.or.kr/report/viewer.do?rcpNo=${m[1]}&dcmNo=${m[2]}&eleId=${m[3]}&offset=${m[4]}&length=${m[5]}&dtd=${m[6]}`;
  const v = await fetchWithTimeout(url, { headers: H }, 8000);
  if (!v.ok) throw new Error('viewer HTTP ' + v.status);
  const buf = await v.arrayBuffer();
  const ct = v.headers.get('content-type') || '';
  return decodeText(buf, /utf-?8/i.test(ct) ? 'utf-8' : 'euc-kr');
}

/** 공시 원문 → 줄 단위 텍스트 */
export async function fetchDartDoc(rcpNo) {
  return htmlToLines(await fetchDartHtml(rcpNo));
}

/** 화면 표시용으로 원문 HTML 정리 (표 구조만 남기고 속성·스크립트 제거) */
export function sanitizeHtml(html, max = 90000) {
  let s = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<(script|style|iframe|object|embed|noscript)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!/^(table|thead|tbody|tfoot|tr|td|th|p|br|div|span|b|strong|i|em|u|ul|ol|li|h[1-6]|sup|sub)$/.test(t)) return ' ';
    if (m.startsWith('</')) return `</${t}>`;
    const keep = [];
    const cs = attrs.match(/colspan\s*=\s*["']?(\d+)/i); if (cs && (t === 'td' || t === 'th')) keep.push(`colspan="${cs[1]}"`);
    const rs = attrs.match(/rowspan\s*=\s*["']?(\d+)/i); if (rs && (t === 'td' || t === 'th')) keep.push(`rowspan="${rs[1]}"`);
    return `<${t}${keep.length ? ' ' + keep.join(' ') : ''}>`;
  });
  s = s.replace(/<\/?(html|body)[^>]*>/gi, '').replace(/\s{2,}/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max).replace(/<[^>]*$/, '') + '<p>… (이하 생략 — 원문 링크에서 전체 보기)</p>';
  return s;
}

export function htmlToLines(html) {
  const body = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const text = decodeEntities(
    body
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|th|p|div|tr|span|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
  );
  return textToLines(text);
}
export const textToLines = (t) => t.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

// ───────────── 헬퍼 ─────────────
const num = (s) => {
  if (s === undefined || s === null) return null;
  const x = String(s).replace(/[,\s원주%]/g, '');
  if (!x || x === '-' || !/^-?\d+(\.\d+)?$/.test(x)) return null;
  return Number(x);
};
const idx = (L, re, from = 0) => { for (let i = from; i < L.length; i++) if (re.test(L[i])) return i; return -1; };
const after = (L, re, k = 1, from = 0) => { const i = idx(L, re, from); return i >= 0 && L[i + k] !== undefined ? L[i + k] : null; };
/** 라벨 이후 처음 나오는 sub 라벨의 값 (예: '2. 취득예정금액' 이후 '보통주식' 다음 줄) */
const afterSub = (L, re, subRe, span = 8) => { const i = idx(L, re); if (i < 0) return null; for (let j = i + 1; j < Math.min(L.length, i + span); j++) if (subRe.test(L[j])) return L[j + 1] ?? null; return null; };
const clean = (s) => (s && s !== '-' ? s : null);

export function won(n) {
  if (n === null || n === undefined) return null;
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  const trim = (x) => x.replace(/\.0+$|(\.\d*?)0+$/, '$1');
  if (a >= 1e12) return s + trim((a / 1e12).toFixed(a >= 1e13 ? 1 : 2)) + '조';
  if (a >= 1e8) return s + Math.round(a / 1e8).toLocaleString('ko-KR') + '억';
  if (a >= 1e4) return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만';
  return s + a.toLocaleString('ko-KR') + '원';
}
export function shares(n) {
  if (n === null || n === undefined) return null;
  if (n >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '억주';
  if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + '만주';
  return n.toLocaleString('ko-KR') + '주';
}
const pct = (v) => (v === null || v === undefined ? null : `${v > 0 ? '+' : ''}${Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`);
const UNIT = { 조원: 1e12, 억원: 1e8, 백만원: 1e6, 천원: 1e3, 원: 1 };

/** 보고서명 정리 (원문을 못 읽었을 때의 기본 제목) */
export function cleanTitle(nm) {
  let s = String(nm || '').replace(/\s+/g, '');
  const corrected = /^\[[^\]]*정정\]/.test(s);
  s = s.replace(/^\[[^\]]*\]/, '');
  s = s.replace(/^주요사항보고서\((.*)\)$/, '$1').replace(/^주요사항보고서\((.*?)\)(\(.*\))$/, '$1$2');
  s = s.replace(/\((공정공시|자율공시|안내공시|종속회사의주요경영사항|자회사의주요경영사항)\)/g, (m, x) => (/종속|자회사/.test(x) ? '(자회사)' : ''));
  s = s.replace(/연결재무제표기준영업\(잠정\)실적/, '연결 잠정실적').replace(/영업\(잠정\)실적/, '잠정실적');
  s = s.replace(/단일판매ㆍ공급계약체결/, '공급계약 체결').replace(/임원ㆍ주요주주특정증권등소유상황보고서/, '임원·주요주주 지분 변동');
  s = s.replace(/타법인주식및출자증권(취득|처분)결정/, '타법인 주식 $1 결정').replace(/투자판단관련주요경영사항/, '투자판단 관련 주요사항').replace(/유상증자또는주식관련사채등의발행결과/, '증자·사채 발행 결과').replace(/최대주주등소유주식변동신고서/, '최대주주 지분 변동').replace(/기업설명회\(IR\)개최/, 'IR 개최')
  s = s.replace(/주식등의대량보유상황보고서/, '5% 대량보유 보고').replace(/결정$/, ' 결정').replace(/ㆍ/g, '·');
  return (corrected ? '[정정] ' : '') + s;
}

/** 원문 줄 → { title, sub } */
export function summarizeDart(reportName, lines) {
  const nm = String(reportName || '').replace(/\s+/g, '');
  let L = lines;
  let reason = null;
  // 정정 공시: 앞쪽 '정정사항' 표를 건너뛰고 본문 서식부터 읽음
  const ci = L.findIndex((x) => /^정정\s*후$/.test(x));
  if (ci >= 0 && ci < 60) {
    reason = after(L, /^\d\.\s*정정사유$/);
    const j = idx(L, /^1\.\s*\S/, ci + 1);
    if (j > 0) L = L.slice(Math.max(0, j - 1));
  }
  const pre = /^\[[^\]]*정정\]/.test(nm) ? '[정정] ' : '';
  const sub = (/(종속회사|자회사)의주요경영사항/.test(nm) ? '자회사 · ' : '') + (reason ? `정정사유: ${reason.slice(0, 40)} · ` : '');
  const out = (title, s) => (title ? { title: pre + title, sub: s ? sub + s : sub.replace(/ · $/, '') || null } : null);

  // 잠정실적
  if (/잠정\)?실적|영업\(잠정\)/.test(nm)) {
    const unit = (L.find((x) => /단위\s*:/.test(x)) || '').match(/(조원|억원|백만원|천원|원)/)?.[1] || '원';
    const mul = UNIT[unit];
    const q = L.map((x) => x.match(/\(`?(\d{2})\.(\d)Q\)/)).find(Boolean);
    const period = q ? `${q[1]}년 ${q[2]}Q` : (L.map((x) => x.match(/\(`?(\d{2})년?\)/)).find(Boolean) ? '연간' : '');
    const metric = (label) => {
      const i = idx(L, new RegExp('^' + label + '$'));
      if (i < 0) return null;
      const j = idx(L, /^당해실적$/, i);
      if (j < 0 || j - i > 3) return null;
      const v = L.slice(j + 1, j + 8);
      const cur = num(v[0]);
      if (cur === null) return null;
      return { cur: cur * mul, qoq: num(v[2]), qoqT: clean(v[3]), yoy: num(v[5]), yoyT: clean(v[6]) };
    };
    const rev = metric('매출액'), op = metric('영업이익'), ni = metric('당기순이익');
    if (!rev && !op) return null;
    const desc = (m) => (m.yoyT ? m.yoyT : m.yoy !== null ? `YoY ${pct(m.yoy)}` : m.qoqT ? m.qoqT : m.qoq !== null ? `QoQ ${pct(m.qoq)}` : '');
    const main = op || rev;
    const title = `${period ? period + ' ' : ''}잠정실적 · ${op ? '영업이익' : '매출'} ${won(main.cur)}${desc(main) ? ` (${desc(main)})` : ''}`;
    const s = [rev && op ? `매출 ${won(rev.cur)}${desc(rev) ? ` (${desc(rev)})` : ''}` : '', ni ? `순이익 ${won(ni.cur)}${desc(ni) ? ` (${desc(ni)})` : ''}` : '', op && op.qoq !== null ? `영업이익 QoQ ${pct(op.qoq)}` : ''].filter(Boolean).join(' · ');
    return out(title, s);
  }

  // 공급계약
  if (/공급계약/.test(nm)) {
    const amt = num(after(L, /^계약금액\s*총액/)) ?? num(after(L, /^(확정\s*)?계약금액/));
    const ratio = num(after(L, /^매출액\s*대비/));
    const party = clean(after(L, /^\d+\.\s*계약상대(방)?$/)) || clean(after(L, /계약상대(방)?$/));
    const name = clean(after(L, /체결계약명|판매ㆍ공급계약\s*내용/));
    const end = clean(afterSub(L, /계약기간/, /^종료일/));
    if (amt === null) return null;
    const kind = /해지/.test(nm) ? '공급계약 해지' : '공급계약 체결';
    const p = party ? party.replace(/\s*\([A-Za-z][^)]*\)\s*$/, '') : null;
    return out(`${won(amt)} ${kind}${ratio !== null ? ` · 매출 대비 ${ratio}%` : ''}`, [p, name, end ? `~${end}` : ''].filter(Boolean).join(' · '));
  }

  // 유상증자
  if (/유상증자결정/.test(nm)) {
    const newSh = num(afterSub(L, /신주의\s*종류와\s*수/, /^보통주식/));
    const preSh = num(afterSub(L, /증자전/, /^보통주식/));
    const price = num(afterSub(L, /신주\s*발행가액|발행가액/, /^보통주식/, 12)) ?? num(afterSub(L, /예정발행가|확정발행가/, /^보통주식/, 12));
    const method = (after(L, /증자방식/) || '').replace(/증자$/, '').replace(/증자/g, '') || null;
    let amt = 0;
    const a = idx(L, /자금조달의\s*목적/), b = idx(L, /증자방식/, a + 1);
    if (a >= 0) for (let i = a + 1; i < (b > a ? b : a + 14); i++) if (/\(원\)$/.test(L[i])) amt += num(L[i + 1]) || 0;
    const disc = num(after(L, /할인율\s*또는\s*할증율|할인율/));
    if (!newSh && !amt) return null;
    const dil = newSh && preSh ? (newSh / preSh) * 100 : null;
    return out(`${method ? method + ' ' : ''}유상증자 ${amt ? won(amt) : shares(newSh)} 결정`, [newSh ? `신주 ${shares(newSh)}${dil ? ` (기존 주식의 ${dil.toFixed(1)}%)` : ''}` : '', price ? `발행가 ${price.toLocaleString('ko-KR')}원${disc !== null ? ` (할인 ${disc}%)` : ''}` : ''].filter(Boolean).join(' · '));
  }

  // 전환사채 / 신주인수권부사채 / 교환사채
  if (/(전환사채|신주인수권부사채|교환사채)권?발행결정/.test(nm)) {
    const kind = /전환/.test(nm) ? '전환사채(CB)' : /신주인수권/.test(nm) ? '신주인수권부사채(BW)' : '교환사채(EB)';
    const amt = num(after(L, /권면.*총액\s*\(원\)/));
    const method = clean(after(L, /사채발행방법/));
    const price = num(after(L, /(전환가액|행사가액|교환가액)\s*\(원/));
    const ci2 = idx(L, /(전환|행사|교환)에\s*관한/);
    const ratio = num(after(L, /주식총수\s*대비\s*비율/, 1, Math.max(0, ci2)));
    const cp = num(after(L, /표면이자율/)), ytm = num(after(L, /만기이자율/));
    if (amt === null) return null;
    return out(`${method ? method + ' ' : ''}${kind} ${won(amt)} 발행`, [price ? `${/전환/.test(nm) ? '전환가' : /교환/.test(nm) ? '교환가' : '행사가'} ${price.toLocaleString('ko-KR')}원` : '', ratio !== null ? `주식총수 대비 ${ratio}%` : '', cp !== null ? `표면 ${cp}% / 만기 ${ytm ?? '-'}%` : ''].filter(Boolean).join(' · '));
  }

  // 자기주식
  if (/자기주식취득신탁계약체결/.test(nm)) {
    const amt = num(after(L, /계약금액\s*\(원\)/));
    return amt === null ? null : out(`자사주 ${won(amt)} 신탁계약 체결`, clean(after(L, /계약목적/)));
  }
  if (/자기주식취득결정/.test(nm)) {
    const amt = num(afterSub(L, /취득예정금액/, /^보통주식/));
    const sh = num(afterSub(L, /취득예정주식/, /^보통주식/));
    const purpose = clean(after(L, /취득목적/)), method = clean(after(L, /취득방법/));
    if (amt === null && sh === null) return null;
    return out(`자사주 ${amt ? won(amt) : shares(sh)} 매입 결정${purpose && /소각/.test(purpose) ? ' · 소각 목적' : ''}`, [sh ? shares(sh) : '', method, purpose].filter(Boolean).join(' · '));
  }
  if (/자기주식처분결정/.test(nm)) {
    const amt = num(afterSub(L, /처분예정금액/, /^보통주식/));
    const sh = num(afterSub(L, /처분예정주식/, /^보통주식/));
    if (amt === null && sh === null) return null;
    return out(`자사주 ${amt ? won(amt) : shares(sh)} 처분 결정`, [sh ? shares(sh) : '', clean(after(L, /처분목적/)), clean(after(L, /처분상대방/))].filter(Boolean).join(' · '));
  }
  if (/주식소각결정/.test(nm)) {
    const sh = num(afterSub(L, /소각할\s*주식의\s*종류와\s*수/, /^보통주식/));
    const tot = num(afterSub(L, /발행주식총수/, /^보통주식/));
    const amt = num(after(L, /소각예정금액/));
    if (sh === null) return null;
    return out(`자사주 ${shares(sh)} 소각 결정${tot ? ` · 발행주식의 ${((sh / tot) * 100).toFixed(2)}%` : ''}`, [amt ? `소각금액 ${won(amt)}` : '', clean(after(L, /취득방법/)), clean(after(L, /소각\s*예정일/)) ? `소각일 ${after(L, /소각\s*예정일/)}` : ''].filter(Boolean).join(' · '));
  }

  // 배당
  if (/배당결정/.test(nm) && !/주주명부폐쇄/.test(nm)) {
    const per = num(afterSub(L, /1주당\s*배당금/, /^보통주식/));
    const yld = num(afterSub(L, /시가배당[률율]/, /^보통주식/));
    const kind = clean(after(L, /배당구분/)) || '배당';
    const total = num(after(L, /배당금총액/));
    const date = clean(after(L, /배당기준일/));
    if (per === null) return null;
    return out(`${kind} 주당 ${per.toLocaleString('ko-KR')}원${yld !== null ? ` · 시가배당률 ${yld}%` : ''}`, [total ? `총 ${won(total)}` : '', date ? `기준일 ${date}` : ''].filter(Boolean).join(' · '));
  }

  // 타법인 주식 취득/처분
  if (/타법인주식및출자증권(취득|처분)결정/.test(nm)) {
    const buy = /취득결정/.test(nm);
    const target = (clean(after(L, /회사명\s*\(국적\)|^회사명/)) || '').replace(/^(주식회사|\(주\)|㈜)\s*|\s*(주식회사|\(주\))$/g, '') || null;
    const amt = num(after(L, buy ? /^취득금액/ : /^처분금액/));
    const ratio = num(after(L, /(자산총액|자기자본)대비\s*\(%\)/));
    const stake = num(after(L, /^지분비율/));
    if (!target || amt === null) return null;
    return out(`${target} ${stake !== null && buy ? `지분 ${stake}% ` : ''}${won(amt)} ${buy ? '취득' : '처분'}`, [ratio !== null ? `자산 대비 ${ratio}%` : '', clean(after(L, buy ? /취득목적/ : /처분목적/))].filter(Boolean).join(' · '));
  }

  // 무상증자 / 감자 / 최대주주 변경
  if (/무상증자결정/.test(nm)) {
    const per = num(after(L, /1주당\s*신주배정\s*주식수/)) ?? num(afterSub(L, /1주당\s*신주배정/, /^보통주식/));
    return per === null ? null : out(`무상증자 · 1주당 ${per}주 배정`, clean(after(L, /신주배정기준일/)) ? `배정기준일 ${after(L, /신주배정기준일/)}` : null);
  }
  if (/감자결정/.test(nm)) {
    const ratio = num(afterSub(L, /감자비율/, /^보통주식/)) ?? num(after(L, /감자비율/));
    return ratio === null ? null : out(`감자 결정 · 감자비율 ${ratio}%`, clean(after(L, /감자방법/)));
  }
  if (/^최대주주변경$|^\[.*\]최대주주변경$/.test(nm)) {
    const bi = idx(L, /^변경\s*전$/), ai = idx(L, /^변경\s*후$/);
    if (ai < 0) return null;
    const pick = (i) => (/^최대주주/.test(L[i + 1] || '') ? L[i + 2] : L[i + 1]);
    const strip = (x) => (x || '').replace(/\s*(주식회사|\(주\))$/, '').replace(/^(주식회사|\(주\))\s*/, '');
    const rate = num(after(L, /소유비율/, 1, ai));
    const who = strip(pick(ai));
    return out(`최대주주 변경${bi >= 0 ? ` ${strip(pick(bi))} →` : ' →'} ${who}${rate !== null ? ` (${rate}%)` : ''}`, clean(after(L, /변경사유$/)));
  }

  // "1. 제목"이 있는 서식 (투자판단 관련 주요경영사항, 조회공시 답변, 풍문 해명 등)
  const t = clean(after(L, /^1\.\s*제목$/));
  if (t) {
    const prefix = /조회공시/.test(nm) ? '조회공시 답변 · ' : '';
    const tt = t.replace(/\s*(에\s*대한|관련)\s*조회공시\s*(요구\s*)?답변.*$/, '').replace(/^\(주\)[^,]*,\s*/, '');
    let body = clean(after(L, /^2\.\s*(주요)?내용$/));
    if (body) body = body.replace(/^[□■○●\-\s]*(개요)?\s*/, '');
    return out(prefix + tt, body ? body.slice(0, 90) + (body.length > 90 ? '…' : '') : null);
  }
  return null;
}

/** 잠정실적 원문 줄 → 숫자 (원 단위) { y:2026, q:3 | null(연간), rev, op, ni } — 컨센서스 비교용 */
export function earnFigures(lines) {
  let L = lines;
  const ci = L.findIndex((x) => /^정정\s*후$/.test(x));
  if (ci >= 0 && ci < 60) { const j = idx(L, /^1\.\s*\S/, ci + 1); if (j > 0) L = L.slice(Math.max(0, j - 1)); }
  const unit = (L.find((x) => /단위\s*:/.test(x)) || '').match(/(조원|억원|백만원|천원|원)/)?.[1] || '원';
  const mul = UNIT[unit];
  const q = L.map((x) => x.match(/\(`?(\d{2})\.(\d)Q\)/)).find(Boolean);
  const val = (label) => {
    const i = idx(L, new RegExp('^' + label + '$'));
    if (i < 0) return null;
    const j = idx(L, /^당해실적$/, i);
    if (j < 0 || j - i > 3) return null;
    const v = num(L[j + 1]);
    return v === null ? null : v * mul;
  };
  const rev = val('매출액'), op = val('영업이익'), ni = val('당기순이익');
  if (rev === null && op === null) return null;
  return { y: q ? 2000 + Number(q[1]) : null, q: q ? Number(q[2]) : null, rev, op, ni };
}
