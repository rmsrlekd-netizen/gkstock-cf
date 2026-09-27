// /api/admin?key=관리자키 — 방문자 통계·게시물 조회수·고장 감시 현황 (관리자 전용)
//  &item=ID1,ID2 → 해당 게시물 조회수만
//  &tg=find → 텔레그램 봇에 메시지를 보낸 채팅 ID 찾기, &tg=test → 테스트 알림
//  &monitor=run → 지금 바로 점검
import { getJSON } from '../lib/store.mjs';
import { report, itemViews } from '../lib/stats.mjs';
import { runMonitor, telegram } from '../lib/monitor.mjs';
import { fetchWithTimeout } from '../lib/util.mjs';

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
  return J({ ok: true, ...rep, monitor: mon, telegram: { token: !!process.env.TELEGRAM_BOT_TOKEN, chat: !!process.env.TELEGRAM_CHAT_ID } });
};

export const config = { path: '/api/admin' };
