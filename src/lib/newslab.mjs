// v253 🔊 뉴스 신호 (GK: '세력주는 주가를 띄울 때 뉴스·보도자료를 이용한다')
//  · 네이버 종목 뉴스 목록에서 **제목·날짜·언론사만** 모음 (기사 본문은 저장하지 않음 — 저작권)
//  · 꼬리표: 뉴스 몰림(평소 대비) · 근거 없는 호재 단어(공시로 확인 안 되는 MOU·추진·기대…) · 본업과 먼 테마 단어 · 같은 제목 여러 매체(보도자료 뿌리기)
//  · 4년치 검증: 📜 공시 확률 판정 날에 뉴스 꼬리표를 붙여 '+30% 먼저 / −15% 먼저' 비율 · 대세상승의 뉴스 최고조가 고점 앞인지 뒤인지
//  · NEWS_ON=false 동안은 크론이 아무것도 안 함 (GK가 '시작' 할 때 true로)
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout, BROWSER_UA, decodeText } from './util.mjs';

export const NEWS_ON = false;
const DAY = 864e5;
const NH = { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/' };
const strip = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** 네이버 종목 뉴스 목록 한 쪽(HTML) → [[YYYY-MM-DD, 제목, 언론사]] */
export function parseNewsPage(h) {
  const out = [];
  for (const tr of String(h || '').split(/<tr[\s>]/i).slice(1)) {
    const t = tr.match(/class="tit"[^>]*>([\s\S]*?)<\/a>/i) || tr.match(/<td class="title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    const d = tr.match(/(20\d{2})\.(\d{2})\.(\d{2})\s+\d{2}:\d{2}/);
    if (!t || !d) continue;
    const o = tr.match(/<td class="info">([\s\S]*?)<\/td>/i);
    const title = strip(t[1]).slice(0, 120); if (!title) continue;
    out.push([`${d[1]}-${d[2]}-${d[3]}`, title, o ? strip(o[1]).slice(0, 20) : '']);
  }
  return out;
}
/** 네이버 모바일 증권 JSON → [[YYYY-MM-DD, 제목, 언론사]] (모양이 바뀌어도 title+날짜 있는 객체를 모두 찾음) */
export function parseNewsJSON(j) {
  const out = [], seen = new Set();
  const walk = (o, dep) => {
    if (!o || dep > 6) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, dep + 1); return; }
    if (typeof o !== 'object') return;
    const t = o.title || o.tit || o.articleTitle, dt = String(o.datetime || o.dateTime || o.date || o.publishedAt || o.regDate || '');
    const m = dt.match(/^(20\d{2})[.\-]?(\d{2})[.\-]?(\d{2})/);
    if (t && m) { const title = strip(t).slice(0, 120), k = (o.officeId || '') + (o.articleId || title); if (title && !seen.has(k)) { seen.add(k); out.push([`${m[1]}-${m[2]}-${m[3]}`, title, strip(o.officeName || o.office || o.press || '').slice(0, 20)]); } return; }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, dep + 1);
  };
  walk(j, 0);
  return out;
}
const SRC = {
  m: (c, p) => `https://m.stock.naver.com/api/news/stock/${c}?pageSize=20&page=${p}`,
  h: (c, p) => `https://finance.naver.com/item/news_news.naver?code=${c}&page=${p}&clusterId=`,
};
async function rawGet(url) {
  const isM = url.includes('m.stock');
  const r = await fetchWithTimeout(url, { headers: isM ? { 'User-Agent': BROWSER_UA, Accept: 'application/json', Referer: 'https://m.stock.naver.com/' } : NH }, 9000);
  const ct = r.headers.get('content-type') || '';
  const txt = decodeText(await r.arrayBuffer(), /utf-?8|json/i.test(ct) || isM ? 'utf-8' : 'euc-kr');
  let items = [];
  if (r.ok) { if (/json/i.test(ct) || /^\s*[[{]/.test(txt)) { try { items = parseNewsJSON(JSON.parse(txt)); } catch {} } else items = parseNewsPage(txt); }
  return { status: r.status, ct: ct.slice(0, 40), len: txt.length, txt, items };
}
/** 실제 네이버 시험 (저장 안 함) — 관리자 '네이버 1쪽 시험' 버튼. 주소 후보마다 1쪽 + 모바일은 깊은 쪽(얼마나 옛날까지 되는지) */
export async function newsProbe(code = '005930') {
  const out = [];
  const one = async (name, url) => { const t0 = Date.now(); try { const x = await rawGet(url); out.push({ name, status: x.status, ms: Date.now() - t0, ct: x.ct, len: x.len, n: x.items.length, first: x.items[0] || null, last: x.items.at(-1) || null, head: x.items.length ? '' : x.txt.replace(/\s+/g, ' ').slice(0, 300), items: name === 'm 1쪽' || (name === 'html 1쪽' && x.items.length) ? x.items.slice(0, 20) : undefined }); } catch (e) { out.push({ name, err: String(e.message).slice(0, 80) }); } };
  await one('m 1쪽', SRC.m(code, 1));
  for (const pg of [50, 150, 400]) await one(`m ${pg}쪽`, SRC.m(code, pg));
  const sm = '007110'; // 일신석재 — 작은 종목은 몇 년 전까지 나오는지
  for (const pg of [1, 20, 60]) await one(`일신석재 ${pg}쪽`, SRC.m(sm, pg));
  const best = out.find((x) => x.n >= 5);
  return { code, src: best?.name || null, n: best?.n || 0, items: best?.items || out.find((x) => x.items)?.items || [], tries: out };
}
async function newsPage(code, page) {
  let x = await rawGet(SRC.m(code, page));
  if (!x.items.length && page === 1) { const y = await rawGet(SRC.h(code, page)); if (y.items.length) x = y; }
  if (x.status >= 400 && !x.items.length) throw new Error('HTTP ' + x.status);
  return x.items;
}

// ── 꼬리표 ──
const HYPE = /MOU|업무\s*협약|협약|양해각서|추진|기대|검토|단독|주목|수혜|급등|강세|상한가|러브콜|독점|세계\s*최초|국내\s*최초|임박|가시화|본격화|잭팟/;
const THEME = /2차\s*전지|배터리|리튬|AI|인공지능|초전도|로봇|양자|원전|SMR|비만|우주|방산|가상\s*자산|비트코인|코인|메타버스|NFT|자율\s*주행|UAM|수소|탄소\s*중립|K-?방산|HBM|반도체\s*장비|희토류|바이오\s*시밀러|치매|항암|신약/;
const BASIS = ['contract', 'invest', 'mna', 'rights3', 'cb', 'paid', 'fund5', 'purpose', 'rename']; // 공시로 확인되는 '실제 일'
const norm = (s) => String(s).replace(/\[[^\]]*\]|\([^)]*\)|[^가-힣A-Za-z0-9]/g, '').slice(0, 22);
/** 그날(Tms)까지 뉴스(items)·공시(evs)로 꼬리표 */
export function newsFeats(items, Tms, evs = []) {
  const d = new Date(Tms + 9 * 3600e3).toISOString().slice(0, 10);
  const back = (n) => new Date(Tms + 9 * 3600e3 - n * DAY).toISOString().slice(0, 10);
  const L = (items || []).filter((x) => x[0] <= d);
  const n5 = L.filter((x) => x[0] > back(5)).length, n60 = L.filter((x) => x[0] > back(65) && x[0] <= back(5)).length;
  const F = [];
  const base = n60 / 60 * 5; // 평소 5일 기사 수
  if (n5 >= 5 && n5 >= Math.max(3, base * 3)) F.push('n:burst');
  const r10 = L.filter((x) => x[0] > back(10));
  const hype = r10.filter((x) => HYPE.test(x[1])).length;
  if (hype >= 3) F.push('n:hype');
  const hasBasis = (evs || []).some((e) => e.ms <= Tms && e.ms > Tms - 14 * DAY && BASIS.includes(e.kind));
  if (hype >= 3 && !hasBasis) F.push('n:nobasis');
  const th = r10.filter((x) => THEME.test(x[1])).length, thOld = L.filter((x) => x[0] > back(200) && x[0] <= back(30) && THEME.test(x[1])).length;
  if (th >= 2 && thOld === 0) F.push('n:theme'); // 예전엔 안 붙던 테마 단어가 최근 갑자기
  const by = new Map(); for (const x of r10) { const k = norm(x[1]); if (k.length < 8) continue; const s = by.get(k) || new Set(); s.add(x[2]); by.set(k, s); }
  if ([...by.values()].some((s) => s.size >= 3)) F.push('n:dup'); // 같은 제목이 3곳↑ 매체 = 보도자료
  if (!L.filter((x) => x[0] > back(60)).length) F.push('n:quiet'); // 60일 기사 0 (조용한 종목)
  return F;
}
export const NEWS_KO = { 'n:burst': '뉴스 몰림(평소 3배↑)', 'n:hype': '호재성 단어 기사 3건↑(10일)', 'n:nobasis': '공시 근거 없는 호재 기사', 'n:theme': '갑자기 붙은 테마 단어', 'n:dup': '같은 제목 3곳↑ 매체(보도자료)', 'n:quiet': '60일 동안 기사 없음' };

