// DART 수집 로직
// - OpenAPI list.json: 종목코드·회사코드 포함, 단 접수 "시각"이 없음
// - DART 홈페이지 '최근공시'(dsac001): 공식 접수 시각(시:분) 제공
// - 두 결과를 접수번호로 합치고, 우리 수집기가 처음 발견한 시각(초)을 함께 저장
import { fetchWithTimeout, kstYmd, kstDate, kstISO, decodeEntities, BROWSER_UA } from './util.mjs';
import { classifyDart } from './dart-classify.mjs';
import { fetchDartDoc, summarizeDart, cleanTitle } from './dart-doc.mjs';
import { getJSON, setJSON } from './store.mjs';

const CLS = { Y: 'KOSPI', K: 'KOSDAQ', N: 'KONEX' };
const TAG_CLS = { kospi: 'Y', kosdaq: 'K', konex: 'N' };

export async function dartList(key, pages = [1, 2]) {
  const bgn = kstYmd(-5), end = kstYmd(0);
  const out = [];
  for (const p of pages) {
    const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${encodeURIComponent(key)}&bgn_de=${bgn}&end_de=${end}&page_no=${p}&page_count=100&sort=date&sort_mth=desc`;
    const r = await fetchWithTimeout(url, {}, 8000);
    if (!r.ok) throw new Error('DART OpenAPI HTTP ' + r.status);
    const j = await r.json();
    if (j.status === '013') break;
    if (j.status !== '000') throw new Error(`DART OpenAPI ${j.status}: ${j.message}`);
    out.push(...(j.list || []));
    if ((j.list || []).length < 100) break;
  }
  return out;
}

/** DART '최근공시' 페이지 (공식 접수 시각 HH:MM) */
export async function dartTimes(dateDot, page = 1, group = '') {
  const body = new URLSearchParams({ currentPage: String(page), maxResults: '100', maxLinks: '10', sort: '', series: '', pageGrouping: group, mdayCnt: '0', selectDate: dateDot, textCrpCik: '' });
  const r = await fetchWithTimeout('https://dart.fss.or.kr/dsac001/search.ax', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': BROWSER_UA, Referer: 'https://dart.fss.or.kr/dsac001/mainAll.do', 'X-Requested-With': 'XMLHttpRequest' },
    body,
  }, 8000);
  if (!r.ok) throw new Error('DART web HTTP ' + r.status);
  return parseDartTimes(await r.text());
}

export function parseDartTimes(html) {
  const rows = [];
  const tbody = html.split('<tbody>')[1] || '';
  for (const tr of tbody.split(/<tr[\s>]/).slice(1)) {
    const tds = tr.split(/<td(?:\s[^>]*)?>/).slice(1);
    if (tds.length < 5) continue;
    const text = (s) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const time = (text(tds[0]).match(/(\d{1,2}:\d{2})/) || [])[1];
    const rcpNo = (tr.match(/rcpNo=(\d{14})/) || [])[1];
    if (!time || !rcpNo) continue;
    const corpCode = (tr.match(/openCorpInfoNew\('(\d{8})'/) || [])[1] || null;
    const mktTag = (tds[1].match(/tagCom_(kospi|kosdaq|konex|etc)/) || [])[1] || 'etc';
    const corpName = text(tds[1].replace(/<span class="tagCom[^"]*"[^>]*>[^<]*<\/span>/, '')).replace(/\s+IR$/, '');
    const report = text(tds[2]);
    const filer = text(tds[3]);
    const date = (text(tds[4]).match(/(\d{4})\.(\d{2})\.(\d{2})/) || []).slice(1).join('-');
    const remark = tds[5] ? [...tds[5].matchAll(/>([^<]{1,2})<\/span>/g)].map((m) => m[1].trim()).join('') : '';
    rows.push({ time: time.padStart(5, '0'), rcpNo, corpCode, corpName, report, filer, date, cls: TAG_CLS[mktTag] || null, remark });
  }
  return rows;
}

function toItem(base) {
  const title = (base.report_nm || '').replace(/\s+/g, ' ').trim();
  const [category, impact] = classifyDart(title);
  const d = base.rcept_dt || '';
  return {
    id: 'DART-' + base.rcept_no,
    titleClean: cleanTitle(title),
    src: 'DART',
    form: title.replace(/\[.*?\]/g, '').split('(')[0].trim(),
    formKo: title,
    category,
    impact,
    name: base.corp_name,
    ticker: base.stock_code || null,
    corpCode: base.corp_code || null,
    exchange: CLS[base.corp_cls] || null,
    party: base.flr_nm && base.flr_nm !== base.corp_name ? base.flr_nm : null,
    remark: base.rm || '',
    date: d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d,
    seq: base.rcept_no,
    url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${base.rcept_no}`,
  };
}

