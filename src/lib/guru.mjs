// 투자 대가 포트폴리오 — 유명 투자자·펀드의 분기 보유 종목 보고(SEC 13F-HR)
//  · 분기 끝난 뒤 45일 안에 공개 (2·5·8·11월 중순에 몰림) → 크론이 3분마다 한 명씩, 6시간 간격으로 새 보고 확인
//  · 직전 분기 보고와 비교해 신규 매수·추가 매수·일부 매도·전량 매도 표시
//  · 13F에는 티커가 없음(CUSIP 번호만) → OpenFIGI(무료)로 CUSIP → 티커 변환, 한 번 찾은 건 저장
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout } from './util.mjs';
import { SEC_HEADERS } from './sec-core.mjs';

export const GURUS = [
  { id: 'buffett', cik: 1067983, who: '워런 버핏', fund: '버크셔 해서웨이', style: '가치투자의 전설', re: /berkshire/i },
  { id: 'ackman', cik: 1336528, who: '빌 애크먼', fund: '퍼싱 스퀘어', style: '소수 종목 집중 투자', re: /pershing/i },
  { id: 'druck', cik: 1536411, who: '스탠리 드러켄밀러', fund: '듀케인 패밀리 오피스', style: '매크로·성장주', re: /duquesne/i },
  { id: 'tepper', cik: 1656456, who: '데이비드 테퍼', fund: '아팔루사', style: '역발상·경기 회복 베팅', re: /appaloosa/i },
  { id: 'lilu', cik: 1709323, who: '리 루', fund: '히말라야 캐피털', style: '멍거가 인정한 가치투자자', re: /himalaya/i },
  { id: 'gates', cik: 1166559, who: '빌 게이츠', fund: '게이츠 재단 신탁', style: '장기 보유', re: /gates/i },
  { id: 'smith', cik: 1569205, who: '테리 스미스', fund: '펀드스미스', style: '좋은 기업을 사서 오래 보유', re: /fundsmith/i },
  { id: 'klarman', cik: 1061768, who: '세스 클라만', fund: '바우포스트', style: '안전마진 가치투자', re: /baupost/i },
  { id: 'marks', cik: 949509, who: '하워드 막스', fund: '오크트리', style: '부실채권·역발상', re: /oaktree/i },
  { id: 'icahn', cik: 921669, who: '칼 아이칸', fund: '아이칸 엔터프라이즈', style: '행동주의 투자', re: /icahn/i },
  { id: 'loeb', cik: 1040273, who: '댄 로엡', fund: '서드 포인트', style: '행동주의·이벤트', re: /third point/i },
  { id: 'einhorn', cik: 1079114, who: '데이비드 아인혼', fund: '그린라이트 캐피털', style: '가치투자·공매도', re: /greenlight/i },
  { id: 'soros', cik: 1029160, who: '조지 소로스', fund: '소로스 펀드', style: '매크로 투자', re: /soros/i },
  { id: 'dalio', cik: 1350694, who: '레이 달리오(창업)', fund: '브리지워터', style: '세계 최대 헤지펀드', re: /bridgewater/i },
  { id: 'tiger', cik: 1167483, who: '체이스 콜먼', fund: '타이거 글로벌', style: '기술·성장주', re: /tiger global/i },
  { id: 'wood', cik: 1697748, who: '캐시 우드', fund: 'ARK 인베스트', style: '파괴적 혁신 성장주', re: /ark invest/i },
  { id: 'burry', cik: 1649339, who: '마이클 버리', fund: '사이언 자산운용', style: '빅쇼트 · 2025년 펀드 정리', re: /scion/i },
];

const pad = (c) => String(c).padStart(10, '0');
const tag = (s, name) => { const m = s.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i')); return m ? m[1].trim() : ''; };

/** 13F 정보표 XML → [{ c: CUSIP, nm, cls, v(달러), sh, pc(put/call) }] (같은 종목 합침, 옵션은 따로) */
export function parseInfoTable(xml) {
  const map = new Map();
  for (const m of String(xml).matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)) {
    const b = m[1];
    const c = tag(b, 'cusip').toUpperCase();
    if (!c) continue;
    const pc = tag(b, 'putCall').toUpperCase();
    const k = pc ? `${c}|${pc}` : c;
    const v = Number(tag(b, 'value').replace(/,/g, '')) || 0;
    const sh = Number(tag(b, 'sshPrnamt').replace(/,/g, '')) || 0;
    const o = map.get(k) || { c, nm: tag(b, 'nameOfIssuer').replace(/&amp;/g, '&'), cls: tag(b, 'titleOfClass'), v: 0, sh: 0, pc: pc || null };
    o.v += v; o.sh += sh;
    map.set(k, o);
  }
  return [...map.values()];
}

