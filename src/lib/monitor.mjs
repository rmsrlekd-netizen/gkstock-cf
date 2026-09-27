// 고장 자동 감시: 수집기·데이터·AI 상태를 주기적으로 점검하고, 문제가 생기거나 복구되면 텔레그램으로 알림
// 설정(선택): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  (없으면 관리자 화면에만 표시)
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout } from './util.mjs';

const MIN = 60e3;
function zoned(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { wd: p.weekday, m: Number(p.hour) * 60 + Number(p.minute) };
}
const weekday = (z) => !['Sat', 'Sun'].includes(z.wd);
const ago = (ms) => (ms < 90e3 ? '방금' : ms < 3600e3 ? `${Math.round(ms / MIN)}분 전` : `${(ms / 3600e3).toFixed(1)}시간 전`);

async function checks() {
  const now = Date.now();
  const us = zoned('America/New_York'), kr = zoned('Asia/Seoul');
  const usBusy = weekday(us) && us.m >= 240 && us.m <= 1230;
  const krBusy = weekday(kr) && kr.m >= 420 && kr.m <= 1230;
  const [sec, dart, news, market, popular, aiErr, aiOk, aiPause] = await Promise.all(['sec/feed', 'dart/feed', 'news/feed', 'market/v1', 'popular/v2', 'ai/lastError', 'ai/lastOk', 'ai/pause'].map((k) => getJSON(k)));
  const out = [];
  const add = (key, name, ok, msg) => out.push({ key, name, ok, msg });

  const age = (f) => (f?.updatedAt ? now - Date.parse(f.updatedAt) : Infinity);
  const secLimit = usBusy ? 20 * MIN : 75 * MIN;
  add('sec', '미국 SEC 공시 수집', age(sec) < secLimit && !(sec?.errors || []).length, `마지막 수집 ${ago(age(sec))}${(sec?.errors || []).length ? ' · 오류: ' + sec.errors.join(' / ').slice(0, 160) : ''}`);
  const dartLimit = krBusy ? 20 * MIN : 75 * MIN;
  add('dart', '한국 DART 공시 수집', age(dart) < dartLimit && !(dart?.errors || []).length, `마지막 수집 ${ago(age(dart))}${(dart?.errors || []).length ? ' · 오류: ' + dart.errors.join(' / ').slice(0, 160) : ''}`);
  const nErr = news?.errors || [];
  const prDay = (news?.items || []).filter((x) => x.src === 'PR' && now - Date.parse(x.time) < 24 * 3600e3).length;
  add('news', '보도자료·뉴스 수집', age(news) < 20 * MIN && (prDay > 0 || !weekday(us)), `마지막 수집 ${ago(age(news))} · 24시간 보도자료 ${prDay}건${nErr.length ? ' · 실패한 출처: ' + nErr.map((e) => e.split(':')[0]).join(', ') : ''}`);
  const mAge = market?.at ? now - market.at : Infinity;
  const idxOk = (market?.body?.indices || []).filter((x) => !x.error).length;
  add('market', '시장 지표', mAge < 30 * MIN && idxOk >= 6, `마지막 갱신 ${ago(mAge)} · 지수 ${idxOk}개 정상${market?.body?.night?.ok === false ? ' · 야간선물 실패: ' + (market.body.night.reason || '') : ''}`);
  const pAge = popular?.at ? now - popular.at : Infinity;
  add('popular', '실시간 인기 종목', pAge < 30 * MIN && (popular?.kr || []).length > 0 && (popular?.us || []).length > 0, `마지막 갱신 ${ago(pAge)} · 국내 ${(popular?.kr || []).length}개 · 미국 ${(popular?.us || []).length}개`);
  const errRecent = aiErr?.at && now - aiErr.at < 60 * MIN && (!aiOk?.at || aiErr.at > aiOk.at);
  const paused = aiPause?.until > now;
  add('ai', 'AI 분석 (Gemini)', !errRecent && !paused, paused ? `${aiPause.reason || '한도 초과'} → ${Math.ceil((aiPause.until - now) / 60e3)}분 동안 AI 호출 중지 (그동안은 자동 요약). 반복되면 Gemini 결제(유료 전환) 필요` : errRecent ? `최근 실패 ${ago(now - aiErr.at)}: ${String(aiErr.error).slice(0, 180)}` : `마지막 성공 ${aiOk?.at ? ago(now - aiOk.at) : '기록 없음'}`);
  return out;
}

export async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const r = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) }, 8000);
  return r.ok;
}

/** 점검 실행 → 상태 저장, 2번 연속 실패하면 알림, 복구되면 복구 알림 */
export async function runMonitor() {
  // 방문자가 없어도 점검할 수 있게 시장 지표·인기 종목을 먼저 새로 받아둠
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  for (const [path, mod] of [['/api/market', '../functions/market.mjs'], ['/api/popular', '../functions/popular.mjs']]) {
    try { await (await import(mod)).default(new Request('http://x' + path), ctx); } catch {}
  }
  await Promise.allSettled(waits);
  const prev = (await getJSON('monitor/state')) || { checks: {} };
  const list = await checks();
  const state = { at: Date.now(), checks: {} };
  const alerts = [], recovered = [];
  for (const c of list) {
    const p = prev.checks[c.key] || { fails: 0, alerted: false };
    const fails = c.ok ? 0 : p.fails + 1;
    let alerted = p.alerted;
    if (!c.ok && fails >= 2 && !p.alerted) { alerts.push(c); alerted = true; }
    if (c.ok && p.alerted) { recovered.push(c); alerted = false; }
    state.checks[c.key] = { ...c, fails, alerted, since: c.ok === (p.ok ?? true) ? p.since || Date.now() : Date.now() };
  }
  if (alerts.length) await telegram(`⚠️ GK 공시레이더 이상 감지\n\n${alerts.map((c) => `• ${c.name}\n  ${c.msg}`).join('\n')}\n\nhttps://gk-stock.com/#admin`).catch(() => {});
  if (recovered.length) await telegram(`✅ GK 공시레이더 복구\n\n${recovered.map((c) => `• ${c.name}: ${c.msg}`).join('\n')}`).catch(() => {});
  await setJSON('monitor/state', state).catch(() => {});
  return state;
}
