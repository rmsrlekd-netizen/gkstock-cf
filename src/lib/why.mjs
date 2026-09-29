// 오늘 주가 움직임 이유 (공시가 없어도): 종목별 최신 뉴스 제목 + 같이 움직인 그룹·업종 + AI 한 줄 추정
//  · 뉴스: 네이버 증권 종목 뉴스 (국내·미국), 미국은 없으면 Finnhub 회사 뉴스
//  · 본문은 가져오지 않음 — 제목·짧은 요약·원문 링크만
//  · AI 추정은 뉴스가 바뀌었을 때만 새로 (하루 최대 WHY_DAILY_MAX건, 기본 300)
import { fetchWithTimeout, kstDate } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';
import { hasAI, askAI, parseJSON, aiPauseInfo, translateTitles } from './ai.mjs';
import { queryArchive } from './archive.mjs';

const H = { Accept: 'application/json', Referer: 'https://m.stock.naver.com/' };
const DAILY_MAX = () => Number(process.env.WHY_DAILY_MAX || 200);
const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
// "202609280931" 또는 "20260928020132" (한국 시간) → ISO
const kstIso = (s) => { const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/); return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+09:00`).toISOString() : null; };

async function getJ(url, ms = 7000) {
  const r = await fetchWithTimeout(url, { headers: H }, ms);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/** 국내 종목 뉴스 */
async function krNews(code) {
  const j = await getJ(`https://api.stock.naver.com/news/stock/${code}?pageSize=10&page=1`);
  const out = [];
  for (const c of Array.isArray(j) ? j : []) {
    const x = c?.items?.[0];
    if (!x?.title) continue;
    out.push({ id: x.id || x.articleId, title: clean(x.titleFull || x.title), sum: clean(x.body).slice(0, 160), src: x.officeName || '', at: kstIso(x.datetime), url: x.mobileNewsUrl || (x.officeId && x.articleId ? `https://n.news.naver.com/mnews/article/${x.officeId}/${x.articleId}` : null), n: c.total || 1 });
  }
  return out;
}

/** 미국 종목 뉴스 (네이버 해외주식, 한국어 번역 기사) */
async function usNaverNews(reuters) {
  const j = await getJ(`https://api.stock.naver.com/news/worldStock/${reuters}?pageSize=10&page=1`);
  return (Array.isArray(j) ? j : []).filter((x) => x?.tit).map((x) => ({ id: `${x.oid}-${x.aid}`, title: clean(x.tit), sum: clean(x.subcontent).slice(0, 160), src: x.ohnm || '', at: kstIso(x.dt), url: `https://m.stock.naver.com/worldstock/stock/${reuters}/news`, n: 1 }));
}