async function secJSON(url) {
  const r = await fetchWithTimeout(url, { headers: { ...SEC_HEADERS, Accept: 'application/json' } }, 10000);
  if (!r.ok) throw new Error('SEC HTTP ' + r.status);
  return r.json();
}
async function infoTableOf(cik, acc) {
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}`;
  const idx = await secJSON(`${base}/index.json`);
  const files = (idx?.directory?.item || []).map((x) => x.name).filter((n) => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
  if (!files.length) throw new Error('13F 정보표 없음');
  const r = await fetchWithTimeout(`${base}/${files[0]}`, { headers: SEC_HEADERS }, 15000);
  if (!r.ok) throw new Error('13F 정보표 HTTP ' + r.status);
  return parseInfoTable(await r.text());
}

/** 직전 분기와 비교 */
export function compareHoldings(cur, prev) {
  const key = (x) => (x.pc ? `${x.c}|${x.pc}` : x.c);
  const pm = new Map((prev || []).map((x) => [key(x), x]));
  const total = cur.reduce((s, x) => s + (x.pc ? 0 : x.v), 0) || 1;
  const rows = cur.map((x) => {
    const p = pm.get(key(x));
    let chg = 'same', dsh = 0, dp = null;
    if (!p) chg = prev ? 'new' : 'same';
    else {
      dsh = x.sh - p.sh;
      dp = p.sh ? Math.round((dsh / p.sh) * 1000) / 10 : null;
      if (dp != null && dp >= 2) chg = 'add'; else if (dp != null && dp <= -2) chg = 'cut';
    }
    return { ...x, pct: x.pc ? null : Math.round((x.v / total) * 1000) / 10, chg, dsh, dp };
  });
  const ck = new Set(cur.map(key));
  const sold = (prev || []).filter((p) => !ck.has(key(p)) && !p.pc).sort((a, b) => b.v - a.v).slice(0, 20).map((p) => ({ ...p, chg: 'sold' }));
  return { total, rows: rows.sort((a, b) => b.v - a.v), sold };
}

/** 한 명 새 보고 확인 → 바뀌었으면 저장 */
async function refreshGuru(g, st) {
  const j = await secJSON(`https://data.sec.gov/submissions/CIK${pad(g.cik)}.json`);
  if (!g.re.test(j?.name || '')) throw new Error(`이름 불일치: ${j?.name}`);
  const f = j?.filings?.recent || {};
  const list = (f.form || []).map((form, i) => ({ form, acc: f.accessionNumber[i], date: f.reportDate[i], filed: f.filingDate[i] })).filter((x) => x.form === '13F-HR');
  if (!list.length) throw new Error('13F 보고 없음');
  const [last, before] = list;
  const old = await getJSON(`guru/h/${g.id}`);
  if (old?.acc === last.acc) return false;
  const cur = await infoTableOf(g.cik, last.acc);
  let prev = null;
  if (before) try { prev = await infoTableOf(g.cik, before.acc); } catch {}
  const { total, rows, sold } = compareHoldings(cur, prev);
  const cnt = (c) => rows.filter((x) => x.chg === c && !x.pc).length;
  const doc = {
    id: g.id, acc: last.acc, date: last.date, filed: last.filed, prevDate: before?.date || null, total, n: rows.filter((x) => !x.pc).length,
    cnt: { new: cnt('new'), add: cnt('add'), cut: cnt('cut'), sold: sold.length },
    rows: rows.slice(0, 80), sold, at: Date.now(),
  };
  await setJSON(`guru/h/${g.id}`, doc);
  // 티커를 모르는 CUSIP → 변환 대기열
  const cmap = (await getJSON('guru/cusip')) || {};
  const pend = new Set(st.pend || []);
  for (const x of [...doc.rows, ...sold]) if (!(x.c in cmap)) pend.add(x.c);
  st.pend = [...pend].slice(0, 1500);
  return true;
}