// ── 모으기: 3분 크론, 한 번 2종목·종목당 최대 8쪽(이어서), DB 핑 0.6초↑·정기 분석 중이면 쉼 ──
//  대상: 레이더 랭킹 + 과거 재현 대세상승 종목 + 적발 사례 (최대 500) · 종목당 4년 전까지 또는 최대 150쪽
const MAX_PAGES = 150, PER_RUN_PAGES = 8; // v255: 큰 종목은 하루 수십 건이라 150쪽(3천 건)에서 끊음 — 세력주 같은 작은 종목은 보통 4년 안에 끝남
export async function newsStep({ codes = 2 } = {}) {
  if (!NEWS_ON) return null;
  const t0 = Date.now(); await getJSON('health/ping').catch(() => null); if (Date.now() - t0 > 600) return { skip: 'db slow' };
  const ms = await getJSON('mp/state').catch(() => null); if ((ms?.busyUntil || 0) > Date.now()) return { skip: 'radar busy' };
  let st = await getJSON('mp/newsq').catch(() => null);
  if (!st) {
    const rank = (await getJSON('mp/rank').catch(() => null)) || {};
    let big = []; try { const { partsLoad } = await import('./btstore.mjs'); big = ((await partsLoad('mp/bt/big'))?.list || []).map((r) => r.c); } catch {}
    let cases = []; try { cases = (await import('./caselab.mjs')).CASE_CODES; } catch {}
    const q = [...new Set([...cases, ...Object.keys(rank), ...big])].filter((c) => /^\d{6}$/.test(c)).slice(0, 500);
    st = { v: 1, queue: q, pos: 0, page: 1, done: false, started: Date.now(), n: 0 };
    await setJSON('mp/newsq', st); return { started: q.length };
  }
  if (st.done) return null;
  const stop = new Date(Date.now() - 1460 * DAY).toISOString().slice(0, 10);
  let pages = 0;
  for (let k = 0; k < codes && st.pos < st.queue.length; k++) {
    const code = st.queue[st.pos], key = `mp/news/${code}`;
    const cur = (await getJSON(key).catch(() => null)) || { items: [] };
    const seen = new Set(cur.items.map((x) => x[0] + '|' + x[1]));
    let end = false;
    for (let p = 0; p < PER_RUN_PAGES; p++) {
      let L; try { L = await newsPage(code, st.page); } catch (e) { cur.err = String(e.message).slice(0, 60); end = true; break; }
      pages++;
      if (!L.length) { end = true; break; }
      for (const x of L) { const id = x[0] + '|' + x[1]; if (!seen.has(id)) { seen.add(id); cur.items.push(x); st.n++; } }
      if (L[L.length - 1][0] < stop || st.page >= MAX_PAGES) { end = true; break; }
      st.page++;
    }
    cur.items.sort((a, b) => (a[0] < b[0] ? 1 : -1)); cur.at = Date.now(); if (cur.items.length > 4000) cur.items.length = 4000;
    await setJSON(key, cur).catch(() => {});
    if (end) { st.pos++; st.page = 1; } else break; // 한 종목을 다 못 받았으면 다음 차례에 이어서
  }
  if (st.pos >= st.queue.length) { st.done = true; st.doneAt = Date.now(); }
  st.at = Date.now(); await setJSON('mp/newsq', st);
  return { pos: st.pos, of: st.queue.length, pages, n: st.n };
}

