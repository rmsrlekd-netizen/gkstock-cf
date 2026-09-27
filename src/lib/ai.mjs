// (선택) AI 요약 — GEMINI_API_KEY 또는 ANTHROPIC_API_KEY 가 있을 때만 동작
import { fetchWithTimeout } from './util.mjs';

// 사용할 AI: GEMINI_API_KEY(구글) 또는 ANTHROPIC_API_KEY(Claude)
// ※ 구글 키(AIza…)를 ANTHROPIC_API_KEY 칸에 넣었어도 자동으로 Gemini로 인식
const isGoogle = (k) => /^(AIza|AQ\.)/.test(k || '');
const googleKey = () => (process.env.GEMINI_API_KEY || '').trim() || (isGoogle(process.env.ANTHROPIC_API_KEY) ? process.env.ANTHROPIC_API_KEY.trim() : null);
const claudeKey = () => (process.env.ANTHROPIC_API_KEY && !isGoogle(process.env.ANTHROPIC_API_KEY) ? process.env.ANTHROPIC_API_KEY.trim() : null);
export const aiProvider = () => (googleKey() ? 'Gemini' : claudeKey() ? 'Claude' : null);
export const hasAI = () => !!aiProvider();

async function gemini(prompt, { maxTokens, timeout }) {
  const models = [...new Set([process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'].filter(Boolean))];
  const until = Date.now() + timeout;
  let lastErr;
  for (const model of models) {
    for (const thinking of [true, false]) {
      const left = until - Date.now();
      if (left < 2500) break;
      const cfg = { maxOutputTokens: maxTokens, temperature: 0.2, responseMimeType: 'application/json' };
      if (thinking) cfg.thinkingConfig = { thinkingBudget: 0 };
      // 새 형식(AQ.) 키와 기존(AIza) 키 모두 x-goog-api-key 헤더로 전달
      const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': googleKey() },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: cfg }),
      }, left);
      const body = await r.text();
      if (r.ok) {
        const j = JSON.parse(body);
        const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
        if (text) return text;
        lastErr = new Error('Gemini 빈 응답 ' + (j.candidates?.[0]?.finishReason || ''));
        continue;
      }
      lastErr = new Error(`Gemini API HTTP ${r.status} (${model}) ${body.slice(0, 250)}`);
      if (r.status === 400 && /thinking|invalid argument/i.test(body) && thinking) continue; // 생각 설정을 빼고 같은 모델 재시도
      if ([404, 429, 500, 502, 503, 504].includes(r.status) || (r.status === 400 && /model|not found|not supported|invalid argument/i.test(body))) break; // 다음 모델
      throw lastErr; // 키 오류 등
    }
  }
  throw lastErr || new Error('Gemini API 시간 부족');
}

async function anthropic(prompt, { maxTokens, timeout }) {
  const models = [...new Set([process.env.ANTHROPIC_MODEL, 'claude-haiku-4-5', 'claude-3-5-haiku-latest'].filter(Boolean))];
  const until = Date.now() + timeout;
  let lastErr;
  for (const model of models) {
    const left = until - Date.now();
    if (left < 2500) break;
    const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': claudeKey(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    }, left);
    if (r.ok) {
      const j = await r.json();
      return (j.content || []).map((c) => c.text || '').join('');
    }
    const body = (await r.text()).slice(0, 300);
    lastErr = new Error(`Claude API HTTP ${r.status} (${model}) ${body}`);
    if (!(r.status === 404 || /model/i.test(body))) break;
  }
  throw lastErr || new Error('Claude API 시간 부족');
}

/** 프롬프트 → AI 응답 텍스트 */
export async function claude(prompt, { maxTokens = 1200, timeout = 9000 } = {}) {
  if (googleKey()) return gemini(prompt, { maxTokens, timeout });
  if (claudeKey()) return anthropic(prompt, { maxTokens, timeout });
  throw new Error('AI 키 미설정');
}
export const askAI = claude;

export function parseJSON(text, open = '{', close = '}') {
  const a = text.indexOf(open), b = text.lastIndexOf(close);
  if (a < 0 || b < a) throw new Error('AI 응답 형식 오류');
  return JSON.parse(text.slice(a, b + 1));
}

/** 미국 공시 목록용 한국어 한 줄 제목 (수집기에서 사용) */
export async function koreanHeadlines(batch) {
  if (!hasAI() || !batch.length) return {};
  const input = batch.map((b) => ({ id: b.id, company: b.company, ticker: b.ticker, form: b.form, items: b.items, headline: b.headline, text: (b.excerpt || '').slice(0, 1200) }));
  const prompt = `다음은 미국 SEC 공시(8-K/6-K 등)의 보도자료 제목과 본문 앞부분입니다. 한국 개인투자자가 한눈에 이해하도록 각 공시의 "핵심 내용"을 한국어로 요약하세요.
규칙:
- title: 45자 이내. 숫자(매출, EPS, 계약 금액, 지분율, 가이던스 등)가 있으면 반드시 포함. 예) "3분기 매출 467억달러(+56%)·EPS 1.05달러, 가이던스 상향"
- sub: 80자 이내 보충 설명 (없으면 빈 문자열)
- 회사명은 title에 쓰지 말 것. 추측 금지, 본문에 있는 사실만.
- 출력은 JSON 배열만: [{"id":"...","title":"...","sub":"..."}]

입력:
${JSON.stringify(input)}`;
  const arr = parseJSON(await claude(prompt, { maxTokens: 1500, timeout: 20000 }), '[', ']');
  const out = {};
  for (const x of arr) if (x && x.id && x.title) out[x.id] = { title: String(x.title).slice(0, 80), sub: String(x.sub || '').slice(0, 140) };
  return out;
}

/** 공시 상세 분석: 5줄 요약 + 주가 긍정/부정 요인 (+ 기업 개요 한국어 요약) */
export async function analyzeFiling({ company, ticker, market, kind, title, form, text, overviewRaw }) {
  const what = kind === 'NEWS' ? `${market === 'KR' ? '한국' : '미국'} 기업 관련 뉴스` : kind === 'PR' ? `${market === 'KR' ? '한국' : '미국'} 기업 보도자료` : market === 'KR' ? '한국 DART 공시' : '미국 SEC 공시';
  const prompt = `당신은 한국 개인투자자를 돕는 증권 애널리스트입니다. 아래 ${what}를 분석하세요.

회사: ${company}${ticker ? ` (${ticker})` : ''}
제목: ${title}${form ? ` [${form}]` : ''}
${overviewRaw ? `\n회사 사업 설명(원문):\n${overviewRaw.slice(0, 1500)}\n` : ''}
원문(일부):
${text.slice(0, 9000)}

다음 JSON 하나만 출력하세요(설명 문장 없이):
{
  "headline": "이 공시·기사의 핵심 내용을 한국어 한 줄 제목으로 (45자 이내, 숫자 포함, 회사명 제외)",
  "summary": ["핵심 내용 요약, 최대 5줄, 각 줄 60자 이내, 숫자·날짜 포함"],
  "positive": ["주가에 긍정적으로 작용할 수 있는 요인 1~3개, 각 70자 이내"],
  "negative": ["주가에 부정적으로 작용할 수 있는 요인·리스크 1~3개, 각 70자 이내"],
  "verdict": "긍정" 또는 "중립" 또는 "부정",
  "overview": ${overviewRaw ? '"이 회사가 무엇을 하는 회사인지 2~3문장 한국어 요약"' : 'null'}
}
규칙: 원문에 있는 사실만 사용하고 추측하지 마세요. 해당 요인이 없으면 빈 배열. 투자 권유 표현 금지. 모두 한국어로.`;
  const j = parseJSON(await claude(prompt, { maxTokens: 1600, timeout: 25000 }));
  const arr = (v, n) => (Array.isArray(v) ? v.filter(Boolean).map((s) => String(s).slice(0, 140)).slice(0, n) : []);
  return {
    headline: j.headline ? String(j.headline).slice(0, 80) : null,
    summary: arr(j.summary, 5),
    positive: arr(j.positive, 4),
    negative: arr(j.negative, 4),
    verdict: ['긍정', '중립', '부정'].includes(j.verdict) ? j.verdict : '중립',
    overview: j.overview ? String(j.overview).slice(0, 400) : null,
  };
}

/** 영문 보도자료·뉴스 제목 → 한국어 핵심 제목 (목록용) */
export async function translateTitles(batch) {
  if (!hasAI() || !batch.length) return {};
  const prompt = `다음 영어 기업 보도자료·뉴스 제목을 한국 개인투자자가 바로 이해하도록 자연스러운 한국어 핵심 제목으로 바꾸세요.
규칙: 50자 이내, 숫자·금액·제품명 유지, 회사명은 빼도 됨, 과장 금지.
출력은 JSON 배열만: [{"id":"...","ko":"..."}]
입력: ${JSON.stringify(batch.map((b) => ({ id: b.id, title: b.title, desc: (b.desc || '').slice(0, 200) })))}`;
  const arr = parseJSON(await claude(prompt, { maxTokens: 1800, timeout: 20000 }), '[', ']');
  const out = {};
  for (const x of arr) if (x && x.id && x.ko) out[x.id] = String(x.ko).slice(0, 90);
  return out;
}

/** 오늘의 핵심 공시·뉴스 (여러 건 → 상위 5~7건 선정) */
export async function dailyDigest(items) {
  const prompt = `당신은 한국 개인투자자를 위한 증권 애널리스트입니다. 아래는 오늘 나온 한국·미국 기업 공시와 보도자료·뉴스 목록입니다.
주가에 영향이 클 만한 핵심 5~7건을 골라 중요도 순으로 정리하세요. 목록에 있는 사실만 사용하세요.
출력은 JSON 하나만:
{"headline":"오늘 시장의 공시 흐름 한 줄 요약(60자 이내)","items":[{"id":"목록의 id 그대로","title":"핵심 내용 한 줄(45자 이내)","why":"주가 영향 이유(60자 이내)","verdict":"긍정|중립|부정"}]}
목록: ${JSON.stringify(items)}`;
  const j = parseJSON(await claude(prompt, { maxTokens: 1800, timeout: 25000 }));
  return {
    headline: String(j.headline || '').slice(0, 120),
    items: (Array.isArray(j.items) ? j.items : []).slice(0, 8).map((x) => ({ id: String(x.id || ''), title: String(x.title || '').slice(0, 100), why: String(x.why || '').slice(0, 140), verdict: ['긍정', '중립', '부정'].includes(x.verdict) ? x.verdict : '중립' })),
  };
}
