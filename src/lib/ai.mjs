// (선택) AI 요약 — GEMINI_API_KEY 또는 ANTHROPIC_API_KEY 가 있을 때만 동작
import { fetchWithTimeout } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';

// ── 한도 초과 보호: Gemini가 "한도 초과(429)"로 거절하면 잠시 AI 호출을 멈춤 (헛된 호출로 한도를 더 쓰지 않게) ──
let pauseMem = { until: 0, checked: 0 };
async function aiPausedUntil() {
  if (Date.now() - pauseMem.checked > 30e3) {
    const p = await getJSON('ai/pause').catch(() => null);
    pauseMem = { until: p?.until || 0, checked: Date.now(), reason: p?.reason };
  }
  return pauseMem.until > Date.now() ? pauseMem.until : 0;
}
const BILLING_RE = /spending cap|spend cap|prepayment|credits are depleted|billing/i;
async function pauseAI(body) {
  const billing = BILLING_RE.test(body);
  const daily = /PerDay|per day|daily/i.test(body);
  const m = body.match(/"retryDelay":\s*"(\d+)s"/);
  const ms = billing ? 30 * 60e3 : daily ? 30 * 60e3 : Math.min(10 * 60e3, Math.max(60e3, (Number(m?.[1]) || 60) * 1000));
  const reason = billing ? (/spend/i.test(body) ? 'Gemini 월 지출 한도(spend cap) 초과 — AI Studio에서 한도를 올려야 함' : 'Gemini 선불 크레딧 소진 — AI Studio에서 충전 필요') : daily ? '하루 한도 초과' : '분당 한도 초과';
  pauseMem = { until: Date.now() + ms, checked: Date.now(), reason };
  await setJSON('ai/pause', { until: pauseMem.until, reason: pauseMem.reason, at: Date.now() }).catch(() => {});
}
export async function aiPauseInfo() { const u = await aiPausedUntil(); return u ? { until: u, reason: pauseMem.reason } : null; }

// 사용할 AI: GEMINI_API_KEY(구글) 또는 ANTHROPIC_API_KEY(Claude)
// ※ 구글 키(AIza…)를 ANTHROPIC_API_KEY 칸에 넣었어도 자동으로 Gemini로 인식
const isGoogle = (k) => /^(AIza|AQ\.)/.test(k || '');
const googleKey = () => (process.env.GEMINI_API_KEY || '').trim() || (isGoogle(process.env.ANTHROPIC_API_KEY) ? process.env.ANTHROPIC_API_KEY.trim() : null);
const claudeKey = () => (process.env.ANTHROPIC_API_KEY && !isGoogle(process.env.ANTHROPIC_API_KEY) ? process.env.ANTHROPIC_API_KEY.trim() : null);
export const aiProvider = () => (googleKey() ? 'Gemini' : claudeKey() ? 'Claude' : null);
export const hasAI = () => !!aiProvider();

// Gemini가 일부 지역(Cloudflare 서버 위치)을 거절하면 서울 중계 서버로 우회
let geminiViaRelay = false;
// ── AI 사용량 기록 (기능별 호출 수·토큰) → 관리자 화면에서 어디서 비용이 나가는지 확인 ──
async function logUsage(tag, u) {
  if (!u) return;
  try {
    const d = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const key = `ai/usage/${d}`;
    const cur = (await getJSON(key)) || {};
    const t = cur[tag] || { n: 0, in: 0, out: 0, th: 0 };
    t.n++; t.in += u.promptTokenCount || 0; t.out += u.candidatesTokenCount || 0; t.th += u.thoughtsTokenCount || 0;
    cur[tag] = t;
    await setJSON(key, cur);
  } catch {}
}
export async function aiUsage(days = 7) {
  const out = [];
  for (let i = 0; i < days; i++) { const d = new Date(Date.now() + 9 * 3600e3 - i * 86400e3).toISOString().slice(0, 10); out.push({ date: d, tags: (await getJSON(`ai/usage/${d}`)) || {} }); }
  return out;
}