/** 4년치 검증: ① 📜 공시 확률 판정 날(mp/bt/disc)에 뉴스 꼬리표를 붙여 discStudy로 '+30% 먼저/−15% 먼저' ② 대세상승(mp/bt/big)의 뉴스 최고조 시점 */
export async function newsReport() {
  const { partsLoad } = await import('./btstore.mjs');
  const st = await getJSON('mp/newsq').catch(() => null);
  const [D, Bg] = await Promise.all([partsLoad('mp/bt/disc').catch(() => null), partsLoad('mp/bt/big').catch(() => null)]);
  const cache = new Map(); const itemsOf = async (c) => { if (!cache.has(c)) cache.set(c, (await getJSON(`mp/news/${c}`).catch(() => null))?.items || null); return cache.get(c); };
  const rows = [];
  for (const r of D?.list || []) { const it = await itemsOf(r[0]); if (!it) continue; const Tms = Date.parse(r[1] + 'T15:40:00+09:00'); const F = newsFeats(it, Tms); rows.push([r[0], r[1], F, ...r.slice(3)]); }
  const { discStudy } = await import('./disclab.mjs');
  const disc = rows.length ? discStudy(rows) : { n: 0, need: 300 };
  // 대세상승: 고점 앞뒤 60일 중 기사 가장 많은 5일 구간이 고점보다 며칠 앞/뒤인가 · 오르기 전 30일 뉴스 몰림 비율
  const runs = []; for (const b of Bg?.list || []) { const it = await itemsOf(b.c); if (!it) continue; const P = Date.parse(b.dP), S = Date.parse(b.d0); let best = null; for (let k = -60; k <= 60; k += 1) { const t = P + k * DAY, a = new Date(t - 5 * DAY + 9 * 3600e3).toISOString().slice(0, 10), z = new Date(t + 9 * 3600e3).toISOString().slice(0, 10); const n = it.filter((x) => x[0] > a && x[0] <= z).length; if (!best || n > best.n) best = { k, n }; } const pre = newsFeats(it, S); runs.push({ k: best?.n ? best.k : null, pre }); }
  const ks = runs.map((r) => r.k).filter((v) => v != null).sort((a, b) => a - b);
  const timing = ks.length >= 10 ? { n: ks.length, med: ks[Math.floor(ks.length / 2)], before: Math.round((ks.filter((v) => v < -5).length / ks.length) * 100), near: Math.round((ks.filter((v) => Math.abs(v) <= 5).length / ks.length) * 100), after: Math.round((ks.filter((v) => v > 5).length / ks.length) * 100) } : null;
  const preCnt = {}; for (const r of runs) for (const f of r.pre) preCnt[f] = (preCnt[f] || 0) + 1;
  return { progress: st ? { pos: st.pos, of: st.queue?.length || 0, n: st.n, done: !!st.done } : null, disc, timing, pre: runs.length ? Object.entries(preCnt).map(([k, c]) => [k, NEWS_KO[k] || k, Math.round((c / runs.length) * 100)]) : [], runs: runs.length, ko: NEWS_KO };
}
