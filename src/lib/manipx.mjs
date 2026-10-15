// 작전 레이더 보강 기능
//  ① 성적표: 레이더가 판정한 뒤 실제 5·20·60거래일 수익률 (단계·상승/하락 분류별 평균·적중률)
//  ② 같은 세력 추적: 같은 투자조합·인물(공시 제출인·인수자)이 여러 종목에 나오는지
//  ③ 거래소 시장경보: 투자주의·경고·위험 지정 (KIND)
//  ④ 관리자 텔레그램 알림: 단계 변화·상승/하락 분류 변화·전환청구 공시
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout, BROWSER_UA, decodeText, decodeEntities } from './util.mjs';

const DAY = 86400e3;
const kstDate = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

// ───── ① 성적표 ─────
async function bars(code) {
  const r = await fetchWithTimeout(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=170&requestType=0`, { headers: { 'User-Agent': BROWSER_UA, Referer: 'https://finance.naver.com/' } }, 9000);
  if (!r.ok) throw new Error('일봉 HTTP ' + r.status);
  const xml = await r.text();
  return [...xml.matchAll(/data="(\d{8})\|[^|]*\|[^|]*\|[^|]*\|([\d.]+)\|/g)].map((m) => ({ d: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`, c: +m[2] })).filter((x) => x.c > 0);
}
const H = [5, 20, 60];
/** 크론: 판정한 날 이후 5·20·60거래일이 지난 종목의 실제 수익률을 채움 (한 번에 최대 20종목) */
export async function perfWatch(max = 20) {
  const idx = ((await getJSON('mp/idx')) || []).slice().sort(); // 오래된 날부터
  const today = kstDate();
  const cache = new Map();
  let fetched = 0, filled = 0;
  for (const date of idx) {
    if (date >= today) continue;
    const age = (Date.parse(today) - Date.parse(date)) / DAY;
    if (age < 7) continue; // 5거래일도 안 지났으면 아직
    const pk = `mp/perf/${date}`;
    const perf = (await getJSON(pk)) || { rows: {} };
    if (perf.done) continue;
    const doc = await getJSON(`mp/day/${date}`);
    if (!doc?.list?.length) { perf.done = true; await setJSON(pk, perf); continue; }
    let pending = 0;
    const tdays = Math.floor(age * 5 / 7) - 1; // 지난 거래일 수(대략, 휴일 무시 → 조금 적게 잡음)
    for (const x of doc.list.slice(0, 80)) {
      const row = perf.rows[x.code] || { st: x.stage, dir: x.dir?.dir || null, lv: x.ai?.level || null, s: x.score, ck: x.cl?.grade || null, rr: x.dir?.rr?.v ?? null };
      if (H.every((h) => row['r' + h] !== undefined)) { perf.rows[x.code] = row; continue; }
      // 아직 다음 기간(5·20·60거래일)이 안 지났으면 받지 않음 (같은 종목만 계속 받느라 다른 종목·날짜가 밀리던 문제)
      const due = H.some((h) => row['r' + h] === undefined && tdays >= h);
      if (!due && age <= 120) { pending++; perf.rows[x.code] = row; continue; }
      if (fetched >= max && !cache.has(x.code)) { pending++; continue; }
      let B = cache.get(x.code);
      if (!B) { try { B = await bars(x.code); } catch { B = null; } cache.set(x.code, B); fetched++; }
      if (!B || !B.length) { pending++; perf.rows[x.code] = row; continue; } // 일봉을 못 받았으면 다음에 다시 (빈 값으로 영구 저장하지 않음)
      let i = -1; for (let k = 0; k < B.length; k++) if (B[k].d <= date) i = k;
      if (i < 0) { for (const h of H) row['r' + h] = null; perf.rows[x.code] = row; continue; } // 일봉 범위 밖
      row.c0 = B[i].c;
      for (const h of H) if (row['r' + h] === undefined && B[i + h]) { row['r' + h] = Math.round((B[i + h].c / B[i].c - 1) * 1000) / 10; filled++; }
      if (age > 120) for (const h of H) if (row['r' + h] === undefined) row['r' + h] = null; // 너무 오래돼 일봉에 없음
      if (H.some((h) => row['r' + h] === undefined)) pending++;
      perf.rows[x.code] = row;
    }
    if (!pending) perf.done = true;
    perf.at = Date.now();
    await setJSON(pk, perf);
    if (fetched >= max) break;
  }
  return fetched || filled ? { fetched, filled } : null;
}
/** 단계별·분류별 평균 수익률·상승 비율 */
export async function perfSummary() {
  const idx = (await getJSON('mp/idx')) || [];
  const groups = {};
  const add = (g, row) => {
    const o = (groups[g] ||= { n: 0 });
    o.n++;
    for (const h of H) { const v = row['r' + h]; if (v == null) continue; o['n' + h] = (o['n' + h] || 0) + 1; o['s' + h] = (o['s' + h] || 0) + v; if (v > 0) o['w' + h] = (o['w' + h] || 0) + 1; if (v >= 20) o['b' + h] = (o['b' + h] || 0) + 1; if (v <= -20) o['l' + h] = (o['l' + h] || 0) + 1; }
  };
  let days = 0;
  for (const d of idx) {
    const perf = await getJSON(`mp/perf/${d}`);
    if (!perf?.rows) continue;
    days++;
    for (const row of Object.values(perf.rows)) {
      add('전체', row);
      if (row.st) add('단계:' + row.st, row);
      if (row.dir) add('분류:' + (row.dir === 'up' ? '상승 가능성' : row.dir === 'down' ? '하락 위험' : '분류 없음'), row);
      if (row.lv) add('AI 의심:' + row.lv, row);
      if (row.ck) add('체크리스트:' + row.ck + '등급', row);
      if (row.rr != null) add('손익비:' + (row.rr >= 3 ? '3 이상' : row.rr >= 2 ? '2~3' : '2 미만'), row);
    }
  }
  const out = Object.entries(groups).map(([g, o]) => {
    const r = { g, n: o.n };
    for (const h of H) if (o['n' + h]) { r['n' + h] = o['n' + h]; r['avg' + h] = Math.round((o['s' + h] / o['n' + h]) * 10) / 10; r['win' + h] = Math.round(((o['w' + h] || 0) / o['n' + h]) * 100); r['big' + h] = Math.round(((o['b' + h] || 0) / o['n' + h]) * 100); r['loss' + h] = Math.round(((o['l' + h] || 0) / o['n' + h]) * 100); }
    return r;
  });
  return { days, groups: out, at: Date.now() };
}

