// 공시 원문 텍스트 가져오기 (상세 창의 '원문 공시' + AI 분석 입력)
import { fetchTextCapped } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';
import { fetchDartHtml, htmlToLines, sanitizeHtml } from './dart-doc.mjs';
import { htmlToText } from './sec-doc.mjs';
import { SEC_HEADERS } from './sec-core.mjs';
import { TX_CODE } from './sec-parse.mjs';
import { fetchArticleLines } from './news.mjs';

export async function findFiling(id) {
  const key = id.startsWith('SEC-') ? 'sec/feed' : id.startsWith('DART-') ? 'dart/feed' : 'news/feed';
  const feed = await getJSON(key);
  const hit = (feed?.items || []).find((x) => x.id === id);
  if (hit) return hit;
  // 피드에서 빠진 오래된 항목은 영구 보관소 → 예전 저장본 순서로
  const { getArchived } = await import('./archive.mjs');
  return (await getArchived(id).catch(() => null)) || (await getJSON(`pg/${id}`))?.item || null;
}

/** 공시별 페이지용 사본 저장 (없을 때만) */
export async function snapshotItem(it) {
  if (!it?.id) return;
  if (await getJSON(`pg/${it.id}`)) return;
  const { _excerpt, txTries, docTries, aiTries, koTries, detailTries, ...item } = it;
  await setJSON(`pg/${it.id}`, { item, at: Date.now() }).catch(() => {});
}

function rowHref(indexHtml, re) {
  for (const r of indexHtml.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    if (!re.test(r)) continue;
    const href = (r.match(/href="([^"]+\.(?:htm|html|txt|xml))"/i) || [])[1];
    if (href && !/-index\.html?$/i.test(href)) return (href.startsWith('http') ? href : 'https://www.sec.gov' + href).replace('/ix?doc=', '');
  }
  return null;
}

async function secLines(it) {
  if (it.tx) {
    const t = it.tx, m = t.main;
    return {
      lines: [
        `Form 4 — 내부자 거래 보고`,
        `보고자: ${t.owner}${t.relation ? ` (${t.relation})` : ''}`,
        `거래일: ${t.date || '-'}`,
        m ? `주요 거래: ${m.label} ${Math.round(m.shares).toLocaleString('en-US')}주, 평균 $${(m.price || 0).toFixed(2)}, 총 $${Math.round(m.value || 0).toLocaleString('en-US')}` : '',
        t.after ? `거래 후 보유: ${Math.round(t.after).toLocaleString('en-US')}주` : '',
        t.tenb51 ? '10b5-1 사전 매매계획에 따른 거래' : '',
        `거래 건수: ${t.count}건 (코드: ${Object.entries(TX_CODE).map(([k, v]) => `${k}=${v}`).slice(0, 6).join(', ')} …)`,
      ].filter(Boolean),
      url: it.url,
    };
  }
  const idx = await fetchTextCapped(it.url, { headers: SEC_HEADERS }, 7000, 300000);
  const form = it.form.replace(/[/()]/g, '\\$&');
  const doc = rowHref(idx, />\s*EX-99\.1\s*</i) || rowHref(idx, new RegExp(`>\\s*${form}\\s*<`, 'i')) || rowHref(idx, />\s*EX-99/i) || rowHref(idx, /\.htm/i);
  if (!doc) return { lines: [], url: it.url };
  const html = await fetchTextCapped(doc, { headers: SEC_HEADERS }, 8000, 700000);
  return { lines: htmlToText(html), html: /\.txt$/i.test(doc) ? null : sanitizeHtml(html), url: doc };
}

/** 원문 줄 배열 (캐시) */
export async function getFilingDoc(it) {
  const key = `doc2/${it.id}`;
  const cached = await getJSON(key);
  if (cached) return cached;
  let res;
  if (it.src === 'NEWS' || it.src === 'PR') {
    const a = await fetchArticleLines(it);
    res = { lines: a.lines, html: a.html || null, url: it.url, note: a.note || null };
  } else if (it.src === 'DART') {
    const html = await fetchDartHtml(it.seq);
    res = { lines: htmlToLines(html), html: sanitizeHtml(html), url: it.url };
  } else {
    res = await secLines(it);
  }
  // 저장 용량 제한: 앞부분 약 3만 자
  let total = 0;
  const lines = [];
  for (const l of res.lines) { if (total > 40000) { lines.push('… (이하 생략 — 원문 링크에서 전체 보기)'); break; } lines.push(l); total += l.length; }
  const out = { lines, html: res.html || null, url: res.url, note: res.note || null, at: Date.now() };
  await setJSON(key, out).catch(() => {});
  return out;
}
