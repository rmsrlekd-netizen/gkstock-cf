// /api/analyze?id=... → AI 5줄 요약 + 주가 긍정/부정 요인 (+ 기업 개요 한국어 요약). 결과는 저장해 재사용
// AI 키가 없거나 AI 호출이 실패하면 원문 기반 자동 요약(규칙 기반)을 대신 돌려줌 (fallback: true)
import { json as jsonRes } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { hasAI, analyzeFiling, aiProvider, claude, parseJSON } from '../lib/ai.mjs';
import { findFiling, getFilingDoc, snapshotItem } from '../lib/filing-doc.mjs';
import { koHeadline } from '../lib/sec-ko.mjs';
import { getSectors } from '../lib/sectors.mjs';
import { naverKrQuotes, naverUsQuotes, reutersOf } from '../lib/naver.mjs';

// 금액 → 읽기 쉬운 문자열
const krw = (v) => (v == null || !Number.isFinite(v) ? null : Math.abs(v) >= 1e12 ? (v / 1e12).toFixed(2) + '조원' : Math.round(v / 1e8).toLocaleString('ko-KR') + '억원');
const usdS = (v) => (v == null || !Number.isFinite(v) ? null : Math.abs(v) >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : '$' + (v / 1e6).toFixed(1) + 'M');

// 애널리스트에게 줄 배경 정보: 재무·밸류에이션, 최근 공시 흐름, 현재 주가 반응
async function context(it, src, comp) {
  const m = src === 'KR' ? krw : usdS;
  const f = comp?.fin || {}, r = comp?.ratios || {};
  const yoy = (a, b) => (a != null && b ? ` (전년 대비 ${(((a - b) / Math.abs(b)) * 100).toFixed(1)}%)` : '');
  const val = [
    comp?.marketCap ? `시가총액 ${m(comp.marketCap)}` : '',
    f.revenue != null ? `매출 ${m(f.revenue)}${yoy(f.revenue, f.revenuePrev)}` : '',
    f.opIncome != null ? `영업이익 ${m(f.opIncome)}${yoy(f.opIncome, f.opIncomePrev)}` : '',
    f.netIncome != null ? `순이익 ${m(f.netIncome)}` : '',
    f.period ? `(재무 기준: ${f.period})` : '',
    r.per ? `PER ${r.per.toFixed(1)}배` : '', r.pbr ? `PBR ${r.pbr.toFixed(1)}배` : '', r.roe ? `ROE ${r.roe.toFixed(1)}%` : '', r.debt ? `부채비율 ${r.debt.toFixed(0)}%` : '',
  ].filter(Boolean).join(', ');
  // 같은 회사의 최근 공시·보도 (최대 6건)
  let recent = [];
  try {
    const [sec, dart, news] = await Promise.all([getJSON('sec/feed'), getJSON('dart/feed'), getJSON('news/feed')]);
    const t = String(it.ticker || '').toUpperCase();
    const pool = [...(sec?.items || []), ...(dart?.items || []), ...(news?.items || [])].filter((x) => x.id !== it.id && t && String(x.ticker || '').toUpperCase() === t && x.src !== 'NEWS');
    recent = pool.map((x) => ({ ms: Date.parse(x.time || x.seenAt || (x.date ? x.date + 'T09:00:00+09:00' : 0)) || 0, t: `${(x.time || x.date || '').slice(0, 10)} ${x.form || x.formKo || x.source || ''}: ${x.ko?.title || x.summary?.title || x.titleKo || x.pr?.headline || x.title || x.titleClean || x.formKo || ''}`.slice(0, 140) }))
      .sort((a, b) => b.ms - a.ms).slice(0, 6).map((x) => x.t);
  } catch {}
  // 현재 주가 반응 (네이버 증권)
  let move = '';
  try {
    const t = String(it.ticker || '');
    if (t) {
      let q = null;
      if (src === 'KR') q = (await naverKrQuotes([t]))[t];
      else { const rc = reutersOf(t, it.exchange) || `${t.toUpperCase()}.O`; q = (await naverUsQuotes([rc]))[rc]; }
      if (q?.price != null) move = `현재가 ${src === 'KR' ? q.price.toLocaleString('ko-KR') + '원' : '$' + q.price} (당일 ${q.pct > 0 ? '+' : ''}${q.pct}%)`;
    }
  } catch {}
  return { val, recent, move };
}

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

