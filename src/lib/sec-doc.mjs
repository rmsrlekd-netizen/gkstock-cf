// SEC 8-K / 6-K 원문에서 "핵심 내용"을 뽑는다
//  - 보도자료(EX-99.x)가 있으면 그 헤드라인과 본문 앞부분
//  - 없으면 8-K 본문의 첫 Item 설명 문장
const NE = { rsquo: '’', lsquo: '‘', ldquo: '"', rdquo: '"', mdash: '—', ndash: '–', amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', reg: '®', trade: '™', copy: '©', bull: '•', hellip: '…' };
const dec = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, c) => {
  if (c[0] === '#') { const n = /^#x/i.test(c) ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : ' '; }
  return NE[c.toLowerCase()] ?? ' ';
});

export function htmlToText(html) {
  return dec(
    html
      .replace(/[\r\n\t]+/g, ' ') // 원문 HTML의 줄바꿈은 문장 중간에도 있으므로 공백으로
      .replace(/<head[\s\S]*?<\/head>/i, '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|td|h\d|li|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** 인덱스 페이지에서 문서 주소 찾기 (type: EX-99.1 등) */
function rowHref(indexHtml, re) {
  for (const r of indexHtml.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    if (!re.test(r)) continue;
    const href = (r.match(/href="([^"]+\.(?:htm|html|txt))"/i) || [])[1];
    if (href && !/-index\.html?$/i.test(href)) return href.startsWith('http') ? href : 'https://www.sec.gov' + href.replace(/^\/ix\?doc=/, '');
  }
  return null;
}
export const findExhibit = (h) => rowHref(h, />\s*EX-99\.1\s*</i) || rowHref(h, />\s*EX-99(\.\d+)?\s*</i);
export const findMain = (h) => rowHref(h, />\s*(8-K|6-K|8-K\/A)\s*</i);

const SKIP = /^(exhibit|ex-?\s?99)|press release|for immediate release|news release|^media|investor|^contacts?\b|^source:|^(nasdaq|nyse)\b|forward[- ]looking|^page \d+|table of contents|^\(?in (thousands|millions)|\.htm$|@|\(\d{3}\)|\d{3}[-.]\d{3}[-.]\d{4}|^(chief|svp|evp|vp|senior vice|vice president)\b|, (svp|evp|cfo|ceo|vp)\b/i;
const VERB = /\b(announces?|announced|reports?|reported|receives?|received|completes?|completed|enters?|entered|provides?|launch(es)?|appoints?|declares?|prices?|priced|closes?|closed|signs?|signed|secures?|achieves?|expands?|names?|named|regains?|updates?|raises?|affirms?|reaffirms?|to acquire|acquires?|agrees?|partners?|wins?|awarded|delivers?|posts?|increases?|approves?|approved|initiates?|results?|guidance)\b/i;
const DATELINE = /^[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z.]*\.?,?\s+[A-Z][a-z]+\.? \d{1,2},\s*\d{4}/;

/** 보도자료 줄 → 헤드라인 */
export function pickHeadline(lines) {
  const top = lines.slice(0, 45);
  let fb = null;
  for (let i = 0; i < top.length; i++) {
    let l = top[i];
    if (SKIP.test(l) || !/[A-Za-z]/.test(l) || /^\d/.test(l) || DATELINE.test(l) || l.length > 230) continue;
    if (l.length > 110 && /\.$/.test(l)) continue; // 본문 문장
    // 회사명이 윗줄로 잘린 경우 합치기
    const prev = top[i - 1];
    if (prev && prev.length < 25 && /^[A-Z]/.test(prev) && !SKIP.test(prev) && !/^\d/.test(prev) && /^[A-Z][a-z]+ /.test(l)) l = prev + ' ' + l;
    // 헤드라인이 다음 줄로 이어진 경우 합치기
    const next = top[i + 1];
    const dangling = /\b(updates?|announces?|reports?|for|of|and|to|with|in|on|the|a|an|its|at|from)$/i.test(l) || l.length < 45;
    if (dangling && next && !SKIP.test(next) && !DATELINE.test(next) && next.length < 150 && !/\.$/.test(next)) l = l + ' ' + next;
    if (l.length < 25 || l.split(' ').length < 4) continue;
    if (VERB.test(l)) return l;
    if (!fb) fb = l;
  }
  return fb;
}

const ABBR = /\b(Inc|Corp|Co|Ltd|L\.P|LP|N\.V|S\.A|No|U\.S|Mr|Ms|Mrs|Dr|Jr|Sr|St|vs|etc|[A-Z])$/;
/** 약어(Inc. 등)에서 끊기지 않는 첫 문장 */
export function firstSentence(text, max = 320) {
  for (let i = 40; i < Math.min(text.length, max); i++) {
    if (!/[.!?]/.test(text[i]) || !(i + 1 >= text.length || /\s/.test(text[i + 1]))) continue;
    if (text[i] === '.' && ABBR.test(text.slice(Math.max(0, i - 6), i))) continue;
    return text.slice(0, i + 1).trim();
  }
  return text.slice(0, max).trim() + (text.length > max ? '…' : '');
}

/** 8-K 본문 → 첫 번째 Item 설명 (9.01 제외) */
export function itemSentence(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!/^Item\s+\d\.\d{2}/i.test(lines[i]) || /^Item\s+9\.01/i.test(lines[i])) continue;
    const body = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      if (/^Item\s+\d\.\d{2}/i.test(lines[j]) || /^SIGNATURES?$/i.test(lines[j])) break;
      if (lines[j].length > 60) body.push(lines[j]);
      if (body.join(' ').length > 500) break;
    }
    const text = body.join(' ');
    if (text) return firstSentence(text);
  }
  return null;
}

export async function fetchFilingText(indexUrl, fetcher) {
  const idx = await fetcher(indexUrl);
  const ex = findExhibit(idx);
  if (ex) {
    const lines = htmlToText(await fetcher(ex));
    const headline = pickHeadline(lines);
    let hi = headline ? lines.findIndex((x) => headline.endsWith(x)) : -1;
    if (hi < 0) hi = 0;
    // 헤드라인 바로 아래 부제(핵심 수치가 있는 경우가 많음)
    const nx = lines[hi + 1];
    const deck = nx && !SKIP.test(nx) && !DATELINE.test(nx) && nx.length >= 20 && nx.length < 200 && !/\.$/.test(nx) ? nx : null;
    return { headline, deck, excerpt: lines.slice(hi + 1).join(' ').slice(0, 1800), doc: ex };
  }
  const main = findMain(idx);
  if (!main) return { none: true };
  const lines = htmlToText(await fetcher(main));
  const s = itemSentence(lines);
  return { itemText: s, excerpt: s || '', doc: main };
}
