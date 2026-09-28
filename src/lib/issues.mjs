// 오늘 주요 이슈 6 — 매시간 새 이슈가 있으면 AI가 자동으로 새로 만드는 시황 카드 (디자인은 고정, 내용만 AI가 채움)
//  한국: 평일 한국시간 8시~16시 매시 정각 5분 후 (장 시작 전 · 장중 · 장 마감 후)
//  미국: 평일 뉴욕시간 8시~17시 매시 정각 5분 후 (프리마켓 · 장중 · 장 마감 후, 서머타임 자동)
//  직전 회차 이후 새 뉴스·공시가 3건 미만이면 그 시간은 건너뜀 (같은 내용 반복 방지)
//  재료: 네이버 증권 주요 뉴스·해외 뉴스, 상승·하락·인기 종목과 '움직임 이유', 테마·섹터, 공시·보도자료, 경제지표, 시장 지표
//  숫자(등락률)는 AI가 쓰지 않고 실제 시세에서 붙임
import { fetchWithTimeout } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';
import { hasAI, askAI, parseJSON, aiPauseInfo } from './ai.mjs';

const HOURS = { KR: [8, 9, 10, 11, 12, 13, 14, 15, 16], US: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17] };
const TZ = { KR: 'Asia/Seoul', US: 'America/New_York' };
const MIN_NEW = 3; // 직전 회차 이후 새 뉴스·공시가 이만큼은 있어야 새로 만듦

function local(mk, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ[mk], year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, m: Number(p.hour) * 60 + Number(p.minute) };
}
export const editionId = (mk, date, h) => `${mk.toLowerCase()}-${date.replace(/-/g, '')}-${String(h).padStart(2, '0')}`;
export function parseId(id) {
  const m = String(id || '').match(/^(kr|us)-(\d{4})(\d{2})(\d{2})-(\d{1,2})$/);
  return m ? { mk: m[1].toUpperCase(), date: `${m[2]}-${m[3]}-${m[4]}`, n: Number(m[5]) } : null;
}
export function phaseOf(mk, h) {
  if (mk === 'KR') return h < 9 ? '장 시작 전' : h <= 15 ? '장중' : '장 마감 후';
  return h <= 9 ? '프리마켓' : h <= 15 ? '장중' : '장 마감 후';
}
function slotFor(mk, h, date) {
  const phase = phaseOf(mk, h);
  return { n: h, phase, name: mk === 'KR' ? `${phase} · ${h}시` : `${phase} · 뉴욕 ${h}시`, date, id: editionId(mk, date, h) };
}

/** 지금 만들어야 할 회차 (없으면 null). force면 오늘 가장 최근 시간 */
export function dueSlot(mk, now = new Date(), { force = false } = {}) {
  const z = local(mk, now);
  const h = Math.floor(z.m / 60), min = z.m % 60;
  if (!force) {
    if (['Sat', 'Sun'].includes(z.wd) || !HOURS[mk].includes(h) || min < 4 || min > 55) return null;
    return slotFor(mk, h, z.date);
  }
  const past = HOURS[mk].filter((x) => x <= h);
  return slotFor(mk, past.length ? past[past.length - 1] : HOURS[mk][0], z.date);
}