/** CUSIP → 티커 (OpenFIGI, 키 없이 분당 25회·한 번에 10개) */
async function mapCusips(st, maxReq = 4) {
  if (!st.pend?.length) return 0;
  const cmap = (await getJSON('guru/cusip')) || {};
  let done = 0;
  for (let i = 0; i < maxReq && st.pend.length; i++) {
    const part = st.pend.splice(0, 10);
    try {
      const r = await fetchWithTimeout('https://api.openfigi.com/v3/mapping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(part.map((c) => ({ idType: 'ID_CUSIP', idValue: c, exchCode: 'US' }))) }, 9000);
      if (r.status === 429) { st.pend.unshift(...part); break; }
      const arr = await r.json();
      part.forEach((c, k) => { const d = arr?.[k]?.data?.[0]; cmap[c] = d?.ticker ? String(d.ticker).replace('/', '.') : ''; });
      done += part.length;
    } catch { st.pend.push(...part); break; }
  }
  if (done) await setJSON('guru/cusip', cmap);
  return done;
}

/** 크론(3분마다): 한 명씩 돌아가며 6시간마다 확인 + CUSIP 변환 */
export async function guruWatch() {
  const st = (await getJSON('guru/state')) || { i: 0, at: {} };
  st.at = st.at || {};
  const out = { mapped: 0 };
  for (let k = 0; k < GURUS.length; k++) {
    const g = GURUS[(st.i + k) % GURUS.length];
    if (Date.now() - (st.at[g.id] || 0) < 6 * 3600e3) continue;
    st.i = (GURUS.indexOf(g) + 1) % GURUS.length;
    st.at[g.id] = Date.now();
    try { out[g.id] = (await refreshGuru(g, st)) ? 'new' : 'same'; delete (st.err || {})[g.id]; }
    catch (e) { st.err = { ...(st.err || {}), [g.id]: String(e.message || e).slice(0, 120) }; out[g.id] = 'error'; }
    break; // 한 번에 한 명
  }
  out.mapped = await mapCusips(st);
  await setJSON('guru/state', st).catch(() => {});
  return out;
}

const QLABEL = (d) => { if (!d) return ''; const [y, m] = d.split('-'); return `${y}년 ${Math.ceil(Number(m) / 3)}분기`; };

/** 화면용: 목록(요약) 또는 한 명 자세히 */
export async function guruView(id) {
  const cmap = (await getJSON('guru/cusip')) || {};
  const tk = (x) => cmap[x.c] || null;
  if (id) {
    const g = GURUS.find((x) => x.id === id);
    if (!g) return null;
    const d = await getJSON(`guru/h/${id}`);
    if (!d) return { g: pub(g), none: true };
    const rows = d.rows.map((x) => ({ ...x, t: tk(x) })), sold = d.sold.map((x) => ({ ...x, t: tk(x) }));
    await koNames([...rows, ...sold]);
    return { g: pub(g), q: QLABEL(d.date), prevQ: QLABEL(d.prevDate), ...d, rows, sold };
  }
  const docs = await Promise.all(GURUS.map((g) => getJSON(`guru/h/${g.id}`).catch(() => null)));
  const list = GURUS.map((g, i) => {
    const d = docs[i];
    if (!d) return { ...pub(g), none: true };
    const top = d.rows.filter((x) => !x.pc).slice(0, 5).map((x) => ({ t: tk(x), nm: x.nm, pct: x.pct }));
    return { ...pub(g), q: QLABEL(d.date), date: d.date, filed: d.filed, total: d.total, n: d.n, cnt: d.cnt, top, old: Date.now() - Date.parse(d.date) > 200 * 86400e3 };
  });
  // 이번 분기 여러 대가가 함께 산 종목 / 판 종목
  const latest = docs.filter(Boolean).map((d) => d.date).sort().pop();
  const buy = new Map(), sell = new Map();
  docs.forEach((d, i) => {
    if (!d || d.date !== latest) return;
    for (const x of d.rows) if (!x.pc && (x.chg === 'new' || x.chg === 'add')) { const o = buy.get(x.c) || { c: x.c, nm: x.nm, who: [], v: 0 }; o.who.push(GURUS[i].who); o.v += x.v; buy.set(x.c, o); }
    for (const x of [...d.rows.filter((r) => !r.pc && r.chg === 'cut'), ...d.sold]) { const o = sell.get(x.c) || { c: x.c, nm: x.nm, who: [], v: 0 }; o.who.push(GURUS[i].who); o.v += x.v; sell.set(x.c, o); }
  });
  const rank = (m) => [...m.values()].sort((a, b) => b.who.length - a.who.length || b.v - a.v).slice(0, 12).map((x) => ({ ...x, t: tk(x) }));
  const hot = { q: QLABEL(latest), buy: rank(buy), sell: rank(sell) };
  await koNames([...list.flatMap((x) => x.top || []), ...hot.buy, ...hot.sell]);
  return { list, hot };
}
const pub = (g) => ({ id: g.id, who: g.who, fund: g.fund, style: g.style });
async function koNames(rows) {
  const ts = [...new Set(rows.map((x) => x.t).filter(Boolean))];
  if (!ts.length) return;
  try { const { usKoNames } = await import('./usko.mjs'); const ko = await usKoNames(ts, { max: 60 }); for (const x of rows) if (x.t) x.ko = ko?.[x.t] || null; } catch {}
}