async function gemini(prompt, { maxTokens, timeout, json = true, think = 0, tag = '기타' }) {
  const models = [...new Set([process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'].filter(Boolean))];
  const until = Date.now() + timeout;
  let lastErr, n429 = 0, nOther = 0, body429 = '';
  for (const model of models) {
    for (const thinking of [true, false]) {
      if (until - Date.now() < 2500) break;
      const cfg = { maxOutputTokens: maxTokens, temperature: 0.2 };
      if (json) cfg.responseMimeType = 'application/json';
      if (thinking) cfg.thinkingConfig = { thinkingBudget: think }; // think>0: 답하기 전에 충분히 생각(심층 분석용)
      // 새 형식(AQ.) 키와 기존(AIza) 키 모두 x-goog-api-key 헤더로 전달
      const call = () => fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': googleKey() },
        relay: geminiViaRelay,
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: cfg }),
      }, Math.max(2500, until - Date.now()));
      let r = await call();
      let body = await r.text();
      // 직접 호출이 '지역 미지원'으로 거절되면 이후 호출은 서울 중계 서버로
      if (r.status === 400 && /location is not supported/i.test(body) && !geminiViaRelay && process.env.KR_RELAY_URL) {
        geminiViaRelay = true;
        r = await call();
        body = await r.text();
      }
      if (r.ok) {
        const j = JSON.parse(body);
        await logUsage(tag, j.usageMetadata);
        const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
        if (text) return text;
        lastErr = new Error('Gemini 빈 응답 ' + (j.candidates?.[0]?.finishReason || ''));
        continue;
      }
      lastErr = new Error(`Gemini API HTTP ${r.status} (${model}) ${body.slice(0, 250)}`);
      // 결제 문제(크레딧 소진·월 지출 한도)는 다른 모델도 똑같이 막힘 → 30분 쉬고 관리자 화면에 이유 표시
      if (r.status === 402 || (r.status === 429 && BILLING_RE.test(body))) { await pauseAI(body); throw lastErr; }
      if (r.status === 429) { n429++; body429 = body; } else nOther++;
      if (r.status === 400 && /thinking|invalid argument/i.test(body) && thinking) continue; // 생각 설정을 빼고 같은 모델 재시도
      if ([404, 429, 500, 502, 503, 504].includes(r.status) || (r.status === 400 && /model|not found|not supported|invalid argument/i.test(body))) break; // 다음 모델
      throw lastErr; // 키 오류 등
    }
  }
  if (n429 && !nOther) await pauseAI(body429); // 모든 모델이 한도 초과 → 잠시 멈춤
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
export async function claude(prompt, { maxTokens = 1200, timeout = 9000, json = true, think = 0, tag = '기타' } = {}) {
  const paused = googleKey() ? await aiPausedUntil() : 0;
  if (paused) throw new Error(`AI 잠시 쉬는 중: ${pauseMem.reason || '사용 한도 초과'} (${new Date(paused + 9 * 3600e3).toISOString().slice(11, 16)} KST 이후 다시 시도)`);
  if (googleKey()) return gemini(prompt, { maxTokens, timeout, json, think, tag });
  if (claudeKey()) return anthropic(prompt, { maxTokens, timeout });
  throw new Error('AI 키 미설정');
}
export const askAI = claude;

