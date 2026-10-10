// 텔레그램 채널 자동 게시 — 중요 공시·보도자료가 나오면 AI 요약과 함께 채널에 올림
//  설정: Cloudflare 변수 TELEGRAM_BOT_TOKEN(봇) + TELEGRAM_CHANNEL_ID(@채널주소 또는 -100… 숫자), 봇을 채널 관리자로 추가
//  관리자 화면에서 켜기/끄기 · 기준(중요도) · 시간당 최대 건수 조절
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout } from './util.mjs';

export const DEFAULT_CFG = { on: true, minImp: 4, perHour: 12, kr: true, us: true, issues: true, digest: true, surge: true, close: true };
// 공시 후 급등 기준 (발표 시점 주가 대비): 국장 +10%, 미장 +15%
export const SURGE = { KR: 10, US: 15 };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/');

export async function tgSend(chat, text, { preview = true } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chat) throw new Error('봇 토큰 또는 채널이 설정되지 않았습니다');
  const send = () => fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: !preview, prefer_large_media: true } }),
  }, 15000);
  // 텔레그램이 잠깐 느리면(응답 지연으로 중단) 한 번 더
  let r;
  try { r = await send(); } catch (e) { if (!/abort|timeout|시간/i.test(String(e.message || e))) throw e; await new Promise((ok) => setTimeout(ok, 1500)); r = await send(); }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`텔레그램 ${j.error_code || r.status}: ${j.description || ''}`);
  return j;
}

// ───── 이미지로 보내기: 모든 게시물을 카드 이미지 + 짧은 설명(캡션)으로 (이미지를 못 만들면 글로) ─────
const NOCTX = { waitUntil() {} };
async function postForm(method, fd) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const go = () => fetchWithTimeout(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: fd }, 25000);
  let r;
  try { r = await go(); } catch (e) { if (!/abort|timeout/i.test(String(e.message || e))) throw e; await new Promise((ok) => setTimeout(ok, 1500)); r = await go(); }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`텔레그램 ${j.error_code || r.status}: ${j.description || ''}`);
  return j;
}
/** 텔레그램 캡션은 1,024자까지 — 넘치면 중간 줄을 줄이고 마지막 링크 줄은 남김 */
function capCaption(text, max = 1000) {
  const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').length;
  if (plain(text) <= max) return text;
  const lines = text.split('\n'), last = lines.pop();
  while (lines.length > 2 && plain(lines.join('\n') + '\n' + last) > max) lines.pop();
  return lines.join('\n') + '\n' + last;
}
export async function tgPhoto(chat, png, caption) {
  const fd = new FormData();
  fd.append('chat_id', chat);
  fd.append('caption', capCaption(caption));
  fd.append('parse_mode', 'HTML');
  fd.append('photo', new Blob([png], { type: 'image/png' }), 'card.png');
  return postForm('sendPhoto', fd);
}
/** 카드 이미지를 만들어 사진으로 보내고, 실패하면 기존처럼 글로 */
async function sendCard(chat, text, makePng, opts = {}) {
  let png = null;
  try { png = await makePng(); } catch (e) { console.warn('tg card', e.message); }
  if (png?.byteLength > 1000) {
    try { return await tgPhoto(chat, png, text); } catch (e) { if (/chat not found|not enough rights|bot is not a member|403/i.test(e.message)) throw e; console.warn('tg photo', e.message); }
  }
  return tgSend(chat, text, opts);
}
async function filingPng(id) {
  const { renderOgImage } = await import('./og.mjs');
  const r = await renderOgImage(NOCTX, id);
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}

