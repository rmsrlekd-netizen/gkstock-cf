// /api/health — 배포 후 점검용: 환경변수·수집기 상태 확인 (키 값은 노출하지 않음)
import { json } from '../lib/util.mjs';
import { getJSON } from '../lib/store.mjs';
import { kospiFrontCode } from '../lib/kis.mjs';
import { aiProvider, askAI } from '../lib/ai.mjs';

export default async (req) => {
  const testAI = new URL(req.url).searchParams.get('ai') === '1';
  let aiTest = null;
  if (testAI) {
    if (!aiProvider()) aiTest = { ok: false, error: 'AI 키 없음' };
    else {
      const t0 = Date.now();
      try { const r = await askAI('JSON으로만 답하세요: {"ok":true}', { maxTokens: 50, timeout: 8000 }); aiTest = { ok: /ok/.test(r), ms: Date.now() - t0, reply: r.slice(0, 80) }; }
      catch (e) { aiTest = { ok: false, error: String(e.message || e).slice(0, 300) }; }
    }
  }
  const aiLast = await getJSON('ai/lastError');
  const sec = await getJSON('sec/feed');
  const dart = await getJSON('dart/feed');
  const news = await getJSON('news/feed');
  const age = (t) => (t ? Math.round((Date.now() - Date.parse(t)) / 1000) + '초 전' : '없음');
  return json({
    ok: true,
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
    kospiFuturesCode: kospiFrontCode(),
  }, { cdnSeconds: 0, swr: 0 });
};

export const config = { path: '/api/health' };