/** 정렬 키: 공식 접수시각 > 수집시각 > 접수번호 */
export function sortKey(x) {
  const t = x.timeMin && x.timeMin !== 'na' ? x.timeMin : `${x.date} ${(x.seenAt || '').slice(11, 16) || '00:00'}`;
  return `${t} ${x.seq}`;
}

const num = (s) => {
  const n = Number(String(s ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** 임원·주요주주 / 대량보유 보고서의 수량 증감을 붙임 */
async function enrichDart(items, key, { max = 5 } = {}) {
  let n = 0;
  const cache = new Map();
  for (const it of items) {
    if (n >= max) break;
    if (it.detail || (it.detailTries || 0) >= 2 || !it.corpCode) continue;
    if (it.category !== 'insider' && it.category !== 'inst') continue;
    if (Date.now() - Date.parse(it.seenAt || 0) > 6 * 3600e3) continue; // 최근 6시간 내 신규만
    n++;
    try {
      const ep = it.category === 'insider' ? 'elestock' : 'majorstock';
      const ck = ep + it.corpCode;
      if (!cache.has(ck)) {
        const r = await fetchWithTimeout(`https://opendart.fss.or.kr/api/${ep}.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${it.corpCode}`, {}, 7000);
        cache.set(ck, await r.json());
      }
      const j = cache.get(ck);
      const row = (j.list || []).find((x) => x.rcept_no === it.seq);
      if (!row) throw new Error('not yet');
      it.detail = ep === 'elestock'
        ? { who: row.repror, role: row.isu_exctv_ofcps || row.isu_main_shrholdr || '', shares: num(row.sp_stock_lmp_cnt), change: num(row.sp_stock_lmp_irds_cnt), rate: num(row.sp_stock_lmp_rate), rateChange: num(row.sp_stock_lmp_irds_rate) }
        : { who: row.repror, role: row.report_tp || '', shares: num(row.stkqy), change: num(row.stkqy_irds), rate: num(row.stkrt), rateChange: num(row.stkrt_irds), reason: row.report_resn || '' };
      if (it.detail.change && Math.abs(it.detail.rateChange || 0) >= 1) it.impact = Math.max(it.impact, 4);
    } catch {
      it.detailTries = (it.detailTries || 0) + 1;
    }
  }
}

// 원문을 읽어 핵심 제목을 만들 공시 종류
const DOC_TYPES = /잠정\)?실적|공급계약|유상증자결정|사채권발행결정|자기주식(취득|처분)결정|자기주식취득신탁계약체결|주식소각결정|배당결정|타법인주식및출자증권(취득|처분)결정|무상증자결정|감자결정|^(\[.*\])?최대주주변경$|투자판단관련주요경영사항|조회공시.*답변|풍문또는보도에대한해명|기타주요경영사항/;

async function enrichDocs(items, { max = 12, deadline = Date.now() + 15000 } = {}) {
  let n = 0;
  const list = items.filter((x) => !x.summary && (x.docTries || 0) < 2 && DOC_TYPES.test((x.formKo || '').replace(/\s+/g, '')));
  list.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));
  for (const it of list) {
    if (n >= max || Date.now() > deadline) break;
    n++;
    try {
      const lines = await fetchDartDoc(it.seq);
      it.summary = summarizeDart(it.formKo, lines) || { none: true };
    } catch {
      it.docTries = (it.docTries || 0) + 1;
    }
  }
  return n;
}

