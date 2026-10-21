// v269 ☠ 상장폐지 목록 (GK: "상폐 위험은 필수 — 과거 상폐 종목의 상폐 전 패턴") — 1단계: KIND 상장폐지 현황을 실제로 받을 수 있는지 시험 (저장 안 함)
import { fetchWithTimeout, BROWSER_UA, decodeText, decodeEntities } from './util.mjs';

const URL0 = 'https://kind.krx.co.kr/investwarn/delcompany.do';
function parse(html) {
  const out = [];
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map((c) => decodeEntities(c.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
    if (cells.length < 4) continue;
    const code = (tr.match(/\b(\d{6})\b/) || [])[1] || null;
    const date = (cells.join(' ').match(/20\d\d-\d\d-\d\d/) || [])[0] || null;
    out.push({ cells: cells.slice(0, 6), code, date });
  }
  return out;
}
export async function delistProbe({ from = '2022-01-01', to = null } = {}) {
  const end = to || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const tries = [];
  for (const method of ['searchDelCompanySub', 'searchDelCompanyList']) {
    const body = new URLSearchParams({ method, currentPageSize: '100', pageIndex: '1', orderMode: '1', orderStat: 'D', marketType: '', searchCorpName: '', fromDate: from, toDate: end, forward: 'delcompany_sub' });
    const t0 = Date.now();
    try {
      const r = await fetchWithTimeout(URL0, { method: 'POST', headers: { 'User-Agent': BROWSER_UA, Referer: URL0 + '?method=searchDelCompanyMain', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body: body.toString() }, 12000);
      const html = decodeText(await r.arrayBuffer(), /utf-?8/i.test(r.headers.get('content-type') || '') ? 'utf-8' : 'euc-kr');
      const rows = r.ok ? parse(html) : [];
      tries.push({ method, status: r.status, ms: Date.now() - t0, n: rows.length, total: (html.match(/전체\s*([\d,]+)\s*건/) || [])[1] || null, sample: rows.slice(0, 8), head: rows.length ? '' : html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300) });
      if (rows.length) break;
    } catch (e) { tries.push({ method, err: String(e.message).slice(0, 80) }); }
  }
  const ok = tries.find((t) => t.n > 0);
  return { ok: !!ok, from, to: end, tries };
}
