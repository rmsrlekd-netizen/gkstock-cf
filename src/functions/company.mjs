// /api/company?src=KR&t=005930&corp=00126380&ex=KOSPI | /api/company?src=US&t=AAPL
import { json, refreshInBackground } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { krCompany, usCompany } from '../lib/company.mjs';
import { getSectors } from '../lib/sectors.mjs';
import { hasAI, overviewKo } from '../lib/ai.mjs';

export default async (req, ctx) => {
  const u = new URL(req.url);
  const src = u.searchParams.get('src') === 'KR' ? 'KR' : 'US';
  const t = (u.searchParams.get('t') || '').trim().toUpperCase();
  const corp = u.searchParams.get('corp') || '';
  const ex = u.searchParams.get('ex') || '';
  if (src === 'US' ? !/^[A-Z0-9.\-]{1,10}$/.test(t) : !/^\d{8}$/.test(corp)) return json({ ok: false, error: '종목 정보가 부족합니다' }, { status: 400, cdnSeconds: 60 });
  const key = `company2/${src}/${src === 'KR' ? corp : t}`;
  try {
    let d = await getJSON(key);
    const fetchFresh = async () => {
      const fresh = src === 'KR' ? await krCompany(t, corp, ex) : await usCompany(t);
      fresh.at = Date.now();
      await setJSON(key, fresh).catch(() => {});
      return fresh;
    };
    if (!d) d = await fetchFresh();
    else if (Date.now() - (d.at || 0) > 12 * 3600e3 || (src === 'US' && d.wall === undefined && process.env.FINNHUB_API_KEY)) refreshInBackground(ctx, key, fetchFresh); // (월가 정보가 없던 예전 저장분도 새로) // 오래된 값은 먼저 보여주고 뒤에서 갱신
    const sm = await getSectors({ allowFetch: false }).catch(() => null);
    const sraw = sm ? (src === 'KR' ? sm.kr?.[t] : sm.us?.[t]) : null;
    if (sraw) { const [ind, prod] = sraw.split('|'); d = { ...d, sectorKo: ind, products: prod || d.products || null }; }
    const ovKey = `aiov/${src}/${src === 'KR' ? corp : t}`;
    let ov = await getJSON(ovKey);
    // 영문 기업 소개 → 한국어 (한 번 번역하면 저장해 재사용)
    // (번역을 기다리지 않고 영문으로 먼저 응답 → 번역은 뒤에서 진행, 다음부터 한국어)
    if (!ov && src === 'US' && d.overviewRaw && hasAI()) {
      const name = d.name || t, raw = d.overviewRaw;
      refreshInBackground(ctx, ovKey, async () => { const text = await overviewKo(name, raw); if (text) await setJSON(ovKey, { text, at: Date.now() }); });
    }
    return json({ ok: true, ...d, overviewKo: ov?.text || null }, { cdnSeconds: ov ? 1800 : 60, swr: 3600 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 60 });
  }
};

export const config = { path: '/api/company' };
