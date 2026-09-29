// /api/halts?mk=KR|US — VI·서킷: 지금 걸려 있는 종목 + 오늘(최근 거래일) 발동·해제 내역
import { json } from '../lib/util.mjs';
import { getJSON } from '../lib/store.mjs';
import { getQuotes } from './quote.mjs';

function zoned(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hms: `${String(p.hour).padStart(2, '0')}:${p.minute}:${p.second}` };
}

export default async (req, ctx) => {
  const u = new URL(req.url);
  const mk = u.searchParams.get('mk') === 'US' ? 'US' : 'KR';
  const tz = mk === 'KR' ? 'Asia/Seoul' : 'America/New_York';
  const z = zoned(new Date(), tz);
  const pre = `halts/${mk.toLowerCase()}/`;
  let doc = await getJSON(pre + z.date);
  if (!doc?.items?.length) { const last = await getJSON(pre + 'last'); if (last?.date && last.date !== z.date) { const d2 = await getJSON(pre + last.date); if (d2?.items?.length) doc = d2; } }
  doc = doc || { date: z.date, items: [] };
  const today = doc.date === z.date;
  const isActive = (x) => {
    if (mk === 'KR') return today && !x.off;
    if (!x.off) return true;
    const rd = x.rdate || x.date;
    return today && (rd > z.date || (rd === z.date && x.off > z.hms)); // 재개 예정 시각 전
  };
  // (예전 기록 보정) 발동가·기준가로 괴리율·방향 다시 계산
  for (const x of doc.items) if (mk === 'KR' && x.price && x.base) { x.gap = Math.round(((x.price - x.base) / x.base) * 10000) / 100; x.dir = x.gap >= 0 ? 'up' : 'down'; }
  const items = doc.items.map((x) => ({ ...x, active: isActive(x) })).sort((a, b) => ((b.date || '') + b.on < (a.date || '') + a.on ? -1 : 1)); // 최근 발동 순
  // 지금 가격 (최대 40종목)
  const keys = [...new Set(items.slice(0, 60).map((x) => `${mk}:${mk === 'KR' ? x.code : x.sym}`))].slice(0, 40);
  let q = {};
  try { q = await getQuotes(keys, { ctx }); } catch {}
  for (const x of items) { const v = q[`${mk}:${mk === 'KR' ? x.code : x.sym}`]; if (v?.price != null) { x.now = v.live ?? v.price; x.nowPct = v.livePct ?? v.pct; if (mk === 'KR' && v.nameKo) x.name = x.name || v.nameKo; if (mk === 'US' && v.nameKo && v.nameKo !== x.sym) x.ko = v.nameKo; } }
  // 종목별 횟수
  const cnt = {};
  for (const x of items) { const k = mk === 'KR' ? x.code : x.sym; cnt[k] = (cnt[k] || 0) + 1; }
  for (const x of items) x.times = cnt[mk === 'KR' ? x.code : x.sym];
  const out = {
    ok: true, mk, date: doc.date, today, at: doc.at || null, err: doc.err || null,
    active: items.filter((x) => x.active), history: items,
    stats: { total: items.length, stocks: Object.keys(cnt).length, mwc: mk === 'US' ? items.filter((x) => x.mwc) : [] },
  };
  if (u.searchParams.get('debug') === '1') out.keys = doc.keys || null;
  return json(out, { cdnSeconds: 20, swr: 40 });
};

export const config = { path: '/api/halts' };