// 진행 중인 분석을 같은 서버 안에서 공유 (미리 분석 중인 항목을 방문자가 열면 그 결과를 같이 기다림)
const inflight = new Map();
export function analyzeId(id) {
  if (inflight.has(id)) return inflight.get(id);
  const p = handle(id).finally(() => setTimeout(() => inflight.delete(id), 1000));
  inflight.set(id, p);
  return p;
}

// 빠른 요약: 처음 여는 공시는 심층 분석(20~40초) 전에 3~5초 안에 핵심 3줄 + 주가 영향을 먼저 보여줌
const qInflight = new Map();
/** 공시 한 줄 핵심 (저장된 심층·빠른 요약에서, 없으면 null) */
export async function savedHeadline(id) {
  const a = (await getJSON(`ai3/${id}`)) || (await getJSON(`aiq/${id}`));
  return a?.headline && !a.fallback ? a.headline : null;
}
export { quick as quickSummary };
async function quick(id) {
  const c = await getJSON(`aiq/${id}`);
  if (c) return c;
  const it = await findFiling(id);
  if (!it) throw new Error('공시를 찾을 수 없습니다');
  const doc = await getFilingDoc(it);
  const text = (doc.lines || []).join('\n');
  if (text.length < 15) throw new Error('원문 내용이 비어 있습니다');
  const title = it.titleKo || it.title || it.summary?.title || it.ko?.title || it.pr?.headline || it.formKo || it.form;
  const what = it.src === 'NEWS' ? '기업 뉴스' : it.src === 'PR' ? '기업 보도자료' : it.src === 'DART' ? '한국 DART 공시' : '미국 SEC 공시';
  const prompt = `아래 ${what}의 핵심을 한국 개인투자자에게 빠르게 알려줘라. 원문에 있는 사실만, 숫자·금액은 그대로.
- headline: 무슨 발표인지 한 줄 (35자 이내)
- summary: 핵심 정확히 3개 (각 60자 이내)
- verdict: 주가 영향 "긍정" / "중립" / "부정" 중 하나
JSON만: {"headline":"","summary":["","",""],"verdict":""}

[회사] ${it.name || it.company || ''}${it.ticker ? ` (${it.ticker})` : ''}
[제목] ${title}${it.form ? ` [${it.form}]` : ''}
[원문]
${text.slice(0, 5000)}`;
  const j = parseJSON(await claude(prompt, { maxTokens: 800, timeout: 15000, think: 0, tag: '빠른 요약' }));
  const summary = (Array.isArray(j?.summary) ? j.summary : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3);
  if (!summary.length) throw new Error('빠른 요약 실패');
  const out = { id, quick: true, headline: String(j.headline || '').slice(0, 60) || null, summary, verdict: ['긍정', '중립', '부정'].includes(j.verdict) ? j.verdict : '중립', at: Date.now() };
  await setJSON(`aiq/${id}`, out).catch(() => {});
  return out;
}

export default async (req) => {
  const u = new URL(req.url);
  const id = u.searchParams.get('id') || '';
  if (!/^(SEC|DART)-[\d-]+$|^(NEWS|PR)-[a-z0-9]+$/.test(id)) return jsonRes({ ok: false, error: '잘못된 공시 ID' }, { status: 400, cdnSeconds: 60 });
  const cached = await getJSON(`ai3/${id}`);
  if (cached) return jsonRes({ ok: true, ...cached }, { cdnSeconds: 86400, swr: 86400 });
  if (u.searchParams.get('quick') === '1') {
    if (!hasAI()) return jsonRes({ ok: false, error: 'AI 없음' }, { status: 503, cdnSeconds: 60 });
    try {
      if (!qInflight.has(id)) qInflight.set(id, quick(id).finally(() => setTimeout(() => qInflight.delete(id), 1000)));
      return jsonRes({ ok: true, ...(await qInflight.get(id)) }, { cdnSeconds: 300 });
    } catch (e) { return jsonRes({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 30 }); }
  }
  const r = await analyzeId(id);
  return jsonRes(r.body, r.opt);
};

