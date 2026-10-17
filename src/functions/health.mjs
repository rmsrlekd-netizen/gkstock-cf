// /api/health — 배포 후 점검용: 환경변수·수집기 상태 확인 (키 값은 노출하지 않음)
import { json } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { kospiFrontCode } from '../lib/kis.mjs';
import { aiProvider, askAI } from '../lib/ai.mjs';

export default async (req) => {
  // 바깥 감시용 짧은 응답 (?beat=1): 자동 수집·점검이 돌고 있는지 (Vercel 중계 서버가 10분마다 확인)
  if (new URL(req.url).searchParams.get('beat') === '1') {
    const [mon, sec, dart] = await Promise.all([getJSON('monitor/state').catch(() => null), getJSON('sec/feed').catch(() => null), getJSON('dart/feed').catch(() => null)]);
    const bad = Object.values(mon?.checks || {}).filter((c) => !c.ok && c.fails >= 2).map((c) => c.name);
    return json({ ok: true, monAge: mon?.at ? Math.round((Date.now() - mon.at) / 1000) : null, secAge: sec?.updatedAt ? Math.round((Date.now() - Date.parse(sec.updatedAt)) / 1000) : null, dartAge: dart?.updatedAt ? Math.round((Date.now() - Date.parse(dart.updatedAt)) / 1000) : null, bad }, { cdnSeconds: 0, swr: 0 });
  }
  // 서버(DB) 응답 속도 점검 (?db=1): 사이트가 '불러오는 중'에 멈출 때 원인 확인용
  if (new URL(req.url).searchParams.get('db') === '1') {
    const lim = (p, ms) => Promise.race([p, new Promise((_, rj) => setTimeout(() => rj(new Error(`${ms / 1000}초 넘게 응답 없음`)), ms))]);
    const t = async (f) => { const t0 = Date.now(); try { const v = await lim(f(), 8000); return { ok: true, ms: Date.now() - t0, v }; } catch (e) { return { ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) }; } };
    const ping = await t(() => getJSON('health/ping').then(() => 'ok'));
    const st = await t(() => getJSON('mp/state').then((s) => s && { date: s.date, phase: s.phase, force: s.force, err: s.err || null, tryN: s.tryN || 0, busy: (s.busyUntil || 0) > Date.now(), log: (s.log || []).slice(-6) }));
    const ai = await t(() => getJSON('ai/pause'));
    const runs = await t(() => getJSON('mp/runhist').then((h) => (h || []).slice(0, 7).map((x) => ({ date: x.date, mins: x.mins, done: x.doneKst, err: x.err, force: x.force }))));
    return json({ ok: true, at: new Date().toISOString(), dbRead: ping, radar: st, radarRuns: runs, aiPause: ai }, { cdnSeconds: 0, swr: 0 });
  }
  const testAI = new URL(req.url).searchParams.get('ai') === '1';
  let aiTest = null;
  if (testAI) {
    if (!aiProvider()) aiTest = { ok: false, error: 'AI 키 없음' };
    else {
      const t0 = Date.now();
      try { const r = await askAI('JSON으로만 답하세요: {"ok":true}', { maxTokens: 50, timeout: 20000 }); aiTest = { ok: /ok/i.test(r), ms: Date.now() - t0, reply: r.slice(0, 80) }; }
      catch (e) { aiTest = { ok: false, error: String(e.message || e).slice(0, 300) }; }
    }
  }
  // 저장소(D1) 쓰기 점검: 무료 한도(하루 10만 행)를 넘으면 여기서 오류가 보임
  // v231 빠르게: 쓰기 시험은 10분에 한 번만(그 사이엔 마지막 결과), 읽기는 한꺼번에 (예전엔 하나씩 차례로 읽어 4~5초)
  const [ping, bf, aiLast, sec, dart, news, borrow, shvol, futc] = await Promise.all(['health/ping', 'backfill/state', 'ai/lastError', 'sec/feed', 'dart/feed', 'news/feed', 'borrow/status', 'shvol/status', 'kis/futcode'].map((k) => getJSON(k).catch(() => null)));
  let dbWrite;
  if (ping?.at && Date.now() - ping.at < 10 * 60e3) dbWrite = { ok: true, checked: Math.round((Date.now() - ping.at) / 1000) + '초 전' };
  else { try { await setJSON('health/ping', { at: Date.now() }); dbWrite = { ok: true }; } catch (e) { dbWrite = { ok: false, error: String(e.message || e).slice(0, 300) }; } }
  const age = (t) => (t ? Math.round((Date.now() - Date.parse(t)) / 1000) + '초 전' : '없음');
  return json({
    ok: true,
    dbWrite,
    backfillQuota: bf?.quota || null,
    env: {
      DART_API_KEY: !!process.env.DART_API_KEY,
      SEC_USER_AGENT: !!process.env.SEC_USER_AGENT,
      KIS_APP_KEY: !!process.env.KIS_APP_KEY,
      KIS_APP_SECRET: !!process.env.KIS_APP_SECRET,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      FINNHUB_API_KEY: !!process.env.FINNHUB_API_KEY,
      aiProvider: aiProvider(),
    },
    ai: { provider: aiProvider(), test: aiTest || '주소 끝에 ?ai=1 을 붙이면 AI 키를 실제로 시험합니다', lastError: aiLast ? { ...aiLast, ago: Math.round((Date.now() - aiLast.at) / 60000) + '분 전' } : null },
    secWatcher: { updated: age(sec?.updatedAt), items: sec?.items?.length || 0, errors: sec?.errors || [], form4WithDetail: (sec?.items || []).filter((x) => x.tx).length, withPressRelease: (sec?.items || []).filter((x) => x.pr).length, withKoreanAI: (sec?.items || []).filter((x) => x.ko).length, aiError: sec?.aiError || null },
    dartWatcher: { updated: age(dart?.updatedAt), items: dart?.items?.length || 0, errors: dart?.errors || [], withOfficialTime: (dart?.items || []).filter((x) => x.timeMin && x.timeMin !== 'na').length, withSummary: (dart?.items || []).filter((x) => x.summary?.title).length },
    news: { updated: age(news?.updatedAt), items: news?.items?.length || 0, pr: (news?.items || []).filter((x) => x.src === 'PR').length, news: (news?.items || []).filter((x) => x.src === 'NEWS').length, withKorean: (news?.items || []).filter((x) => x.titleKo).length, errors: news?.errors || [], aiError: news?.aiError || null },
    shortData: { borrow, finraDaily: shvol },
    kospiFuturesCode: futc?.codes || kospiFrontCode(),
  }, { cdnSeconds: 0, swr: 0 });
};

export const config = { path: '/api/health' };
