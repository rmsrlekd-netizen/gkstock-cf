// 장 마감 브리핑 — 국장 마감(15:45~) · 미장 마감(뉴욕 16:15~) 뒤 AI가 오늘 장을 정리하고 다음 장 체크포인트를 뽑음
//  미장 마감 브리핑의 체크포인트는 "국장 오전장"에서 볼 한국 업종·종목 위주, 국장 마감 브리핑은 "오늘 밤 미장·내일 국장" 위주
import { getJSON, setJSON } from './store.mjs';
import { hasAI, askAI, parseJSON, aiPauseInfo } from './ai.mjs';

const TZ = { KR: 'Asia/Seoul', US: 'America/New_York' };
const WIN = { KR: [15 * 60 + 45, 19 * 60], US: [16 * 60 + 15, 20 * 60] }; // 만드는 시간대 (현지)
const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { s = clean(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function local(mk, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ[mk], year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, m: Number(p.hour) * 60 + Number(p.minute) };
}

export async function buildBrief(mk, date) {
  const { gather } = await import('./issues.mjs');
  const g = await gather(mk, { n: 16, phase: '장 마감 후', name: '장 마감 후' }, { regular: true });
  if (g.text.length < 400) throw new Error('재료 부족');
  const d = new Date(date + 'T12:00:00Z');
  const md = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  const next = mk === 'US'
    ? `next: 내일(한국시간) 국장 오전장에서 투자자가 챙길 체크포인트 정확히 3개. 오늘 미국장 흐름이 한국 어느 업종·종목에 영향을 줄지(예: 미국 반도체 강세 → 삼성전자·SK하이닉스·한미반도체). targets에는 한국 업종·종목 이름 최대 3개`
    : `next: 오늘 밤 미국장과 내일 국장에서 챙길 체크포인트 정확히 3개. targets에는 관련 업종·종목 이름 최대 3개`;
  const prompt = `너는 증권사 리서치센터의 시황 에디터다. ${md} ${mk === 'KR' ? '한국 증시' : '미국 증시'} 장 마감 브리핑을 쓴다. 한국 개인투자자가 1분 안에 읽고 ${mk === 'US' ? '다음 날 국장 오전장' : '다음 장'}에 활용할 수 있게.
규칙:
- 아래 [자료]에 있는 사실만. 없는 숫자·사건은 지어내지 않는다. 매수·매도 추천 금지. 간결한 명사형.
- headline: 오늘 장 한 줄 (35자 이내)
- summary: 오늘 장 핵심 정확히 3개 (각 45자 이내) — 지수·수급·금리/환율·주도 섹터 흐름
- sectors: 강세 up 최대 3개, 약세 down 최대 3개 {name(10자), why(30자)}
- movers: 특징주 최대 5개 {name, code(자료 괄호 안 코드 그대로), why(35자)}
- ${next} {title(22자), desc(45자), targets:[..]}
- risk: 주의할 변수 한 줄 (40자)
JSON만: {"headline":"","summary":["","",""],"sectors":{"up":[{"name":"","why":""}],"down":[{"name":"","why":""}]},"movers":[{"name":"","code":"","why":""}],"next":[{"title":"","desc":"","targets":[""]}],"risk":""}

[자료]
${g.text}`;
  const j = parseJSON(await askAI(prompt, { maxTokens: 5000, timeout: 90000, think: 512 }));
  if (!j?.headline || !Array.isArray(j.next)) throw new Error('AI 응답 형식 오류');
  const okCode = (c) => (mk === 'KR' ? /^\d{6}$/.test(c) : /^[A-Z][A-Z0-9.\-]{0,6}$/.test(c));
  const movers = (Array.isArray(j.movers) ? j.movers : []).slice(0, 5).map((x) => {
    let code = String(x?.code || '').trim().toUpperCase();
    if (!okCode(code)) code = g.names.get(clean(x?.name).replace(/\s/g, '')) || '';
    return { name: cut(x?.name, 20), code: okCode(code) ? code : '', why: cut(x?.why, 50) };
  }).filter((x) => x.name);
  // 특징주 등락률은 실제 시세(정규장)로
  const keys = movers.filter((x) => x.code).map((x) => `${mk}:${x.code}`);
  if (keys.length) {
    try { const q = await (await import('../functions/quote.mjs')).getQuotes(keys); for (const x of movers) { const v = q[`${mk}:${x.code}`]; if (v?.pct != null) x.pct = Math.round(Number(v.pct) * 100) / 100; } } catch {}
  }
  const sec = (a) => (Array.isArray(a) ? a : []).slice(0, 3).map((x) => ({ name: cut(x?.name, 14), why: cut(x?.why, 40) })).filter((x) => x.name);
  const out = {
    mk, date, at: Date.now(), headline: cut(j.headline, 50),
    summary: (Array.isArray(j.summary) ? j.summary : []).map((x) => cut(x, 64)).filter(Boolean).slice(0, 3),
    sectors: { up: sec(j.sectors?.up), down: sec(j.sectors?.down) }, movers,
    next: j.next.slice(0, 3).map((x) => ({ title: cut(x?.title, 30), desc: cut(x?.desc, 64), targets: (Array.isArray(x?.targets) ? x.targets : []).map((t) => cut(t, 14)).filter(Boolean).slice(0, 3) })).filter((x) => x.title),
    risk: cut(j.risk, 56), idx: g.ix,
  };
  await setJSON(`brief/${mk}/${date}`, out);
  await setJSON(`brief/latest/${mk}`, out);
  return out;
}

/** 크론: 장 마감 뒤 한 번 (실패하면 다음 회차에 다시, 최대 3번) */
export async function briefWatch(now = new Date()) {
  const res = {};
  for (const mk of ['KR', 'US']) {
    const z = local(mk, now);
    if (['Sat', 'Sun'].includes(z.wd) || z.m < WIN[mk][0] || z.m > WIN[mk][1]) continue;
    if (await getJSON(`brief/${mk}/${z.date}`)) continue;
    if (!hasAI() || (await aiPauseInfo())) continue;
    // 휴장일이면 (오늘 시세가 안 움직였으면) 건너뜀
    const pop = await getJSON('popular/v2');
    const list = mk === 'KR' ? pop?.krUp : pop?.usUp;
    if (list?.length && list.every((x) => !x.pct)) continue;
    const tk = `brief/try/${mk}/${z.date}`;
    const t = (await getJSON(tk)) || { n: 0 };
    if (t.n >= 3) continue;
    await setJSON(tk, { n: t.n + 1 });
    try { res[mk] = (await buildBrief(mk, z.date)).headline; } catch (e) { res[mk] = 'error: ' + e.message; }
  }
  return res;
}
