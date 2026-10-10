// 바깥 감시 (Vercel 크론, 10분마다): 공시레이더(Cloudflare) 자체가 멈추면 텔레그램으로 알림
//  Cloudflare 안의 고장 감시는 Cloudflare가 멈추면 같이 멈추므로, 다른 곳(Vercel)에서 한 번 더 확인
//  설정: Vercel → 프로젝트 → Settings → Environment Variables 에 TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (Cloudflare와 같은 값)
//  같은 문제는 1시간에 한 번만 알림 (매시 0~9분 회차에서만 보냄) · 복구 알림은 하지 않음 (Cloudflare 쪽이 보냄)
const SITE = 'https://gk-stock.com';

async function tg(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }) });
  return r.ok;
}

export async function GET() {
  const problems = [];
  let beat = null;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(`${SITE}/api/health?beat=1&t=${Date.now()}`, { signal: ctrl.signal, headers: { 'cache-control': 'no-cache' } });
    clearTimeout(t);
    if (!r.ok) problems.push(`사이트 응답 오류 HTTP ${r.status}`);
    else beat = await r.json();
  } catch (e) { problems.push(`사이트에 접속할 수 없음 (${String(e.message || e).slice(0, 80)})`); }
  if (beat) {
    if (beat.monAge == null || beat.monAge > 30 * 60) problems.push(`자동 점검이 ${beat.monAge == null ? '기록 없음' : Math.round(beat.monAge / 60) + '분째 멈춤'} — Cloudflare 크론(자동 수집)이 멈췄을 수 있음`);
  }
  const min = new Date().getUTCMinutes();
  let sent = false;
  if (problems.length && min < 10) sent = await tg(`🚨 GK 공시레이더 바깥 감시\n\n${problems.map((p) => '• ' + p).join('\n')}\n\nCloudflare 대시보드 → Workers → gkstock → Logs 확인\n${SITE}/#admin`).catch(() => false);
  return new Response(JSON.stringify({ ok: !problems.length, problems, beat, sent }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