const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const kstIso = (s) => { const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+09:00` : null; };
const hm = (iso) => (iso ? new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(11, 16) : '');
const sp = (v) => (v == null || !Number.isFinite(Number(v)) ? '' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
const cut = (s, n) => { s = clean(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const NH = { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' };

async function naverNews(url, hours) {
  const r = await fetchWithTimeout(url, { headers: NH }, 9000);
  if (!r.ok) throw new Error('네이버 뉴스 HTTP ' + r.status);
  const arr = await r.json();
  const since = Date.now() - hours * 3600e3;
  return (Array.isArray(arr) ? arr : []).map((x) => ({ t: clean(x.tit), s: clean(x.subcontent).slice(0, 110), src: x.ohnm || '', at: kstIso(x.dt), rel: (x.relatedItems || []).map((r) => ({ code: r.reutersCode, name: r.itemName, pct: Number(r.fluctuationsRatio) })) }))
    .filter((x) => x.t && x.at && Date.parse(x.at) > since);
}
const US_RC = /^[A-Z][A-Z0-9.]{0,6}\.(O|N|A|K|P)$/;
const US_WORD = /미국|뉴욕|월가|연준|파월|나스닥|S&P|다우|국채|트럼프|백악관|달러|유가|엔비디아|애플|테슬라|마이크로소프트|아마존|구글|알파벳|메타|브로드컴|마이크론/;

/** AI에 줄 재료 모으기 */
export async function gather(mk, slot, opts = {}) {
  const pre = slot.phase === '장 시작 전' || slot.phase === '프리마켓';
  const keys = []; // 새 소식 판단용 (뉴스 제목·공시 번호)
  let [pop, themes, mkt, sec, dart, news, econ, wm] = await Promise.all(['popular/v2', 'themes/v1', 'market/v1', 'sec/feed', 'dart/feed', 'news/feed', 'econ/v1', 'why/map'].map((k) => getJSON(k).catch(() => null)));
  // 장 마감 브리핑: 미국은 시간외가 아닌 정규장 등락 기준으로
  if (opts.regular && mk === 'US') {
    try { const { naverUsMovers } = await import('./naver.mjs'); const [up, down] = await Promise.all([naverUsMovers('up', 20), naverUsMovers('down', 12)]); pop = { ...(pop || {}), usUp: up, usDown: down, usSession: null }; } catch {}
  }
  const L = [];
  const names = new Map(); // 이름 → 코드 (AI가 코드를 빼먹었을 때 찾기용)
  const note = (name, code) => { if (name && code) names.set(String(name).replace(/\s/g, ''), String(code)); };
  const reason = (x) => { const w = wm?.[`${x.market}|${String(x.ticker).toUpperCase()}`]; const r = x.reason || w?.r; return r && !/^뚜렷한/.test(r) ? ` — ${r}` : ''; };
  const idx = mkt?.body?.indices || [];
  const pick = mk === 'KR' ? ['코스피', '코스닥', '원/달러', '나스닥100 선물', '미 10년물 금리'] : ['S&P 500', '나스닥', '다우', '나스닥100 선물', '반도체(SOX)', 'VIX', '미 10년물 금리', '원/달러'];
  const ix = pick.map((l) => idx.find((x) => x.label === l && !x.error)).filter(Boolean);
  L.push('[시장 지표] ' + ix.map((x) => `${x.label} ${x.price?.toLocaleString('en-US', { maximumFractionDigits: 2 })} (${sp(x.pct)})`).join(' · '));

  let newsN = 0;
  if (mk === 'KR') {
    const mn = await naverNews('https://api.stock.naver.com/news/mainnews?page=1&pageSize=40', pre ? 16 : 10).catch(() => []);
    newsN = mn.length;
    for (const x of mn.slice(0, 32)) keys.push('n:' + x.t.slice(0, 40));
    if (mn.length) L.push('[증권 주요 뉴스]\n' + mn.slice(0, 32).map((x) => `- (${hm(x.at)} ${x.src}) ${x.t}${x.s ? ' | ' + x.s : ''}`).join('\n'));
  } else {
    const wn = await naverNews('https://api.stock.naver.com/news/worldNews?page=1&pageSize=80', 14).catch(() => []);
    const us = wn.filter((x) => x.rel.some((r) => US_RC.test(r.code || '')) || US_WORD.test(x.t));
    newsN = us.length;
    for (const x of us.slice(0, 30)) keys.push('n:' + x.t.slice(0, 40));
    for (const x of us) for (const r of x.rel) if (US_RC.test(r.code || '')) note(r.name, r.code.split('.')[0]);
    if (us.length) L.push('[해외 주요 뉴스 (로이터·한국어)]\n' + us.slice(0, 30).map((x) => `- (${hm(x.at)}) ${x.t}${x.rel.length ? ' [관련: ' + x.rel.filter((r) => US_RC.test(r.code || '')).slice(0, 3).map((r) => `${r.name}(${r.code.split('.')[0]}) ${sp(r.pct)}`).join(', ') + ']' : ''}`).join('\n'));
  }

  const lst = (arr, n) => (arr || []).slice(0, n).map((x) => { note(x.name, x.ticker); return `- ${x.name}(${x.ticker}) ${sp(x.pct)}${reason(x)}`; }).join('\n');
  const prevNote = pre ? ' (전 거래일 기준)' : '';
  if (mk === 'KR') {
    if (pop?.krUp?.length) L.push(`[상승 특징주${prevNote}]\n` + lst(pop.krUp, 18));
    if (pop?.krDown?.length) L.push(`[하락 특징주${prevNote}]\n` + lst(pop.krDown, 10));
    if (pop?.kr?.length) L.push('[실시간 인기 검색 종목]\n' + lst(pop.kr, 10));
    const kt = themes?.kr;
    if (kt?.themes?.length) L.push('[강세 테마]\n' + kt.themes.slice(0, 10).map((g) => { (g.leaders || []).forEach((s) => note(s.name, s.t)); return `- ${g.name} ${sp(g.rate)} (대장주: ${(g.leaders || []).slice(0, 4).map((s) => `${s.name}(${s.t}) ${sp(s.pct)}`).join(', ')})${g.why ? ' — ' + g.why : ''}`; }).join('\n'));
    if (kt?.worstThemes?.length) L.push('[약세 테마]\n' + kt.worstThemes.slice(0, 5).map((g) => `- ${g.name} ${sp(g.rate)} (${(g.leaders || []).slice(0, 3).map((s) => `${s.name}(${s.t})`).join(', ')})`).join('\n'));
    const since = Date.now() - (pre ? 20 : 12) * 3600e3;
    const dl = (dart?.items || []).filter((x) => x.impact >= 4 && (Date.parse(x.seenAt || x.time || '') || 0) > since).slice(0, 25);
    for (const x of dl) keys.push('d:' + x.id);
    if (dl.length) L.push('[주요 공시 (DART)]\n' + dl.map((x) => { note(x.name, x.ticker); return `- ${x.name}(${x.ticker || ''}): ${cut(x.summary?.title || x.titleClean || x.formKo, 70)}`; }).join('\n'));
  } else {
    const ses = pop?.usSession ? (pop.usSession === 'AFTER' ? ' (애프터마켓 등락률)' : ' (프리마켓 등락률)') : prevNote;
    if (pop?.usUp?.length) L.push(`[상승 특징주${ses}]\n` + lst(pop.usUp.filter((x) => (x.price || 0) >= 1), 16));
    if (pop?.usDown?.length) L.push(`[하락 특징주${ses}]\n` + lst(pop.usDown.filter((x) => (x.price || 0) >= 1), 10));
    if (pop?.us?.length) L.push('[한국 투자자 인기 미국 종목]\n' + lst(pop.us, 10));
    const ut = themes?.us;
    if (ut?.sectors?.length) L.push('[S&P 섹터 ETF] ' + ut.sectors.map((s) => `${s.name}(${s.t}) ${sp(s.pct)}`).join(' · '));
    if (ut?.themes?.length) L.push('[테마 ETF]\n' + [...ut.themes.slice(0, 7), ...ut.themes.slice(-3)].map((g) => { (g.stocks || []).forEach((s) => note(s.t, s.t)); return `- ${g.name}(${g.t}) ${sp(g.pct)} (대표: ${(g.stocks || []).slice(0, 4).map((s) => `${s.t} ${sp(s.pct)}`).join(', ')})${g.why ? ' — ' + g.why : ''}`; }).join('\n'));
    const since = Date.now() - 18 * 3600e3;
    const sl = (sec?.items || []).filter((x) => x.impact >= 4 && x.ticker && Date.parse(x.time) > since).slice(0, 20);
    for (const x of sl) keys.push('s:' + x.id);
    if (sl.length) L.push('[주요 SEC 공시]\n' + sl.map((x) => `- ${x.name}(${x.ticker}) ${x.form}: ${cut(x.ko?.title || x.pr?.headline || x.formKo, 70)}`).join('\n'));
    const pl = (news?.items || []).filter((x) => x.src === 'PR' && x.market === 'US' && x.ticker && Date.parse(x.time) > since).slice(0, 25);
    for (const x of pl) keys.push('p:' + x.id);
    if (pl.length) L.push('[주요 보도자료]\n' + pl.map((x) => `- ${x.company || x.ticker}(${x.ticker}): ${cut(x.titleKo || x.title, 80)}`).join('\n'));
    const today = local('US').date;
    const ev = (econ?.days || []).find((d) => d.date === today)?.events?.filter((e) => e.imp >= 2) || [];
    for (const e of ev) if (e.actual != null) keys.push('e:' + e.id);
    if (ev.length) L.push('[오늘 미국 경제지표 (뉴욕시간)]\n' + ev.slice(0, 12).map((e) => `- ${e.et} ${e.ko || e.name}: ${e.actual != null ? `발표 ${e.actual} (예상 ${e.cons ?? '-'}, 이전 ${e.prev ?? '-'})${e.ai?.headline ? ' — ' + e.ai.headline : ''}` : `발표 예정 (예상 ${e.cons ?? '-'}, 이전 ${e.prev ?? '-'})`}`).join('\n'));
  }
  const themeStrip = mk === 'KR'
    ? (themes?.kr?.themes || []).slice(0, 6).map((g) => ({ name: g.name, pct: g.rate }))
    : (themes?.us?.themes || []).slice(0, 6).map((g) => ({ name: g.name, pct: g.pct }));
  return { text: L.join('\n\n'), names, ix: ix.map((x) => ({ label: x.label, price: x.price, pct: x.pct, unit: x.unit || '' })), themeStrip, newsN, keys };
}

function prompt(mk, slot, date, text, prev) {
  const d = new Date(date + 'T12:00:00Z');
  const md = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  const h = slot.n;
  const when = mk === 'KR'
    ? { '장 시작 전': '한국 증시 개장 전 (전날 미국장·밤사이 뉴스·오늘 일정 중심)', 장중: `한국 증시 장중 (한국시간 ${h}시 현재)`, '장 마감 후': '한국 증시 마감 직후 (오늘 장 정리)' }[slot.phase]
    : { 프리마켓: `미국 증시 개장 전 프리마켓 (뉴욕시간 ${h}시, 밤사이 뉴스·실적·경제지표 중심)`, 장중: `미국 증시 장중 (뉴욕시간 ${h}시 현재)`, '장 마감 후': '미국 증시 마감 직후 (오늘 장 정리)' }[slot.phase];
  const prevTxt = prev?.issues?.length ? `\n[직전 회차 (${prev.slot}) 이슈]\n${prev.issues.map((x, i) => `${i + 1}. [${x.tag}] ${x.title}`).join('\n')}\n` : '';
  return `너는 증권사 리서치센터의 시황 에디터다. 한국 개인투자자를 위해 "${md} ${mk === 'KR' ? '국장' : '미장'} ${slot.name} 주요 이슈 6"을 만든다. 매시간 새로 갱신되는 시황판이다.
시점: ${when}

규칙:
- 아래 [자료]에 있는 사실만 쓴다. 자료에 없는 숫자·사건·전망은 절대 지어내지 않는다.
- 서로 다른 핵심 이슈 정확히 6개를 지금 시점의 중요도 순으로 (자료가 부족하면 최소 5개). 같은 사건을 두 번 쓰지 않는다.
- 시장 전체 흐름(지수·수급·금리·환율 등) 이슈 1개 + 기업·업종·테마 이슈로 구성. 덜 중요한 건 과감히 뺀다.${prevTxt ? '\n- 직전 회차 이후 새로 나온 뉴스·공시를 우선 반영한다. 여전히 중요한 직전 이슈는 최신 내용으로 고쳐 유지해도 된다.\n- new: 직전 회차 목록에 없던 새 이슈면 true, 이어지는 이슈면 false' : '\n- new: 모두 false'}
- 등락률 숫자는 쓰지 않아도 된다 (종목 등락률은 시스템이 실제 시세로 붙인다). 금액·수치는 자료에 있을 때만.
- 매수·매도 추천 표현 금지. 사실과 영향 위주의 간결한 명사형 문장.
- tag: 업종·테마 이름 2~7자 (예: 반도체, 2차전지, 바이오, 거시경제, 방산)
- title: 핵심 한 줄 26자 이내 / sub: 부연 36자 이내
- points: 핵심 내용 정확히 3개, 각 42자 이내
- check: 투자자가 앞으로 확인할 점 한 줄 40자 이내
- stocks: 관련 종목 최대 3개. 자료에 나온 종목만, code는 자료의 괄호 안 코드(${mk === 'KR' ? '6자리 숫자' : '미국 티커'}) 그대로. 시장 전체 이슈면 빈 배열.
- tone: 해당 종목·시장 입장에서 "호재" | "악재" | "중립"
- headline: 지금 시장 흐름 한 줄 요약 40자 이내
- keywords: 핵심 키워드 3~4개 (각 8자 이내)

JSON 하나만 출력:
{"headline":"","keywords":[""],"issues":[{"tag":"","title":"","sub":"","points":["","",""],"check":"","stocks":[{"name":"","code":""}],"tone":"호재|악재|중립","new":false}]}
${prevTxt}
[자료]
${text}`;
}

/** 한 회차 만들기 */
export async function buildEdition(mk, slot, date, { prev = null, force = false } = {}) {
  if (!hasAI()) throw new Error('AI 키 없음');
  const pause = await aiPauseInfo();
  if (pause) throw new Error('AI 쉬는 중: ' + (pause.reason || ''));
  const g = await gather(mk, slot);
  if (g.text.length < 400) throw new Error('재료 부족');
  // 같은 날 직전 회차와 비교해 새 뉴스·공시가 거의 없으면 이번 시간은 건너뜀
  const same = prev && prev.date === date ? prev : null;
  const fresh = same?.sig ? g.keys.filter((k) => !same.sig.includes(k)).length : g.keys.length;
  if (same && !force && fresh < MIN_NEW) { const e = new Error(`새 이슈 없음 (새 소식 ${fresh}건)`); e.skip = true; throw e; }
  const txt = await askAI(prompt(mk, slot, date, g.text, same), { maxTokens: 9000, timeout: 110000, think: 1024 });
  const j = parseJSON(txt);
  const okCode = (c) => (mk === 'KR' ? /^\d{6}$/.test(c) : /^[A-Z][A-Z0-9.\-]{0,6}$/.test(c));
  const issues = (Array.isArray(j?.issues) ? j.issues : []).filter((x) => x && x.title).slice(0, 6).map((x) => ({
    tag: cut(x.tag, 9), title: cut(x.title, 34), sub: cut(x.sub, 48),
    points: (Array.isArray(x.points) ? x.points : []).map((p) => cut(p, 60)).filter(Boolean).slice(0, 3),
    check: cut(x.check, 56),
    tone: ['호재', '악재', '중립'].includes(x.tone) ? x.tone : '중립',
    isNew: !!same && x.new === true,
    stocks: (Array.isArray(x.stocks) ? x.stocks : []).slice(0, 3).map((s) => {
      const name = cut(s?.name, 20);
      let code = String(s?.code || '').trim().toUpperCase();
      if (!okCode(code)) code = g.names.get(name.replace(/\s/g, '')) || '';
      return { name: name || code, code: okCode(code) ? code : '' };
    }).filter((s) => s.name),
  }));
  if (issues.length < 5) throw new Error(`AI 이슈 부족 (${issues.length}개)`);
  // 종목 등락률은 실제 시세로
  const keys = [...new Set(issues.flatMap((x) => x.stocks.filter((s) => s.code).map((s) => `${mk}:${s.code}`)))];
  let q = {};
  if (keys.length) { try { q = await (await import('../functions/quote.mjs')).getQuotes(keys); } catch {} }
  for (const x of issues) for (const s of x.stocks) { const v = q[`${mk}:${s.code}`]; const vp = v?.livePct ?? v?.pct; if (vp != null) s.pct = Math.round(Number(vp) * 100) / 100; }
  return {
    id: editionId(mk, date, slot.n), mk, date, n: slot.n, hour: slot.n, slot: slot.name, short: slot.phase, fresh, sig: g.keys.slice(0, 200),
    headline: cut(j.headline, 60), keywords: (Array.isArray(j.keywords) ? j.keywords : []).map((k) => cut(k, 12)).filter(Boolean).slice(0, 4),
    issues, idx: g.ix, themes: g.themeStrip, at: Date.now(),
  };
}

export async function saveEdition(ed) {
  await setJSON(`issues/ed/${ed.id}`, ed);
  const key = `issues/idx/${ed.mk}`;
  const idx = ((await getJSON(key)) || []).filter((x) => x.id !== ed.id);
  idx.unshift({ id: ed.id, date: ed.date, n: ed.n, hour: ed.hour, slot: ed.slot, short: ed.short, headline: ed.headline, at: ed.at });
  idx.sort((a, b) => b.date.localeCompare(a.date) || (b.hour ?? -1) - (a.hour ?? -1));
  await setJSON(key, idx.slice(0, 150));
}

/** 크론(매분): 매시 정각 5분쯤 새 이슈가 있으면 새 회차를 만듦 (실패하면 4분 뒤 다시, 최대 3번) */
export async function issuesWatch(now = new Date(), ctx = null) {
  const out = {};
  for (const mk of ['KR', 'US']) {
    const idx = (await getJSON(`issues/idx/${mk}`)) || [];
    let s = dueSlot(mk, now);
    // 처음 설치 직후 한 회차도 없으면 가장 최근 시간으로 바로 만들어 둠
    const boot = !s && !idx.length;
    if (boot) s = dueSlot(mk, now, { force: true });
    if (!s) continue;
    if (idx.some((x) => x.id === s.id)) continue;
    const tk = `issues/try/${s.id}`;
    const t = (await getJSON(tk)) || { n: 0, at: 0 };
    if (t.n >= 3 || Date.now() - t.at < 4 * 60e3) continue;
    // 장중인데 휴장일이면 건너뜀 (인기 종목 상태가 '장중'이 아님)
    if (s.phase === '장중' && !boot) {
      const pop = await getJSON('popular/v2');
      const list = mk === 'KR' ? pop?.krUp : pop?.usUp;
      if (list?.length && list.every((x) => x.status && x.status !== 'OPEN')) { await setJSON(tk, { n: 9, at: Date.now(), err: '휴장' }); continue; }
    }
    await setJSON(tk, { n: t.n + 1, at: Date.now() });
    try {
      const prev = idx[0] ? await getJSON(`issues/ed/${idx[0].id}`) : null;
      const ed = await buildEdition(mk, s, s.date, { prev, force: boot });
      await saveEdition(ed);
      out[mk] = ed.id;
      // 카톡 공유 미리보기 이미지를 미리 그려 둠
      try { await (await import('./og.mjs')).issueOgPng(ctx, ed.id, ed); } catch (e) { console.warn('issue-og', e.message); }
    } catch (e) {
      out[mk] = (e.skip ? 'skip: ' : 'error: ') + e.message;
      await setJSON(tk, { n: e.skip ? 9 : t.n + 1, at: Date.now(), err: String(e.message).slice(0, 200) }).catch(() => {});
    }
  }
  return out;
}
