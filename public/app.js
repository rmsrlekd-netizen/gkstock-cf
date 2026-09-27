/* GK 공시레이더 — 프런트엔드
 * 데이터는 전부 같은 사이트의 /api/* (Cloudflare Worker)에서 받아옵니다.
 *  /api/sec  /api/dart  미국·한국 공시 (30초)     /api/news  보도자료·뉴스 (60초)
 *  /api/market 시장 지표 (60초)  /api/views 인기 종목 (60초)  /api/flows 국내 수급 (3분, 수급 화면)
 *  /api/analyze AI 분석  /api/company 기업 정보  /api/doc 원문  /api/stock 종목 수급
 *  /api/quote 현재가  /api/digest AI 오늘의 핵심  /api/search 종목 검색
 */
(() => {
  'use strict';

  // ───────────────────────── 공통 ─────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function load(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  async function getJSON(url, opt) {
    const r = await fetch(url, opt || { cache: 'no-store' });
    let j = null;
    try { j = await r.json(); } catch {}
    if (!j) throw new Error(`HTTP ${r.status}`);
    if (!r.ok || j.ok === false) { const e = new Error(j.error || `HTTP ${r.status}`); e.data = j; throw e; }
    return j;
  }
  const isMobile = () => matchMedia('(max-width: 860px)').matches;

  // ───────────────────────── 상태 ─────────────────────────
  const S = {
    items: new Map(),            // id → 정규화된 항목 (공시·보도자료·뉴스 통합)
    raw: { sec: [], dart: [], news: [] },
    loaded: { sec: false, dart: false, news: false },
    errors: {}, updated: {},
    view: 'home', mk: 'ALL', type: 'ALL', theme: null, q: '', sort: 'time', limit: 120,
    sel: null,
    ai: new Map(), co: new Map(), doc: new Map(), stock: new Map(), quotes: new Map(),
    market: null, flows: null, views: null,
    flowTab: load('gk_flowtab', 'usInsider'), flowSide: 'buy', insiderSide: 'all',
    watch: load('gk_watch2', []),            // [{m:'US', t:'NVDA', n:'NVIDIA'}]
    sound: load('gk_sound', false), notify: load('gk_notify', false), fs: load('gk_fs', 'fs-l'),
    bell: [], bellUnread: 0, fresh: new Set(), booted: false,
  };
  document.documentElement.className = S.fs;
  const wkey = (m, t) => `${m}:${String(t || '').toUpperCase()}`;
  const inWatch = (m, t) => !!t && S.watch.some((w) => wkey(w.m, w.t) === wkey(m, t));

  // ───────────────────────── 포맷 ─────────────────────────
  const partsOf = (d, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  function fmtDT(d, tz = 'Asia/Seoul') {
    const p = partsOf(d, tz);
    const hh = String(+p.hour % 24).padStart(2, '0');
    return { date: `${p.year}.${p.month}.${p.day}`, md: `${p.month}.${p.day}`, hm: `${hh}:${p.minute}`, s: p.second, full: `${p.year}.${p.month}.${p.day} ${hh}:${p.minute}:${p.second}` };
  }
  const kstDay = (d = new Date()) => fmtDT(d).date;
  function rel(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86400)}일 전`;
  }
  function fmtPx(p, dp) {
    if (p === null || p === undefined || Number.isNaN(p)) return '—';
    if (dp !== undefined) return p.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    if (Math.abs(p) >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    return p.toFixed(2);
  }
  const fmtPct = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
  const dirCls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const fmtInt = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('ko-KR'));
  const signedInt = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('ko-KR')}`);
  function fmtBig(n) {
    if (n === null || n === undefined) return '—';
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e12) return s + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + (a / 1e3).toFixed(0) + 'K';
    return s + a.toFixed(0);
  }
  const usd = (n) => (n === null || n === undefined ? '—' : '$' + fmtBig(n));
  const titleCase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  function money(v, cur) {
    if (v === null || v === undefined) return '—';
    if (cur === 'KRW') {
      const a = Math.abs(v), s = v < 0 ? '-' : '';
      if (a >= 1e12) return s + (a / 1e12).toFixed(a >= 1e14 ? 0 : a >= 1e13 ? 1 : 2).replace(/\.0+$/, '') + '조원';
      if (a >= 1e8) return s + Math.round(a / 1e8).toLocaleString('ko-KR') + '억원';
      return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만원';
    }
    return (v < 0 ? '-$' : '$') + fmtBig(Math.abs(v));
  }
  const pxStr = (q) => (!q ? '—' : q.cur === 'KRW' ? `${fmtInt(q.price)}원` : `$${fmtPx(q.price)}`);

  // ───────────────────────── 로고 ─────────────────────────
  const hue = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  function monogram(m, t, n) {
    if (m === 'KR') return (n || t || '?').replace(/^\(주\)|㈜|주식회사/g, '').trim().slice(0, 2);
    return (t || n || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
  }
  function logoSrcs(m, t) {
    t = String(t || '').toUpperCase();
    if (!t) return [];
    if (m === 'KR') {
      if (!/^[0-9A-Z]{6}$/.test(t)) return [];
      return [`/api/logo?m=KR&t=${t}`, `https://static.toss.im/png-icons/securities/icn-sec-fill-${t}.png`, `https://file.alphasquare.co.kr/media/images/stock_logo/kr/${t}.png`];
    }
    const d = encodeURIComponent(t.replace(/[./]/g, '-'));
    return [`/api/logo?m=US&t=${encodeURIComponent(t)}`, `https://images.financialmodelingprep.com/symbol/${d}.png`, `https://assets.parqet.com/logos/symbol/${encodeURIComponent(t)}?format=png`];
  }
  function logoHTML(m, t, n, size = '', news = false) {
    const mono = monogram(m, t, n);
    if (news && !t) return `<div class="logo-b news ${size}"><span class="mm">${esc(n || 'NEWS')}</span></div>`;
    const srcs = logoSrcs(m, t);
    const mk = `hsl(${hue(t || n)} 35% 32%)`;
    if (!srcs.length) return `<div class="logo-b fb ${size}" style="--mk:${mk}"><span class="mm">${esc(mono)}</span></div>`;
    return `<div class="logo-b ${size}" data-mono="${esc(mono)}" style="--mk:${mk}"><img src="${srcs[0]}" data-alt="${srcs.slice(1).join('|')}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>`;
  }
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.parentElement?.classList.contains('logo-b')) return;
    const rest = (img.dataset.alt || '').split('|').filter(Boolean);
    if (rest.length) { img.dataset.alt = rest.slice(1).join('|'); img.src = rest[0]; return; }
    const box = img.parentElement;
    box.classList.add('fb');
    box.innerHTML = `<span class="mm">${esc(box.dataset.mono || '?')}</span>`;
  }, true);
  document.addEventListener('load', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.parentElement?.classList.contains('logo-b') && img.naturalWidth > 0 && img.naturalWidth < 8) img.dispatchEvent(new Event('error'));
  }, true);

  // ───────────────────────── 공시 제목 (SEC·DART) ─────────────────────────
  function personName(n) {
    const s = String(n || '').trim();
    if (!s) return '';
    if (/\b(LLC|L\.?P\.?|INC|CORP|FUND|TRUST|CAPITAL|PARTNERS|HOLDINGS|MANAGEMENT|GROUP|LTD|ADVISORS?|INVESTMENTS?|BANK|CO|HATHAWAY|FOUNDATION|ASSOCIATES)\b/i.test(s)) return titleCase(s);
    const p = s.replace(/,/g, '').split(/\s+/);
    return p.length >= 2 ? titleCase([...p.slice(1), p[0]].join(' ')) : titleCase(s);
  }
  function roleShort(rel) {
    const r = String(rel || '');
    const rules = [[/Chief Executive|\bCEO\b/i, 'CEO'], [/Chief Financial|\bCFO\b/i, 'CFO'], [/Chief Operating|\bCOO\b/i, 'COO'], [/Chief Technology|\bCTO\b/i, 'CTO'], [/Chair(man|woman|person)?\b/i, '회장'], [/General Counsel|Chief Legal/i, '법무책임자'], [/\bEVP\b|Executive Vice President/i, 'EVP'], [/\bSVP\b|Senior Vice President/i, 'SVP'], [/Vice President|\bVP\b/i, '부사장'], [/\bPresident\b/i, '사장'], [/Chief [A-Za-z]+ Officer/i, '임원'], [/10% 주주/, '10% 대주주'], [/이사/, '이사'], [/임원/, '임원']];
    for (const [re, label] of rules) if (re.test(r)) return label;
    return '';
  }
  const RM = { 유: '유가증권', 코: '코스닥', 넥: '코넥스', 연: '연결', 정: '정정', 철: '철회', 공: '공정위' };
  function secHead(it) {
    const m = it.tx?.main;
    if (m && m.shares) { const role = roleShort(it.tx.relation); return `${role ? role + ' ' : ''}${personName(it.tx.owner)} ${m.label} ${fmtInt(m.shares)}주${m.value ? ` (${usd(m.value)})` : ''}`; }
    if (it.ko?.title) return it.ko.title;
    if (it.pr?.headline) return it.pr.headline;
    if (it.items?.length) return it.items.map((x) => x.ko).join(' · ');
    if (/^13F/i.test(it.form)) return '분기 포트폴리오 공개 (13F)';
    if (/^144/.test(it.form)) return `${it.party ? personName(it.party) + ' ' : ''}보유주식 매도 예정 신고 (Form 144)`;
    if (it.category === 'inst' && it.party) return `${personName(it.party)} — ${/13D/.test(it.form) ? '지분 5% 이상 취득 (경영참여 목적)' : '지분 5% 이상 보유 (단순투자)'}`;
    if (it.category === 'insider' && it.party) return `${personName(it.party)} 내부자 거래 신고`;
    if (it.category === 'periodic') return ({ '10-Q': '분기보고서(10-Q) 제출', '10-K': '연간보고서(10-K) 제출', '20-F': '연간보고서(20-F) 제출' }[it.form.replace(/\/A$/, '')] || it.formKo + ' 제출');
    if (it.category === 'offering') return /^424B/.test(it.form) ? '신주·채권 발행 확정 (투자설명서) — 지분 희석 주의' : /^(S-1|F-1)/.test(it.form) ? '공모·상장 증권신고서 제출' : /^(S-3|F-3)/.test(it.form) ? '증자용 일괄신고서 제출 — 향후 발행 가능' : it.formKo;
    return it.formKo || it.form;
  }
  function secSub(it) {
    if (it.tx) { const t = it.tx; return [t.relation, t.main?.price ? `평균 $${fmtPx(t.main.price)}` : '', t.after ? `거래 후 ${fmtInt(t.after)}주` : '', t.tenb51 ? '10b5-1 사전계획' : ''].filter(Boolean).join(' · '); }
    const kinds = (it.items || []).map((x) => x.ko).join(' · ');
    if (it.ko?.sub) return [it.ko.sub, kinds].filter(Boolean).join(' · ');
    if (it.pr?.deck && !it.ko) return it.pr.deck;
    if (it.ko?.title || it.pr?.headline) return [kinds, it.form].filter(Boolean).join(' · ');
    if (it.pr?.itemText) return it.pr.itemText;
    return [it.form, it.party ? personName(it.party) : ''].filter(Boolean).join(' · ');
  }
  function dartHead(it) {
    const d = it.detail;
    if (d && d.change !== null && d.change !== undefined && it.category === 'insider') return `${d.role ? d.role + ' ' : ''}${d.who || ''} ${d.change > 0 ? '매수' : d.change < 0 ? '매도' : '변동'} ${fmtInt(Math.abs(d.change))}주${d.shares !== null && d.shares !== undefined ? ` (보유 ${fmtInt(d.shares)}주)` : ''}`;
    if (d && it.category === 'inst' && d.rate !== null && d.rate !== undefined) { const rc = d.rateChange; return `${d.who || '보고자'} 지분 ${d.rate}%${rc ? ` (${rc > 0 ? '+' : ''}${rc}%p)` : ''}${d.reason ? ' · ' + d.reason.slice(0, 20) : ''}`; }
    if (it.summary?.title) return it.summary.title;
    return it.titleClean || it.formKo;
  }
  function dartSub(it) {
    if (it.summary?.sub) return it.summary.sub;
    const d = it.detail;
    if (d && it.category === 'inst') return [d.role, d.change ? `보유 ${fmtInt(d.shares)}주 (${signedInt(d.change)}주)` : '', it.titleClean].filter(Boolean).join(' · ');
    if (d) return `${it.titleClean}${d.rate !== null && d.rate !== undefined ? ` · 지분율 ${d.rate}%` : ''}`;
    if (it.summary?.title) return it.titleClean;
    const rm = [...(it.remark || '')].map((c) => RM[c]).filter(Boolean).join(' · ');
    return [it.party ? `제출인 ${it.party}` : '', rm].filter(Boolean).join(' · ') || 'DART 전자공시';
  }
  function dartWhen(it) {
    const seen = it.seenAt ? Date.parse(it.seenAt) : null;
    if (it.timeMin && it.timeMin !== 'na') {
      const off = Date.parse(it.timeMin.replace(' ', 'T') + ':00+09:00');
      const ms = it.seenLive && seen && seen - off >= 0 && seen - off < 120e3 ? seen : off + 59e3;
      return { ms, official: it.timeMin, seen: it.seenLive ? seen : null };
    }
    if (it.seenLive && seen) return { ms: seen, seen };
    return { ms: Date.parse(`${it.date}T18:00:00+09:00`) || 0, dateOnly: true };
  }

  // ───────────────────────── 테마·호재/악재 자동 분류 ─────────────────────────
  const THEME_LABEL = { earnings: '실적', bio: '임상/FDA', deal: '계약/M&A', offering: '증자/희석', insider: '내부자', inst: '기관', other: '기타' };
  const RE = {
    bio: /FDA|임상|Phase\s?[123I]|clinical|trial|허가|신약|치료제|BLA|NDA|IND\b|topline|바이오시밀러|Breakthrough/i,
    earnings: /실적|earnings|revenue|매출|영업이익|순이익|quarter(ly)? results|EPS|guidance|가이던스|financial results|분기|reports (first|second|third|fourth)/i,
    deal: /계약|contract|agreement|acquisi|acquire|merger|인수|합병|M&A|partnership|수주|공급|제휴|협약|MOU|collaborat|license|기술이전|tender offer|공개매수|양수|양도/i,
    offering: /유상증자|전환사채|신주인수권|교환사채|\bCB\b|\bBW\b|offering|dilut|warrant|private placement|at-the-market|shelf|증권신고서|감자/i,
  };
  const POS_RE = /흑자\s?전환|최대\s?(실적|매출)|사상\s?최대|상향|수주|공급계약|자기주식\s?(취득|소각)|자사주\s?(매입|취득|소각)|주식\s?소각|무상증자|현금ㆍ?·?배당|배당\s?결정|승인|허가|급등|상승|신고가|호실적|beat|raise[sd]? guidance|record|approv|award|wins?\b|launch|breakthrough|surge|soar|jump|upgrade|buyback|repurchase|partnership|성장|증가|개선|돌파|체결/i;
  const NEG_RE = /적자|감소|하향|유상증자|전환사채|신주인수권|소송|횡령|배임|거래정지|상장폐지|관리종목|불성실|감자|회생|부도|철회|취소|해지|급락|하락|약세|신저가|lawsuit|litigation|delist|miss(es|ed)?\b|lower(s|ed)? guidance|offering|dilut|going concern|default|bankrupt|investigation|recall|downgrade|plunge|tumble|halt|layoff|decline|net loss|warning|하회|우려|부진|악화/i;

  function classify(n) {
    const r = n.raw, text = `${n.head} ${n.sub} ${n.orig || ''}`;
    let theme = 'other';
    if (n.src === 'SEC') {
      const codes = (r.items || []).map((x) => x.code);
      if (r.category === 'earnings') theme = 'earnings';
      else if (r.category === 'offering') theme = 'offering';
      else if (r.category === 'insider') theme = 'insider';
      else if (r.category === 'inst') theme = 'inst';
      else if (codes.some((c) => ['1.01', '2.01', '1.02'].includes(c))) theme = 'deal';
    } else if (n.src === 'DART') {
      if (r.category === 'earnings') theme = 'earnings';
      else if (r.category === 'offering') theme = 'offering';
      else if (r.category === 'insider') theme = 'insider';
      else if (r.category === 'inst') theme = 'inst';
    }
    if (theme === 'other') {
      if (RE.bio.test(text)) theme = 'bio';
      else if (RE.offering.test(text)) theme = 'offering';
      else if (RE.earnings.test(text)) theme = 'earnings';
      else if (RE.deal.test(text)) theme = 'deal';
    }
    // 호재·악재
    let sent = null;
    const code = r.tx?.main?.code;
    if (code === 'P') sent = 'pos'; else if (code === 'S') sent = 'neg';
    else if (n.src === 'DART' && r.category === 'insider' && r.detail?.change) sent = r.detail.change > 0 ? 'pos' : 'neg';
    else if (theme === 'offering') sent = 'neg';
    else {
      const p = POS_RE.test(text), g = NEG_RE.test(text);
      sent = p && !g ? 'pos' : g && !p ? 'neg' : null;
    }
    n.theme = theme; n.sent = sent;
    // 중요도
    let imp = r.impact ?? (n.kind === 'PR' ? (n.ticker ? 3 : 2) : n.ticker ? 3 : 2);
    if (n.kind !== 'FILING' && ['earnings', 'bio', 'deal'].includes(theme) && n.ticker) imp = Math.max(imp, 4);
    n.impact = imp;
  }

  // ───────────────────────── 정규화 ─────────────────────────
  function normSec(r) {
    const ms = Date.parse(r.time) || 0;
    const n = { id: r.id, kind: 'FILING', src: 'SEC', market: 'US', ticker: r.ticker, name: r.name ? titleCase(r.name).replace(/\b(Inc|Corp|Ltd|Plc|Co|Llc)\b\.?/g, (m) => m) : r.ticker, exchange: r.exchange, ms, exact: true, url: r.url, raw: r, form: r.form };
    n.head = secHead(r); n.sub = secSub(r);
    n.orig = r.ko?.title && r.pr?.headline ? r.pr.headline : null;
    n.cls = r.tx?.main?.code === 'P' ? 'buy' : r.tx?.main?.code === 'S' ? 'sell' : '';
    n.kindLabel = r.form;
    classify(n);
    return n;
  }
  function normDart(r) {
    const w = dartWhen(r);
    const n = { id: r.id, kind: 'FILING', src: 'DART', market: 'KR', ticker: r.ticker, name: r.name, exchange: r.exchange, corpCode: r.corpCode, ms: w.ms, when: w, url: r.url, raw: r, form: r.formKo };
    n.head = dartHead(r); n.sub = dartSub(r);
    n.orig = n.head !== (r.titleClean || r.formKo) ? (r.titleClean || r.formKo) : null;
    n.cls = r.category === 'insider' && r.detail?.change ? (r.detail.change > 0 ? 'buy' : 'sell') : '';
    n.kindLabel = { earnings: '실적', current: '수시공시', offering: '증자·희석', insider: '임원지분', inst: '5% 지분', periodic: '정기보고서' }[r.category] || '공시';
    classify(n);
    return n;
  }
  function normNews(r) {
    const n = { id: r.id, kind: r.src === 'PR' ? 'PR' : 'NEWS', src: r.src, market: r.market || 'US', ticker: r.ticker, name: r.company || r.ticker || r.source, corpCode: r.corpCode, ms: Date.parse(r.time) || 0, exact: true, url: r.url, raw: r, source: r.source };
    n.head = r.titleKo || r.title;
    n.orig = r.titleKo ? r.title : null;
    n.sub = r.desc ? r.desc.slice(0, 160) : '';
    n.cls = '';
    n.kindLabel = n.kind === 'PR' ? '보도자료' : '뉴스';
    classify(n);
    return n;
  }
  function applyAI(n) {
    const a = S.ai.get(n.id);
    if (a && !a.fallback) n.sent = a.verdict === '긍정' ? 'pos' : a.verdict === '부정' ? 'neg' : null, n.aiDone = true;
  }

  function rebuild() {
    const prev = S.items;
    const next = new Map();
    for (const r of S.raw.sec) next.set(r.id, normSec(r));
    for (const r of S.raw.dart) next.set(r.id, normDart(r));
    for (const r of S.raw.news) if (!next.has(r.id)) next.set(r.id, normNews(r));
    next.forEach(applyAI);
    const fresh = [];
    if (S.booted) for (const [id, n] of next) if (!prev.has(id) && Date.now() - n.ms < 3 * 3600e3) fresh.push(n);
    S.items = next;
    if (fresh.length) onFresh(fresh);
  }

  // ───────────────────────── 필터 ─────────────────────────
  function baseFilter(n, { ignoreType = false, ignoreTheme = false } = {}) {
    if (S.mk !== 'ALL' && n.market !== S.mk) return false;
    if (!ignoreType && S.type !== 'ALL' && n.kind !== S.type) return false;
    if (S.view === 'watch' && !inWatch(n.market, n.ticker)) return false;
    if (!ignoreTheme && S.theme) {
      const t = S.theme;
      if (t === 'major' && !(n.impact >= 4)) return false;
      else if (t === 'pos' && n.sent !== 'pos') return false;
      else if (t === 'neg' && n.sent !== 'neg') return false;
      else if (t === 'pr' && n.kind !== 'PR') return false;
      else if (THEME_LABEL[t] && n.theme !== t) return false;
    }
    if (S.q) {
      const hay = `${n.ticker || ''} ${n.name || ''} ${n.head} ${n.sub} ${n.orig || ''} ${n.form || ''} ${n.source || ''}`.toLowerCase();
      if (!S.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }
  function visible() {
    const arr = [...S.items.values()].filter((n) => baseFilter(n));
    if (S.sort === 'impact') arr.sort((a, b) => b.impact - a.impact || (b.sent === 'pos') - (a.sent === 'pos') || b.ms - a.ms);
    else arr.sort((a, b) => b.ms - a.ms);
    return arr;
  }

  // ───────────────────────── 렌더: 행 ─────────────────────────
  const SRC_BADGE = { SEC: ['sec', 'SEC'], DART: ['dart', 'DART'], PR: ['pr', '보도자료'], NEWS: ['news', '뉴스'] };
  function timeHTML(n) {
    if (n.src === 'DART' && n.when) {
      const w = n.when;
      if (w.official) { const [d, hm] = w.official.split(' '); const s = w.seen ? fmtDT(new Date(w.seen)).s : null; return `<div class="r-time" title="DART 공식 접수 ${esc(w.official)}${w.seen ? ' / 수집 ' + fmtDT(new Date(w.seen)).full : ''}">${hm}${s ? `:${s}` : ''}<small>${d.slice(5).replace('-', '.')}</small></div>`; }
      if (w.seen) { const k = fmtDT(new Date(w.seen)); return `<div class="r-time" title="수집 ${k.full}">${k.hm}:${k.s}<small>${k.md}</small></div>`; }
      return `<div class="r-time">--:--<small>${esc((n.raw.date || '').slice(5).replace('-', '.'))}</small></div>`;
    }
    const k = fmtDT(new Date(n.ms));
    const title = n.src === 'SEC' ? `SEC 접수 ${k.full} KST / ${fmtDT(new Date(n.ms), 'America/New_York').full} ET` : `${k.full} KST`;
    return `<div class="r-time" title="${title}">${k.hm}:${k.s}<small>${k.md} · ${rel(n.ms)}</small></div>`;
  }
  function tagsHTML(n, max = 4, noKind = false) {
    const t = [];
    const kc = n.kind === 'FILING' ? 'k-f' : n.kind === 'PR' ? 'k-p' : 'k-n';
    if (!noKind) t.push(`<span class="tag ${kc}">${n.kind === 'FILING' ? '공시' : n.kind === 'PR' ? '보도자료' : '뉴스'}</span>`);
    if (n.impact >= 5) t.push('<span class="tag imp">중요</span>');
    if (n.sent === 'pos') t.push('<span class="tag pos">호재</span>');
    if (n.sent === 'neg') t.push('<span class="tag neg">악재</span>');
    if (n.theme !== 'other') t.push(`<span class="tag th">${THEME_LABEL[n.theme]}</span>`);
    if (n.aiDone) t.push('<span class="tag ai">AI</span>');
    return t.slice(0, max).join('');
  }
  function starHTML(n) {
    if (!n.ticker) return '';
    const on = inWatch(n.market, n.ticker);
    return `<button class="star ${on ? 'on' : ''}" data-star="${esc(n.market)}|${esc(n.ticker)}|${esc(n.name || '')}" title="관심종목">${on ? '★' : '☆'}</button>`;
  }
  function rowHTML(n) {
    const [sc, sl] = SRC_BADGE[n.src];
    const cls = ['row', S.sel === n.id ? 'sel' : '', S.fresh.has(n.id) ? 'fresh' : ''].join(' ');
    const news = n.kind === 'NEWS' && !n.ticker;
    return `<article class="${cls}" data-id="${esc(n.id)}">
      ${logoHTML(n.market, n.ticker, news ? (n.source || '뉴스').slice(0, 4) : n.name, '', news)}
      <div class="r-main">
        <div class="r-top">${n.ticker ? `<span class="tk">${esc(n.market === 'KR' ? n.name || n.ticker : n.ticker)}</span>` : ''}${n.ticker && n.market === 'US' && n.name ? `<span class="co">${esc(n.name)}</span>` : ''}<span>${n.market === 'KR' ? '🇰🇷' : '🇺🇸'}</span><span class="src ${sc}">${sl}</span>${n.source && n.kind !== 'FILING' ? `<span>${esc(n.source)}</span>` : n.kindLabel && n.kind === 'FILING' ? `<span>${esc(n.kindLabel)}</span>` : ''}</div>
        <div class="r-head ${n.cls}">${esc(n.head)}</div>
        ${n.sub ? `<div class="r-sub">${esc(n.sub)}</div>` : ''}
      </div>
      <div class="r-side">${timeHTML(n)}<div class="tags">${tagsHTML(n)}</div>${starHTML(n)}</div>
    </article>`;
  }

  // ───────────────────────── 렌더: 피드·통계·사이드 ─────────────────────────
  const anyLoaded = () => S.loaded.sec || S.loaded.dart || S.loaded.news;
  function renderFeed() {
    const list = $('#list');
    if (!anyLoaded()) { list.innerHTML = Array.from({ length: 8 }, () => '<div class="skel"></div>').join(''); return; }
    const arr = visible();
    if (!arr.length) {
      const errs = Object.entries(S.errors).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()}: ${v}`);
      list.innerHTML = S.view === 'watch' && !S.watch.length
        ? '<div class="empty">관심종목이 없습니다.<br>목록의 ☆ 또는 상세 창의 ☆를 눌러 추가하세요.</div>'
        : `<div class="empty">조건에 맞는 항목이 없습니다.${errs.length ? `<br><small>${esc(errs.join(' / '))}</small>` : ''}</div>`;
    } else {
      list.innerHTML = arr.slice(0, S.limit).map(rowHTML).join('') + (arr.length > S.limit ? `<button class="btn more-btn" id="moreRows">더 보기 (${fmtInt(arr.length - S.limit)}건)</button>` : '');
    }
    renderCounts();
  }
  function renderCounts() {
    const c = { ALL: 0, FILING: 0, PR: 0, NEWS: 0 };
    for (const n of S.items.values()) if (baseFilter(n, { ignoreType: true })) { c.ALL++; c[n.kind]++; }
    for (const k in c) $('#c' + k).textContent = fmtInt(c[k]);
    // 테마 사이드바
    const T = [['major', '📌 시장 주요'], ['pos', '📈 호재'], ['neg', '📉 악재'], ['earnings', '💰 실적'], ['bio', '💊 임상/FDA'], ['deal', '🤝 계약/M&A'], ['offering', '🧾 증자/희석'], ['insider', '👤 내부자'], ['inst', '🏦 기관'], ['pr', '📄 보도자료']];
    const tc = {};
    for (const n of S.items.values()) {
      if (!baseFilter(n, { ignoreTheme: true })) continue;
      if (n.impact >= 4) tc.major = (tc.major || 0) + 1;
      if (n.sent) tc[n.sent] = (tc[n.sent] || 0) + 1;
      tc[n.theme] = (tc[n.theme] || 0) + 1;
      if (n.kind === 'PR') tc.pr = (tc.pr || 0) + 1;
    }
    $('#themes').innerHTML = T.map(([k, l]) => `<li data-theme="${k}" class="${S.theme === k ? 'on' : ''}"><span>${l}</span><i>${fmtInt(tc[k] || 0)}</i></li>`).join('');
  }
  function renderStats() {
    const today = kstDay();
    const hourAgo = Date.now() - 3600e3;
    const c = { SEC: [0, 0], DART: [0, 0], PR: [0, 0], NEWS: [0, 0] };
    for (const n of S.items.values()) {
      const k = n.src;
      if (fmtDT(new Date(n.ms)).date === today || (n.src === 'DART' && (n.raw.date || '').replace(/-/g, '.') === today)) c[k][0]++;
      if (n.ms > hourAgo) c[k][1]++;
    }
    for (const k in c) {
      $('#st' + k).textContent = S.loaded[k === 'SEC' ? 'sec' : k === 'DART' ? 'dart' : 'news'] ? fmtInt(c[k][0]) + '건' : '–';
      $('#st' + k + 'd').textContent = c[k][1] ? `최근 1시간 +${c[k][1]}` : '';
    }
    $$('.stat').forEach((b) => b.classList.toggle('on', statActive(b.dataset.stat)));
  }
  function statActive(k) {
    if (k === 'SEC') return S.type === 'FILING' && S.mk === 'US';
    if (k === 'DART') return S.type === 'FILING' && S.mk === 'KR';
    return S.type === k && S.mk === 'ALL';
  }
  function syncControls() {
    $$('#mkSeg button, #mkSeg2 button').forEach((b) => b.classList.toggle('on', b.dataset.mk === S.mk));
    $$('#typeChips button').forEach((b) => b.classList.toggle('on', b.dataset.type === S.type));
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.type === S.type));
    $$('#themeChips button').forEach((b) => b.classList.toggle('on', b.dataset.theme === S.theme));
    $('#sortSel').value = S.sort;
    const t = { ALL: '실시간 공시 & 뉴스', FILING: '실시간 공시', PR: '기업 보도자료', NEWS: '주요 뉴스' }[S.type];
    $('#feedTitle').textContent = S.view === 'watch' ? '관심종목 공시 & 뉴스' : S.q ? `"${S.q}" 검색 결과` : t;
    renderWatchbar();
  }
  function renderAll() { syncControls(); renderFeed(); renderStats(); }

  function renderWatchbar() {
    const bar = $('#watchbar');
    if (S.view !== 'watch' && !S.q) { bar.hidden = true; return; }
    bar.hidden = false;
    if (S.q && S.view !== 'watch') { bar.innerHTML = `<span class="muted">검색어</span><span class="wchip">${esc(S.q)}<button data-clear-q title="검색 해제">✕</button></span>`; return; }
    if (!S.watch.length) { bar.innerHTML = '<span class="muted">관심종목이 없습니다. 목록이나 상세 창의 ☆를 눌러 추가하세요.</span>'; return; }
    bar.innerHTML = S.watch.map((w) => {
      const q = S.quotes.get(wkey(w.m, w.t));
      return `<span class="wchip" data-open-co="${esc(w.m)}|${esc(w.t)}|${esc(w.n || '')}">${esc(w.m === 'KR' ? w.n || w.t : w.t)}${q ? ` <span class="${dirCls(q.pct)} mono">${fmtPct(q.pct)}</span>` : ''}<button data-unwatch="${esc(w.m)}|${esc(w.t)}" title="삭제">✕</button></span>`;
    }).join('');
    fetchQuotes(S.watch.map((w) => wkey(w.m, w.t))).then((changed) => { if (changed && S.view === 'watch') renderWatchbar(); });
  }

  // ───────────────────────── 현재가 ─────────────────────────
  async function fetchQuotes(keys) {
    const need = [...new Set(keys)].filter((k) => { const q = S.quotes.get(k); return !q || Date.now() - q._at > 60e3; }).slice(0, 10);
    if (!need.length) return false;
    need.forEach((k) => S.quotes.set(k, { ...(S.quotes.get(k) || {}), _at: Date.now() }));
    try {
      const j = await getJSON(`/api/quote?list=${encodeURIComponent(need.join(','))}`, {});
      for (const [k, v] of Object.entries(j.quotes || {})) if (v) S.quotes.set(k.toUpperCase(), { ...v, _at: Date.now() });
      return true;
    } catch { return false; }
  }
  const quoteOf = (m, t) => { const q = S.quotes.get(wkey(m, t)); return q && q.price !== undefined ? q : null; };

  // ───────────────────────── 데이터: 공시·뉴스 ─────────────────────────
  async function poll(kind) {
    if (document.hidden && S.booted) return;
    try {
      const j = await getJSON(`/api/${kind}`);
      S.raw[kind] = j.items || [];
      S.errors[kind] = (j.errors || []).length && !(j.items || []).length ? j.errors.join(' / ') : null;
      S.updated[kind] = j.updatedAt || new Date().toISOString();
    } catch (e) { S.errors[kind] = e.message; }
    S.loaded[kind] = true;
    rebuild();
    if (['home', 'filings', 'pr', 'news', 'watch'].includes(S.view)) { renderFeed(); renderStats(); }
    if (S.view === 'flows' && ['usInsider', 'usInst', 'krInsider'].includes(S.flowTab)) renderFlows();
    if (S.view === 'company' && S.coCur) renderCoRecent();
    if (!S.booted && S.loaded.sec && S.loaded.dart && S.loaded.news) {
      S.booted = true;
      const m = location.hash.match(/^#item\/(.+)$/);
      if (m && S.items.has(decodeURIComponent(m[1]))) openItem(decodeURIComponent(m[1]));
    }
  }

  // ───────────────────────── 알림 (종 모양) ─────────────────────────
  let actx = null;
  function chime(strong) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;
      (strong ? [880, 1320] : [990]).forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.35);
        o.connect(g).connect(actx.destination);
        o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.4);
      });
    } catch {}
  }
  function onFresh(fresh) {
    fresh.forEach((n) => S.fresh.add(n.id));
    setTimeout(() => fresh.forEach((n) => S.fresh.delete(n.id)), 4000);
    const imp = fresh.filter((n) => n.impact >= 4 || inWatch(n.market, n.ticker));
    if (!imp.length) return;
    S.bell = [...imp.map((n) => ({ id: n.id, at: Date.now() })), ...S.bell].slice(0, 50);
    S.bellUnread += imp.length;
    $('#bellDot').hidden = false;
    if (S.sound) chime(imp.some((n) => n.impact >= 5 || inWatch(n.market, n.ticker)));
    if (S.notify && 'Notification' in window && Notification.permission === 'granted') {
      imp.filter((n) => inWatch(n.market, n.ticker) || n.impact >= 5).slice(0, 3).forEach((n) => {
        try { const x = new Notification(`${n.ticker || ''} ${n.name || ''}`.trim(), { body: n.head, tag: n.id }); x.onclick = () => { window.focus(); openItem(n.id); }; } catch {}
      });
    }
  }
  function renderBell() {
    const p = $('#bellPanel');
    const rows = S.bell.map((b) => S.items.get(b.id)).filter(Boolean);
    p.innerHTML = `<h4>알림 <button class="link" data-close-bell>닫기 ✕</button></h4>
      <div class="set-row"><div>알림음<small>중요 공시·관심종목 소식이 오면 소리</small></div><input type="checkbox" class="tg" data-set="sound" ${S.sound ? 'checked' : ''}></div>
      <div class="set-row"><div>데스크톱 알림<small>관심종목·매우 중요한 항목</small></div><input type="checkbox" class="tg" data-set="notify" ${S.notify ? 'checked' : ''}></div>
      ${rows.length ? rows.map((n) => `<div class="al" data-id="${esc(n.id)}"><b>${esc(n.market === 'KR' ? n.name : n.ticker || n.name || '')}</b> ${esc(n.head)}<small>${fmtDT(new Date(n.ms)).full} · ${n.kind === 'FILING' ? '공시' : n.kind === 'PR' ? '보도자료' : '뉴스'}</small></div>`).join('')
        : '<div class="empty" style="padding:1.5rem 0">이 창을 연 뒤 새로 들어온 중요 공시·관심종목 소식이 여기에 쌓입니다.</div>'}`;
  }

  // ───────────────────────── 시장 지표 ─────────────────────────
  const FG_KO = { 'extreme fear': '극단적 공포', fear: '공포', neutral: '중립', greed: '탐욕', 'extreme greed': '극단적 탐욕' };
  const fgColor = (v) => (v < 25 ? '#ef4444' : v < 45 ? '#f59e0b' : v <= 55 ? '#9aa3b5' : v <= 75 ? '#4ade80' : '#22c55e');
  function gaugeSVG(score) {
    const cx = 64, cy = 66, r = 54;
    const pt = (v) => { const a = Math.PI * (1 - v / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
    const seg = (a, b, c) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${c}" stroke-width="9" fill="none" opacity=".9"/>`; };
    const segs = [[0, 24.5, '#ef4444'], [25.5, 44.5, '#f59e0b'], [45.5, 54.5, '#6b7385'], [55.5, 74.5, '#4ade80'], [75.5, 100, '#22c55e']].map((s) => seg(...s)).join('');
    const a = Math.PI * (1 - (score ?? 50) / 100);
    const nx = cx + (r - 14) * Math.cos(a), ny = cy - (r - 14) * Math.sin(a);
    return `<svg viewBox="0 0 128 74">${segs}<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#e9eef8" stroke-width="2.5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="4.5" fill="#e9eef8" stroke="none"/></svg>`;
  }
  function idxFmt(x) {
    const px = x.unit === '%' ? x.price.toFixed(3) + '%' : fmtPx(x.price);
    const ch = x.unit === '%' ? `${x.chg > 0 ? '+' : ''}${(x.chg * 100).toFixed(1)}bp` : fmtPct(x.pct);
    return { px, ch, dir: dirCls(x.pct ?? x.chg) };
  }
  function nightInfo() {
    const m = S.market, n = m?.night, ewy = m?.ewy?.price ? m.ewy : null;
    if (n && n.ok) return { label: n.session === 'night' ? 'K200 야간선물' : 'K200 선물', price: fmtPx(n.price), pct: n.pct, chg: n.chg, note: n.note };
    if (ewy) return { label: 'EWY(한국 ETF)', price: '$' + fmtPx(ewy.price), pct: ewy.pct, chg: ewy.chg, ewy: true };
    return null;
  }
  function renderTape() {
    const m = S.market;
    const parts = [];
    const fg = m?.fearGreed;
    if (fg && !fg.error) parts.push(`<span class="tp" data-view="market"><b>공포·탐욕</b><span style="color:${fgColor(fg.score)}">${fg.score}</span><em style="color:${fgColor(fg.score)}">${FG_KO[fg.rating] || fg.rating}</em></span>`);
    const ni = nightInfo();
    if (ni) parts.push(`<span class="tp" data-view="market"><b>${ni.label}</b><span>${ni.price}</span><em class="${dirCls(ni.pct)}">${fmtPct(ni.pct)}</em></span>`);
    for (const x of m?.indices || []) {
      if (x.error || x.price === null || x.price === undefined) continue;
      const f = idxFmt(x);
      parts.push(`<span class="tp" data-view="market"><b>${esc(x.label)}</b><span>${f.px}</span><em class="${f.dir}">${f.ch}</em></span>`);
    }
    $('#tapeIn').innerHTML = parts.length ? parts.join('') : `<span class="tp"><b>${m ? '시장 지표를 불러오지 못했습니다' : '시장 지표 불러오는 중…'}</b></span>`;
  }
  function renderMarket() {
    const m = S.market;
    const fg = m?.fearGreed;
    if (fg && !fg.error) {
      const c = fgColor(fg.score);
      const h = (label, v) => (v === null || v === undefined ? '' : `<span>${label} <b style="color:${fgColor(v)}">${v}</b></span>`);
      $('#fgCard').innerHTML = `<div class="lbl">CNN 공포·탐욕 지수 <small class="muted">${fg.time ? fmtDT(new Date(fg.time)).hm + ' 기준' : ''}</small></div>${gaugeSVG(fg.score)}
        <div><div class="fg-score" style="color:${c}">${fg.score}</div><div class="fg-rating" style="color:${c}">${FG_KO[fg.rating] || fg.rating}</div><div class="fg-hist">${h('전일', fg.prevClose)}${h('1주', fg.week)}${h('1개월', fg.month)}${h('1년', fg.year)}</div></div>`;
    } else $('#fgCard').innerHTML = `<div class="lbl">CNN 공포·탐욕 지수</div>${gaugeSVG(null)}<div class="fg-rating muted">${m ? '불러오기 실패' : '불러오는 중'}</div>`;
    const n = m?.night, ni = nightInfo();
    if (ni) {
      $('#nightCard').innerHTML = `<div class="lbl">${ni.ewy ? '코스피 야간 대용 (EWY)' : n.session === 'night' ? '코스피200 야간선물' : '코스피200 선물(주간)'} <small class="muted">${ni.ewy ? '미국 상장 한국 ETF' : esc(n.code || '')}</small></div>
        <div class="night-price">${ni.price}</div><div class="night-chg ${dirCls(ni.chg)}">${ni.chg > 0 ? '▲' : ni.chg < 0 ? '▼' : ''} ${fmtPx(Math.abs(ni.chg || 0))} (${fmtPct(ni.pct)})</div>
        <p class="foot-note">${ni.ewy ? '한국투자증권 API 키(KIS_APP_KEY·KIS_APP_SECRET)를 등록하면 실제 코스피200 야간선물 시세로 바뀝니다.' : `${ni.note ? esc(ni.note) + ' · ' : ''}한국투자증권 · 야간 18:00~05:00 KST`}</p>`;
    } else $('#nightCard').innerHTML = `<div class="lbl">코스피200 야간선물</div><div class="night-price muted">—</div><p class="foot-note">${m ? esc(n?.reason || '시세 없음') : '불러오는 중'}</p>`;
    const list = (m?.indices || []).filter((x) => !x.error && x.price !== null && x.price !== undefined);
    $('#idxGrid').innerHTML = list.map((x) => { const f = idxFmt(x); return `<div class="idx" title="${esc(x.src || '')}"><div class="l">${esc(x.label)}</div><div class="p">${f.px}</div><div class="c ${f.dir}">${f.ch}</div></div>`; }).join('') || '<div class="muted">지수 데이터를 불러오는 중이거나 가져오지 못했습니다.</div>';
    $('#mktMeta').textContent = m?.fetchedAt ? `${fmtDT(new Date(m.fetchedAt)).hm} 갱신` : '';
  }
  async function pollMarket() {
    if (document.hidden && S.market) return;
    try { S.market = await getJSON('/api/market'); } catch (e) { if (!S.market) S.market = { error: e.message }; }
    renderTape();
    if (S.view === 'market') renderMarket();
  }

  // ───────────────────────── 인기 종목 ─────────────────────────
  async function pollViews() {
    if (document.hidden && S.views) return;
    try { S.views = await getJSON('/api/views'); } catch { S.views = S.views || { top: [] }; }
    const top = (S.views.top || []).slice(0, 7);
    await fetchQuotes(top.map((x) => wkey(x.src, x.ticker)));
    renderPop();
  }
  function popRow(x, i) {
    const q = quoteOf(x.src, x.ticker);
    const label = x.src === 'KR' ? x.name || x.ticker : x.ticker;
    return `<li data-open-co="${esc(x.src)}|${esc(x.ticker)}|${esc(x.name || '')}"><span class="rk">${i + 1}</span>${logoHTML(x.src, x.ticker, x.name, 'sm')}<span class="nm">${esc(label)}</span><span class="pc ${q ? dirCls(q.pct) : 'muted'}">${q ? fmtPct(q.pct) : fmtInt(x.n) + '회'}</span></li>`;
  }
  function renderPop() {
    const top = S.views?.top || [];
    $('#pop').innerHTML = top.length ? top.slice(0, 7).map(popRow).join('') : '<li class="muted">오늘 조회된 종목이 아직 없습니다. 공시를 눌러 보세요.</li>';
  }
  function trackView(m, ticker, name) {
    if (!ticker) return;
    const day = kstDay();
    let v = load('gk_viewed', {});
    if (v.day !== day) v = { day, t: {} };
    const k = wkey(m, ticker);
    if (v.t[k]) return;
    v.t[k] = 1; save('gk_viewed', v);
    fetch('/api/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src: m, ticker, name }) }).then(() => setTimeout(pollViews, 1500)).catch(() => {});
  }

  // ───────────────────────── 모달 ─────────────────────────
  function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; }
  async function openPopularModal() {
    openModal('<h2>🔥 오늘의 인기 종목</h2><div class="loading"><span class="spin"></span>불러오는 중…</div>');
    await pollViews();
    const top = S.views?.top || [];
    await fetchQuotes(top.slice(0, 10).map((x) => wkey(x.src, x.ticker)));
    if ($('#modal').hidden) return;
    $('#modalBody').innerHTML = `<h2>🔥 오늘의 인기 종목</h2><p class="muted" style="margin-top:-.4rem">GK 공시레이더 방문자 조회수 기준 · 오늘 ${fmtInt(S.views?.total || 0)}회 · 매일 0시(KST) 초기화</p>
      ${top.length ? `<ol class="pop">${top.map((x, i) => { const q = quoteOf(x.src, x.ticker); return `<li data-open-co="${esc(x.src)}|${esc(x.ticker)}|${esc(x.name || '')}"><span class="rk">${i + 1}</span>${logoHTML(x.src, x.ticker, x.name, 'sm')}<span class="nm">${esc(x.src === 'KR' ? x.name || x.ticker : `${x.ticker} · ${x.name || ''}`)}</span><span class="pc"><span class="${q ? dirCls(q.pct) : 'muted'}">${q ? pxStr(q) + ' ' + fmtPct(q.pct) : ''}</span> <span class="muted">${fmtInt(x.n)}회</span></span></li>`; }).join('')}</ol>` : '<div class="empty">아직 오늘 조회된 종목이 없습니다.</div>'}`;
  }
  async function openDigestModal() {
    openModal('<h2>🤖 AI가 분석한 오늘의 핵심 공시</h2><div class="loading"><span class="spin"></span>AI가 오늘의 공시·보도자료를 살펴보는 중… (최대 10초)</div>');
    let d;
    try { d = await getJSON('/api/digest', {}); } catch (e) {
      if ($('#modal').hidden) return;
      $('#modalBody').innerHTML = `<h2>🤖 AI 오늘의 핵심 공시</h2>${e.data?.needsKey ? aiKeyHelp() : `<p class="err">AI 분석을 불러오지 못했습니다: ${esc(e.message)}</p>${aiKeyHelp(true)}`}${digestFallback()}`;
      return;
    }
    if ($('#modal').hidden) return;
    const vc = (v) => (v === '긍정' ? 'pos' : v === '부정' ? 'neg' : 'neu');
    $('#modalBody').innerHTML = `<h2>🤖 AI가 분석한 오늘의 핵심 공시</h2><p class="dg-head">${esc(d.headline || '')}</p>
      ${(d.items || []).map((x, i) => `<div class="dg-item" data-id="${esc(x.id)}"><span class="dg-n">${i + 1}</span><div><div class="dg-c">${x.market === 'KR' ? '🇰🇷' : '🇺🇸'} ${esc(x.company || '')}</div><div class="dg-t">${esc(x.title)}</div><div class="dg-w">${esc(x.why)}</div></div><span class="verdict ${vc(x.verdict)}">${esc(x.verdict)}</span></div>`).join('') || '<div class="empty">오늘은 아직 주요 공시가 없습니다.</div>'}
      <p class="note">${d.at ? fmtDT(new Date(d.at)).full + ' 분석 · ' : ''}30분마다 새로 분석합니다. 투자 참고용이며 투자 권유가 아닙니다.</p>`;
  }
  function digestFallback() {
    const arr = [...S.items.values()].filter((n) => n.impact >= 4 && Date.now() - n.ms < 24 * 3600e3).sort((a, b) => b.impact - a.impact || b.ms - a.ms).slice(0, 7);
    if (!arr.length) return '';
    return `<h3 style="margin:1.2rem 0 .3rem;font-size:1rem">자동 분류 기준 중요 공시 (AI 미사용)</h3>${arr.map((n, i) => `<div class="dg-item" data-id="${esc(n.id)}"><span class="dg-n">${i + 1}</span><div><div class="dg-c">${n.market === 'KR' ? '🇰🇷' : '🇺🇸'} ${esc(n.name || n.ticker || '')}</div><div class="dg-t">${esc(n.head)}</div><div class="dg-w">${esc(n.sub || '')}</div></div><span>${tagsHTML(n, 2)}</span></div>`).join('')}`;
  }
  function aiKeyHelp(invalid) {
    return `<div class="card2"><h4>AI 분석을 켜는 방법</h4><div class="lead" style="margin:0;font-size:.9rem;color:var(--text2)">
      ${invalid ? '현재 등록된 AI 키가 인식되지 않습니다(키 오류 또는 사용 한도 초과).<br>' : ''}
      1) <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>에서 무료 Gemini API 키(AIza로 시작)를 발급<br>
      2) Cloudflare → Workers &amp; Pages → gkstock → Settings → Variables and Secrets에 <b>GEMINI_API_KEY</b> 이름(Secret)으로 등록<br>
      3) 저장하면 바로 적용됩니다 → <code>/api/health?ai=1</code> 에서 확인</div></div>`;
  }
  function openSettings() {
    const fsOpt = [['fs-m', '보통'], ['fs-l', '크게'], ['fs-xl', '아주 크게']];
    openModal(`<h2>⚙️ 설정</h2>
      <div class="set-row"><div>글자 크기<small>화면 전체 글자 크기</small></div><div class="seg" id="fsSeg">${fsOpt.map(([v, l]) => `<button data-fs="${v}" class="${S.fs === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="set-row"><div>알림음<small>중요 공시·관심종목 소식이 오면 소리</small></div><input type="checkbox" class="tg" data-set="sound" ${S.sound ? 'checked' : ''}></div>
      <div class="set-row"><div>데스크톱 알림<small>관심종목·매우 중요한 항목</small></div><input type="checkbox" class="tg" data-set="notify" ${S.notify ? 'checked' : ''}></div>
      <h3 style="margin:1.2rem 0 .5rem;font-size:1rem">관심종목 (${S.watch.length})</h3>
      <div class="chips">${S.watch.map((w) => `<span class="wchip">${esc(w.m === 'KR' ? w.n || w.t : w.t)}<button data-unwatch="${esc(w.m)}|${esc(w.t)}">✕</button></span>`).join('') || '<span class="muted">없음 — 목록의 ☆를 눌러 추가하세요.</span>'}</div>
      <p class="note">설정과 관심종목은 이 브라우저에만 저장됩니다.</p>`);
  }

  // ───────────────────────── 상세 패널 ─────────────────────────
  const verdictCls = (v) => (v === '긍정' ? 'pos' : v === '부정' ? 'neg' : 'neu');
  function detailBox() { return isMobile() ? $('#sheetIn') : $('#detail'); }
  function openItem(id) {
    const n = S.items.get(id);
    if (!n) return;
    S.sel = id; S.dTab = 'ai';
    $$('#list .row').forEach((r) => r.classList.toggle('sel', r.dataset.id === id));
    const box = detailBox();
    if (box === $('#detail')) $('#sheetIn').innerHTML = ''; else $('#detail').innerHTML = D_EMPTY;
    box.innerHTML = detailHTML(n);
    if (isMobile()) { $('#sheet').hidden = false; $('#scrim').hidden = false; document.body.style.overflow = 'hidden'; $('#sheet').scrollTop = 0; }
    else box.scrollTop = 0;
    history.replaceState(null, '', '#item/' + encodeURIComponent(id));
    if (n.ticker) { trackView(n.market, n.ticker, n.name); loadQuoteHead(n); }
    loadAI(n); loadCoMini(n);
  }
  function closeSheet() { $('#sheet').hidden = true; $('#scrim').hidden = true; document.body.style.overflow = ''; }
  function detailHTML(n) {
    const [sc, sl] = SRC_BADGE[n.src];
    let when;
    if (n.src === 'DART' && n.when) {
      when = n.when.official ? `DART 접수 ${n.when.official.replace(/-/g, '.')}` : n.raw.date;
      if (n.when.seen) when += ` · 수집 ${fmtDT(new Date(n.when.seen)).full}`;
    } else {
      when = `${fmtDT(new Date(n.ms)).full} KST`;
      if (n.src === 'SEC') when += ` · ${fmtDT(new Date(n.ms), 'America/New_York').full} ET`;
    }
    const on = n.ticker && inWatch(n.market, n.ticker);
    return `${isMobile() ? '<div class="close-sheet"><button class="ico sm" data-close-sheet>✕</button></div>' : ''}<div class="dp">
      <div class="dp-head">
        ${logoHTML(n.market, n.ticker, n.kind === 'NEWS' && !n.ticker ? (n.source || '뉴스').slice(0, 4) : n.name, 'lg', n.kind === 'NEWS' && !n.ticker)}
        <div class="dp-co"><div class="t1">${n.ticker ? `<b>${esc(n.market === 'KR' ? n.ticker : n.ticker)}</b>` : ''}<span>${esc(n.name || n.source || '')}</span></div>
          <div class="t2">${n.market === 'KR' ? '🇰🇷 한국' : '🇺🇸 미국'}${n.exchange ? ' · ' + esc(n.exchange) : ''}${n.ticker ? ` · <button class="link" data-star="${esc(n.market)}|${esc(n.ticker)}|${esc(n.name || '')}">${on ? '★ 관심종목' : '☆ 관심종목 추가'}</button>` : ''}</div></div>
        <div class="dp-px" id="dpPx"></div>
      </div>
      <h2 class="${n.cls}">${esc(n.head)}</h2>
      <div class="badges"><span class="src ${sc}">${sl}</span>${tagsHTML(n, 6, true)}${n.form && n.kind === 'FILING' ? `<span class="muted">${esc(n.form)}</span>` : ''}${n.source && n.kind !== 'FILING' ? `<span class="muted">${esc(n.source)}</span>` : ''}</div>
      <div class="orig">🕒 ${esc(when)}</div>
      ${n.orig ? `<div class="orig">원제목: ${esc(n.orig)}</div>` : ''}
      ${n.sub && n.sub !== n.orig ? `<p class="lead">${esc(n.sub)}</p>` : ''}
      <div class="dtabs" id="dTabs"><button data-dtab="ai" class="on">AI 5줄 요약</button><button data-dtab="co">기업 소개</button><button data-dtab="doc">원문 보기</button></div>
      <div id="dpTab">${aiPane(n)}</div>
      ${extraCards(n)}
      <div id="dpCo"></div>
      <div class="links">${n.url ? `<a class="btn primary" href="${esc(n.url)}" target="_blank" rel="noopener">${n.kind === 'FILING' ? '공시 원문 사이트 ↗' : '기사 원문 ↗'}</a>` : ''}${n.ticker ? `<button class="btn" data-open-co="${esc(n.market)}|${esc(n.ticker)}|${esc(n.name || '')}">기업 상세보기 →</button>` : ''}</div>
    </div>`;
  }
  function extraCards(n) {
    const r = n.raw;
    if (r.tx?.main) {
      const t = r.tx, m = t.main, buy = m.code === 'P';
      return `<div class="card2"><h4>내부자 거래 내역 <span class="muted">Form 4</span></h4><div class="stats">
        <div><span>거래</span><b class="${buy ? 'buy' : m.code === 'S' ? 'sell' : ''}">${esc(m.label)}</b></div><div><span>수량</span><b>${fmtInt(m.shares)}주</b></div><div><span>금액</span><b>${usd(m.value)}</b></div><div><span>평균 단가</span><b>${m.price ? '$' + fmtPx(m.price) : '—'}</b></div></div>
        <dl class="kv" style="margin-top:.7rem"><dt>보고자</dt><dd>${esc(titleCase(t.owner))}${t.relation ? ` · ${esc(t.relation)}` : ''}</dd><dt>거래일</dt><dd class="mono">${esc(t.date || '')}</dd><dt>거래 후 보유</dt><dd class="mono">${fmtInt(t.after)}주</dd>${t.tenb51 ? '<dt>비고</dt><dd>10b5-1 사전계획 거래</dd>' : ''}</dl></div>`;
    }
    if (r.detail && n.src === 'DART') {
      const d = r.detail;
      return `<div class="card2"><h4>지분 변동 <span class="muted">DART</span></h4><div class="stats">
        <div><span>증감</span><b class="${d.change > 0 ? 'buy' : d.change < 0 ? 'sell' : ''}">${signedInt(d.change)}주</b></div><div><span>보유</span><b>${fmtInt(d.shares)}주</b></div><div><span>지분율</span><b>${d.rate ?? '—'}%</b></div><div><span>보고자</span><b>${esc(d.who || '—')}</b></div></div>${d.reason ? `<p class="note">사유: ${esc(d.reason)}</p>` : ''}</div>`;
    }
    if (r.items?.length && n.src === 'SEC') return `<div class="card2"><h4>8-K 보고 항목</h4><dl class="kv">${r.items.map((x) => `<dt class="mono">${esc(x.code)}</dt><dd>${esc(x.ko)}</dd>`).join('')}</dl></div>`;
    return '';
  }
  // AI 탭
  function aiPane(n) {
    const a = S.ai.get(n.id);
    if (!a) return `<div class="card2"><h4>🤖 AI 5줄 요약</h4><div class="loading"><span class="spin"></span>AI가 원문을 읽고 분석하는 중… (처음 여는 항목은 5~15초)</div></div>`;
    if (a.error) return `<div class="card2"><h4>🤖 AI 5줄 요약</h4><p class="err">분석하지 못했습니다: ${esc(a.error)}</p><button class="btn sm" data-ai-retry>다시 시도</button></div>`;
    const li = (arr) => (arr && arr.length ? arr.map((x) => `<li>${esc(x)}</li>`).join('') : '<li class="muted">뚜렷한 요인 없음</li>');
    return `<div class="card2"><h4>${a.fallback ? '📝 자동 요약 (AI 미사용)' : '🤖 핵심 요약 5'} <span class="verdict ${verdictCls(a.verdict)}">주가 영향: ${esc(a.verdict || '중립')}</span></h4>
        <ol class="sum5">${(a.summary || []).slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
      <div class="pn"><div class="pos"><h5>▲ 긍정적 요인</h5><ul>${li(a.positive)}</ul></div><div class="neg"><h5>▼ 부정적 요인</h5><ul>${li(a.negative)}</ul></div></div>
      ${a.fallback ? `<div class="card2"><p class="err" style="margin:0 0 .5rem">AI 분석이 동작하지 않아 원문 문장과 키워드로 자동 정리했습니다.${a.aiError ? `<br><small>원인: ${esc(a.aiError)}</small>` : ''}</p>${aiKeyHelp(!!a.aiError && !/설정되지/.test(a.aiError))}<button class="btn sm" data-ai-retry style="margin-top:.6rem">AI로 다시 분석</button></div>`
        : `<p class="note">${esc(a.provider || 'AI')}가 ${a.basis ? esc(a.basis) : '원문'}을 읽고 작성한 참고용 요약입니다. 투자 판단 전 원문을 확인하세요.</p>`}`;
  }
  async function loadAI(n, force) {
    if (S.ai.has(n.id) && !force && !S.ai.get(n.id).error) return;
    S.ai.delete(n.id);
    if (S.sel === n.id && S.dTab === 'ai') $('#dpTab').innerHTML = aiPane(n);
    let a;
    try { a = await getJSON(`/api/analyze?id=${encodeURIComponent(n.id)}${force ? '&r=' + Date.now() : ''}`, force ? { cache: 'no-store' } : {}); }
    catch (e) { a = { error: e.message }; }
    S.ai.set(n.id, a);
    if (!a.error && !a.fallback) { applyAI(n); updateRowTags(n); }
    if (a.overview) { const c = [...S.co.values()].find((d) => d && d.ticker && d.ticker === n.ticker); if (c && !c.overviewKo) c.overviewKo = a.overview; }
    if (S.sel !== n.id) return;
    if (S.dTab === 'ai') $('#dpTab').innerHTML = aiPane(n);
    if (!a.error && !a.fallback) { const b = $('.dp .badges'); if (b) b.innerHTML = `<span class="src ${SRC_BADGE[n.src][0]}">${SRC_BADGE[n.src][1]}</span>${tagsHTML(n, 6, true)}`; }
    const d = coOf(n); if (d && a.overview && !d.overviewKo) { d.overviewKo = a.overview; renderCoMini(n, d); }
  }
  function updateRowTags(n) {
    const row = $(`#list .row[data-id="${CSS.escape(n.id)}"] .tags`);
    if (row) row.innerHTML = tagsHTML(n);
  }
  // 현재가 (상세 머리)
  async function loadQuoteHead(n) {
    await fetchQuotes([wkey(n.market, n.ticker)]);
    const q = quoteOf(n.market, n.ticker);
    if (S.sel !== n.id || !$('#dpPx')) return;
    $('#dpPx').innerHTML = q ? `<b>${pxStr(q)}</b><em class="${dirCls(q.pct)}">${q.pct > 0 ? '▲' : q.pct < 0 ? '▼' : ''} ${fmtPct(q.pct)}</em>` : '';
  }
  // 기업 정보
  function coUrl(m, t, corp, ex) {
    if (m === 'KR') return corp ? `/api/company?src=KR&t=${encodeURIComponent(t || '')}&corp=${corp}&ex=${encodeURIComponent(ex || '')}` : null;
    return t ? `/api/company?src=US&t=${encodeURIComponent(t)}` : null;
  }
  const coOf = (n) => S.co.get(coUrl(n.market, n.ticker, n.corpCode, n.exchange));
  async function fetchCo(url) {
    if (!url) return null;
    if (S.co.has(url)) return S.co.get(url);
    try { const d = await getJSON(url, {}); S.co.set(url, d); return d; } catch (e) { return { error: e.message }; }
  }
  async function loadCoMini(n) {
    const url = coUrl(n.market, n.ticker, n.corpCode, n.exchange);
    if (!url) { $('#dpCo').innerHTML = ''; return; }
    $('#dpCo').innerHTML = '<div class="card2"><h4>기업 정보</h4><div class="loading"><span class="spin"></span>불러오는 중…</div></div>';
    const d = await fetchCo(url);
    if (S.sel !== n.id) return;
    renderCoMini(n, d);
    if (S.dTab === 'co') $('#dpTab').innerHTML = coPane(n, d);
  }
  const firstSentences = (t, k = 2) => (String(t || '').match(/[^.!?。]+[.!?。]+/g) || [t || '']).slice(0, k).join(' ').trim();
  function overviewText(d) {
    if (!d) return '';
    return d.overviewKo || (d.overviewRaw ? firstSentences(d.overviewRaw, 2) : '');
  }
  function coTags(d) { return [d.sector, d.industry, d.ceo ? `대표 ${d.ceo}` : '', d.founded ? `설립 ${d.founded}` : '', d.exchange].filter(Boolean); }
  function renderCoMini(n, d) {
    const box = $('#dpCo');
    if (!box) return;
    if (!d || d.error) { box.innerHTML = d?.error ? `<div class="card2"><h4>기업 정보</h4><p class="muted" style="margin:0;font-size:.88rem">기업 정보를 불러오지 못했습니다: ${esc(d.error)}</p></div>` : ''; return; }
    const ov = overviewText(d);
    box.innerHTML = `<div class="card2"><h4>기업 정보 <button class="link" data-open-co="${esc(n.market)}|${esc(n.ticker)}|${esc(n.name || '')}">기업 상세보기 ›</button></h4>
      <div class="co-mini">${logoHTML(n.market, n.ticker, n.name, 'sm')}<p>${ov ? esc(ov.length > 220 ? ov.slice(0, 218) + '…' : ov) : '<span class="muted">사업 개요 정보 없음</span>'}</p></div>
      <div class="co-tags">${coTags(d).slice(0, 5).map((t) => `<span>${esc(t)}</span>`).join('')}${d.marketCap ? `<span>시총 ${money(d.marketCap, d.currency)}</span>` : ''}</div></div>`;
  }
  function finStats(d) {
    const f = d.fin || {}, r = d.ratios || {}, cur = d.currency;
    const yoy = (a, b) => (a !== null && a !== undefined && b ? ((a - b) / Math.abs(b)) * 100 : null);
    const y = (a, b) => { const v = yoy(a, b); return v === null ? '' : `<em class="${dirCls(v)}">YoY ${fmtPct(v)}</em>`; };
    const x = (v, suf = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(Math.abs(v) >= 100 ? 0 : 2) + suf);
    return `<div class="stats">
      <div><span>시가총액</span><b>${money(d.marketCap, cur)}</b></div><div><span>매출</span><b>${money(f.revenue, cur)}</b>${y(f.revenue, f.revenuePrev)}</div>
      <div><span>영업이익</span><b>${money(f.opIncome, cur)}</b>${y(f.opIncome, f.opIncomePrev)}</div><div><span>순이익</span><b>${money(f.netIncome, cur)}</b>${y(f.netIncome, f.netIncomePrev)}</div>
      <div><span>PER</span><b>${x(r.per, '배')}</b></div><div><span>PBR</span><b>${x(r.pbr, '배')}</b></div><div><span>ROE</span><b>${x(r.roe, '%')}</b></div><div><span>ROA</span><b>${x(r.roa, '%')}</b></div></div>
      <p class="note">재무: ${esc(f.period || '-')} · 지표: ${esc(r.basis || '-')} · 출처 ${d.src === 'KR' ? 'DART' : 'Nasdaq'}</p>`;
  }
  function coPane(n, d) {
    if (!n.ticker || (n.market === 'KR' && !n.corpCode)) return '<div class="card2"><p class="muted" style="margin:0">이 항목은 연결된 상장 종목이 없어 기업 정보를 표시할 수 없습니다.</p></div>';
    if (!d) return '<div class="card2"><div class="loading"><span class="spin"></span>기업 정보 불러오는 중…</div></div>';
    if (d.error) return `<div class="card2"><p class="err">기업 정보를 불러오지 못했습니다: ${esc(d.error)}</p></div>`;
    const ov = d.overviewKo || d.overviewRaw || '';
    return `<div class="card2"><h4>${esc(d.name || n.name || n.ticker)} <span class="muted">${esc([d.sector, d.industry].filter(Boolean).join(' · '))}</span></h4>
      <p style="margin:0;font-size:.92rem;line-height:1.7;color:var(--text2)">${ov ? esc(ov.length > 700 ? ov.slice(0, 698) + '…' : ov) : '사업 개요 정보를 찾지 못했습니다.'}${!d.overviewKo && d.overviewRaw && d.src === 'US' ? ' <small class="muted">(영문 원문 · AI 분석 후 한국어로 바뀝니다)</small>' : ''}</p>
      <div class="co-tags">${coTags(d).map((t) => `<span>${esc(t)}</span>`).join('')}${d.homepage ? `<a class="link" href="${esc(d.homepage)}" target="_blank" rel="noopener">홈페이지 ↗</a>` : ''}</div>
      ${finStats(d)}</div>`;
  }
  // 원문
  async function loadDoc(n) {
    if (S.doc.has(n.id)) return S.doc.get(n.id);
    try { const d = await getJSON(`/api/doc?id=${encodeURIComponent(n.id)}`, {}); S.doc.set(n.id, d); return d; } catch (e) { return { error: e.message }; }
  }
  function docPane(n, d) {
    if (!d) return '<div class="card2"><div class="loading"><span class="spin"></span>원문 불러오는 중…</div></div>';
    const link = `<a class="link" href="${esc(d.url || n.url || '#')}" target="_blank" rel="noopener">원문 사이트 ↗</a>`;
    if (d.error) return `<div class="card2"><h4>원문 ${link}</h4><p class="err">원문을 불러오지 못했습니다: ${esc(d.error)}</p></div>`;
    const body = d.html ? `<div class="doc html">${d.html}</div>` : `<div class="doc">${esc((d.lines || []).join('\n')) || '<span class="muted">내용이 없습니다.</span>'}</div>`;
    return `<div class="card2"><h4>${n.kind === 'FILING' ? '공시 원문' : '기사·보도자료 본문'} ${link}</h4>${d.note ? `<p class="note" style="margin-top:0">${esc(d.note)}</p>` : ''}${body}</div>`;
  }
  async function switchDTab(tab) {
    const n = S.items.get(S.sel);
    if (!n) return;
    S.dTab = tab;
    $$('#dTabs button').forEach((b) => b.classList.toggle('on', b.dataset.dtab === tab));
    if (tab === 'ai') { $('#dpTab').innerHTML = aiPane(n); return; }
    if (tab === 'co') { $('#dpTab').innerHTML = coPane(n, coOf(n)); if (!coOf(n) && n.ticker) loadCoMini(n); return; }
    $('#dpTab').innerHTML = docPane(n, S.doc.get(n.id));
    const d = await loadDoc(n);
    if (S.sel === n.id && S.dTab === 'doc') $('#dpTab').innerHTML = docPane(n, d);
  }

  // ───────────────────────── 기업분석 화면 ─────────────────────────
  function tvSymbol(t, ex) {
    ex = String(ex || '').toUpperCase();
    const pre = ex.includes('NASDAQ') ? 'NASDAQ:' : ex.includes('NYSE') ? 'NYSE:' : ex.includes('CBOE') ? 'CBOE:' : '';
    return pre + String(t).replace('-', '.');
  }
  function chartHTML(m, t, ex) {
    if (m === 'KR') return `<div class="panel"><h3>일봉 차트 <span>네이버 증권</span></h3><div style="background:#fff;border-radius:10px;overflow:hidden"><img src="https://ssl.pstatic.net/imgfinance/chart/item/candle/day/${esc(t)}.png?t=${(Date.now() / 6e4) | 0}" alt="" style="width:100%;display:block" referrerpolicy="no-referrer"></div></div>`;
    const url = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSymbol(t, ex))}&interval=D&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=0e1629&theme=dark&style=1&timezone=Asia%2FSeoul&withdateranges=1&locale=kr`;
    return `<div class="panel"><h3>차트 <span>TradingView</span></h3><div class="chart"><iframe src="${url}" loading="lazy" title="차트"></iframe></div></div>`;
  }
  function findCorp(m, t) {
    if (m !== 'KR') return null;
    for (const n of S.items.values()) if (n.market === 'KR' && n.ticker === t && n.corpCode) return { corpCode: n.corpCode, name: n.name, exchange: n.exchange };
    return null;
  }
  async function openCompany(m, t, name, extra = {}) {
    t = String(t || '').toUpperCase();
    if (!t) return;
    const hit = findCorp(m, t) || {};
    const c = { m, t, name: name || hit.name || t, corpCode: extra.corpCode || hit.corpCode, exchange: extra.exchange || hit.exchange };
    if (m === 'KR' && !c.corpCode) {
      try { const j = await getJSON(`/api/search?q=${encodeURIComponent(t)}`, {}); const x = (j.items || []).find((y) => y.market === 'KR' && y.ticker === t); if (x) { c.corpCode = x.corpCode; c.name = name || x.name; } } catch {}
    }
    S.coCur = c;
    closeSheet(); closeModal();
    setView('company', `#company/${m}/${t}`);
    trackView(m, t, c.name);
    const on = inWatch(m, t);
    $('#coBody').innerHTML = `<div class="co-hero">${logoHTML(m, t, c.name, 'lg')}<div><h3>${esc(c.name)}</h3><div class="muted">${m === 'KR' ? '🇰🇷 한국' : '🇺🇸 미국'} · <span class="mono">${esc(t)}</span>${c.exchange ? ' · ' + esc(c.exchange) : ''} · <button class="link" data-star="${esc(m)}|${esc(t)}|${esc(c.name)}">${on ? '★ 관심종목' : '☆ 관심종목 추가'}</button></div></div><div class="px" id="coPx"></div></div>
      <div class="co-grid"><div><div id="coInfo"><div class="panel"><div class="loading"><span class="spin"></span>기업 정보 불러오는 중…</div></div></div>${chartHTML(m, t, c.exchange)}<div class="panel"><h3>최근 공시·보도자료·뉴스 <span id="coRecentN"></span></h3><div id="coRecent"></div></div></div>
      <div><div id="coFlows"><div class="panel"><div class="loading"><span class="spin"></span>수급 데이터 불러오는 중…</div></div></div><div class="links">${coLinks(c)}</div></div></div>`;
    renderCoRecent();
    fetchQuotes([wkey(m, t)]).then(() => { const q = quoteOf(m, t); if (S.coCur === c && $('#coPx')) $('#coPx').innerHTML = q ? `<b>${pxStr(q)}</b><span class="${dirCls(q.pct)} mono">${q.pct > 0 ? '▲' : q.pct < 0 ? '▼' : ''} ${fmtPct(q.pct)}</span>` : ''; });
    const url = coUrl(m, t, c.corpCode, c.exchange);
    fetchCo(url).then((d) => {
      if (S.coCur !== c) return;
      if (!url) { $('#coInfo').innerHTML = '<div class="panel"><p class="muted">DART 고유번호를 찾지 못해 기업 정보를 표시할 수 없습니다.</p></div>'; return; }
      const n = { market: m, ticker: t, corpCode: c.corpCode, name: c.name };
      $('#coInfo').innerHTML = coPane(n, d).replace('class="card2"', 'class="panel"');
    });
    loadStockFlows(c);
  }
  function coLinks(c) {
    const L = [];
    if (c.m === 'KR') {
      L.push(`<a class="btn" href="https://finance.naver.com/item/main.naver?code=${esc(c.t)}" target="_blank" rel="noopener">네이버 증권 ↗</a>`);
      L.push(`<a class="btn" href="https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm=${encodeURIComponent(c.name || '')}" target="_blank" rel="noopener">DART 공시 ↗</a>`);
    } else {
      L.push(`<a class="btn" href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK=${encodeURIComponent(c.t)}&owner=include&count=40" target="_blank" rel="noopener">SEC 전체 공시 ↗</a>`);
      L.push(`<a class="btn" href="https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(c.t.toLowerCase())}" target="_blank" rel="noopener">Nasdaq ↗</a>`);
    }
    return L.join('');
  }
  function renderCoRecent() {
    const c = S.coCur;
    if (!c || !$('#coRecent')) return;
    const arr = [...S.items.values()].filter((n) => n.market === c.m && n.ticker && n.ticker.toUpperCase() === c.t).sort((a, b) => b.ms - a.ms).slice(0, 15);
    $('#coRecentN').textContent = arr.length ? `${arr.length}건` : '';
    $('#coRecent').innerHTML = arr.length ? arr.map(rowHTML).join('') : '<p class="muted">현재 수집된 최근 3일치 목록에 이 종목 항목이 없습니다.</p>';
  }
  async function loadStockFlows(c) {
    const url = c.m === 'KR' ? `/api/stock?src=KR&t=${encodeURIComponent(c.t)}${c.corpCode ? '&corp=' + c.corpCode : ''}` : `/api/stock?src=US&t=${encodeURIComponent(c.t)}`;
    let d = S.stock.get(url);
    try { if (!d || Date.now() - d._at > 5 * 60e3) { d = await getJSON(url, {}); d._at = Date.now(); S.stock.set(url, d); } }
    catch (e) { if (S.coCur === c) $('#coFlows').innerHTML = `<div class="panel"><h3>수급</h3><p class="err">불러오지 못했습니다: ${esc(e.message)}</p></div>`; return; }
    if (S.coCur !== c) return;
    $('#coFlows').innerHTML = c.m === 'KR' ? krStockHTML(d) : usStockHTML(d);
  }
  const note = (m) => `<p class="muted" style="margin:0;font-size:.88rem">${esc(m)}</p>`;
  function usStockHTML(d) {
    let h = '';
    if (d.short?.length) {
      const s0 = d.short[0], s1 = d.short[1];
      const chg = s1 && s1.interest ? ((s0.interest - s1.interest) / s1.interest) * 100 : null;
      h += `<div class="panel"><h3>공매도 잔고 <span>FINRA · ${esc(s0.date)} 기준</span></h3><div class="stats" style="grid-template-columns:repeat(3,1fr)"><div><span>잔고</span><b>${fmtBig(s0.interest)}주</b></div><div><span>직전 대비</span><b class="${dirCls(chg)}">${fmtPct(chg)}</b></div><div><span>숏커버 소요일</span><b>${s0.days !== null && s0.days !== undefined ? s0.days.toFixed(1) + '일' : '—'}</b></div></div>
        <table class="tbl" style="margin-top:.6rem"><tr><th>결제일</th><th>잔고</th><th>일평균 거래량</th><th>커버일</th></tr>${d.short.map((r) => `<tr><td>${esc(r.date)}</td><td>${fmtInt(r.interest)}</td><td>${fmtInt(r.avgVol)}</td><td>${r.days !== null && r.days !== undefined ? r.days.toFixed(2) : '—'}</td></tr>`).join('')}</table></div>`;
    } else h += `<div class="panel"><h3>공매도 잔고</h3>${note(d.errors?.short || '데이터 없음')}</div>`;
    if (d.insider) {
      const i = d.insider;
      h += `<div class="panel"><h3>내부자 거래 <span>3개월 매수 ${i.buys3m ?? 0} · 매도 ${i.sells3m ?? 0}건</span></h3><div class="stats" style="grid-template-columns:1fr 1fr"><div><span>3개월 순매매</span><b class="${dirCls(i.net3m)}">${signedInt(i.net3m)}주</b></div><div><span>12개월 순매매</span><b class="${dirCls(i.net12m)}">${signedInt(i.net12m)}주</b></div></div>
        <table class="tbl" style="margin-top:.6rem"><tr><th>내부자</th><th>일자</th><th>거래</th><th>수량</th></tr>${(i.rows || []).slice(0, 10).map((r) => `<tr><td class="t">${esc(titleCase(r.who))}</td><td>${esc(r.date)}</td><td class="t ${/Buy/i.test(r.type) ? 'buy' : /Sell/i.test(r.type) ? 'sell' : ''}">${esc(r.type)}</td><td>${fmtInt(r.shares)}</td></tr>`).join('')}</table></div>`;
    } else h += `<div class="panel"><h3>내부자 거래</h3>${note(d.errors?.insider || '데이터 없음')}</div>`;
    if (d.inst) {
      const s = d.inst;
      h += `<div class="panel"><h3>기관 보유 <span>13F · 분기</span></h3><div class="stats"><div><span>기관 보유율</span><b>${esc(s.pct || '—')}</b></div><div><span>비중 확대</span><b class="up">${fmtInt(s.increased?.holders)}곳</b></div><div><span>비중 축소</span><b class="down">${fmtInt(s.decreased?.holders)}곳</b></div><div><span>신규/청산</span><b>${fmtInt(s.newPos?.holders)}/${fmtInt(s.soldOut?.holders)}</b></div></div>
        <table class="tbl" style="margin-top:.6rem"><tr><th>기관</th><th>보유</th><th>변동</th></tr>${(s.top || []).slice(0, 10).map((r) => `<tr><td class="t">${esc(r.name)}</td><td>${fmtBig(r.shares)}</td><td class="${dirCls(r.change)}">${signedInt(r.change)}</td></tr>`).join('')}</table></div>`;
    } else h += `<div class="panel"><h3>기관 보유</h3>${note(d.errors?.inst || '데이터 없음')}</div>`;
    return h;
  }
  function krStockHTML(d) {
    let h = '';
    const ymd = (s) => (s && s.length === 8 ? `${s.slice(4, 6)}.${s.slice(6, 8)}` : esc(s || ''));
    const kisMsg = (e) => (e === 'KIS_APP_KEY 미설정' ? '한국투자증권 API 키(KIS_APP_KEY·KIS_APP_SECRET)를 등록하면 표시됩니다.' : e || '데이터 없음');
    if (d.investors?.length) h += `<div class="panel"><h3>투자자별 순매수 <span>주</span></h3><table class="tbl"><tr><th>일자</th><th>종가</th><th>개인</th><th>외국인</th><th>기관</th></tr>${d.investors.map((r) => `<tr><td>${ymd(r.date)}</td><td>${fmtInt(r.close)}</td><td class="${dirCls(r.person)}">${signedInt(r.person)}</td><td class="${dirCls(r.foreign)}">${signedInt(r.foreign)}</td><td class="${dirCls(r.inst)}">${signedInt(r.inst)}</td></tr>`).join('')}</table></div>`;
    else h += `<div class="panel"><h3>투자자별 순매수</h3>${note(kisMsg(d.errors?.investors))}</div>`;
    if (d.short?.length) h += `<div class="panel"><h3>공매도 거래 <span>일별</span></h3><table class="tbl"><tr><th>일자</th><th>종가</th><th>공매도 수량</th><th>비중</th></tr>${d.short.map((r) => `<tr><td>${ymd(r.date)}</td><td>${fmtInt(r.close)}</td><td>${fmtInt(r.qty)}</td><td>${r.ratio !== null && r.ratio !== undefined ? r.ratio.toFixed(2) + '%' : '—'}</td></tr>`).join('')}</table></div>`;
    else h += `<div class="panel"><h3>공매도 거래</h3>${note(kisMsg(d.errors?.short))}</div>`;
    if (d.insider?.length) h += `<div class="panel"><h3>임원·주요주주 지분 변동 <span>DART</span></h3><table class="tbl"><tr><th>보고자</th><th>보고일</th><th>증감</th><th>보유</th></tr>${d.insider.map((r) => `<tr><td class="t">${esc(r.who)}<br><small class="muted">${esc(r.role || '')}</small></td><td>${esc(r.date)}</td><td class="${dirCls(r.change)}">${signedInt(r.change)}</td><td>${fmtInt(r.shares)}</td></tr>`).join('')}</table></div>`;
    if (d.major?.length) h += `<div class="panel"><h3>5% 이상 대량보유 <span>DART</span></h3><table class="tbl"><tr><th>보고자</th><th>보고일</th><th>증감</th><th>지분율</th></tr>${d.major.map((r) => `<tr><td class="t">${esc(r.who)}</td><td>${esc(r.date)}</td><td class="${dirCls(r.change)}">${signedInt(r.change)}</td><td>${r.rate ?? '—'}%</td></tr>`).join('')}</table></div>`;
    return h;
  }

  // ───────────────────────── 수급 레이더 ─────────────────────────
  const TAB_INFO = {
    usInsider: 'SEC Form 4 원문에서 장내 매수·매도 수량과 금액을 읽어 옵니다.',
    usInst: '13D(경영참여)·13G(단순투자) 5% 이상 지분 보고와 13F 기관 포트폴리오 보고.',
    krInst: '장중 증권사 집계 기준 잠정치 (한국투자증권). 확정치는 장 마감 후.',
    krFrgn: '장중 증권사 집계 기준 잠정치 (한국투자증권). 확정치는 장 마감 후.',
    krShort: '공매도 거래량 비중 상위 (한국투자증권). 공매도 잔고는 KRX 로그인 전용이라 거래 비중으로 표시합니다.',
    krInsider: 'DART 임원·주요주주 소유상황 / 주식등의 대량보유(5%) 보고.',
  };
  function fRow(i, m, t, name, sub, val, small, cls, attr) {
    return `<div class="f-row" ${attr}><span class="f-rk">${i}</span>${logoHTML(m, t, name, 'sm')}<div style="min-width:0"><div class="f-name">${esc(name)}</div><div class="f-sub">${sub}</div></div><div class="f-val ${cls || ''}">${val}${small ? `<small>${small}</small>` : ''}</div></div>`;
  }
  function renderFlows() {
    const box = $('#flows'), tab = S.flowTab;
    $$('#flowTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#flowFoot').textContent = TAB_INFO[tab] || '';
    const sub = $('#flowSub');
    if (tab === 'usInsider') sub.innerHTML = `<div class="seg" data-sub="insiderSide">${[['all', '전체'], ['P', '장내 매수'], ['S', '장내 매도']].map(([v, l]) => `<button data-v="${v}" class="${S.insiderSide === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    else if (tab === 'krInst' || tab === 'krFrgn') sub.innerHTML = `<div class="seg" data-sub="flowSide">${[['buy', '순매수 상위'], ['sell', '순매도 상위']].map(([v, l]) => `<button data-v="${v}" class="${S.flowSide === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    else sub.innerHTML = '';
    const byTime = (a, b) => b.ms - a.ms;
    const all = [...S.items.values()];
    if (tab === 'usInsider') {
      let list = all.filter((n) => n.src === 'SEC' && n.raw.tx?.main && ['P', 'S'].includes(n.raw.tx.main.code));
      if (S.insiderSide !== 'all') list = list.filter((n) => n.raw.tx.main.code === S.insiderSide);
      list.sort(byTime);
      $('#flowMeta').textContent = `Form 4 ${list.length}건`;
      box.innerHTML = list.length ? list.slice(0, 100).map((n, i) => { const m = n.raw.tx.main, buy = m.code === 'P', k = fmtDT(new Date(n.ms)); return fRow(i + 1, 'US', n.ticker, `${n.ticker} · ${n.name}`, `${esc(personName(n.raw.tx.owner))}${n.raw.tx.relation ? ' · ' + esc(n.raw.tx.relation) : ''}`, `${buy ? '+' : '-'}${usd(m.value)}`, `${fmtInt(m.shares)}주 · ${k.md} ${k.hm}:${k.s}`, buy ? 'buy' : 'sell', `data-id="${esc(n.id)}"`); }).join('') : `<div class="empty">${S.loaded.sec ? '아직 매수·매도가 파악된 Form 4가 없습니다.' : '불러오는 중…'}</div>`;
      return;
    }
    if (tab === 'usInst') {
      const list = all.filter((n) => n.src === 'SEC' && n.raw.category === 'inst').sort(byTime);
      $('#flowMeta').textContent = `${list.length}건`;
      box.innerHTML = list.length ? list.slice(0, 100).map((n, i) => { const k = fmtDT(new Date(n.ms)); return fRow(i + 1, 'US', n.ticker, n.ticker ? `${n.ticker} · ${n.name}` : n.name, esc(n.head), esc(n.raw.form.replace('SCHEDULE ', 'SC ')), `${k.md} ${k.hm}:${k.s}`, '', `data-id="${esc(n.id)}"`); }).join('') : '<div class="empty">불러오는 중…</div>';
      return;
    }
    if (tab === 'krInsider') {
      const list = all.filter((n) => n.src === 'DART' && ['insider', 'inst'].includes(n.raw.category)).sort(byTime);
      $('#flowMeta').textContent = `${list.length}건`;
      box.innerHTML = list.length ? list.slice(0, 100).map((n, i) => { const d = n.raw.detail; const val = d && d.change !== null && d.change !== undefined ? `${signedInt(d.change)}주` : n.raw.category === 'inst' ? '5%' : '임원'; return fRow(i + 1, 'KR', n.ticker, n.name, esc(d ? `${d.who || ''}${d.role ? ' · ' + d.role : ''}` : n.raw.formKo), val, n.when?.official ? n.when.official.slice(5).replace('-', '.') : '', d?.change > 0 ? 'buy' : d?.change < 0 ? 'sell' : '', `data-id="${esc(n.id)}"`); }).join('') : '<div class="empty">불러오는 중…</div>';
      return;
    }
    const f = S.flows;
    if (!f) { box.innerHTML = '<div class="empty">불러오는 중…</div>'; pollFlows(); return; }
    if (f.needsKis) { box.innerHTML = '<div class="empty"><b>한국투자증권 Open API 키가 필요합니다.</b><br>국내 기관·외국인 순매수와 공매도 데이터는 증권사 API로만 무료 제공됩니다.<br>Cloudflare 변수(Variables and Secrets)에 <code>KIS_APP_KEY</code>, <code>KIS_APP_SECRET</code> 등록 후 재배포하세요.</div>'; $('#flowMeta').textContent = ''; return; }
    if (f.error) { box.innerHTML = `<div class="empty">불러오지 못했습니다: ${esc(f.error)}</div>`; return; }
    $('#flowMeta').textContent = f.fetchedAt ? `${fmtDT(new Date(f.fetchedAt)).hm} 갱신` : '';
    const key = tab === 'krInst' ? (S.flowSide === 'buy' ? 'instBuy' : 'instSell') : tab === 'krFrgn' ? (S.flowSide === 'buy' ? 'frgnBuy' : 'frgnSell') : 'short';
    let list = f[key] || [];
    if (!list.length) { box.innerHTML = `<div class="empty">${f.errors?.[key] ? esc(f.errors[key]) : '데이터가 없습니다. (장 시작 전이거나 휴장일일 수 있습니다)'}</div>`; return; }
    if (tab === 'krShort') list = list.slice().sort((a, b) => (b.shortRatio || 0) - (a.shortRatio || 0));
    box.innerHTML = list.map((x, i) => {
      const sub = `${fmtInt(x.price)}원 <span class="${dirCls(x.pct)}">${fmtPct(x.pct)}</span>`;
      const attr = `data-open-co="KR|${esc(x.ticker)}|${esc(x.name)}"`;
      if (tab === 'krShort') return fRow(i + 1, 'KR', x.ticker, x.name, sub, x.shortRatio !== null && x.shortRatio !== undefined ? x.shortRatio.toFixed(2) + '%' : '—', `${fmtInt(x.shortQty)}주`, '', attr);
      return fRow(i + 1, 'KR', x.ticker, x.name, sub, `${signedInt(x.qty)}주`, x.amount !== null && x.amount !== undefined ? `금액 ${fmtInt(x.amount)}` : '', x.qty > 0 ? 'buy' : x.qty < 0 ? 'sell' : '', attr);
    }).join('');
  }
  async function pollFlows() {
    try { S.flows = await getJSON('/api/flows', {}); } catch (e) { S.flows = e.data?.needsKis ? e.data : { error: e.message }; }
    if (S.view === 'flows') renderFlows();
  }

  // ───────────────────────── 화면 전환 ─────────────────────────
  const FEED_VIEWS = { home: 'ALL', filings: 'FILING', pr: 'PR', news: 'NEWS', watch: 'ALL' };
  function setView(v, hash) {
    S.view = v;
    const feed = v in FEED_VIEWS;
    $('#viewFeed').hidden = !feed;
    $('#viewCompany').hidden = v !== 'company';
    $('#viewFlows').hidden = v !== 'flows';
    $('#viewMarket').hidden = v !== 'market';
    $('#viewGuide').hidden = v !== 'guide';
    $$('#nav > button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $('#moreMenu').hidden = true;
    if (hash !== false) history.replaceState(null, '', hash || '#' + v);
    if (feed) { S.type = FEED_VIEWS[v]; S.limit = 120; renderAll(); }
    if (v === 'market') renderMarket();
    if (v === 'flows') { renderFlows(); if (!S.flows || Date.now() - (S.flowsAt || 0) > 180e3) { S.flowsAt = Date.now(); pollFlows(); } }
    if (v === 'company' && !S.coCur) renderCoQuick();
    if (v !== 'company' || hash !== undefined) window.scrollTo({ top: 0 });
  }
  function renderCoQuick() {
    const top = (S.views?.top || []).slice(0, 8);
    const base = top.length ? top.map((x) => [x.src, x.ticker, x.name]) : [['US', 'NVDA', 'NVIDIA'], ['US', 'TSLA', 'Tesla'], ['US', 'AAPL', 'Apple'], ['KR', '005930', '삼성전자'], ['KR', '000660', 'SK하이닉스']];
    $('#coQuick').innerHTML = base.map(([m, t, n]) => `<button data-open-co="${esc(m)}|${esc(t)}|${esc(n || '')}">${esc(m === 'KR' ? n || t : t)}</button>`).join('');
  }
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    const m = h.match(/^company\/(US|KR)\/([A-Z0-9.\-]+)/i);
    if (m) { openCompany(m[1].toUpperCase(), m[2]); return; }
    if (/^item\//.test(h)) { setView('home', false); return; }
    setView(['home', 'filings', 'pr', 'news', 'watch', 'company', 'flows', 'market', 'guide'].includes(h) ? h : 'home', false);
  }

  // ───────────────────────── 검색 ─────────────────────────
  function localCompanies(q) {
    const ql = q.toLowerCase(), seen = new Set(), out = [];
    for (const n of S.items.values()) {
      if (!n.ticker) continue;
      const k = wkey(n.market, n.ticker);
      if (seen.has(k)) continue;
      if (n.ticker.toLowerCase().includes(ql) || (n.name || '').toLowerCase().includes(ql)) { seen.add(k); out.push({ market: n.market, ticker: n.ticker, name: n.name, corpCode: n.corpCode, exchange: n.exchange }); }
      if (out.length >= 6) break;
    }
    return out;
  }
  function bindSearch(input, box, { feed }) {
    let timer, seq = 0, act = -1;
    const render = (q, list, loading) => {
      const opts = [];
      if (feed) opts.push(`<button data-kw="${esc(q)}">🔎 "${esc(q)}" 키워드로 공시·뉴스 검색</button>`);
      if (list.length) opts.push('<div class="sg-h">종목</div>' + list.map((x) => `<button data-open-co="${esc(x.market)}|${esc(x.ticker)}|${esc(x.name || '')}" data-corp="${esc(x.corpCode || '')}" data-ex="${esc(x.exchange || '')}">${logoHTML(x.market, x.ticker, x.name, 'sm')}<span>${esc(x.name || x.ticker)}</span><small>${x.market === 'KR' ? '🇰🇷' : '🇺🇸'} ${esc(x.ticker)}</small></button>`).join(''));
      if (loading) opts.push('<div class="sg-h"><span class="spin"></span>전체 상장사 검색 중…</div>');
      box.innerHTML = opts.join('');
      box.hidden = !opts.length;
      act = -1;
    };
    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(timer);
      if (!q) { box.hidden = true; if (feed && S.q) { S.q = ''; renderAll(); } return; }
      const local = localCompanies(q);
      render(q, local, true);
      const my = ++seq;
      timer = setTimeout(async () => {
        let remote = [];
        try { remote = (await getJSON(`/api/search?q=${encodeURIComponent(q)}`, {})).items || []; } catch {}
        if (my !== seq) return;
        const seen = new Set(local.map((x) => wkey(x.market, x.ticker)));
        render(q, [...local, ...remote.filter((x) => !seen.has(wkey(x.market, x.ticker)))].slice(0, 12), false);
      }, 250);
    });
    input.addEventListener('keydown', (e) => {
      const btns = $$('button', box);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length; btns.forEach((b, i) => b.classList.toggle('act', i === act)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (act >= 0 && btns[act]) { btns[act].click(); return; }
        const q = input.value.trim();
        if (!q) return;
        if (feed) { applyKeyword(q); box.hidden = true; }
        else { const b = box.querySelector('[data-open-co]'); if (b) b.click(); else if (/^[A-Za-z.\-]{1,6}$/.test(q)) openCompany('US', q.toUpperCase()); else if (/^\d{6}$/.test(q)) openCompany('KR', q); }
      }
      if (e.key === 'Escape') { box.hidden = true; input.blur(); }
    });
    box.addEventListener('mousedown', (e) => e.preventDefault());
    input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 150));
  }
  function applyKeyword(q) {
    S.q = q; S.theme = null;
    if (!(S.view in FEED_VIEWS) || S.view === 'watch') setView('home'); else renderAll();
    $('#search').blur();
  }

  // ───────────────────────── 관심종목 ─────────────────────────
  function toggleWatch(m, t, n) {
    const k = wkey(m, t);
    if (S.watch.some((w) => wkey(w.m, w.t) === k)) { S.watch = S.watch.filter((w) => wkey(w.m, w.t) !== k); toast(`${m === 'KR' ? n || t : t} 관심종목 해제`); }
    else { S.watch.push({ m, t: t.toUpperCase(), n }); toast(`${m === 'KR' ? n || t : t} 관심종목 추가 ★`); }
    save('gk_watch2', S.watch);
    renderFeed(); renderWatchbar();
    $$('[data-star]').forEach((b) => {
      const [bm, bt] = b.dataset.star.split('|');
      if (wkey(bm, bt) !== k) return;
      const on = inWatch(bm, bt);
      b.classList.toggle('on', on);
      b.textContent = b.classList.contains('star') ? (on ? '★' : '☆') : on ? '★ 관심종목' : '☆ 관심종목 추가';
    });
  }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200); }
  async function setSetting(key, on, el) {
    if (key === 'notify' && on) {
      if (!('Notification' in window)) { toast('이 브라우저는 알림을 지원하지 않습니다'); if (el) el.checked = false; return; }
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') { toast('브라우저 알림 권한이 필요합니다'); if (el) el.checked = false; return; }
    }
    S[key] = on; save('gk_' + key, on);
    $$(`[data-set="${key}"]`).forEach((x) => (x.checked = on));
    if (key === 'sound' && on) chime(false);
    toast(key === 'sound' ? (on ? '알림음 켜짐' : '알림음 꺼짐') : on ? '데스크톱 알림 켜짐' : '데스크톱 알림 꺼짐');
  }

  // ───────────────────────── 이벤트 ─────────────────────────
  function bind() {
    // 필터
    const onMk = (e) => { const b = e.target.closest('button[data-mk]'); if (!b) return; S.mk = b.dataset.mk; S.limit = 120; renderAll(); };
    $('#mkSeg').addEventListener('click', onMk); $('#mkSeg2').addEventListener('click', onMk);
    $('#typeChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.type = S.type === b.dataset.type ? 'ALL' : b.dataset.type; S.limit = 120; renderAll(); });
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.type = b.dataset.type; S.limit = 120; renderAll(); });
    $('#themeChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.theme = S.theme === b.dataset.theme ? null : b.dataset.theme; S.limit = 120; renderAll(); });
    $('#themes').addEventListener('click', (e) => { const li = e.target.closest('li'); if (!li) return; S.theme = S.theme === li.dataset.theme ? null : li.dataset.theme; S.limit = 120; renderAll(); });
    $('#sortSel').addEventListener('change', (e) => { S.sort = e.target.value; renderFeed(); });
    $('#btnRefresh').addEventListener('click', async (e) => { const b = e.currentTarget; b.querySelector('svg').style.animation = 'spin .8s linear infinite'; await Promise.all([poll('sec'), poll('dart'), poll('news')]); b.querySelector('svg').style.animation = ''; toast('새로고침 완료'); });
    $$('.stat').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.stat;
      if (statActive(k)) { S.type = 'ALL'; S.mk = 'ALL'; }
      else if (k === 'SEC' || k === 'DART') { S.type = 'FILING'; S.mk = k === 'SEC' ? 'US' : 'KR'; }
      else { S.type = k; S.mk = 'ALL'; }
      S.limit = 120; renderAll();
      $('.feedcol').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    // 상단 메뉴
    $('#nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) { if (b.dataset.view === 'company') S.coCur = null, $('#coBody').innerHTML = coEmpty; if (S.q && b.dataset.view !== 'home') S.q = '', ($('#search').value = ''); setView(b.dataset.view); }
    });
    $('#moreBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('#moreMenu'), r = e.currentTarget.getBoundingClientRect();
      menu.hidden = !menu.hidden;
      menu.style.top = r.bottom + 6 + 'px'; menu.style.left = Math.min(r.left, innerWidth - 250) + 'px';
    });
    $('.logo').addEventListener('click', (e) => { e.preventDefault(); S.q = ''; S.theme = null; S.mk = 'ALL'; $('#search').value = ''; setView('home'); });
    bindSearch($('#search'), $('#suggest'), { feed: true });
    bindSearch($('#coSearch'), $('#coSuggest'), { feed: false });
    $('#btnBell').addEventListener('click', (e) => { e.stopPropagation(); const p = $('#bellPanel'); p.hidden = !p.hidden; if (!p.hidden) { renderBell(); S.bellUnread = 0; $('#bellDot').hidden = true; } });
    $('#btnUser').addEventListener('click', openSettings);
    $('#flowTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.flowTab = b.dataset.tab; save('gk_flowtab', S.flowTab); renderFlows(); });
    $('#flowSub').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; S[b.parentElement.dataset.sub] = b.dataset.v; renderFlows(); });

    document.addEventListener('change', (e) => { const el = e.target.closest('[data-set]'); if (el) setSetting(el.dataset.set, el.checked, el); });
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t.closest('#moreMenu') && !t.closest('#moreBtn')) $('#moreMenu').hidden = true;
      if (!t.closest('#bellPanel') && !t.closest('#btnBell')) $('#bellPanel').hidden = true;
      const star = t.closest('[data-star]');
      if (star) { e.stopPropagation(); const [m, tk, n] = star.dataset.star.split('|'); toggleWatch(m, tk, n); if (!$('#modal').hidden && $('#modalBody h2')?.textContent.includes('설정')) openSettings(); return; }
      const un = t.closest('[data-unwatch]');
      if (un) { e.stopPropagation(); const [m, tk] = un.dataset.unwatch.split('|'); toggleWatch(m, tk); if (!$('#modal').hidden) openSettings(); return; }
      if (t.closest('[data-clear-q]')) { S.q = ''; $('#search').value = ''; renderAll(); return; }
      if (t.closest('[data-close-bell]')) { $('#bellPanel').hidden = true; return; }
      if (t.closest('[data-close-modal]') || t.id === 'modal') { closeModal(); return; }
      if (t.closest('[data-close-sheet]') || t.id === 'scrim') { closeSheet(); return; }
      const fs = t.closest('[data-fs]');
      if (fs) { S.fs = fs.dataset.fs; save('gk_fs', S.fs); document.documentElement.className = S.fs; $$('#fsSeg button').forEach((b) => b.classList.toggle('on', b === fs)); return; }
      if (t.closest('#moreRows')) { S.limit += 120; renderFeed(); return; }
      const kw = t.closest('[data-kw]');
      if (kw) { applyKeyword(kw.dataset.kw); $('#suggest').hidden = true; return; }
      const dt = t.closest('[data-dtab]');
      if (dt) { switchDTab(dt.dataset.dtab); return; }
      if (t.closest('[data-ai-retry]')) { const n = S.items.get(S.sel); if (n) loadAI(n, true); return; }
      const mo = t.closest('[data-open-modal]');
      if (mo) { $('#moreMenu').hidden = true; mo.dataset.openModal === 'digest' ? openDigestModal() : openPopularModal(); return; }
      const co = t.closest('[data-open-co]');
      if (co) { const [m, tk, n] = co.dataset.openCo.split('|'); if (co.closest('#suggest')) $('#search').value = ''; $('#suggest').hidden = true; $('#coSuggest').hidden = true; openCompany(m, tk, n, { corpCode: co.dataset.corp || undefined, exchange: co.dataset.ex || undefined }); return; }
      const vw = t.closest('.tp[data-view]');
      if (vw) { setView(vw.dataset.view); return; }
      const row = t.closest('[data-id]');
      if (row && !t.closest('a')) {
        const id = row.dataset.id;
        if (!S.items.has(id)) { toast('이 항목은 현재 목록에서 찾을 수 없습니다'); return; }
        closeModal(); $('#bellPanel').hidden = true;
        if (!(S.view in FEED_VIEWS)) setView('home');
        openItem(id);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeModal(); closeSheet(); $('#bellPanel').hidden = true; }
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#search').focus(); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll('sec'); poll('dart'); poll('news'); pollMarket(); } });
    window.addEventListener('hashchange', () => { if (!/^#item\//.test(location.hash)) route(); });
    let wasMobile = isMobile();
    window.addEventListener('resize', () => { const m = isMobile(); if (m !== wasMobile) { wasMobile = m; if (!m) closeSheet(); if (S.sel) openItem(S.sel); } });
  }
  const coEmpty = document.getElementById('coBody').innerHTML;
  const D_EMPTY = document.getElementById('detail').innerHTML;

  // ───────────────────────── 시작 ─────────────────────────
  function every(ms, fn) { fn(); setInterval(fn, ms); }
  bind();
  route();
  renderTape();
  renderFeed();
  every(30000, () => poll('sec'));
  every(30000, () => poll('dart'));
  every(60000, () => poll('news'));
  every(60000, pollMarket);
  every(60000, pollViews);
  setInterval(() => { if (S.view === 'flows' && !document.hidden) pollFlows(); }, 180000);
  setInterval(() => { if (S.view in FEED_VIEWS && !document.hidden) { renderStats(); $$('#list .r-time small').length && renderFeed(); } }, 60000);
})();
