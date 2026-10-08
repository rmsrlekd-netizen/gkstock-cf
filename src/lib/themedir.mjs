// 테마·섹터 전체 목록 (당일 등락과 상관없이 늘 보는 '관련주 사전')
//  한국: 네이버 증권 테마(약 260개)·업종(약 80개) 전체 + 소속 종목 (하루 한 번, 크론에서 조금씩 채움)
//  미국: 사이트에 정리된 테마 30개 + S&P 500·나스닥100 섹터 11개 (고정 목록)
import { fetchWithTimeout } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';
import { US_GROUPS, US_SECTORS, US_SECTOR_MEMBERS, NDX_BY_SECTOR } from './themes.mjs';

const NH = { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' };
async function nget(url, ms = 9000) {
  const r = await fetchWithTimeout(url, { headers: NH }, ms);
  if (!r.ok) throw new Error('네이버 HTTP ' + r.status);
  return r.json();
}
const n0 = (s) => { const x = Number(String(s ?? '').replace(/[,%+\s]/g, '')); return Number.isFinite(x) ? x : null; };

async function groupList(kind) {
  const first = await nget(`https://m.stock.naver.com/api/stocks/${kind}?page=1&pageSize=100`);
  const pages = Math.min(5, Math.ceil((first.totalCount || 0) / 100));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => nget(`https://m.stock.naver.com/api/stocks/${kind}?page=${i + 2}&pageSize=100`).catch(() => ({ groups: [] }))));
  return [first, ...rest].flatMap((j) => j.groups || []).filter((g) => g.no && g.name).map((g) => ({ k: kind === 'industry' ? 'i' : 't', no: g.no, name: g.name, n: g.totalCount || 0 }));
}
async function members(k, no) {
  const base = `https://m.stock.naver.com/api/stocks/${k === 'i' ? 'industry' : 'theme'}/${Number(no)}?page=1&pageSize=`;
  let j = await nget(base + 100).catch(() => null);
  if (!j?.stocks?.length) j = await nget(base + 40); // 한 번에 많이 못 받는 경우 대비
  return (j.stocks || []).filter((x) => x.itemCode).map((x) => ({ t: x.itemCode, name: x.stockName, cap: n0(x.marketValue) || 0 }))
    .sort((a, b) => b.cap - a.cap).map(({ t, name }) => [t, name]); // 시가총액 큰 순 (대표 종목이 앞에)
}

/** 크론(3분마다): 목록은 하루 한 번, 종목은 한 번에 20개 그룹씩 (24시간 지난 것부터) */
export async function themeDirWatch({ per = 20 } = {}) {
  const d = (await getJSON('tdir/kr')) || { at: 0, groups: [], mem: {} };
  let listChanged = false;
  if (!d.groups.length || Date.now() - d.at > 24 * 3600e3) {
    const [t, i] = await Promise.all([groupList('theme'), groupList('industry').catch(() => [])]);
    if (t.length > 50) { d.groups = [...t, ...i]; d.at = Date.now(); listChanged = true; }
  }
  const key = (g) => `${g.k}${g.no}`;
  const todo = d.groups.filter((g) => !d.mem[key(g)] || Date.now() - (d.mem[key(g)].at || 0) > 24 * 3600e3)
    .sort((a, b) => (d.mem[key(a)]?.at || 0) - (d.mem[key(b)]?.at || 0)).slice(0, per);
  let done = 0;
  for (let i = 0; i < todo.length; i += 5) {
    await Promise.all(todo.slice(i, i + 5).map(async (g) => { try { d.mem[key(g)] = { at: Date.now(), s: await members(g.k, g.no) }; done++; } catch {} }));
  }
  const live = new Set(d.groups.map(key));
  for (const k of Object.keys(d.mem)) if (!live.has(k)) delete d.mem[k];
  if (done || listChanged || todo.length === 0) await setJSON('tdir/kr', d); // 종목을 못 받아도 테마 목록은 먼저 저장
  d.lastErr = null;
  return { groups: d.groups.length, filled: Object.keys(d.mem).length, done };
}

/** 화면용 목록 */
export async function themeDir(mk) {
  if (mk === 'US') {
    const secName = Object.fromEntries(US_SECTORS.map(([t, name]) => [t, name]));
    return {
      mk: 'US',
      groups: [
        ...US_GROUPS.map(([name, etf, list]) => ({ k: 't', name, etf, s: list.map((t) => [t, t]) })),
        ...Object.keys(US_SECTOR_MEMBERS).map((etf) => ({ k: 'i', name: secName[etf] || etf, etf, s: [...new Set([...(US_SECTOR_MEMBERS[etf] || []), ...(NDX_BY_SECTOR[etf] || [])])].map((t) => [t, t]) })),
      ],
    };
  }
  let d = (await getJSON('tdir/kr')) || { groups: [], mem: {} };
  if (!d.groups.length) { // 아직 한 번도 안 만들어졌으면 지금 바로 (목록 + 일부 종목)
    try { await themeDirWatch({ per: 10 }); d = (await getJSON('tdir/kr')) || d; } catch {}
  }
  return {
    mk: 'KR', at: d.at,
    groups: d.groups.map((g) => ({ k: g.k, no: g.no, name: g.name, n: g.n, s: d.mem[`${g.k}${g.no}`]?.s || null })),
  };
}
