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
  // 저장소 쓰기 점검 (Cloudflare D1 무료 한도 초과 시 모든 수집이 멈춤)
  let dbErr = null;
  try { await setJSON('health/ping', { at: now }); } catch (e) { dbErr = String(e.message || e); }
  add('db', '데이터 저장소 (D1)', !dbErr, dbErr ? `저장 실패 → 수집이 멈춘 상태: ${dbErr.slice(0, 160)}. 하루 쓰기 한도 초과라면 오전 9시(한국)에 풀림` : '저장 정상');

  const age = (f) => (f?.updatedAt ? now - Date.parse(f.updatedAt) : Infinity);
  const secLimit = usBusy ? 20 * MIN : 75 * MIN;
  add('sec', '미국 SEC 공시 수집', age(sec) < secLimit && !(sec?.errors || []).length, `마지막 수집 ${ago(age(sec))}${(sec?.errors || []).length ? ' · 오류: ' + sec.errors.join(' / ').slice(0, 160) : ''}${(sec?.skipped || []).length ? ' · SEC 응답이 느려 드문 서식(' + sec.skipped.join(', ') + ')은 다음 회차에 먼저 수집' : ''}`);
  const dartLimit = krBusy ? 20 * MIN : 75 * MIN;
  // DART 지연 = 우리가 처음 발견한 시각 - DART 공식 접수 시각(분 단위) (최근 24시간 중앙값)
  const dl = (dart?.items || []).filter((x) => x.seenLive && x.seenAt && x.timeMin && x.timeMin !== 'na' && now - Date.parse(x.seenAt) < 24 * 3600e3)
    .map((x) => (Date.parse(x.seenAt) - Date.parse(x.timeMin.replace(' ', 'T') + ':00+09:00')) / 60e3 - 0.5).filter((v) => v > -2 && v < 600).sort((a, b) => a - b);
  const dMed = dl.length ? dl[Math.floor(dl.length / 2)] : null;
  add('dart', '한국 DART 공시 수집', age(dart) < dartLimit && !(dart?.errors || []).length, `마지막 수집 ${ago(age(dart))}${dMed != null ? ` · 접수 후 평균 지연 약 ${Math.max(0, dMed).toFixed(1)}분 (${dl.length}건)` : ''}${(dart?.errors || []).length ? ' · 오류: ' + dart.errors.join(' / ').slice(0, 160) : ''}`);
  const nErr = news?.errors || [];
  const prDay = (news?.items || []).filter((x) => x.src === 'PR' && now - Date.parse(x.time) < 24 * 3600e3).length;
  // 보도자료 지연 = 우리가 처음 가져온 시각 - 원래 발표 시각 (최근 24시간 중앙값)
  // 출처별 발표 후 지연(중앙값). 수집이 멈췄다가 몰아서 들어온 것(6시간 넘게 늦은 것)은 제외
  const SRC = { 'PR Newswire': 'PRN', 'Business Wire': 'BW', 'GlobeNewswire': 'GNW', 'ACCESS Newswire': 'AW', '뉴스와이어': '뉴스와이어' };
  const bySrc = {};
  for (const x of news?.items || []) {
    if (x.src !== 'PR' || !x.seenAt || now - Date.parse(x.time) > 24 * 3600e3) continue;
    const v = (Date.parse(x.seenAt) - Date.parse(x.time)) / 60e3;
    if (v < -5 || v > 360) continue;
    (bySrc[SRC[x.source] || x.source] ||= []).push(Math.max(0, v));
  }
  const med = (a) => { a.sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
  const lagTxt = Object.entries(bySrc).map(([k, a]) => `${k} ${Math.round(med(a))}분`).join(' · ');
  add('news', '보도자료 수집', age(news) < 15 * MIN && (prDay > 0 || !weekday(us)), `마지막 수집 ${ago(age(news))} · 24시간 보도자료 ${prDay}건${lagTxt ? ` · 발표 후 지연(중앙값) ${lagTxt}` : ''}${nErr.length ? ' · 이번 회차 응답 없음: ' + nErr.map((e) => ({ bw: 'BW', prn: 'PRN', gnw: 'GNW', aw: 'AW', nw: '뉴스와이어', prnd: 'PRN 직접' }[e.split(':')[0]] || e.split(':')[0])).join(', ') : ''}`);
  // 출처별 멈춤 감지: 연속 실패가 길거나, 미국 평일 낮인데 새 글이 오래 안 들어오면 이상
  // (각 출처는 막히면 직접 → 중계 서버 → 다른 접속 방식으로 알아서 우회하고, 되는 경로를 기억함)
  const sh = await getJSON('news/srchealth');
  if (sh) {
    const NM = { gnw: 'GlobeNewswire', prn: 'PR Newswire', bw: 'Business Wire', aw: 'ACCESS Newswire', nw: '뉴스와이어', prnd: 'PRN 직접' };
    const STALL = { gnw: 3, prn: 3, bw: 4, aw: 8, nw: 12 }; // 시간
    const usDay = weekday(us) && us.m >= 7 * 60 && us.m <= 20 * 60;
    const bad = [], info = [];
    for (const [k, h] of Object.entries(sh)) {
      if (!NM[k] || k === 'prnd') continue;
      const newH = h.newAt ? (now - Date.parse(h.newAt)) / 3600e3 : Infinity;
      const failLong = (h.fails || 0) >= 20;
      const stalled = usDay && STALL[k] && newH > STALL[k] && (h.okAt ? now - Date.parse(h.okAt) < 60 * MIN : true);
      if (failLong) bad.push(`${NM[k]}: ${h.fails}회 연속 실패 — ${h.lastErr || ''}`.slice(0, 200));
      else if (stalled) bad.push(`${NM[k]}: 새 보도자료가 ${newH === Infinity ? '한동안' : newH.toFixed(1) + '시간'} 없음 (사이트 형식 변경 가능성)`);
      info.push(`${NM[k]} ${h.newAt ? ago(now - Date.parse(h.newAt)) : '-'}`);
    }
    add('newsSrc', '보도자료 출처별 상태', !bad.length, bad.length ? bad.join(' / ') : '마지막 새 글: ' + info.join(' · '));
  }
  const mAge = market?.at ? now - market.at : Infinity;
  const idxOk = (market?.body?.indices || []).filter((x) => !x.error).length;
  add('market', '시장 지표', mAge < 30 * MIN && idxOk >= 6, `마지막 갱신 ${ago(mAge)} · 지수 ${idxOk}개 정상${market?.body?.night?.ok === false ? ' · 야간선물 실패: ' + (market.body.night.reason || '') : ''}`);
  const pAge = popular?.at ? now - popular.at : Infinity;
  add('popular', '실시간 인기 종목', pAge < 30 * MIN && (popular?.kr || []).length > 0 && (popular?.us || []).length > 0, `마지막 갱신 ${ago(pAge)} · 국내 ${(popular?.kr || []).length}개 · 미국 ${(popular?.us || []).length}개`);
  // AI가 가끔 틀린 형식으로 답하는 건(다음 호출에서 대부분 정상) 30분 안에 성공이 있으면 이상으로 보지 않음
  const flaky = /JSON|형식 오류|Unexpected token|Unterminated|Expected/.test(String(aiErr?.error || ''));
  const errRecent = aiErr?.at && now - aiErr.at < 60 * MIN && (!aiOk?.at || aiErr.at > aiOk.at) && !(flaky && aiOk?.at && now - aiOk.at < 30 * MIN);
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
  // 저장소가 막히면 상태 기록도 안 되므로 바로 알림 (같은 서버에서 3시간에 한 번)
  const dbc = list.find((c) => c.key === 'db');
  if (dbc && !dbc.ok && Date.now() - (globalThis.__gkDbAlert || 0) > 3 * 3600e3) { globalThis.__gkDbAlert = Date.now(); await telegram(`⚠️ GK 공시레이더 저장소 오류\n\n${dbc.msg}`).catch(() => {}); }
  if (alerts.length) await telegram(`⚠️ GK 공시레이더 이상 감지\n\n${alerts.map((c) => `• ${c.name}\n  ${c.msg}`).join('\n')}\n\nhttps://gk-stock.com/#admin`).catch(() => {});
  if (recovered.length) await telegram(`✅ GK 공시레이더 복구\n\n${recovered.map((c) => `• ${c.name}: ${c.msg}`).join('\n')}`).catch(() => {});
  await setJSON('monitor/state', state).catch(() => {});
  return state;
}