// ───── ② 같은 세력 추적 ─────
//  공시 제출인(5% 보고·최대주주 등)과 최대주주 변경의 새 최대주주 이름을 모아, 2개 이상 종목에 나오는 이름을 연결
const BIG = /국민연금|자산운용|증권|은행|보험|캐피탈|공제회|투자신탁|우리사주|한국투자|미래에셋|삼성|신한|KB|NH|하나|IBK|산업은행|수출입은행|예금보험|한국거래소|BlackRock|Vanguard|Morgan|Goldman|JP ?Morgan|Citi|UBS|Norges|Templeton|Fidelity|Capital Group/i;
export function partyKey(name) {
  const n = String(name || '').replace(/\(주\)|㈜|주식회사|유한회사|합자회사|\s|\.|,/g, '').replace(/[()（）]/g, '').trim();
  return n.length >= 2 ? n.toUpperCase() : null;
}
export function partiesOf(evs) {
  const out = new Map();
  for (const e of evs || []) {
    const names = [];
    if (e.party) names.push(e.party);
    const m = String(e.sum || '').match(/→\s*([^(·]+)/); // '최대주주 변경 A → B (12%)'
    if (m && e.kind === 'mna') names.push(m[1].trim());
    for (const nm of names) {
      if (!nm || BIG.test(nm)) continue;
      const k = partyKey(nm);
      if (k && !out.has(k)) out.set(k, { name: nm.trim().slice(0, 40), kind: e.kind, ms: e.ms });
    }
  }
  return out;
}
/** 전 종목 공시에서 이름 → 등장 종목 목록 */
export function buildPartyIndex(evByCode, names = {}) {
  const idx = {};
  for (const [code, evs] of Object.entries(evByCode)) {
    for (const [k, v] of partiesOf(evs)) (idx[k] ||= { n: v.name, list: [] }).list.push({ c: code, nm: names[code] || null, d: kstDate(v.ms), k: v.kind });
  }
  for (const k of Object.keys(idx)) if (idx[k].list.length < 2) delete idx[k];
  return idx;
}
export function linksOf(code, evs, pidx) {
  const out = [];
  for (const [k, v] of partiesOf(evs)) {
    const p = pidx?.[k];
    if (!p) continue;
    const others = p.list.filter((y) => y.c !== code);
    if (others.length) out.push({ who: v.name, others: others.slice(0, 6) });
  }
  return out.slice(0, 5);
}

// ───── ③ 거래소 시장경보 (투자주의·경고·위험) ─────
const LV = { 1: '투자주의', 2: '투자경고', 3: '투자위험' };
async function kindWarn(menu) {
  const end = kstDate(), start = kstDate(Date.now() - 30 * DAY);
  const body = new URLSearchParams({ method: 'investattentwarnriskySub', currentPageSize: '300', pageIndex: '1', orderMode: '4', orderStat: 'D', searchCodeType: '', searchCorpName: '', repIsuSrtCd: '', menuIndex: String(menu), forward: 'invstattentwarnrisky_sub', marketType: '', startDate: start, endDate: end });
  const r = await fetchWithTimeout('https://kind.krx.co.kr/investwarn/investattentwarnrisky.do', { method: 'POST', headers: { 'User-Agent': BROWSER_UA, Referer: 'https://kind.krx.co.kr/investwarn/investattentwarnrisky.do?method=investattentwarnriskyMain', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: body.toString() }, 12000);
  if (!r.ok) throw new Error('KIND HTTP ' + r.status);
  const html = decodeText(await r.arrayBuffer(), /utf-?8/i.test(r.headers.get('content-type') || '') ? 'utf-8' : 'euc-kr');
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const out = [];
  for (const tr of rows) {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map((c) => decodeEntities(c.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
    if (cells.length < 3) continue;
    const name = (tr.match(/title="([^"]+)"/) || [])[1] || cells[1];
    const date = cells.find((c) => /^20\d{2}-\d{2}-\d{2}$/.test(c)) || null;
    const code = (tr.match(/['"](\d{6})['"]/) || [])[1] || null;
    if (name) out.push({ name: name.trim(), code, date });
  }
  return out;
}
/** 크론(하루 2번): code → { lv, name, date } (최근 30일 지정) */
export async function warnWatch(nameToCode = {}) {
  const st = (await getJSON('mp/warn')) || {};
  if (Date.now() - (st.at || 0) < 6 * 3600e3) return null;
  const map = {};
  const err = [];
  for (const menu of [1, 2, 3]) {
    try {
      for (const x of await kindWarn(menu)) {
        const code = x.code || nameToCode[x.name];
        if (!code) continue;
        if (!map[code] || menu > map[code].m) map[code] = { m: menu, lv: LV[menu], date: x.date, name: x.name };
      }
    } catch (e) { err.push(`${LV[menu]}: ${e.message}`); }
  }
  const next = { at: Date.now(), map: Object.keys(map).length || !st.map ? map : st.map, err: err.length ? err.join(' / ').slice(0, 200) : null, n: Object.keys(map).length };
  await setJSON('mp/warn', next);
  return { n: next.n, err: next.err };
}

// ───── ④ 관리자 텔레그램 알림 ─────
export async function radarAlert(lines, codes = []) {
  if (!lines.length) return false;
  // 사이트 '🔔 알림 기록'에 남김 (텔레그램이 꺼져 있거나 하루 한도를 넘어도 기록은 남음)
  try {
    const h = (await getJSON('mp/alerts')) || { list: [] };
    const at = Date.now();
    h.list = [...lines.map((t, i) => ({ at, t: String(t).replace(/^•\s*/, ''), c: codes[i] || null })), ...h.list].slice(0, 500);
    await setJSON('mp/alerts', h);
  } catch {}
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return false;
  const st = (await getJSON('mp/alert')) || {};
  const day = kstDate();
  if (st.day !== day) { st.day = day; st.n = 0; }
  const room = Math.max(0, 40 - (st.n || 0));
  if (!room) return false;
  const send = lines.slice(0, Math.min(room, 12));
  const { telegram } = await import('./monitor.mjs');
  const ok = await telegram(`🕵️ 작전 레이더 알림 (관리자 전용)\n\n${send.join('\n')}${lines.length > send.length ? `\n…외 ${lines.length - send.length}건` : ''}\n\n※ 패턴 신호일 뿐 증거 아님 · gk-stock.com/#radar`).catch(() => false);
  if (ok) { st.n = (st.n || 0) + send.length; await setJSON('mp/alert', st); }
  return ok;
}
