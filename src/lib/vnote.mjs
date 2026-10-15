// 당일 분석 (관리자 전용, 예전 '영상 소재 노트') — 장 마감 뒤 그날 국장·미장의 중요 내용을 분석 정리 형태로 자동 기록
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
  const prompt = `당신은 한국 개인투자자를 위한 증권 애널리스트입니다. 아래는 오늘(${date}) ${mk === 'KR' ? '한국 증시(국장)' : '미국 증시(미장)'} 마감 기준 재료입니다.
오늘 하루 시장의 중요한 내용을 '분석 정리' 형태로 써 주세요. (영상 대본·제목·썸네일·오프닝 멘트 같은 것은 쓰지 말 것)
규칙:
- 재료에 있는 사실·숫자만 사용 (지어내지 말 것). 숫자는 재료 그대로.
- 주가가 떨어졌다는 이유만으로 실적이 나빴다고 단정하지 말 것. 실적 평가는 '실적' 항목의 컨센서스 판정을 따를 것.
- 담백한 보고서 문체(~함, ~임 또는 ~다). 과장·감탄 없이. 투자 권유 아님.
출력은 JSON 하나만:
{"headline":"오늘 장 한 줄 요약(45자 이내)",
"overview":"시장 전체 흐름 3~4문장(지수·수급·분위기, 250자 이내)",
"sections":[{"title":"핵심 이슈 이름(25자 이내)","body":"무슨 일이 있었고 왜 중요한지 2~3문장(200자 이내)","facts":["관련 숫자·사실 2~4개(각 60자 이내)"],"stocks":["관련 종목명"]}],
"themes":{"strong":["강세 테마·업종과 이유(각 50자 이내)"],"weak":["약세 테마·업종과 이유"]},
"earnings":["실적 발표 정리(종목 · 컨센서스 판정 · 숫자, 각 70자 이내)"],
"checks":["다음 거래일에 확인할 점 2~4개(각 60자 이내)"]}
sections는 중요도 순으로 4~6개.
재료: ${JSON.stringify(mat).slice(0, 20000)}`;
  const j = parseJSON(await askAI(prompt, { maxTokens: 3500, timeout: 70000, tag: '당일 분석' }));
  const arr = (a, n, len) => (Array.isArray(a) ? a : []).map((x) => cut(x, len)).filter(Boolean).slice(0, n);
  const note = {
    v: 2, mk, date, at: Date.now(), edId: c.edId,
    summary: cut(j.headline, 70), overview: cut(j.overview, 320),
    sections: (Array.isArray(j.sections) ? j.sections : []).filter((t) => t?.title).slice(0, 6).map((t) => ({ title: cut(t.title, 34), body: cut(t.body, 260), facts: arr(t.facts, 4, 80), stocks: arr(t.stocks, 4, 20) })),
    themes: { strong: arr(j.themes?.strong, 4, 70), weak: arr(j.themes?.weak, 3, 70) },
    earnings: arr(j.earnings, 8, 90), checks: arr(j.checks, 4, 80),
    ix: c.ix, up: c.up.slice(0, 5), down: c.down.slice(0, 3),
  };
  if (note.sections.length < 3) throw new Error('AI 정리 부족');
  await setJSON(`vnote/${mk}/${date}`, note);
  const idx = ((await getJSON('vnote/idx')) || []).filter((x) => !(x.mk === mk && x.date === date));
  idx.unshift({ mk, date, at: note.at, summary: note.summary });
  idx.sort((a, b) => b.at - a.at);
  await setJSON('vnote/idx', idx.slice(0, 2000)); // 날짜별 기록은 계속 남김
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