function itemMs(x) {
  if (x.src === 'DART') {
    if (x.timeMin && x.timeMin !== 'na') return Date.parse(x.timeMin.replace(' ', 'T') + ':00+09:00') + 59e3;
    return Date.parse(x.seenAt || '') || 0;
  }
  return Date.parse(x.time || x.seenAt || '') || 0;
}
const titleOf = (x) => x.ko?.title || x.summary?.title || x.titleKo || x.pr?.headline || x.title || x.titleClean || x.formKo || x.form || '';
const nameOf = (x) => (x.src === 'DART' || x.market === 'KR' ? x.name || x.ticker : `${x.ticker}${x.name ? ' · ' + x.name : x.company ? ' · ' + x.company : ''}`);

// ───── 관심 우량주 목록 (실적 발표는 이 종목들만 채널에 올림) ─────
//  국장: 코스피 시가총액 상위 200 + 코스닥 상위 100 · 미장: 시가총액 상위 300 + 지금 인기 종목 (하루 한 번 갱신)
let blueMem = null;
export async function blueSet() {
  if (blueMem && Date.now() - blueMem.at < 3600e3) return blueMem;
  let c = await getJSON('tgch/blue');
  if (!c || Date.now() - c.at > 20 * 3600e3) {
    const H = { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' };
    const get = (u) => fetchWithTimeout(u, { headers: H }, 9000).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const kr = [], us = [];
    const pages = await Promise.all([
      ...[1, 2].map((i) => get(`https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${i}&pageSize=100`)),
      get('https://m.stock.naver.com/api/stocks/marketValue/KOSDAQ?page=1&pageSize=100'),
      ...[1, 2, 3].map((i) => get(`https://api.stock.naver.com/stock/nation/USA/marketValue?page=${i}&pageSize=100`)),
    ]);
    pages.slice(0, 3).forEach((j) => { for (const x of j?.stocks || []) if (x.itemCode) kr.push(x.itemCode); });
    pages.slice(3).forEach((j) => { for (const x of j?.stocks || []) if (x.symbolCode) us.push(String(x.symbolCode).toUpperCase()); });
    if (kr.length > 100 && us.length > 100) { c = { at: Date.now(), kr, us }; await setJSON('tgch/blue', c).catch(() => {}); }
    else if (!c) c = { at: Date.now() - 19 * 3600e3, kr, us }; // 실패하면 1시간 뒤 다시
  }
  // 지금 인기 종목(네이버 검색 상위)도 관심 종목으로
  const pop = (await getJSON('popular/v2').catch(() => null)) || {};
  const set = { KR: new Set([...(c.kr || []), ...(pop.kr || []).map((x) => x.ticker)]), US: new Set([...(c.us || []), ...(pop.us || []).map((x) => String(x.ticker || '').toUpperCase())]), at: Date.now() };
  blueMem = set;
  return set;
}
const isEarnings = (x) => x.category === 'earnings' || (x.items || []).some((i) => i.code === '2.02') || /잠정\s*실적|영업\(잠정\)|손익구조/.test(`${x.titleClean || ''}${x.formKo || ''}`);

/** 올릴 만한 항목인지 (중요도 기준) */
async function worth(x, cfg) {
  const mk = x.src === 'DART' || x.market === 'KR' ? 'KR' : 'US';
  if (!x.ticker || (mk === 'KR' ? !cfg.kr : !cfg.us)) return false;
  if (/^(4|144|13F|3|5|SC 13G|SCHEDULE 13G|10-Q|10-K|20-F|40-F|DEF|ARS)/i.test(x.form || '')) return false;
  if (x.src === 'DART' && x.category === 'insider') return false;
  if (x.src === 'NEWS') return false;
  const { typeOf } = await import('./react.mjs');
  const tp = typeOf(x);
  // 실적 발표: 모든 회사가 아니라 관심 우량주(시총 상위·인기 종목)만
  if (isEarnings(x) || tp === 'us_earn' || tp === 'kr_earn') {
    const b = await blueSet();
    return b[mk].has(String(x.ticker).toUpperCase());
  }
  // 보도자료: AI가 호재·악재로 판정한 것 중 유형이 뚜렷한 것만
  if (x.src === 'PR') return !!tp;
  return (x.impact ?? 0) >= cfg.minImp;
}

// ───── 한국어 제목: 미국 공시·보도자료 영어 제목은 AI 번역 (한 번 번역하면 저장) ─────
const hasKo = (s) => /[가-힣]/.test(String(s || ''));
export async function koTitle(x, ai) {
  for (const c of [ai?.headline, x.ko?.title, x.titleKo, x.summary?.title, x.rk?.title]) if (c && hasKo(c)) return String(c);
  const raw = titleOf(x);
  if (hasKo(raw)) return raw;
  const ck = `tgch/ko/${x.id}`;
  const c = await getJSON(ck).catch(() => null);
  if (c?.ko) return c.ko;
  try {
    const { translateTitles } = await import('./ai.mjs');
    const m = await translateTitles([{ id: x.id, title: raw, desc: x.pr?.deck || x.desc || '' }]);
    if (m[x.id]) { await setJSON(ck, { ko: m[x.id] }).catch(() => {}); return m[x.id]; }
  } catch {}
  return raw;
}

/** 크론(매분) */
export async function channelWatch() {
  const chat = process.env.TELEGRAM_CHANNEL_ID;
  if (!chat || !process.env.TELEGRAM_BOT_TOKEN) return null;
  const cfg = { ...DEFAULT_CFG, ...((await getJSON('tgch/cfg')) || {}) };
  if (!cfg.on) return { off: true };
  const now = Date.now();
  const st = (await getJSON('tgch/state')) || { sent: [], first: now, hist: [] };
  if (!st.first) st.first = now;
  const sent = new Set(st.sent);
  const hist = (st.hist || []).filter((t) => now - t < 3600e3); // 최근 1시간 게시 시각
  const [sec, dart, news] = await Promise.all(['sec/feed', 'dart/feed', 'news/feed'].map((k) => getJSON(k).catch(() => null)));
  const pool = [...(sec?.items || []), ...(dart?.items || []), ...(news?.items || [])]
    .filter((x) => x.id && !sent.has(x.id) && !x.dupOf)
    .map((x) => ({ x, ms: itemMs(x) }))
    .filter(({ ms }) => ms && now - ms < 40 * 60e3 && ms > st.first - 5 * 60e3) // 켠 뒤에 나온 최근 것만
    .sort((a, b) => a.ms - b.ms);
  let n = 0;
  const errs = [];
  for (const { x, ms } of pool) {
    if (n >= 3 || hist.length >= cfg.perHour) break;
    if (!(await worth(x, cfg))) { sent.add(x.id); continue; } // 대상 아님 → 다시 안 봄
    // AI 분석을 최대 6분 기다림 (없으면 제목만으로)
    const ai = (await getJSON(`ai3/${x.id}`)) || (await getJSON(`aiq/${x.id}`));
    if (!ai && now - ms < 6 * 60e3) continue;
    if (x.src === 'PR' && ai?.verdict === '중립') { sent.add(x.id); continue; } // 보도자료는 호재·악재만
    const mk = x.src === 'DART' || x.market === 'KR' ? 'KR' : 'US';
    const v = ai?.verdict || null;
    const vt = v === '긍정' ? '🟢 호재' : v === '부정' ? '🔴 악재' : v ? '⚪ 중립' : '';
    const pts = (ai?.summary || []).slice(0, 2).map((s) => `• ${esc(String(s).slice(0, 110))}`).join('\n');
    const kind = x.src === 'DART' ? 'DART 공시' : x.src === 'SEC' ? `SEC ${x.form || '공시'}` : x.source || '보도자료';
    const earn = isEarnings(x) ? '📊 <b>실적 발표</b>  ' : '';
    const ev = earn ? (await getJSON('earn/vmap').catch(() => null))?.[x.id] : null;
    if (earn && !ev && now - ms < 6 * 60e3) continue; // 실적은 컨센서스 판정을 조금 기다림
    const text = `${earn}${mk === 'KR' ? '🇰🇷' : '🇺🇸'} <b>${esc(nameOf(x))}</b>${vt ? '  ' + vt : ''}\n${esc(String(await koTitle(x, ai)).slice(0, 140))}${ev ? `\n\n${ev.v === '상회' ? '🟢' : ev.v === '하회' ? '🔴' : '⚪'} <b>컨센서스 ${esc(ev.v)}</b> · ${esc(ev.line)}` : ''}${pts ? '\n\n' + pts : ''}\n\n<i>${esc(kind)} · ${kst(ms)} KST</i>\n<a href="https://gk-stock.com/p/${encodeURIComponent(x.id)}">자세히 보기 →</a>`;
    try { await sendCard(chat, text, () => filingPng(x.id)); sent.add(x.id); hist.push(Date.now()); n++; st.last = { id: x.id, at: Date.now(), title: titleOf(x).slice(0, 80) }; }
    catch (e) { errs.push(e.message); if (/429|Too Many/i.test(e.message)) break; if (/chat not found|not enough rights|bot is not a member|403/i.test(e.message)) { st.err = e.message; break; } }
  }
  st.sent = [...sent].slice(-800);
  st.hist = hist;
  const day = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  if (st.day !== day) { st.day = day; st.dayN = 0; }
  st.dayN = (st.dayN || 0) + n;
  if (n) delete st.err;
  if (errs.length) st.lastErr = { at: now, msg: errs[0].slice(0, 200) };
  await setJSON('tgch/state', st).catch(() => {});
  return { sent: n, errs };
}

// ───── 오늘 주요 이슈: 새 회차가 만들어지면 채널에 올림 (사이트 회차 시간 그대로) ─────
export async function postIssue(ed) {
  const chat = process.env.TELEGRAM_CHANNEL_ID;
  if (!chat || !process.env.TELEGRAM_BOT_TOKEN || !ed?.issues?.length) return false;
  const cfg = { ...DEFAULT_CFG, ...((await getJSON('tgch/cfg')) || {}) };
  if (!cfg.on || !cfg.issues || (ed.mk === 'KR' ? !cfg.kr : !cfg.us)) return false;
  const key = `tgch/iss/${ed.id}`;
  if (await getJSON(key)) return false; // 같은 회차는 한 번만
  const pct = (v) => (v == null ? '' : ` ${v > 0 ? '▲' : v < 0 ? '▼' : ''}${Math.abs(v).toFixed(2)}%`);
  const lines = ed.issues.slice(0, 6).map((x, i) => {
    const s0 = (x.stocks || []).find((s) => s.pct != null);
    return `${i + 1}. ${x.tone === '호재' ? '🟢' : x.tone === '악재' ? '🔴' : '⚪'} <b>${esc(x.title)}</b>${s0 ? `  <i>${esc(s0.name)}${pct(s0.pct)}</i>` : ''}`;
  }).join('\n');
  const text = `📰 <b>${ed.mk === 'KR' ? '국장' : '미장'} 주요 이슈 · ${esc(ed.slot || '')}</b>\n${esc(ed.headline || '')}\n\n${lines}\n\n<a href="https://gk-stock.com/i/${encodeURIComponent(ed.id)}">이슈 ${ed.issues.length}개 자세히 보기 →</a>`;
  await sendCard(chat, text, async () => { const saved = await getJSON(`issues/og/${ed.id}`); if (saved?.b) return Uint8Array.from(atob(saved.b), (c) => c.charCodeAt(0)); return (await import('./og.mjs')).issueOgPng(NOCTX, ed.id, ed); }, { preview: true });
  await setJSON(key, { at: Date.now() });
  return true;
}

// ───── AI가 고른 핵심 공시: 하루 3번씩 (국장 장 전·점심·마감 / 미장 개장 전·장중·마감) ─────
const DG_TIMES = { KR: [[8, 40], [12, 10], [15, 45]], US: [[8, 50], [12, 30], [16, 15]] };
function zoned(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, m: Number(p.hour) * 60 + Number(p.minute) };
}
export async function digestWatch() {
  const chat = process.env.TELEGRAM_CHANNEL_ID;
  if (!chat || !process.env.TELEGRAM_BOT_TOKEN) return null;
  const cfg = { ...DEFAULT_CFG, ...((await getJSON('tgch/cfg')) || {}) };
  if (!cfg.on || !cfg.digest) return null;
  const out = {};
  for (const mk of ['KR', 'US']) {
    if (mk === 'KR' ? !cfg.kr : !cfg.us) continue;
    const z = zoned(mk === 'KR' ? 'Asia/Seoul' : 'America/New_York');
    const wk = ['Sat', 'Sun'].includes(z.wd); // 주말엔 하루 한 번(첫 회차)만
    const slot = (wk ? DG_TIMES[mk].slice(0, 1).map(([h, mi]) => [h + 1, mi]) : DG_TIMES[mk]).find(([h, mi]) => z.m >= h * 60 + mi && z.m < h * 60 + mi + 10);
    if (!slot) continue;
    const key = `tgch/dg/${mk}/${z.date}-${slot[0]}${slot[1]}`;
    if (await getJSON(key)) continue;
    await setJSON(key, { at: Date.now() }); // 실패해도 이 회차는 다시 안 보냄 (중복 방지)
    try {
      const res = await (await import('../functions/digest.mjs')).default(new Request(`http://x/api/digest?mk=${mk}`));
      const d = await res.json();
      if (!d?.ok || !d.items?.length) { out[mk] = 'empty'; continue; }
      const [sec, dart, news] = await Promise.all(['sec/feed', 'dart/feed', 'news/feed'].map((k) => getJSON(k).catch(() => null)));
      const all = new Map([...(sec?.items || []), ...(dart?.items || []), ...(news?.items || [])].map((x) => [x.id, x]));
      const lines = d.items.slice(0, 6).map((x, i) => {
        const it = all.get(x.id);
        const nm = it ? (mk === 'KR' ? it.name || it.ticker : it.ticker || it.company || '') : '';
        return `${i + 1}. ${x.verdict === '긍정' ? '🟢' : x.verdict === '부정' ? '🔴' : '⚪'} <b>${esc(nm)}</b> ${esc(x.title)}${x.why ? `\n    └ ${esc(String(x.why).slice(0, 90))}` : ''}`;
      }).join('\n');
      const when = mk === 'KR' ? ['장 시작 전', '점심', '장 마감'][DG_TIMES.KR.indexOf(slot)] : ['개장 전', '장중', '장 마감'][DG_TIMES.US.indexOf(slot)];
      const text = `🤖 <b>AI가 고른 ${mk === 'KR' ? '국장' : '미장'} 핵심 공시</b> · ${when}\n${esc(d.headline || '')}\n\n${lines}\n\n<a href="https://gk-stock.com/?top=digest&mk=${mk}">전체 보기 →</a>`;
      await sendCard(chat, text, () => digestPng(mk, when, d, all), { preview: false });
      out[mk] = 'sent';
    } catch (e) { out[mk] = 'error: ' + e.message; }
  }
  return out;
}

