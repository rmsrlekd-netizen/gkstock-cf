// /api/company?src=KR&t=005930&corp=00126380&ex=KOSPI | /api/company?src=US&t=AAPL
import { json } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';
import { krCompany, usCompany } from '../lib/company.mjs';
import { getSectors } from '../lib/sectors.mjs';

export default async (req) => {
  const u = new URL(req.url);
  const src = u.searchParams.get('src') === 'KR' ? 'KR' : 'US';
  const t = (u.searchParams.get('t') || '').trim().toUpperCase();
  const corp = u.searchParams.get('corp') || '';
  const ex = u.searchParams.get('ex') || '';
  if (src === 'US' ? !/^[A-Z0-9.\-]{1,10}$/.test(t) : !/^\d{8}$/.test(corp)) return json({ ok: false, error: '종목 정보가 부족합니다' }, { status: 400, cdnSeconds: 60 });
  const key = `company2/${src}/${src === 'KR' ? corp : t}`;
  try {
    let d = await getJSON(key);
    if (!d || Date.now() - (d.at || 0) > 12 * 3600e3) {
      try {
        const fresh = src === 'KR' ? await krCompany(t, corp, ex) : await usCompany(t);
        fresh.at = Date.now();
        d = fresh;
        await setJSON(key, d).catch(() => {});
      } catch (e) {
        if (!d) throw e; // 새로 못 가져오면 예전 값이라도 보여줌
      }
    }
    const sm = await getSectors({ allowFetch: false }).catch(() => null);
    const sraw = sm ? (src === 'KR' ? sm.kr?.[t] : sm.us?.[t]) : null;
    if (sraw) { const [ind, prod] = sraw.split('|'); d = { ...d, sectorKo: ind, products: prod || d.products || null }; }
    const ov = await getJSON(`aiov/${src}/${src === 'KR' ? corp : t}`);
    return json({ ok: true, ...d, overviewKo: ov?.text || null }, { cdnSeconds: 1800, swr: 3600 });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, { status: 502, cdnSeconds: 60 });
  }
};

export const config = { path: '/api/company' };
