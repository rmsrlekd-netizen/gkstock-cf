// /api/why?mk=KR|US&t=종목코드&name=이름 — 오늘 주가 움직임 이유 (뉴스 제목 + AI 한 줄 추정)
import { json } from '../lib/util.mjs';
import { getJSON } from '../lib/store.mjs';
import { whyFor, peersIn } from '../lib/why.mjs';
import { getQuotes } from './quote.mjs';

export default async (req) => {
  const u = new URL(req.url);
  const mk = u.searchParams.get('mk') === 'US' ? 'US' : 'KR';
  const t = String(u.searchParams.get('t') || '').toUpperCase().trim();
  if (!/^[0-9A-Z.\-]{1,12}$/.test(t)) return json({ ok: false, error: '종목 코드가 올바르지 않습니다' }, { status: 400, cdnSeconds: 60 });
  const name = (u.searchParams.get('name') || '').slice(0, 60) || null;
  try {
    // 오늘 등락률 + (상승·하락 상위에 있으면) 같이 움직인 종목
    let pct = null, reuters = null, peers = null;
    const pop = await getJSON('popular/v2');
    for (const k of mk === 'KR' ? ['krUp', 'krDown', 'kr'] : ['usUp', 'usDown', 'us']) {
      const list = pop?.[k] || [];
      const x = list.find((y) => String(y.ticker).toUpperCase() === t);
      if (x) { pct = x.pct; reuters = x.reuters || null; if (/Up|Down/.test(k)) peers = peersIn(list, x, null); break; }
    }
    if (pct == null) { const q = await getQuotes([`${mk}:${t}`]).catch(() => ({})); pct = q[`${mk}:${t}`]?.pct ?? null; }
    const r = await whyFor({ mk, t, name, pct, reuters, peers, minMove: 1, translate: true }); // 직접 열어본 종목은 1% 이상 움직여도 AI 추정
    return json({ ok: true, ...r }, { cdnSeconds: 120, swr: 300 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 20 });
  }
};

export const config = { path: '/api/why' };