// ───── 공시 후 급등: 발표 뒤 6시간 안에 발표 시점 주가 대비 크게 오른 종목을 알림 (중요도와 상관없이) ─────
export async function surgeWatch() {
  const chat = process.env.TELEGRAM_CHANNEL_ID;
  if (!chat || !process.env.TELEGRAM_BOT_TOKEN) return null;
  const cfg = { ...DEFAULT_CFG, ...((await getJSON('tgch/cfg')) || {}) };
  if (!cfg.on || !cfg.surge) return null;
  const now = Date.now();
  const map = (await getJSON('px0/map')) || {};
  const recent = Object.entries(map).filter(([, v]) => v?.p > 0 && now - v.t < 6 * 3600e3);
  if (!recent.length) return { n: 0 };
  const [sec, dart, news] = await Promise.all(['sec/feed', 'dart/feed', 'news/feed'].map((k) => getJSON(k).catch(() => null)));
  const all = new Map([...(sec?.items || []), ...(dart?.items || []), ...(news?.items || [])].map((x) => [x.id, x]));
  const mkOf = (x) => (x.src === 'DART' || x.market === 'KR' ? 'KR' : 'US');
  const qk = (x) => `${mkOf(x)}:${String(x.ticker || '').toUpperCase()}`;
  const cand = recent.map(([id, v]) => ({ x: all.get(id), v })).filter(({ x }) => x?.ticker && (mkOf(x) === 'KR' ? cfg.kr : cfg.us) && x.src !== 'NEWS');
  if (!cand.length) return { n: 0 };
  const { getQuotes } = await import('../functions/quote.mjs');
  const q = await getQuotes([...new Set(cand.map(({ x }) => qk(x)))].slice(0, 60)).catch(() => ({}));
  const st = (await getJSON('tgch/surge')) || {};
  const day = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  if (st.day !== day) { st.day = day; st.done = {}; st.n = 0; }
  const hits = [];
  for (const { x, v } of cand) {
    const k = qk(x), cur = q[k]?.live ?? q[k]?.price;
    if (!cur || st.done[k]) continue; // 같은 종목은 하루 한 번
    const r = (cur / v.p - 1) * 100;
    if (r >= SURGE[mkOf(x)] && r < 1000) hits.push({ x, v, k, r, cur, sess: q[k]?.session || null, day: q[k]?.livePct ?? q[k]?.pct });
  }
  hits.sort((a, b) => b.r - a.r);
  let n = 0;
  for (const h of hits) {
    if (n >= 3 || (st.n || 0) >= 40) break; // 한 번에 3건, 하루 40건까지
    const x = h.x, mk = mkOf(x);
    const ai = (await getJSON(`ai3/${x.id}`)) || (await getJSON(`aiq/${x.id}`));
    const mins = Math.round((now - h.v.t) / 60e3);
    const ago = mins < 60 ? `${mins}분` : `${Math.floor(mins / 60)}시간 ${mins % 60}분`;
    const px = mk === 'KR' ? `${Math.round(h.cur).toLocaleString('ko-KR')}원` : `$${h.cur < 1 ? h.cur.toFixed(4) : h.cur.toFixed(2)}`;
    const sess = h.sess === 'PRE' ? ' (프리)' : h.sess === 'AFTER' ? ' (애프터)' : h.sess === 'DAY' ? ' (데이)' : '';
    const kind = x.src === 'DART' ? 'DART 공시' : x.src === 'SEC' ? `SEC ${x.form || '공시'}` : x.source || '보도자료';
    const pt = (ai?.summary || [])[0];
    const text = `🚀 <b>공시 후 급등</b>  ${mk === 'KR' ? '🇰🇷' : '🇺🇸'} <b>${esc(nameOf(x))}</b>  <b>+${h.r.toFixed(1)}%</b>\n발표 후 ${ago} · 지금 ${px}${sess}\n\n${esc(String(await koTitle(x, ai)).slice(0, 140))}${pt ? `\n• ${esc(String(pt).slice(0, 110))}` : ''}\n\n<i>${esc(kind)} · ${kst(h.v.t)} KST 주가 대비</i>\n<a href="https://gk-stock.com/p/${encodeURIComponent(x.id)}">자세히 보기 →</a>`;
    try { await sendCard(chat, text, () => filingPng(x.id), { preview: false }); st.done[h.k] = { id: x.id, r: Math.round(h.r * 10) / 10, at: now }; st.n = (st.n || 0) + 1; n++; }
    catch (e) { st.lastErr = e.message; if (/429|Too Many|403|chat not found/i.test(e.message)) break; }
  }
  await setJSON('tgch/surge', st).catch(() => {});
  return { n, hits: hits.length };
}

