// 영상 소재 노트 (관리자 전용) — 장 마감 뒤 "오늘 영상으로 다룰 만한 이슈 5개 + 핵심 숫자 + 제목·썸네일 후보"를 자동으로 만들어 둠
//  · 국장: 한국 시간 평일 16:45~18:00 / 미장: 뉴욕 시간 평일 16:40~18:00 (한국 시간 새벽~아침)
//  · 재료: 그날 마지막 '오늘 주요 이슈' 회차 + 급등·급락 이유 + 강세 테마 + 실적 컨센서스 판정
//  · 저장: vnote/{KR|US}/{날짜} · 목록 vnote/idx (최근 20개) · 관리자 화면에서 보기·복사·다시 만들기
import { getJSON, setJSON } from './store.mjs';
import { isTradingDay } from './schedule.mjs';

const TZ = { KR: 'Asia/Seoul', US: 'America/New_York' };
const WIN = { KR: [16 * 60 + 45, 18 * 60], US: [16 * 60 + 40, 18 * 60] };
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function local(mk, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ[mk], year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, m: Number(p.hour) * 60 + Number(p.minute) };
}

export async function buildNote(mk, date) {
  date = date || local(mk).date;
  const { closeData } = await import('./closecard.mjs');
  const c = await closeData(mk, date);
  const ed = c.edId ? await getJSON(`issues/ed/${c.edId}`) : null;
  const vmap = (await getJSON('earn/vmap')) || {};
  const earn = Object.values(vmap).filter((v) => v.mk === mk && Date.now() - (v.at || 0) < 30 * 3600e3).slice(0, 12).map((v) => `${v.n}(${v.t}) 컨센서스 ${v.v}: ${v.line}`);
  const mat = {
    지수: c.ix.map((x) => `${x.label} ${x.price ?? ''} ${x.pct != null ? (x.pct > 0 ? '+' : '') + Number(x.pct).toFixed(2) + '%' : ''}`),
    주요이슈: (ed?.issues || []).map((x) => ({ 분류: x.tag, 제목: x.title, 요약: x.sub, 포인트: x.points, 성격: x.tone, 종목: (x.stocks || []).map((s) => `${s.name}${s.pct != null ? ' ' + (s.pct > 0 ? '+' : '') + s.pct + '%' : ''}`) })),
    급등: c.up.map((x) => `${x.name}${x.sub ? '(' + x.sub + ')' : ''} ${x.pct > 0 ? '+' : ''}${Number(x.pct).toFixed(1)}%${x.why ? ' — ' + x.why : ''}`),
    급락: c.down.map((x) => `${x.name}${x.sub ? '(' + x.sub + ')' : ''} ${Number(x.pct).toFixed(1)}%${x.why ? ' — ' + x.why : ''}`),
    강세테마: c.th.map((x) => `${x.name} ${x.pct > 0 ? '+' : ''}${Number(x.pct || 0).toFixed(1)}%`),
    약세테마: c.thDown.map((x) => `${x.name} ${Number(x.pct || 0).toFixed(1)}%`),
    실적: earn,
  };
  if (!mat.주요이슈.length && !mat.급등.length) throw new Error('오늘 재료가 부족합니다');
  const { askAI, parseJSON } = await import('./ai.mjs');
  const prompt = `당신은 구독자 많은 한국 주식 유튜브 채널 'GK의 미국 주식'의 기획 작가입니다. 아래는 오늘(${date}) ${mk === 'KR' ? '한국 증시(국장)' : '미국 증시(미장)'} 마감 기준 재료입니다.
오늘 영상으로 만들면 조회수와 정보 가치가 둘 다 높을 소재 5개를 고르고, 영상 제목·썸네일 문구 후보를 제안하세요.
규칙:
- 재료에 있는 사실·숫자만 사용 (지어내지 말 것). 숫자는 재료 그대로.
- 주가가 떨어졌다는 이유만으로 실적이 나빴다고 단정하지 말 것. 실적 평가는 '실적' 항목의 컨센서스 판정을 따를 것.
- 제목은 궁금증을 주되 거짓·과장(예: "무조건", "100% 오른다") 금지. 30자 안팎.
- 투자 권유가 아니라 정보 전달 관점.
출력은 JSON 하나만:
{"summary":"오늘 장을 한 줄로(40자 이내)",
"topics":[{"title":"소재 이름(20자 이내)","why":"왜 지금 다룰 만한지(60자 이내)","facts":["영상에서 말할 핵심 숫자·사실 3개(각 50자 이내)"],"angle":"영상 전개 방향 한 줄(50자 이내)","tickers":["관련 종목명"]}],
"titles":["영상 제목 후보 5개"],
"thumbs":["썸네일 큰 글자 후보 3개(각 12자 이내)"],
"shorts":["쇼츠(60초)로 뽑을 아이디어 2개(각 40자 이내)"],
"hook":"영상 첫 10초 오프닝 멘트(70자 이내)"}
재료: ${JSON.stringify(mat).slice(0, 20000)}`;
  const j = parseJSON(await askAI(prompt, { maxTokens: 3500, timeout: 70000, tag: '영상 소재 노트' }));
  const arr = (a, n, len) => (Array.isArray(a) ? a : []).map((x) => cut(x, len)).filter(Boolean).slice(0, n);
  const note = {
    mk, date, at: Date.now(), edId: c.edId,
    summary: cut(j.summary, 60),
    topics: (Array.isArray(j.topics) ? j.topics : []).filter((t) => t?.title).slice(0, 5).map((t) => ({ title: cut(t.title, 30), why: cut(t.why, 90), facts: arr(t.facts, 4, 80), angle: cut(t.angle, 80), tickers: arr(t.tickers, 4, 20) })),
    titles: arr(j.titles, 6, 50), thumbs: arr(j.thumbs, 4, 20), shorts: arr(j.shorts, 3, 60), hook: cut(j.hook, 120),
    ix: c.ix, up: c.up.slice(0, 5), down: c.down.slice(0, 3),
  };
  if (note.topics.length < 3) throw new Error('AI 소재 부족');
  await setJSON(`vnote/${mk}/${date}`, note);
  const idx = ((await getJSON('vnote/idx')) || []).filter((x) => !(x.mk === mk && x.date === date));
  idx.unshift({ mk, date, at: note.at, summary: note.summary });
  idx.sort((a, b) => b.at - a.at);
  await setJSON('vnote/idx', idx.slice(0, 20));
  return note;
}

