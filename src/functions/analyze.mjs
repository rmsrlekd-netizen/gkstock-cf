// /api/analyze?id=... → AI 5줄 요약 + 주가 긍정/부정 요인 (+ 기업 개요 한국어 요약). 결과는 저장해 재사용
// AI 키가 없거나 AI 호출이 실패하면 원문 기반 자동 요약(규칙 기반)을 대신 돌려줌 (fallback: true)
import { json } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { hasAI, analyzeFiling, aiProvider } from '../lib/ai.mjs';
import { findFiling, getFilingDoc } from '../lib/filing-doc.mjs';

const POS = [
  [/흑자\s?전환|turn(ed)? profitable/i, '흑자 전환'], [/YoY \+|전년\s?대비\s?\+|up \d+% (from|year)/i, '전년 대비 증가'], [/(매출|영업이익|순이익)[^.\n]{0,20}(증가|성장)|record (revenue|quarter)|revenue (grew|increased|rose)/i, '실적 성장'],
  [/가이던스[^.\n]{0,10}상향|raise[sd]? (its |full[- ]year )?guidance/i, '가이던스 상향'], [/공급계약|수주|contract award|awarded|definitive agreement/i, '신규 계약·수주'],
  [/자기주식\s?취득|자사주\s?(매입|취득)|share repurchase|buyback/i, '자사주 매입'], [/소각/, '주식 소각'], [/배당|dividend/i, '배당'],
  [/FDA[^.\n]{0,30}(approv|clear|grant)|품목허가|승인/i, '허가·승인'], [/무상증자/, '무상증자'], [/partnership|collaboration|제휴|협력/i, '제휴·협력'],
];
const NEG = [
  [/적자\s?(전환|확대|지속)|net loss/i, '적자'], [/(매출|영업이익|순이익)[^.\n]{0,20}감소|revenue (declined|decreased|fell)/i, '실적 감소'],
  [/가이던스[^.\n]{0,10}하향|lower(ed|s)? (its )?guidance/i, '가이던스 하향'], [/유상증자|public offering|registered direct|private placement|at-the-market/i, '신주 발행에 따른 지분 희석'],
  [/전환사채|신주인수권|convertible|warrant/i, '잠재 주식 증가(희석)'], [/소송|lawsuit|litigation/i, '소송 리스크'], [/횡령|배임|불성실공시|거래정지|상장폐지|delist/i, '거래·상장 리스크'],
  [/감자/, '감자'], [/장내\s?매도|매도\s?\d|sale of|sold/i, '내부자·주요주주 매도'], [/중단|terminat|discontinu|철회/i, '계약·사업 중단'],
];

function fallback(title, sub, lines) {
  const text = [title, sub, ...lines.slice(0, 12)].join('\n');
  const sents = [title, ...String(sub || '').split(/\s·\s/).filter((x) => x.length > 4)].slice(0, 3);
  for (const l of lines) {
    for (const s of String(l).split(/(?<=[.!?。다])\s+/)) {
      const t = s.replace(/\s+/g, ' ').trim();
      if (t.length < 12 || t.length > 220 || /^[-–·\d\s.,()%:]+$/.test(t)) continue;
      if (sents.some((x) => x.slice(0, 30) === t.slice(0, 30))) continue;
      sents.push(t.length > 110 ? t.slice(0, 108) + '…' : t);
      if (sents.length >= 5) break;
    }
    if (sents.length >= 5) break;
  }
  const positive = POS.filter(([re]) => re.test(text)).map(([, l]) => l).slice(0, 3);
  const negative = NEG.filter(([re]) => re.test(text)).map(([, l]) => l).slice(0, 3);
  const verdict = positive.length > negative.length ? '긍정' : negative.length > positive.length ? '부정' : '중립';
  return { summary: sents.slice(0, 5), positive, negative, verdict };
}

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^(SEC|DART)-[\d-]+$|^(NEWS|PR)-[a-z0-9]+$/.test(id)) return json({ ok: false, error: '잘못된 공시 ID' }, { status: 400, cdnSeconds: 60 });
  const cached = await getJSON(`ai/${id}`);
  if (cached) return json({ ok: true, ...cached }, { cdnSeconds: 86400, swr: 86400 });
  let it, doc, title;
  try {
    it = await findFiling(id);
    if (!it) return json({ ok: false, error: '공시를 찾을 수 없습니다' }, { status: 404, cdnSeconds: 60 });
    doc = await getFilingDoc(it);
    title = it.titleKo || it.title || it.summary?.title || it.ko?.title || it.pr?.headline || it.formKo || it.form;
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 20 });
  }
  const text = (doc.lines || []).join('\n');
  let aiError = hasAI() ? null : 'AI 키(GEMINI_API_KEY 또는 ANTHROPIC_API_KEY)가 설정되지 않았습니다';
  if (hasAI() && text.length >= 15) {
    try {
      const src = it.src === 'DART' || it.market === 'KR' ? 'KR' : 'US';
      const ck = src === 'KR' ? it.corpCode : (it.ticker || '').toUpperCase();
      const comp = ck ? await getJSON(`company/${src}/${ck}`) : null;
      const hasOv = ck ? await getJSON(`aiov/${src}/${ck}`) : null;
      const a = await analyzeFiling({ company: it.name || it.company || '', ticker: it.ticker, market: src, kind: it.src, title, form: it.form || it.source || '', text, overviewRaw: !hasOv && comp?.overviewRaw ? comp.overviewRaw : null });
      if (!a.summary.length) throw new Error('AI 응답에 요약이 없습니다');
      if (a.overview && ck) await setJSON(`aiov/${src}/${ck}`, { text: a.overview, at: Date.now() }).catch(() => {});
      const out = { id, provider: aiProvider(), basis: doc.note || null, summary: a.summary, positive: a.positive, negative: a.negative, verdict: a.verdict, overview: a.overview || hasOv?.text || null, at: Date.now() };
      await setJSON(`ai/${id}`, out).catch(() => {});
      return json({ ok: true, ...out }, { cdnSeconds: 86400, swr: 86400 });
    } catch (e) {
      aiError = String(e.message || e).slice(0, 300);
      await setJSON('ai/lastError', { at: Date.now(), id, error: aiError }).catch(() => {});
    }
  } else if (text.length < 15) aiError = aiError || '원문 내용이 비어 있습니다';
  // AI 실패 → 규칙 기반 요약 (저장하지 않음: 다음에 AI 재시도)
  const sub = it.summary?.sub || it.ko?.sub || it.pr?.deck || it.desc || '';
  const f = fallback(title, sub, doc.lines || []);
  return json({ ok: true, id, fallback: true, provider: null, aiError, basis: doc.note || null, ...f, overview: null, at: Date.now() }, { cdnSeconds: 120 });
};

export const config = { path: '/api/analyze' };