// AI가 가끔 JSON을 조금 틀리게 쓰는 경우(문장 속 따옴표, 끝에 남은 쉼표, 줄바꿈 등)를 고쳐서 읽기
function repairJSON(t) {
  let out = '', inStr = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') { out += c + (t[i + 1] ?? ''); i++; continue; }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '"') {
        // 뒤에 , } ] : 가 오면 진짜 문자열 끝, 아니면 문장 속 따옴표 → 이스케이프
        let j = i + 1;
        while (j < t.length && /\s/.test(t[j])) j++;
        if (j >= t.length || /[,}\]:]/.test(t[j])) { inStr = false; out += c; } else out += '\\"';
        continue;
      }
      out += c;
    } else {
      if (c === '"') inStr = true;
      out += c;
    }
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}
// 속성 사이 쉼표 빠짐 보정: "값"\n  "다음키": → "값",\n  "다음키":
const addCommas = (t) => t.replace(/(["\]}0-9el])(\s*\n\s*)(?="[^"\n]{1,40}"\s*:)/g, '$1,$2');
export function parseJSON(text, open = '{', close = '}') {
  const base = String(text || '').replace(/```(?:json)?/gi, '');
  const a = base.indexOf(open), b = base.lastIndexOf(close);
  if (a < 0 || b < a) throw new Error('AI 응답 형식 오류');
  const raw = base.slice(a, b + 1);
  // 여러 방식으로 차례로 시도 (문장 속 “ ” 따옴표는 그대로 두는 게 먼저)
  const tries = [
    raw,
    repairJSON(raw),
    addCommas(raw),
    repairJSON(addCommas(raw)),
    repairJSON(addCommas(raw.replace(/[“”]/g, '"'))),
  ];
  let first;
  for (const t of tries) { try { return JSON.parse(t); } catch (e) { first = first || e; } }
  throw first;
}

/** 미국 공시 목록용 한국어 한 줄 제목 (수집기에서 사용) */
// JSON이 망가졌을 때: 키별로 값을 따로 찾아 읽기
export function looseParse(text) {
  const t = String(text || '');
  if (!t) return null;
  const strAt = (i) => { // i 위치의 "..." 문자열 (문장 속 따옴표는 뒤에 , ] } 줄바꿈이 올 때만 끝으로 봄)
    if (t[i] !== '"') return null;
    let out = '';
    for (let k = i + 1; k < t.length; k++) {
      const c = t[k];
      if (c === '\\') { const n = t[k + 1]; out += n === 'n' ? '\n' : n; k++; continue; }
      if (c === '"') { let m = k + 1; while (m < t.length && /[ \t]/.test(t[m])) m++; if (m >= t.length || /[,\]}\n\r]/.test(t[m])) return { v: out, end: k + 1 }; }
      out += c;
    }
    return { v: out, end: t.length };
  };
  const find = (key) => { const m = new RegExp(`"${key}"\\s*:\\s*`).exec(t); return m ? m.index + m[0].length : -1; };
  const getStr = (key) => { const i = find(key); if (i < 0) return null; const r = strAt(i); return r ? r.v.trim() : null; };
  const getArr = (key) => {
    let i = find(key); if (i < 0 || t[i] !== '[') return [];
    const out = []; i++;
    while (i < t.length) {
      while (i < t.length && /[\s,]/.test(t[i])) i++;
      if (t[i] === ']' || i >= t.length) break;
      if (t[i] === '"') { const r = strAt(i); out.push(r.v.trim()); i = r.end; continue; }
      if (t[i] === '{') { const e = t.indexOf('}', i); const seg = t.slice(i, e + 1); const tt = /"t"\s*:\s*"([^"]*)"/.exec(seg), dd = /"d"\s*:\s*"([\s\S]*?)"\s*}/.exec(seg); if (tt || dd) out.push({ t: tt?.[1] || '', d: dd?.[1] || '' }); i = e + 1; continue; }
      break;
    }
    return out;
  };
  const j = { headline: getStr('headline'), summary: getArr('summary'), positive: getArr('positive'), negative: getArr('negative'), analyst: getStr('analyst'), points: getArr('points'), watch: getArr('watch'), verdict: getStr('verdict'), overview: getStr('overview'), impact: { size: getStr('size'), short: getStr('short'), mid: getStr('mid') } };
  return j.summary.length ? j : null;
}

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
  const arr = parseJSON(await claude(prompt, { maxTokens: 1500, timeout: 20000, tag: 'SEC 제목 번역' }), '[', ']');
  const out = {};
  for (const x of arr) if (x && x.id && x.title) out[x.id] = { title: String(x.title).slice(0, 80), sub: String(x.sub || '').slice(0, 140) };
  return out;
}

/** 공시·보도자료 상세 분석: 섹터 전문 애널리스트 시각의 5줄 요약 + 긍정/부정 요인 + 코멘트 */
// 공시 종류별로 전문 애널리스트가 반드시 따져보는 항목
function lensFor(kind, form, title, text) {
  const t = `${form} ${title} ${text.slice(0, 3000)}`;
  const L = [];
  if (/2\.02|실적|잠정|results|revenue|earnings|quarter|매출액|영업이익/i.test(t)) L.push('실적: 매출·영업이익·순이익의 전년/전분기 대비 증감률, 이익률(마진) 변화, 일회성 요인 제거 후 본질 이익, 가이던스 상향·하향 여부, 원문에 컨센서스가 있으면 비교(없으면 "컨센서스 비교 불가"라고 명시)');
  if (/offering|placement|유상증자|전환사채|신주인수권|convertible|warrant|at-the-market|424B|S-3|shelf/i.test(t)) L.push('자금조달·희석: 조달 금액 ÷ 시가총액으로 희석률(%) 계산, 할인율(발행가 vs 현재가), 자금 용도(성장 투자 vs 운영자금·부채상환), 현금 소진 속도와 추가 조달 가능성, 워런트·전환가 리셋 조건');
  if (/1\.01|agreement|contract|awarded|공급계약|수주|계약/i.test(t)) L.push('계약·수주: 계약금액 ÷ 최근 연매출로 매출 대비 비중(%) 계산, 계약 기간(연 환산 매출 기여), 상대방 신용도·반복성, 마진 수준 추정 근거, 조건부·해지 조항');
  if (/merger|acquisition|acquire|인수|합병|M&A|tender/i.test(t)) L.push('M&A: 인수가·프리미엄, 인수 대상 매출·이익 대비 멀티플, 자금 조달 방식(현금·주식·부채)과 희석, 시너지 실현 가능성, 규제 승인 리스크');
  if (/FDA|임상|clinical|trial|approval|허가|PDUFA|phase/i.test(t)) L.push('임상·허가: 단계(1/2/3상), 1차 평가변수 충족 여부와 통계적 유의성(p값), 안전성 신호, 경쟁 약물 대비 차별점, 시장 규모와 상업화 일정, 현금으로 버틸 수 있는 기간');
  if (/5\.02|사임|resign|appoint|대표이사|CEO|CFO|임원/i.test(t)) L.push('경영진 변동: 갑작스러운 사임 여부(사유 명시 유무), 후임자 경력, CFO 사임 시 회계 이슈 가능성, 업계에서 이런 변동이 주가에 미친 전례');
  if (/buyback|repurchase|자기주식|자사주|dividend|배당|소각/i.test(t)) L.push('주주환원: 규모 ÷ 시가총액(%) 계산, 실제 매입·소각 여부(취득만인지), 재원(현금흐름 대비 지속 가능성), 배당수익률 변화');
  if (/delist|상장폐지|거래정지|going concern|계속기업|Nasdaq.*deficiency|3\.01|불성실/i.test(t)) L.push('상장 유지 리스크: 사유(주가·자본·감사의견), 유예기간과 해소 방법(역분할 등), 역분할 시 과거 주가 흐름, 최악 시나리오');
  if (/Form 4|insider|장내매수|장내매도|임원ㆍ주요주주|소유상황/i.test(t)) L.push('내부자 거래: 매수·매도 규모 ÷ 보유 주식(%), 사전계획(10b5-1) 여부, 최근 반복 패턴, 경영진 매수의 신호 의미');
  if (/13D|13G|대량보유|5%/i.test(t)) L.push('지분 변동: 보고자의 성격(행동주의·전략적 투자자·패시브), 지분율 변화 폭, 경영 참여 목적 여부');
  if (!L.length) L.push('이 발표가 매출·이익·현금흐름·재무구조·밸류에이션·경쟁 구도 중 어디에 실제로 영향을 주는지, 영향이 없다면 "주가 영향 제한적"이라고 분명히 판단');
  return L;
}

export async function analyzeFiling({ company, ticker, market, kind, title, form, text, overviewRaw, sector, valuation, recent, move }) {
  const what = kind === 'NEWS' ? `${market === 'KR' ? '한국' : '미국'} 기업 관련 뉴스` : kind === 'PR' ? `${market === 'KR' ? '한국' : '미국'} 기업 보도자료` : market === 'KR' ? '한국 DART 공시' : '미국 SEC 공시';
  const lens = lensFor(kind, form || '', title || '', text);
  const prompt = `당신은 ${sector ? `"${sector}" 섹터를` : '이 업종을'} 10년 넘게 커버해 온 증권사 시니어 애널리스트(바이사이드 경력 포함)입니다.
기관투자자에게 보내는 당일 코멘트 수준으로, 아래 ${what}를 꼼꼼하고 날카롭게 분석하세요. 뻔한 일반론·원문 요약 반복은 쓰지 마세요.

[회사] ${company}${ticker ? ` (${ticker})` : ''}${sector ? ` / 섹터: ${sector}` : ''}
${valuation ? `[재무·밸류에이션] ${valuation}\n` : ''}${move ? `[현재 주가 반응] ${move}\n` : ''}${recent?.length ? `[최근 이 회사 공시·보도 흐름]\n${recent.map((x) => '- ' + x).join('\n')}\n` : ''}[제목] ${title}${form ? ` [${form}]` : ''}
${overviewRaw ? `[회사 사업 설명(원문)]\n${overviewRaw.slice(0, 1500)}\n` : ''}
[원문]
${text.slice(0, 12000)}

[이 발표에서 반드시 따져볼 항목]
${lens.map((x) => '- ' + x).join('\n')}

[분석 원칙]
1. 숫자로 말하기: 원문 숫자를 그대로 인용하고, 가능한 경우 직접 계산하세요(희석률 = 조달액/시가총액, 계약 비중 = 계약액/연매출, 증감률 등). 계산에 쓴 숫자를 함께 적으세요.
2. 맥락 비교: 같은 섹터에서 이런 발표가 보통 어떻게 평가되는지, 회사 규모 대비 의미가 큰지 작은지 판단하세요.
3. 행간 읽기: 발표 시점(장 마감 후·금요일 등), 빠진 정보, 표현의 톤 변화, 조건·단서 조항처럼 시장이 놓치기 쉬운 부분을 짚으세요.
4. 반대 시나리오: 긍정적인 발표라도 리스크를, 부정적인 발표라도 반전 가능성을 함께 보세요.
5. 결론을 흐리지 마세요: "지켜봐야 한다"로 끝내지 말고 영향의 크기(크다/보통/제한적)와 방향을 분명히 판단하세요.
6. 원문과 위 정보에 없는 사실(컨센서스 수치, 목표주가 등)은 절대 지어내지 마세요. 모르면 "정보 없음"이라고 쓰세요.

다음 JSON 하나만 출력하세요(모두 한국어):
{
  "headline": "핵심 내용 한 줄 제목 (45자 이내, 숫자 포함, 회사명 제외)",
  "summary": ["핵심 내용 3~5줄, 각 70자 이내, 숫자 포함. 중요하고 내용이 많으면 5줄, 단순하면 3줄"],
  "positive": ["주가 긍정 요인 1~3개, 각 70자 이내, '무엇이 → 왜'가 드러나게"],
  "negative": ["주가 부정 요인·리스크 1~3개, 각 70자 이내"],
  "analyst": "종합 판단 3~4문장 (300자 이내): 이 발표의 본질, 주가 영향의 크기와 방향, 그 근거",
  "points": [
    {"t": "숫자로 본 의미", "d": "핵심 수치를 계산·비교해 해석 (200자 이내)"},
    {"t": "섹터 관점", "d": "업계 관행·경쟁사 대비 의미 (200자 이내)"},
    {"t": "시장이 놓치기 쉬운 점", "d": "행간·조건·타이밍·빠진 정보 (200자 이내)"},
    {"t": "시나리오", "d": "상방 시나리오와 하방 시나리오를 각각 한 문장씩 (200자 이내)"}
  ],
  "impact": {"size": "큼" 또는 "보통" 또는 "제한적", "short": "단기(며칠) 주가 영향 한 줄 (50자 이내)", "mid": "중기(1~3개월) 영향 한 줄 (50자 이내)"},
  "watch": ["앞으로 확인할 체크포인트 2~3개, 각 60자 이내, 구체적으로(날짜·수치·이벤트)"],
  "verdict": "긍정" 또는 "중립" 또는 "부정",
  "overview": ${overviewRaw ? '"이 회사가 무엇을 하는 회사인지 2~3문장 한국어 요약"' : 'null'}
}
매수·매도 추천이나 목표주가는 쓰지 마세요.`;
  let j, raw1 = '', raw2 = '';
  try { raw1 = await claude(prompt, { maxTokens: 6000, timeout: 55000, think: 1024, tag: '공시 AI 분석' }); j = parseJSON(raw1); }
  catch (e) {
    if (!raw1) throw e; // AI 호출 자체가 실패(한도 등)
    // 형식이 깨졌으면 한 번 더 요청 (이번엔 빠르게)
    console.warn('analyze JSON retry', e.message);
    try { raw2 = await claude(prompt + '\n\n주의: 반드시 올바른 JSON만 출력하세요. 문장 안에서 큰따옴표(")는 쓰지 말고 작은따옴표(\')를 쓰세요. 항목 사이 쉼표를 빠뜨리지 마세요.', { maxTokens: 6000, timeout: 40000, think: 0, tag: '공시 AI 분석' }); j = parseJSON(raw2); }
    catch (e2) {
      // 그래도 깨졌으면 항목별로 느슨하게 뽑아냄 (요약·긍정·부정·코멘트만 있어도 충분)
      j = looseParse(raw2) || looseParse(raw1);
      await setJSON('ai/lastRaw', { at: Date.now(), error: String(e2.message || e2), text: String(raw2 || raw1).slice(0, 6000) }).catch(() => {});
      if (!j) throw e2;
    }
  }
  const arr = (v, n, len = 160) => (Array.isArray(v) ? v.filter(Boolean).map((s) => String(s).slice(0, len)).slice(0, n) : []);
  const im = j.impact || {};
  return {
    headline: j.headline ? String(j.headline).slice(0, 80) : null,
    summary: arr(j.summary, 5),
    positive: arr(j.positive, 3),
    negative: arr(j.negative, 3),
    analyst: j.analyst ? String(j.analyst).slice(0, 500) : null,
    points: (Array.isArray(j.points) ? j.points : []).filter((x) => x && x.t && x.d).slice(0, 4).map((x) => ({ t: String(x.t).slice(0, 30), d: String(x.d).slice(0, 320) })),
    impact: im.size || im.short ? { size: ['큼', '보통', '제한적'].includes(im.size) ? im.size : '보통', short: String(im.short || '').slice(0, 90), mid: String(im.mid || '').slice(0, 90) } : null,
    watch: arr(j.watch, 3, 120),
    verdict: ['긍정', '중립', '부정'].includes(j.verdict) ? j.verdict : '중립',
    overview: j.overview ? String(j.overview).slice(0, 400) : null,
  };
}

/** 영문 기업 소개 → 한국어 2~3문장 */
export async function overviewKo(name, raw) {
  const prompt = `다음은 ${name}의 영문 기업 소개입니다. 한국 개인투자자가 이해하기 쉽게 이 회사가 무엇을 하는 회사인지(주요 사업·제품·고객·시장) 한국어 3문장 이내로 설명하세요. 원문에 있는 사실만 쓰고, 설명 문장만 출력하세요.\n\n${String(raw).slice(0, 2500)}`;
  const t = await claude(prompt, { maxTokens: 500, timeout: 20000, json: false, tag: '회사 소개 번역' });
  const out = String(t).replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 450);
  return /[가-힣]{4,}/.test(out) ? out : null;
}

/** 영문 보도자료·뉴스 제목 → 한국어 핵심 제목 (목록용) */
export async function translateTitles(batch) {
  if (!hasAI() || !batch.length) return {};
  const prompt = `다음 영어 기업 보도자료·뉴스 제목을 한국 개인투자자가 바로 이해하도록 자연스러운 한국어 핵심 제목으로 바꾸세요.
규칙: 50자 이내, 숫자·금액·제품명 유지, 회사명은 빼도 됨, 과장 금지.
출력은 JSON 배열만: [{"id":"...","ko":"..."}]
입력: ${JSON.stringify(batch.map((b) => ({ id: b.id, title: b.title, desc: (b.desc || '').slice(0, 200) })))}`;
  const arr = parseJSON(await claude(prompt, { maxTokens: 1800, timeout: 20000, tag: '보도자료 제목 번역' }), '[', ']');
  const out = {};
  for (const x of arr) if (x && x.id && x.ko) out[x.id] = String(x.ko).slice(0, 90);
  return out;
}

/** 오늘의 핵심 공시·뉴스 (여러 건 → 상위 5~7건 선정) */
export async function dailyDigest(items, note = '') {
  const prompt = `당신은 한국 개인투자자를 위한 증권 애널리스트입니다. 아래는 오늘 나온 한국·미국 기업 공시와 보도자료·뉴스 목록입니다.
주가에 영향이 클 만한 핵심 6건을 골라 중요도 순으로 정리하세요(목록이 6건보다 적으면 전부). 반드시 6건을 채우세요. 목록에 있는 사실만 사용하세요.${note ? '\n' + note : ''}
출력은 JSON 하나만:
{"headline":"오늘 시장의 공시 흐름 한 줄 요약(60자 이내)","items":[{"id":"목록의 id 그대로","title":"핵심 내용 한 줄(45자 이내)","why":"주가 영향 이유(60자 이내)","verdict":"긍정|중립|부정"}]}
목록: ${JSON.stringify(items)}`;
  const j = parseJSON(await claude(prompt, { maxTokens: 1800, timeout: 25000, tag: 'AI 핵심 공시' }));
  return {
    headline: String(j.headline || '').slice(0, 120),
    items: (Array.isArray(j.items) ? j.items : []).slice(0, 8).map((x) => ({ id: String(x.id || ''), title: String(x.title || '').slice(0, 100), why: String(x.why || '').slice(0, 140), verdict: ['긍정', '중립', '부정'].includes(x.verdict) ? x.verdict : '중립' })),
  };
}

/** 영어 원문 한 덩어리(여러 문단) → 한국어 문단 배열 */
export async function translateParagraphs(paras, { timeout = 40000 } = {}) {
  const prompt = `다음은 미국 기업의 공시·보도자료·기사 원문 일부입니다. 한국 개인투자자가 읽기 쉬운 자연스러운 한국어로 전부 번역하세요.
규칙:
- 요약하거나 빼먹지 말고 모든 문장을 번역 (표의 숫자·금액·날짜·% 는 그대로 유지, 단위는 필요하면 괄호로 한국어 병기)
- 회사명·제품명·사람 이름은 원문 표기 유지 가능, 직함은 한국어로
- 입력의 각 문단은 "[[숫자]]" 로 시작합니다. 출력도 같은 번호를 붙여 같은 순서로, 문단마다 한 줄씩만 쓰세요
- 번역문 외 다른 설명은 쓰지 마세요

${paras.map((p, i) => `[[${i}]] ${p}`).join('\n')}`;
  const text = await claude(prompt, { maxTokens: 8000, timeout, json: false, tag: '원문 번역' });
  const out = new Array(paras.length).fill(null);
  const re = /\[\[(\d+)\]\]\s*([\s\S]*?)(?=\n?\[\[\d+\]\]|$)/g;
  let m;
  while ((m = re.exec(text))) { const i = Number(m[1]); if (i < paras.length) out[i] = m[2].trim(); }
  if (out.every((x) => !x)) { // 번호를 안 붙였으면 줄 단위로
    const ls = text.split('\n').map((x) => x.trim()).filter(Boolean);
    return ls;
  }
  return out.map((x, i) => x || paras[i]);
}

/** 구글 검색을 함께 쓰는 Gemini 호출 (웹에서 확인한 최신 정보가 필요할 때) → { text, sources } */
export async function askAIWeb(prompt, { maxTokens = 3000, timeout = 60000 } = {}) {
  if (!googleKey()) throw new Error('웹 검색 AI는 Gemini 키가 필요합니다');
  const paused = await aiPausedUntil();
  if (paused) throw new Error('AI 잠시 쉬는 중: ' + (pauseMem.reason || ''));
  const models = [...new Set([process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest'].filter(Boolean))];
  const until = Date.now() + timeout;
  let lastErr;
  for (const model of models) {
    if (until - Date.now() < 3000) break;
    const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': googleKey() }, relay: geminiViaRelay,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 } }),
    }, Math.max(3000, until - Date.now()));
    const body = await r.text();
    if (r.ok) {
      const j = JSON.parse(body);
      const c = j.candidates?.[0];
      await logUsage('일정 검색(웹)', j.usageMetadata);
      const text = (c?.content?.parts || []).map((p) => p.text || '').join('');
      const sources = (c?.groundingMetadata?.groundingChunks || []).map((g) => g.web).filter(Boolean).map((w) => ({ title: w.title || '', uri: w.uri || '' })).slice(0, 12);
      if (text) return { text, sources };
      lastErr = new Error('Gemini 빈 응답');
      continue;
    }
    lastErr = new Error(`Gemini 검색 HTTP ${r.status} (${model}) ${body.slice(0, 200)}`);
    if (r.status === 402 || (r.status === 429 && BILLING_RE.test(body))) { await pauseAI(body); throw lastErr; }
    if (![404, 429, 500, 503, 400].includes(r.status)) throw lastErr;
  }
  throw lastErr || new Error('Gemini 검색 실패');
}