/** 크론(3분마다) */
export async function vnoteWatch(now = new Date()) {
  const out = {};
  for (const mk of ['KR', 'US']) {
    const z = local(mk, now);
    if (z.m < WIN[mk][0] || z.m > WIN[mk][1]) continue;
    if (!isTradingDay(mk, z.date) || (await getJSON(`issues/hol/${mk}/${z.date}`))?.on) continue;
    if (await getJSON(`vnote/${mk}/${z.date}`)) continue;
    const tk = `vnote/try/${mk}/${z.date}`;
    const t = (await getJSON(tk)) || { n: 0, at: 0 };
    if (t.n >= 3 || Date.now() - t.at < 10 * 60e3) continue;
    await setJSON(tk, { n: t.n + 1, at: Date.now() });
    try { await buildNote(mk, z.date); out[mk] = 'ok'; }
    catch (e) { out[mk] = 'error: ' + e.message; await setJSON(tk, { n: t.n + 1, at: Date.now(), err: String(e.message).slice(0, 200) }).catch(() => {}); }
  }
  return out;
}

/** 관리자 화면용: 최근 목록 + 선택한 노트 */
export async function noteView(mk, date) {
  const idx = (await getJSON('vnote/idx')) || [];
  const pick = mk && date ? { mk, date } : idx[0];
  const note = pick ? await getJSON(`vnote/${pick.mk}/${pick.date}`) : null;
  return { idx, note };
}