/** 예약 함수 1회 실행 */
export async function runDartWatch({ docs: withDocs = true, light = false } = {}) {
  const key = process.env.DART_API_KEY;
  const started = Date.now();
  const state = (await getJSON('dart/feed')) || { items: [], cursor: {} };
  const corpMap = (await getJSON('dart/corpmap')) || {};
  const firstRun = !state.items.length;
  const byId = new Map(state.items.map((x) => [x.id, x]));
  const errors = [];
  const now = Date.now();
  const nowISO = kstISO(now);

  const upsert = (it, extra = {}) => {
    const old = byId.get(it.id);
    if (old) {
      byId.set(it.id, { ...old, ...Object.fromEntries(Object.entries(it).filter(([, v]) => v !== null && v !== undefined && v !== '')), ...extra });
    } else {
      byId.set(it.id, { ...it, ...extra, seenAt: nowISO, seenLive: !firstRun });
    }
  };

  // 1) OpenAPI 목록
  if (key) {
    try {
      const list = await dartList(key, light ? [1] : [1, 2, 3]);
      for (const x of list) {
        if (x.corp_code && x.stock_code) corpMap[x.corp_code] = [x.stock_code, x.corp_cls];
        if (!CLS[x.corp_cls] || !x.stock_code) continue; // 상장사만
        upsert(toItem(x));
      }
    } catch (e) {
      errors.push(e.message);
    }
  } else {
    errors.push('DART_API_KEY 미설정 (DART 홈페이지 목록만 사용)');
  }

  // 2) 공식 접수 시각 (오늘 1페이지 + 과거 날짜 백필 1페이지)
  const applyTimes = (rows) => {
    for (const r of rows) {
      const id = 'DART-' + r.rcpNo;
      // 접수일은 접수번호 앞 8자리가 정확 (목록의 날짜 칸과 다르면 시각을 신뢰하지 않음)
      const rd = `${r.rcpNo.slice(0, 4)}-${r.rcpNo.slice(4, 6)}-${r.rcpNo.slice(6, 8)}`;
      if (r.date && r.date !== rd) continue;
      r.date = rd;
      const it = byId.get(id);
      if (it) {
        it.timeMin = `${r.date} ${r.time}`;
        if (!it.corpCode && r.corpCode) it.corpCode = r.corpCode;
        continue;
      }
      // 목록 API보다 홈페이지에 먼저 뜬 상장사 공시는 바로 추가
      if (!r.cls) continue;
      const cm = r.corpCode && corpMap[r.corpCode];
      upsert(toItem({ rcept_no: r.rcpNo, report_nm: r.report, corp_name: r.corpName, corp_code: r.corpCode, stock_code: cm ? cm[0] : null, corp_cls: r.cls, flr_nm: r.filer, rm: r.remark, rcept_dt: r.date.replace(/-/g, '') }), { timeMin: `${r.date} ${r.time}` });
    }
  };
  try {
    const today = kstDate(0, '.');
    // 오늘: 전체 목록 + 5%·임원 보고 목록(별도 메뉴) 첫 페이지
    applyTimes(await dartTimes(today, 1, ''));
    if (!light) applyTimes(await dartTimes(today, 2, '').catch(() => []));
    applyTimes(await dartTimes(today, 1, 'O'));
    // 백필: 시각이 비어 있는 날짜를 한 페이지씩 (전체 → 5%·임원 순)
    state.cursor = state.cursor || {};
    const missing = light ? [] : [...new Set([...byId.values()].filter((x) => !x.timeMin && x.date).map((x) => x.date))].sort().reverse();
    for (const d of missing.slice(0, 2)) {
      const group = (state.cursor[d + '|'] || 0) >= 99 ? 'O' : '';
      const ck = d + '|' + group;
      const cur = state.cursor[ck] || (d === kstDate(0) ? 2 : 1);
      if (cur >= 99) { for (const x of byId.values()) if (x.date === d && !x.timeMin) x.timeMin = 'na'; continue; }
      const more = await dartTimes(d.replace(/-/g, '.'), cur, group);
      applyTimes(more);
      state.cursor[ck] = more.length < 100 ? 99 : cur + 1;
      if (group === 'O' && more.length < 100) for (const x of byId.values()) if (x.date === d && !x.timeMin) x.timeMin = 'na';
      break;
    }
  } catch (e) {
    errors.push(e.message);
  }

  // 3) 정리: 최근 5일, 최대 2000건
  const cutoff = kstDate(-5);
  let items = [...byId.values()].filter((x) => (x.date || '') >= cutoff);
  items.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));
  items = items.slice(0, 2000);
  // 종목코드가 없는 상장사 공시 → DART 기업개황으로 종목코드 확인 (회사별 1회, 결과 기억)
  if (key && !light) {
    const need = [...new Set(items.filter((x) => !x.ticker && x.corpCode && !(x.corpCode in corpMap)).map((x) => x.corpCode))].slice(0, 15);
    for (const cc of need) {
      try {
        const r = await fetchWithTimeout(`https://opendart.fss.or.kr/api/company.json?crtfc_key=${encodeURIComponent(key)}&corp_code=${cc}`, {}, 6000);
        const j = await r.json();
        if (j.status === '000') corpMap[cc] = [j.stock_code && j.stock_code.trim() ? j.stock_code.trim() : null, j.corp_cls];
      } catch {}
    }
  }
  for (const x of items) {
    const cm = x.corpCode && corpMap[x.corpCode];
    if (!x.ticker && cm && cm[0]) x.ticker = cm[0];
    if (!x.exchange && cm && CLS[cm[1]]) x.exchange = CLS[cm[1]];
    if (x.name) x.name = x.name.replace(/\s+IR$/, '');
  }

  if (key && !light) await enrichDart(items, key, { max: 5 }).catch(() => {});
  for (const x of items) if (!x.titleClean) x.titleClean = cleanTitle(x.formKo);
  const docs = withDocs ? await enrichDocs(items, { max: 12, deadline: started + 23000 }).catch(() => 0) : 0;

  await setJSON('dart/feed', { updatedAt: new Date().toISOString(), errors, cursor: state.cursor || {}, items });
  await setJSON('dart/corpmap', corpMap);
  return { count: items.length, docs, errors, ms: Date.now() - started };
}