/** 미국 종목 뉴스 (Finnhub, 영어) */
async function usFinnhub(t) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return [];
  const r = await fetchWithTimeout(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(t)}&from=${kstDate(-2)}&to=${kstDate(0)}&token=${key}`, {}, 7000);
  if (!r.ok) return [];
  const arr = await r.json();
  return (Array.isArray(arr) ? arr : []).slice(0, 10).map((x) => ({ id: 'fh' + x.id, title: clean(x.headline), sum: clean(x.summary).slice(0, 160), src: x.source || '', at: new Date((x.datetime || 0) * 1000).toISOString(), url: x.url || null, n: 1 }));
}

/** 우리 사이트에 올라온 이 종목의 최근 공시·보도자료 (가장 직접적인 근거) */
export function ownTitle(n) {
  const its = (n.items || []).map((x) => x.ko).filter(Boolean).slice(0, 2).join('·');
  return clean(n.ko?.title || n.titleKo || n.summaryKo || n.title || [n.formKo || n.form, its].filter(Boolean).join(' ') || '');
}
async function ownNews(mk, t) {
  const { itemMs } = await import('./archive.mjs');
  const arr = (await queryArchive({ market: mk, ticker: t, limit: 8 }).catch(() => [])).filter((n) => Date.now() - itemMs(n) < 48 * 3600e3 && !/^(3|4|5|144)(\/A)?$/.test(String(n.form || '')));
  //  한국어 제목이 없는 공시("해외기업 수시공시" 등)는 저장된 AI 요약(한 줄 + 핵심 3줄)을 근거로 씀
  const ai = {};
  await Promise.all(arr.filter((n) => mk === 'US' && !n.ko?.title && !n.titleKo).map(async (n) => {
    const a = (await getJSON(`ai3/${n.id}`)) || (await getJSON(`aiq/${n.id}`));
    if (a?.headline && !a.fallback) ai[n.id] = { title: a.headline, sum: (a.summary || []).join(' / ').slice(0, 200) };
  }));
  return arr
    .map((n) => ({ id: 'own-' + n.id, title: ai[n.id]?.title || ownTitle(n), sum: ai[n.id]?.sum || clean(n.desc || '').slice(0, 160), src: n.src === 'PR' ? (n.source || '보도자료') : n.src === 'SEC' ? 'SEC 공시' : 'DART 공시', at: new Date(itemMs(n)).toISOString(), url: n.url || null, n: 1, own: true }))
    .filter((x) => x.title);
}

/** 영어 뉴스 제목 → 한국어 (AI 번역, 한 번 번역한 제목은 저장해 모두 재사용). 바뀐 게 있으면 true */
export async function koNews(news) {
  const en = (news || []).filter((x) => x.title && !x.titleKo && !/[가-힣]/.test(x.title));
  if (!en.length) return false;
  const map = (await getJSON('tr/why')) || {};
  let changed = false;
  const need = [];
  for (const x of en) { if (map[x.id]) { x.titleKo = map[x.id]; changed = true; } else need.push(x); }
  if (need.length && hasAI() && !(await aiPauseInfo())) {
    try {
      const ko = await translateTitles(need.slice(0, 12).map((x) => ({ id: x.id, title: x.title.slice(0, 200), desc: (x.sum || '').slice(0, 160) })));
      for (const x of need) if (ko[x.id]) { x.titleKo = map[x.id] = ko[x.id]; changed = true; }
      const keys = Object.keys(map);
      if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete map[k];
      await setJSON('tr/why', map).catch(() => {});
    } catch (e) { console.warn('why tr', e.message); }
  }
  return changed;
}

async function stockNews(mk, t, reuters) {
  const own = await ownNews(mk, t);
  return [...own, ...(await extNews(mk, t, reuters))].slice(0, 10);
}
async function extNews(mk, t, reuters) {
  let list = [];
  if (mk === 'KR') list = await krNews(t).catch(() => []);
  else {
    const cands = reuters ? [reuters] : [`${t}.O`, `${t}.N`, `${t}.K`, `${t}.A`];
    for (const rc of cands) {
      list = await usNaverNews(rc).catch(() => []);
      if (list.length) break;
    }
    const fresh = list.filter((x) => Date.now() - Date.parse(x.at) < 36 * 3600e3);
    if (fresh.length < 2) list = [...list, ...(await usFinnhub(t).catch(() => []))];
  }
  // 최근 3일 안의 것만, 최신순
  return list.filter((x) => x.title && x.at && Date.now() - Date.parse(x.at) < 72 * 3600e3)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 8);
}

async function aiReason({ mk, name, t, pct, news, peers }) {
  const dir = pct >= 0 ? '상승' : '하락';
  const peerTxt = [
    peers?.group?.length ? `같은 그룹 종목도 같이 ${dir}: ${peers.group.join(', ')}` : '',
    peers?.sector ? `같은 업종(${peers.sector.name}) ${peers.sector.n}개 종목이 같이 ${dir} 상위` : '',
  ].filter(Boolean).join('\n');
  const newsTxt = news.map((x, i) => `[${i + 1}] (${x.at ? new Date(Date.parse(x.at) + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : ''} ${x.src}) ${x.title}${x.sum ? ' — ' + x.sum : ''}`).join('\n');
  const prompt = `너는 증권사 시황 담당 애널리스트다. ${mk === 'KR' ? '한국' : '미국'} 종목 "${name}"(${t})의 주가가 오늘 ${pct > 0 ? '+' : ''}${pct.toFixed(2)}% ${dir}했다.
아래 최근 뉴스(제목·요약)와 동반 움직임 정보만 근거로, 오늘 주가가 움직인 가장 유력한 이유를 한국어 한 줄로 써라.
규칙:
- reason: 45자 이내, 명사형으로 끝낼 것 (예: "담관암 신약 FDA 허가 소식에 그룹주 동반 상한가")
- 이 종목과 직접 관련 없는 일반 시황·인기검색 기사는 무시
- 근거가 부족하면 지어내지 말고 reason을 "뚜렷한 개별 뉴스 없음 — 수급·테마 영향 추정"으로, confidence를 "낮음"으로
- confidence: 뉴스가 오늘 움직임을 직접 설명하면 "높음", 관련은 있으나 간접적이면 "보통", 추정이면 "낮음"
- basis: 근거로 쓴 뉴스 번호 배열
JSON만 출력: {"reason":"","confidence":"높음|보통|낮음","basis":[1]}

${peerTxt ? '동반 움직임:\n' + peerTxt + '\n\n' : ''}최근 뉴스:
${newsTxt || '(없음)'}`;
  const txt = await askAI(prompt, { maxTokens: 400, timeout: 20000, tag: '주가 움직임 이유' });
  const j = parseJSON(txt);
  if (!j?.reason) throw new Error('AI 응답 형식 오류');
  return { reason: String(j.reason).slice(0, 80), conf: ['높음', '보통', '낮음'].includes(j.confidence) ? j.confidence : '보통', basis: (j.basis || []).map(Number).filter((n) => n >= 1 && n <= news.length) };
}

/**
 * 한 종목의 "오늘 움직임 이유"
 * opts: { mk, t, name, pct, reuters, peers, allowAI=true, force=false }
 */
export async function whyFor({ mk, t, name, pct = null, reuters = null, peers = null, allowAI = true, force = false, minMove = 2, translate = false }) {
  t = String(t || '').toUpperCase();
  const key = `why/${mk}/${t}`;
  const prev = await getJSON(key);
  const now = Date.now();
  if (prev && !force && now - prev.at < (prev.reason ? 8 : 3) * 60e3) {
    if (translate && mk === 'US' && (await koNews(prev.news).catch(() => false))) await setJSON(key, prev).catch(() => {}); // 제목 번역이 새로 붙었으면 저장
    return { ...prev, pct: pct ?? prev.pct, peers: peers || prev.peers, cached: true };
  }
  const news = await stockNews(mk, t, reuters);
  const sig = news.map((x) => x.id + ':' + String(x.title || '').length).join('|'); // 같은 공시라도 AI 요약이 새로 붙어 제목이 바뀌면 다시 판단
  const out = { mk, t, name: name || prev?.name || t, pct: pct ?? prev?.pct ?? null, news, peers: peers || prev?.peers || null, at: now, sig, reason: null, conf: null, basis: [], aiAt: null, aiPct: null };
  // 오늘(20시간 안) 만든 AI 이유는 그대로 이어 씀
  if (prev?.reason && prev.aiAt && now - prev.aiAt < 20 * 3600e3) Object.assign(out, { reason: prev.reason, conf: prev.conf, basis: prev.basis || [], aiAt: prev.aiAt, aiPct: prev.aiPct });
  const moved = out.pct != null && Math.abs(out.pct) >= minMove;
  const oldSig = news.map((x) => x.id).join('|'); // 예전 방식 기록은 '근거 부족'이었던 것만 다시 판단 (AI 호출 절약)
  const changed = (sig !== prev?.sig && !(prev?.sig === oldSig && prev?.conf !== '낮음')) || !out.reason || (out.aiPct != null && out.pct != null && Math.abs(out.pct - out.aiPct) >= 6 && now - out.aiAt > 60 * 60e3);
  if (allowAI && moved && changed && hasAI() && !(await aiPauseInfo())) {
    const dayKey = `why/count/${kstDate(0)}/${mk}`; // 한국·미국 따로 (국장에서 다 써서 미장 프리마켓에 AI가 멈추던 문제)
    const cnt = (await getJSON(dayKey))?.n || 0;
    if (cnt < DAILY_MAX()) {
      try {
        const r = await aiReason({ mk, name: out.name, t, pct: out.pct, news, peers: out.peers });
        Object.assign(out, r, { aiAt: now, aiPct: out.pct });
        await setJSON(dayKey, { n: cnt + 1 }).catch(() => {});
      } catch (e) { out.aiError = String(e.message || e).slice(0, 160); }
    }
  }
  if (translate && mk === 'US') await koNews(out.news).catch(() => false); // 미국 뉴스 제목 한국어로 (화면에서 직접 열 때만 — AI 호출 절약)
  else if (mk === 'US' && prev?.news) { const pm = new Map(prev.news.filter((x) => x.titleKo).map((x) => [x.id, x.titleKo])); for (const x of out.news) if (pm.has(x.id)) x.titleKo = pm.get(x.id); }
  await setJSON(key, out).catch(() => {});
  return out;
}

// 그룹 이름 (HLB, LG, SK, 삼성 … 앞부분)
function groupOf(name) {
  const n = String(name || '').replace(/\s/g, '');
  const en = n.match(/^[A-Z]{2,5}(?=[가-힣A-Z]|$)/);
  if (en) return en[0];
  const ko = n.match(/^(삼성|현대|한화|롯데|두산|포스코|카카오|네이버|셀트리온|에코프로|한미|대웅|녹십자|코오롱|효성|신세계|CJ|GS|DB|OCI)/);
  return ko ? ko[0] : null;
}

/** 상승·하락 목록 안에서 같이 움직인 그룹·업종 찾기 */
export function peersIn(list, x, sectorOfFn) {
  const g = groupOf(x.name);
  const group = g ? list.filter((y) => y !== x && groupOf(y.name) === g).map((y) => y.name).slice(0, 5) : [];
  const sec = sectorOfFn?.(x);
  const same = sec ? list.filter((y) => y !== x && sectorOfFn(y) === sec) : [];
  return { group: group.length ? group : undefined, sector: same.length >= 2 ? { name: sec, n: same.length + 1 } : undefined };
}

/** 인기·상승·하락 종목 전체의 이유를 미리 만들어 둠 (3분마다) */
export async function whyWatch({ budgetMs = 45000, maxAI = 10 } = {}) {
  const started = Date.now();
  let pop = await getJSON('popular/v2');
  if (!pop || Date.now() - pop.at > 5 * 60e3) {
    try { await (await import('../functions/popular.mjs')).default(new Request('http://x/api/popular')); pop = await getJSON('popular/v2'); } catch {}
  }
  if (!pop) return { n: 0 };
  const { getSectors } = await import('./sectors.mjs');
  const sm = await getSectors({ allowFetch: false }).catch(() => null);
  const secOf = (y) => { const raw = y.market === 'KR' ? sm?.kr?.[y.ticker] : sm?.us?.[String(y.ticker).toUpperCase()]; return raw ? raw.split('|')[0] : null; };
  const todo = new Map();
  for (const k of ['krUp', 'krDown', 'usUp', 'usDown', 'kr', 'us']) {
    const list = pop[k] || [];
    for (const x of list) {
      const id = `${x.market}|${String(x.ticker).toUpperCase()}`;
      if (todo.has(id)) continue;
      todo.set(id, { x, peers: /Up|Down/.test(k) ? peersIn(list, x, secOf) : null });
    }
  }
  const items = [...todo.values()].sort((a, b) => Math.abs(b.x.pct || 0) - Math.abs(a.x.pct || 0));
  const map = (await getJSON('why/map')) || {};
  let ai = 0, n = 0;
  for (let i = 0; i < items.length && Date.now() - started < budgetMs; i += 3) {
    await Promise.all(items.slice(i, i + 3).map(async ({ x, peers }) => {
      const allow = ai < maxAI;
      if (allow) ai++; // AI 몫을 미리 잡아둠 (동시에 3개씩 돌기 때문)
      const r = await whyFor({ mk: x.market, t: x.ticker, name: x.name, pct: x.pct, reuters: x.reuters, peers, allowAI: allow }).catch(() => null);
      if (allow && !(r?.aiAt >= started)) ai--; // 실제로 AI를 안 불렀으면 돌려놓음
      if (!r) return;
      n++;
      map[`${x.market}|${String(x.ticker).toUpperCase()}`] = { r: r.reason, c: r.conf, n: r.news?.length || 0, at: r.aiAt || r.at };
    }));
  }
  // 급등락 종목의 공시가 서식 이름뿐("해외기업 수시공시" 등)이면 원문을 읽고 한 줄 요약을 미리 만들어 둠 (한 번에 최대 4건)
  try {
    const need = [...new Set(['usUp', 'usDown', 'krUp', 'krDown', 'us', 'kr'].flatMap((k) => (pop[k] || []).map((x) => x.prNeed).filter(Boolean)))].slice(0, 4);
    if (need.length && hasAI() && Date.now() - started < budgetMs + 10000) {
      const { quickSummary } = await import('../functions/analyze.mjs');
      await Promise.all(need.map((id) => quickSummary(id).catch(() => null)));
    }
  } catch {}
  // 오래된 것 정리
  for (const [k, v] of Object.entries(map)) if (Date.now() - (v.at || 0) > 24 * 3600e3) delete map[k];
  await setJSON('why/map', map).catch(() => {});
  return { n, ai, ms: Date.now() - started };
}
