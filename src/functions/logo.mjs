// /api/logo?m=US&t=AAPL  |  /api/logo?m=KR&t=005930
// 여러 로고 출처를 서버에서 차례로 확인해, 실제로 열리는 이미지 주소로 보내준다(302).
// 확인 결과는 D1 저장소에 저장해 두고 Cloudflare 캐시에도 오래 캐시되므로, 같은 종목은 한 번만 확인한다.
import { fetchWithTimeout, BROWSER_UA } from '../lib/util.mjs';
import { getJSON, setJSON } from '../lib/store.mjs';

export function logoCandidates(m, t) {
  if (m === 'KR') {
    return [
      `https://static.toss.im/png-icons/securities/icn-sec-fill-${t}.png`,
      `https://file.alphasquare.co.kr/media/images/stock_logo/kr/${t}.png`,
      `https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${t}.svg`,
    ];
  }
  const dash = t.replace(/[./]/g, '-');
  return [
    `https://images.financialmodelingprep.com/symbol/${dash}.png`,
    `https://assets.parqet.com/logos/symbol/${encodeURIComponent(t)}?format=png`,
    `https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/${dash}.png`,
    `https://financialmodelingprep.com/image-stock/${dash}.png`,
  ];
}

async function works(url) {
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'image/*' } }, 3500);
    if (!r.ok) return false;
    const ct = r.headers.get('content-type') || '';
    if (!/image\//i.test(ct)) return false;
    const buf = await r.arrayBuffer();
    return buf.byteLength > 150;
  } catch {
    return false;
  }
}

const redirect = (url) => new Response(null, {
  status: 302,
  headers: {
    location: url,
    'cache-control': 'public, max-age=86400',
    'x-gk-edge-ttl': '1209600',
  },
});
const miss = () => new Response('no logo', {
  status: 404,
  headers: { 'cache-control': 'public, max-age=21600', 'x-gk-edge-ttl': '172800' },
});

export default async (req) => {
  const u = new URL(req.url);
  const m = u.searchParams.get('m') === 'KR' ? 'KR' : 'US';
  const t = String(u.searchParams.get('t') || '').trim().toUpperCase();
  if (m === 'KR' ? !/^[0-9A-Z]{6}$/.test(t) : !/^[A-Z0-9.\-/]{1,10}$/.test(t)) return miss();
  const key = `logo/${m}/${t.replace(/[^A-Z0-9]/g, '_')}`;
  const cached = await getJSON(key);
  if (cached) {
    const age = Date.now() - (cached.at || 0);
    if (cached.url && age < 30 * 86400e3) return redirect(cached.url);
    if (cached.miss && age < 3 * 86400e3) return miss();
  }
  // 후보를 동시에 확인하고, 우선순위가 가장 높은 성공 주소를 사용
  const cands = logoCandidates(m, t);
  const ok = await Promise.all(cands.map(works));
  const url = cands.find((_, i) => ok[i]);
  await setJSON(key, url ? { url, at: Date.now() } : { miss: true, at: Date.now() }).catch(() => {});
  return url ? redirect(url) : miss();
};

export const config = { path: '/api/logo' };