// 반환: { body, opt } (json() 인자)
async function handle(id) {
  const json = (body, opt) => ({ body, opt });
  const cached = await getJSON(`ai3/${id}`);
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
  // 같은 공시가 방금(15분 안) AI 분석에 실패했으면 다시 부르지 않고 자동 요약으로 (한도 절약)
  const failed = await getJSON(`aifail/${id}`);
  // AI가 그 뒤에 한 번이라도 성공했으면(한도·결제 문제 해결) 바로 다시 시도
  const lastOk = failed ? await getJSON('ai/lastOk') : null;
  const recentFail = failed && Date.now() - failed.at < 15 * 60e3 && !(lastOk?.at > failed.at);
  if (recentFail) aiError = failed.error;
  if (hasAI() && text.length >= 15 && !recentFail) {
    try {
      const src = it.src === 'DART' || it.market === 'KR' ? 'KR' : 'US';
      const ck = src === 'KR' ? it.corpCode : (it.ticker || '').toUpperCase();
      const comp = ck ? await getJSON(`company2/${src}/${ck}`) : null;
      const hasOv = ck ? await getJSON(`aiov/${src}/${ck}`) : null;
      const sm = await getSectors({ allowFetch: false }).catch(() => null);
      const sraw = it.ticker && sm ? (src === 'KR' ? sm.kr?.[it.ticker] : sm.us?.[String(it.ticker).toUpperCase()]) : null;
      const sector = (sraw ? sraw.split('|')[0] : '') || comp?.sectorKo || [comp?.sector, comp?.industry].filter(Boolean).join(' · ') || '';
      const cx = await Promise.race([context(it, src, comp), new Promise((r) => setTimeout(() => r({ val: '', recent: [], move: '' }), 4000))]);
      const a = await analyzeFiling({ company: it.name || it.company || '', ticker: it.ticker, market: src, kind: it.src, title, form: it.form || it.source || '', text, overviewRaw: !hasOv && comp?.overviewRaw ? comp.overviewRaw : null, sector, valuation: cx.val, recent: cx.recent, move: cx.move });
      if (!a.summary.length) throw new Error('AI 응답에 요약이 없습니다');
      if (a.overview && ck) await setJSON(`aiov/${src}/${ck}`, { text: a.overview, at: Date.now() }).catch(() => {});
      const out = { id, provider: aiProvider(), basis: doc.note || null, headline: a.headline || null, summary: a.summary, positive: a.positive, negative: a.negative, analyst: a.analyst, points: a.points, impact: a.impact, watch: a.watch, sector: sector || null, verdict: a.verdict, overview: a.overview || hasOv?.text || null, at: Date.now() };
      await setJSON(`ai3/${id}`, out).catch(() => {});
      await setJSON('ai/lastOk', { at: Date.now(), id }).catch(() => {});
      await snapshotItem(it);
      return json({ ok: true, ...out }, { cdnSeconds: 86400, swr: 86400 });
    } catch (e) {
      aiError = String(e.message || e).slice(0, 300);
      await setJSON(`aifail/${id}`, { at: Date.now(), error: aiError }).catch(() => {});
      if (!/잠시 쉬는 중/.test(aiError)) await setJSON('ai/lastError', { at: Date.now(), id, error: aiError }).catch(() => {});
    }
  } else if (text.length < 15) aiError = aiError || '원문 내용이 비어 있습니다';
  // AI 실패 → 규칙 기반 요약 (저장하지 않음: 다음에 AI 재시도)
  const sub = it.summary?.sub || it.ko?.sub || it.pr?.deck || it.desc || '';
  const f = fallback(title, sub, doc.lines || []);
  const rk = it.src === 'SEC' ? koHeadline({ ...it, _excerpt: (doc.lines || []).slice(0, 40).join(' ') }) : null;
  if (rk) f.headline = rk.title;
  return json({ ok: true, id, fallback: true, provider: null, aiError, basis: doc.note || null, ...f, overview: null, at: Date.now() }, { cdnSeconds: 120 });
}

export const config = { path: '/api/analyze' };
