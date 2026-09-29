// /api/admin?key=관리자키 — 방문자 통계·게시물 조회수·고장 감시 현황 (관리자 전용)
//  &item=ID1,ID2 → 해당 게시물 조회수만
//  &tg=find → 텔레그램 봇에 메시지를 보낸 채팅 ID 찾기, &tg=test → 테스트 알림
//  &monitor=run → 지금 바로 점검
import { getJSON, setJSON } from '../lib/store.mjs';
import { report, itemViews } from '../lib/stats.mjs';
import { runMonitor, telegram } from '../lib/monitor.mjs';
import { aiUsage } from '../lib/ai.mjs';
import { fetchWithTimeout } from '../lib/util.mjs';
import { archiveStats } from '../lib/archive.mjs';

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default async (req) => {
  const u = new URL(req.url);
  const want = process.env.ADMIN_KEY;
  if (!want) return J({ ok: false, error: 'Cloudflare 변수에 ADMIN_KEY(관리자 비밀번호)를 먼저 등록하세요.', needsSetup: true }, 403);
  if ((u.searchParams.get('key') || '') !== want) return J({ ok: false, error: '관리자 비밀번호가 맞지 않습니다.' }, 403);

  const item = u.searchParams.get('item');
  if (item) return J({ ok: true, views: await itemViews(item.split(',').filter(Boolean).slice(0, 50)) });

  const tg = u.searchParams.get('tg');
  if (tg === 'find') {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return J({ ok: false, error: 'TELEGRAM_BOT_TOKEN을 먼저 등록하세요.' });
    const r = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getUpdates`, {}, 8000);
    const j = await r.json().catch(() => ({}));
    const chats = [...new Map((j.result || []).map((x) => x.message?.chat || x.my_chat_member?.chat).filter(Boolean).map((c) => [c.id, { id: c.id, name: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username }])).values()];
    return J({ ok: true, chats, hint: chats.length ? '' : '텔레그램에서 봇에게 아무 메시지나 보낸 뒤 다시 누르세요.' });
  }
  if (tg === 'test') return J({ ok: await telegram('🔔 GK 공시레이더 테스트 알림입니다. 이 메시지가 보이면 고장 알림이 정상적으로 연결된 것입니다.').catch(() => false) });
  // 텔레그램 채널 자동 게시: &ch=test | on | off | set&minImp=4&perHour=12&kr=1&us=1
  const ch = u.searchParams.get('ch');
  if (ch) {
    const { tgSend, DEFAULT_CFG } = await import('../lib/tgchannel.mjs');
    const cfg = { ...DEFAULT_CFG, ...((await getJSON('tgch/cfg')) || {}) };
    if (ch === 'test') {
      try { await tgSend(process.env.TELEGRAM_CHANNEL_ID, '📡 <b>GK의 공시레이더</b> 채널 연결 테스트입니다.\n중요 공시가 나오면 AI 요약과 함께 이곳에 자동으로 올라와요.\n<a href="https://gk-stock.com">gk-stock.com</a>'); return J({ ok: true }); }
      catch (e) { return J({ ok: false, error: e.message }); }
    }
    if (ch === 'on' || ch === 'off') cfg.on = ch === 'on';
    if (ch === 'set') {
      const n = (k, lo, hi) => { const v = Number(u.searchParams.get(k)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined; };
      const mi = n('minImp', 3, 5), ph = n('perHour', 1, 180);
      if (mi !== undefined) cfg.minImp = mi;
      if (ph !== undefined) cfg.perHour = ph;
      for (const k of ['kr', 'us', 'issues', 'digest']) if (u.searchParams.has(k)) cfg[k] = u.searchParams.get(k) === '1';
    }
    await setJSON('tgch/cfg', cfg);
    return J({ ok: true, cfg });
  }
  if (u.searchParams.get('monitor') === 'run') await runMonitor();

  const [rep, mon, sec, dart, news] = await Promise.all([report(), getJSON('monitor/state'), getJSON('sec/feed'), getJSON('dart/feed'), getJSON('news/feed')]);
  // 인기 게시물 제목 붙이기
  const all = new Map([...(sec?.items || []), ...(dart?.items || []), ...(news?.items || [])].map((x) => [x.id, x]));
  const titleOf = async (id) => {
    const x = all.get(id) || (await getJSON(`pg/${id}`))?.item;
    if (!x) return { title: id };
    return { title: x.ko?.title || x.summary?.title || x.titleKo || x.pr?.headline || x.title || x.titleClean || x.formKo || id, name: x.name || x.company || '', ticker: x.ticker || '', market: x.market || (x.src === 'DART' ? 'KR' : 'US') };
  };
  rep.topItems = await Promise.all(rep.topItems.map(async (x) => ({ ...x, ...(await titleOf(x.id)) })));
  const [arch, bf] = await Promise.all([archiveStats().catch((e) => ({ error: e.message })), getJSON('backfill/state')]);
  const usage = await aiUsage(7).catch(() => []);
  return J({ ok: true, ...rep, usage, archive: arch, backfill: bf, monitor: mon, telegram: { token: !!process.env.TELEGRAM_BOT_TOKEN, chat: !!process.env.TELEGRAM_CHAT_ID }, channel: await (async () => { const { DEFAULT_CFG } = await import('../lib/tgchannel.mjs'); const st = (await getJSON('tgch/state')) || {}; return { id: process.env.TELEGRAM_CHANNEL_ID || null, cfg: { ...DEFAULT_CFG, ...((await getJSON('tgch/cfg')) || {}) }, today: st.day === new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) ? st.dayN || 0 : 0, last: st.last || null, err: st.err || null, lastErr: st.lastErr || null }; })() });
};

export const config = { path: '/api/admin' };
