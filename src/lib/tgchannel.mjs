// 텔레그램 채널 자동 게시 — 중요 공시·보도자료가 나오면 AI 요약과 함께 채널에 올림
//  설정: Cloudflare 변수 TELEGRAM_BOT_TOKEN(봇) + TELEGRAM_CHANNEL_ID(@채널주소 또는 -100… 숫자), 봇을 채널 관리자로 추가
//  관리자 화면에서 켜기/끄기 · 기준(중요도) · 시간당 최대 건수 조절
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout } from './util.mjs';

export const DEFAULT_CFG = { on: true, minImp: 4, perHour: 12, kr: true, us: true };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/');

export async function tgSend(chat, text, { preview = true } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chat) throw new Error('봇 토큰 또는 채널이 설정되지 않았습니다');
  const r = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: !preview, prefer_large_media: true } }),
  }, 9000);
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`텔레그램 ${j.error_code || r.status}: ${j.description || ''}`);
  return j;
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

/** 올릴 만한 항목인지 (중요도 기준) */
async function worth(x, cfg) {
  const mk = x.src === 'DART' || x.market === 'KR' ? 'KR' : 'US';
  if (!x.ticker || (mk === 'KR' ? !cfg.kr : !cfg.us)) return false;
  if (/^(4|144|13F|3|5|SC 13G|SCHEDULE 13G|10-Q|10-K|20-F|40-F|DEF|ARS)/i.test(x.form || '')) return false;
  if (x.src === 'DART' && x.category === 'insider') return false;
  if (x.src === 'PR' || x.src === 'NEWS') {
    // 보도자료: AI가 호재·악재로 판정한 것 중 유형이 뚜렷한 것만
    if (x.src === 'NEWS') return false;
    const { typeOf } = await import('./react.mjs');
    return !!typeOf(x);
  }
  return (x.impact ?? 0) >= cfg.minImp;
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
    const text = `${mk === 'KR' ? '🇰🇷' : '🇺🇸'} <b>${esc(nameOf(x))}</b>${vt ? '  ' + vt : ''}\n${esc(String(ai?.headline || titleOf(x)).slice(0, 140))}${pts ? '\n\n' + pts : ''}\n\n<i>${esc(kind)} · ${kst(ms)} KST</i>\n<a href="https://gk-stock.com/p/${encodeURIComponent(x.id)}">자세히 보기 →</a>`;
    try { await tgSend(chat, text); sent.add(x.id); hist.push(Date.now()); n++; st.last = { id: x.id, at: Date.now(), title: titleOf(x).slice(0, 80) }; }
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