// ───── 'AI가 고른 핵심 공시' 카드 이미지 (1200×630) ─────
async function digestPng(mk, when, d, all) {
  const { ImageResponse, GoogleFont, cache } = await import('@cf-wasm/og/workerd');
  const { t } = await import('@cf-wasm/og/html-to-react');
  cache.setExecutionContext(NOCTX);
  const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const kr = mk === 'KR';
  const rows = d.items.slice(0, 6).map((x, i) => {
    const it = all.get(x.id);
    const nm = it ? (kr ? it.name || it.ticker : it.ticker || it.company || '') : '';
    const vc = x.verdict === '긍정' ? '#34d399' : x.verdict === '부정' ? '#fb7185' : '#a5b4fc';
    const vt = x.verdict === '긍정' ? '호재' : x.verdict === '부정' ? '악재' : '중립';
    return `<div style="display:flex;align-items:center;width:524px;margin:0 ${i % 2 ? 0 : 32}px 12px 0;padding:10px 16px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(139,108,255,.35)"><div style="display:flex;width:44px;height:44px;border-radius:12px;background:#f5c542;color:#1b1300;font-size:26px;font-weight:700;align-items:center;justify-content:center">${i + 1}</div><div style="display:flex;flex-direction:column;margin-left:14px;flex:1"><div style="display:flex;align-items:center"><div style="display:flex;font-size:20px;font-weight:700;color:#93c5fd">${e(cut(nm, 14))}</div><div style="display:flex;margin-left:8px;padding:1px 10px;border-radius:999px;border:2px solid ${vc};color:${vc};font-size:16px;font-weight:700">${vt}</div></div><div style="display:flex;font-size:23px;font-weight:700;color:#fff">${e(cut(x.title, 22))}</div></div></div>`;
  }).join('');
  const html = `<div style="display:flex;flex-direction:column;width:1200px;height:630px;padding:38px 56px 34px;background:linear-gradient(135deg,#1a1650 0%,#0b0d24 55%,#080a1c 100%);color:#eef0ff;font-family:'Noto Sans KR'"><div style="display:flex;width:100%;align-items:center;justify-content:space-between"><div style="display:flex;align-items:center"><div style="display:flex;padding:8px 20px;border-radius:999px;background:${kr ? '#ff5a6a' : '#3e7bff'};color:#fff;font-size:26px;font-weight:700">${kr ? '국장' : '미장'} · ${e(when)}</div></div><div style="display:flex;font-size:26px;font-weight:700;color:#c4b5fd">GK의 공시레이더</div></div><div style="display:flex;margin-top:12px;font-size:52px;font-weight:700;color:#fff">AI가 고른 핵심 공시</div><div style="display:flex;margin-top:6px;font-size:26px;color:#c3c7e6">${e(cut(d.headline, 46))}</div><div style="display:flex;flex-wrap:wrap;width:100%;margin-top:18px">${rows}</div><div style="display:flex;width:100%;margin-top:auto;justify-content:space-between;align-items:center;font-size:22px;color:#8b90b8"><div style="display:flex">실시간 공시 · AI 분석 · 호재/악재</div><div style="display:flex;color:#f5c542;font-weight:700">gk-stock.com</div></div></div>`;
  const allText = [...new Set(`${html.replace(/<[^>]+>/g, '')}국장미장AI가고른핵심공시호재악재중립GK의공시레이더gk-stock.com0123456789…·`.replace(/\s+/g, ''))].join('') + ' ';
  const res = await ImageResponse.async(t(html.replace(/>\s+</g, '><')), { width: 1200, height: 630, fonts: [new GoogleFont('Noto Sans KR', { weight: 400, text: allText }), new GoogleFont('Noto Sans KR', { weight: 700, text: allText })] });
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}
