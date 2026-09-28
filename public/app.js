/* GK의 공시레이더 — 프런트엔드
 * 데이터는 전부 같은 사이트의 /api/* (Cloudflare Worker)에서 받아옵니다.
 *  /api/sec /api/dart 공시 (30초)  /api/news 보도자료·뉴스 (60초)  /api/popular 인기 종목 (60초)
 *  /api/market 시장 지표  /api/views 사이트 조회수  /api/sectors 섹터  /api/flows 국내 수급
 *  /api/analyze AI 분석  /api/company 기업·재무  /api/stock 공매도·내부자·기관  /api/doc 원문
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
  const isMobile = () => matchMedia('(max-width: 720px)').matches;

  // ───────────────────────── 상태 ─────────────────────────
  const S = {
    items: new Map(),
    raw: { sec: [], dart: [], news: [] },
    loaded: { sec: false, dart: false, news: false },
    errors: {}, updated: {},
    view: 'home', mk: 'ALL', type: 'ALL', theme: null, q: '', sort: 'time', limit: 80,
    sel: null, dTab: 'ai',
    ai: new Map(), aiq: new Map(), co: new Map(), doc: new Map(), stock: new Map(), quotes: new Map(),
    sectors: { us: {}, kr: {} },
    market: null, flows: null, views: null, popular: null, popTab: load('gk_poptab', 'KR'), popKind: load('gk_popkind', 'pop'),
    flowTab: load('gk_flowtab', 'usInsider'), flowSide: 'buy', insiderSide: 'all',
    watch: load('gk_watch2', []),
    sound: load('gk_sound', false), notify: load('gk_notify', false), fs: load('gk_fs', 'fs-l'),
    bell: [], booted: false, fresh: new Set(), tr: {}, trPending: new Set(), real: {}, hiddenPoll: {}, olderDone: {}, olderBusy: false, watchAlert: load('gk_watchAlert', true), extra: new Map(), extraTried: new Map(), admin: load('gk_admin', ''), trdoc: new Map(), docLang: 'ko', aTab: 'fin', digests: {}, digestMk: load('gk_dmk', 'ALL'), earn: null, earnMk: 'US', earnDay: 0, earnCap: '0',
  };
  document.documentElement.className = 'js notranslate ' + S.fs;
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
  // 휴대폰 표에서 긴 숫자를 짧게 (-7,630,126 → -763만) — 컴퓨터는 전체 숫자, 휴대폰은 짧은 숫자를 보여줌
  const shortNum = (n, signed) => {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    const a = Math.abs(n), sg = n < 0 ? '-' : signed && n > 0 ? '+' : '';
    const v = a >= 1e8 ? (a / 1e8).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + '억' : a >= 1e4 ? Math.round(a / 1e4).toLocaleString('ko-KR') + '만' : Math.round(a).toLocaleString('ko-KR');
    return sg + v;
  };
  const nx = (n, signed = true) => `<span class="nf">${signed ? signedInt(n) : fmtInt(n)}</span><span class="ns">${shortNum(n, signed)}</span>`;
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
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    if (cur === 'KRW') {
      const a = Math.abs(v), s = v < 0 ? '-' : '';
      if (a >= 1e12) return s + (a / 1e12).toFixed(a >= 1e14 ? 0 : a >= 1e13 ? 1 : 2).replace(/\.0+$/, '') + '조원';
      if (a >= 1e8) return s + Math.round(a / 1e8).toLocaleString('ko-KR') + '억원';
      return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만원';
    }
    return (v < 0 ? '-$' : '$') + fmtBig(Math.abs(v));
  }
  const perShare = (v, cur) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : cur === 'KRW' ? `${fmtInt(v)}원` : `$${v.toFixed(2)}`);
  const pxStr = (q) => (!q || q.price === null || q.price === undefined ? '—' : q.cur === 'KRW' || q.market === 'KR' ? `${fmtInt(q.price)}원` : `$${fmtPx(q.price)}`);

  // ───────────────────────── 로고 ─────────────────────────
  const hue = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  function monogram(m, t, n) {
    if (m === 'KR') return (n || t || '?').replace(/^\(주\)|㈜|주식회사/g, '').trim().slice(0, 2);
    return (t || n || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
  }
  function logoSrcs(m, t, n) {
    t = String(t || '').toUpperCase();
    if (!t) return [];
    const nq = n ? '&n=' + encodeURIComponent(String(n).slice(0, 40)) : '';
    if (m === 'KR') {
      if (!/^[0-9A-Z]{6}$/.test(t)) return [];
      return [`/api/logo?m=KR&t=${t}`, `https://static.toss.im/png-icons/securities/icn-sec-fill-${t}.png`, `https://file.alphasquare.co.kr/media/images/stock_logo/kr/${t}.png`];
    }
    const d = encodeURIComponent(t.replace(/[./]/g, '-'));
    return [`/api/logo?m=US&t=${encodeURIComponent(t)}${nq}`, `https://images.financialmodelingprep.com/symbol/${d}.png`, `https://assets.parqet.com/logos/symbol/${encodeURIComponent(t)}?format=png`];
  }
  function logoHTML(m, t, n, size = '', news = false) {
    if (news && !t) return `<div class="logo-b news ${size}"><span class="mm">${esc((n || '뉴스').slice(0, 4))}</span></div>`;
    if (!t) {
      // 비상장사·종목 미연결: 회사명 첫 글자로 만든 로고 (물음표 대신)
      const nm = String(n || '').replace(/^\(주\)|㈜|주식회사/g, '').trim();
      const txt = !nm ? 'PR' : /^[가-힣]/.test(nm) ? nm.slice(0, 2) : nm.replace(/[^A-Za-z0-9가-힣]/g, '').slice(0, 3).toUpperCase();
      return `<div class="logo-b fb gen ${size}" style="--mk:hsl(${hue(nm || 'PR')} 55% 42%)"><span class="mm">${esc(txt)}</span></div>`;
    }
    const mono = monogram(m, t, n);
    const srcs = logoSrcs(m, t, m === 'US' ? n : '');
    const mk = `hsl(${hue(t || n)} 45% 38%)`;
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

  // ───────────────────────── 섹터 ─────────────────────────
  function sectorOf(m, t) {
    if (!t) return '';
    const v = m === 'KR' ? S.sectors.kr?.[t] : S.sectors.us?.[String(t).toUpperCase()];
    return v ? v.split('|')[0] : '';
  }
  async function loadSectors() {
    try { const j = await getJSON('/api/sectors', {}); S.sectors = { us: j.us || {}, kr: j.kr || {} }; if (S.booted) renderFeed(); } catch {}
  }

  // ───────────────────────── SEC·DART 제목 ─────────────────────────
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
    if (it.rk?.title) return it.rk.title;
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
    if (it.ko?.sub) return it.ko.sub;
    if (it.rk?.sub) return it.rk.sub;
    if (it.pr?.deck) return it.pr.deck;
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
    if (it.approxMs) return { ms: it.approxMs, dateOnly: true };
    return { ms: Date.parse(`${it.date}T18:00:00+09:00`) || 0, dateOnly: true };
  }

  // ───────────────────────── 테마·호재/악재 자동 분류 ─────────────────────────
  const THEME_LABEL = { earnings: '실적', bio: '임상·FDA', deal: '계약·M&A', offering: '증자·희석', insider: '내부자', inst: '기관·5%', other: '기타' };
  const RE = {
    bio: /FDA|임상|Phase\s?[123I]|clinical|trial|허가|신약|치료제|BLA|NDA|IND\b|topline|바이오시밀러|Breakthrough/i,
    earnings: /실적|earnings|revenue|매출|영업이익|순이익|quarter(ly)? results|EPS|guidance|가이던스|financial results|분기|reports (first|second|third|fourth)/i,
    deal: /계약|contract|agreement|acquisi|acquire|merger|인수|합병|M&A|partnership|수주|공급|제휴|협약|MOU|collaborat|license|기술이전|tender offer|공개매수|양수|양도/i,
    offering: /유상증자|전환사채|신주인수권|교환사채|\bCB\b|\bBW\b|offering|dilut|warrant|private placement|at-the-market|shelf|증권신고서|감자|희석|사모 증권/i,
  };
  const POS_RE = /흑자\s?전환|최대\s?(실적|매출)|사상\s?최대|상향|수주|공급계약|자기주식\s?(취득|소각)|자사주\s?(매입|취득|소각)|주식\s?소각|무상증자|배당\s?결정|승인|허가|급등|상승|신고가|호실적|beat|raise[sd]? guidance|record|approv|award|wins?\b|breakthrough|surge|soar|jump|upgrade|buyback|repurchase|성장|증가|개선|돌파|체결|충족 회복|임무 성공/i;
  const NEG_RE = /적자|감소|하향|유상증자|전환사채|신주인수권|소송|횡령|배임|거래정지|상장폐지|관리종목|불성실|감자|회생|파산|부도|철회|취소|해지|급락|하락|약세|신저가|lawsuit|litigation|delist|miss(es|ed)?\b|lower(s|ed)? guidance|offering|dilut|going concern|default|bankrupt|investigation|recall|downgrade|plunge|tumble|halt|layoff|decline|net loss|warning|하회|우려|부진|악화|미달|사임|손상|희석|정정 예정/i;

  function classify(n) {
    const r = n.raw, text = `${n.head} ${n.sub} ${n.orig || ''}`;
    let theme = 'other';
    const cat = r.category;
    if (n.src === 'SEC' || n.src === 'DART') {
      if (cat === 'earnings') theme = 'earnings';
      else if (cat === 'offering') theme = 'offering';
      else if (cat === 'insider') theme = 'insider';
      else if (cat === 'inst') theme = 'inst';
      else if (n.src === 'SEC' && (r.items || []).some((x) => ['1.01', '2.01', '1.02'].includes(x.code))) theme = 'deal';
    }
    if (theme === 'other') {
      if (RE.bio.test(text)) theme = 'bio';
      else if (RE.offering.test(text)) theme = 'offering';
      else if (RE.earnings.test(text)) theme = 'earnings';
      else if (RE.deal.test(text)) theme = 'deal';
    }
    let sent = null;
    const code = r.tx?.main?.code;
    if (code === 'P') sent = 'pos'; else if (code === 'S') sent = 'neg';
    else if (n.src === 'DART' && cat === 'insider' && r.detail?.change) sent = r.detail.change > 0 ? 'pos' : 'neg';
    else if (theme === 'offering') sent = 'neg';
    else { const p = POS_RE.test(text), g = NEG_RE.test(text); sent = p && !g ? 'pos' : g && !p ? 'neg' : null; }
    n.theme = theme; n.sent = sent;
    let imp = r.impact ?? (n.kind === 'PR' ? (n.ticker ? 3 : 2) : n.ticker ? 3 : 2);
    if (n.kind !== 'FILING' && ['earnings', 'bio', 'deal'].includes(theme) && n.ticker) imp = Math.max(imp, 4);
    n.impact = Math.max(1, Math.min(5, imp || 1));
  }

  // ───────────────────────── 정규화 ─────────────────────────
  const cleanCo = (s) => titleCase(s || '').replace(/\bInc\b\.?|\bCorp(oration)?\b\.?|\bLtd\b\.?|\bPlc\b|\bLlc\b|\bCo\b\.?|,\s*$/gi, '').replace(/[,\s]+$/, '').trim();
  function normSec(r) {
    const n = { id: r.id, kind: 'FILING', src: 'SEC', market: 'US', ticker: r.ticker, name: r.name ? cleanCo(r.name) : r.ticker, exchange: r.exchange, ms: Date.parse(r.time) || 0, url: r.url, raw: r, form: r.form };
    n.head = secHead(r); n.sub = secSub(r);
    n.orig = (r.ko?.title || r.rk?.title) && r.pr?.headline ? r.pr.headline : null;
    if (n.orig && n.sub === n.orig) n.sub = r.pr?.deck || '';
    n.cls = r.tx?.main?.code === 'P' ? 'buy' : r.tx?.main?.code === 'S' ? 'sell' : '';
    n.kindLabel = r.form;
    // 8-K·6-K에 첨부된 보도자료(Exhibit 99.1)는 보도자료 탭에도 표시 (스톡타이탄 방식)
    n.prLike = !!(r.pr?.headline && /^(8-K|6-K)/.test(r.form || ''));
    classify(n);
    return n;
  }
  function normDart(r) {
    const w = dartWhen(r);
    const n = { id: r.id, kind: 'FILING', src: 'DART', market: 'KR', ticker: r.ticker, name: r.name, exchange: r.exchange, corpCode: r.corpCode, ms: w.ms, when: w, url: r.url, raw: r, form: r.formKo };
    n.head = dartHead(r); n.sub = dartSub(r);
    n.orig = n.head !== (r.titleClean || r.formKo) ? (r.titleClean || r.formKo) : null;
    if (n.orig && n.sub === n.orig) n.sub = '';
    n.cls = r.category === 'insider' && r.detail?.change ? (r.detail.change > 0 ? 'buy' : 'sell') : '';
    n.kindLabel = { earnings: '실적', current: '수시공시', offering: '증자·희석', insider: '임원지분', inst: '5% 지분', periodic: '정기보고서' }[r.category] || '공시';
    classify(n);
    return n;
  }
  // 보도자료 제목 맨 앞 "회사명, …" 에서 회사명 추정 (비상장사 로고 글자용)
  function guessCo(title) {
    const m = String(title || '').match(/^\s*([^,，:…·\[\]"“]{2,22}?)\s*[,，]/);
    if (!m) return '';
    const w = m[1].split(/\.{2,}|…/).pop().trim();
    return w.length >= 2 && w.split(/\s+/).length <= 4 ? w : '';
  }
  function normNews(r) {
    const n = { id: r.id, kind: r.src === 'PR' ? 'PR' : 'NEWS', src: r.src, market: r.market || 'US', ticker: r.ticker, name: r.company || r.ticker || (r.src === 'PR' ? guessCo(r.title) : ''), corpCode: r.corpCode, ms: Date.parse(r.time) || 0, url: r.url, raw: r, source: r.source };
    n.head = r.titleKo || r.title;
    n.orig = r.titleKo ? r.title : null;
    n.sub = r.desc ? r.desc.slice(0, 180) : '';
    n.cls = '';
    n.kindLabel = n.kind === 'PR' ? '보도자료' : '뉴스';
    classify(n);
    return n;
  }
  function applyAI(n) {
    const a = S.ai.get(n.id);
    if (!a || a.error) return;
    if (!a.fallback) { n.sent = a.verdict === '긍정' ? 'pos' : a.verdict === '부정' ? 'neg' : null; n.aiDone = true; }
    if (a.headline && !a.fallback && !n.raw.tx) { if (!n.orig) n.orig = n.head; n.head = a.headline; }
  }
  const hasKo = (x) => /[가-힣]/.test(x || '');
  function applyTr(n) {
    const t = S.tr[n.id];
    if (t && !hasKo(n.head) && !n.raw.tx) { if (!n.orig) n.orig = n.head; n.head = t; }
  }
  // 화면에 보이는 영어 제목을 모아 한국어 번역 요청 (결과는 서버에 저장되어 모두가 재사용)
  let trTimer = null;
  const trTries = new Map();
  function queueTranslate(list) {
    for (const n of list) if (n && !hasKo(n.head) && !n.raw.tx && !S.tr[n.id] && !S.trPending.has(n.id) && (trTries.get(n.id) || 0) < 3 && (n.kind !== 'FILING' || n.src === 'SEC')) S.trPending.add(n.id);
    if (!S.trPending.size || trTimer) return;
    trTimer = setTimeout(async () => {
      const ids = [...S.trPending].slice(0, 40);
      ids.forEach((id) => trTries.set(id, (trTries.get(id) || 0) + 1));
      try {
        const j = await getJSON('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
        Object.assign(S.tr, j.tr || {});
        let changed = false;
        for (const id of ids) { const n = S.items.get(id); if (n && S.tr[id]) { applyTr(n); changed = true; } }
        if (changed && S.view in FEED_VIEWS) { renderFeed(); renderTrend(); renderDigest(); }
        if (changed && S.view === 'item' && S.sel && S.tr[S.sel] && $('#aHead')) $('#aHead').textContent = S.items.get(S.sel).head;
      } catch {}
      ids.forEach((id) => S.trPending.delete(id));
      trTimer = null;
      // 남은 제목이 있으면 이어서 번역 (항목당 최대 3번 시도)
      if (S.trPending.size) queueTranslate([]);
    }, 400);
  }
  const normRaw = (r) => (r.src === 'SEC' ? normSec(r) : r.src === 'DART' ? normDart(r) : normNews(r));
  function rebuild() {
    const prev = S.items, next = new Map();
    for (const r of S.raw.sec) next.set(r.id, normSec(r));
    for (const r of S.raw.dart) next.set(r.id, normDart(r));
    for (const r of S.raw.news) if (r.src === 'PR' && !next.has(r.id) && !r.dupOf && !(r.src === 'PR' && (r.market === 'KR' || (r.source === '뉴스와이어' && !r.usOk && !r.ko)))) next.set(r.id, normNews(r)); // 한국 보도자료 제외 (뉴스와이어의 미국 상장사 한국어판은 표시)
    for (const [id, r] of S.extra) if (!next.has(id) && r.src !== 'NEWS') next.set(id, normRaw(r)); // 공유 링크로 연 오래된 항목 유지
    next.forEach((n) => { applyTr(n); applyAI(n); });
    // 같은 보도자료가 통신사(PR Newswire 등)에도 있으면 SEC 첨부본은 보도자료 탭에서 빼기
    const wire = new Map();
    for (const n of next.values()) if (n.kind === 'PR' && n.ticker && n.market === 'US') (wire.get(n.ticker) || wire.set(n.ticker, []).get(n.ticker)).push(n.ms);
    for (const n of next.values()) if (n.prLike && (wire.get(n.ticker) || []).some((ms) => Math.abs(ms - n.ms) < 12 * 3600e3)) n.prLike = false;
    const fresh = [];
    if (S.booted) for (const [id, n] of next) if (!prev.has(id) && Date.now() - n.ms < 3 * 3600e3) fresh.push(n);
    S.items = next;
    if (fresh.length) onFresh(fresh);
  }

  // ───────────────────────── 필터 ─────────────────────────
  function baseFilter(n, { ignoreType = false, ignoreTheme = false } = {}) {
    if (S.mk !== 'ALL' && n.market !== S.mk) return false;
    if (!ignoreType && S.type !== 'ALL' && n.kind !== S.type && !(S.type === 'PR' && n.prLike)) return false;
    if (S.view === 'watch' && !inWatch(n.market, n.ticker)) return false;
    if (!ignoreTheme && S.theme) {
      const t = S.theme;
      if (t === 'major' && !(n.impact >= 4)) return false;
      if (t === 'pos' && n.sent !== 'pos') return false;
      if (t === 'neg' && n.sent !== 'neg') return false;
      if (t === 'pr' && n.kind !== 'PR') return false;
      if (THEME_LABEL[t] && n.theme !== t) return false;
    }
    if (S.q) {
      const hay = `${n.ticker || ''} ${n.name || ''} ${n.head} ${n.sub} ${n.orig || ''} ${n.form || ''} ${n.source || ''} ${sectorOf(n.market, n.ticker)}`.toLowerCase();
      if (!S.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }
  function visible() {
    const arr = [...S.items.values()].filter((n) => baseFilter(n));
    if (S.sort === 'impact') arr.sort((a, b) => b.impact - a.impact || b.ms - a.ms);
    else arr.sort((a, b) => b.ms - a.ms);
    return arr;
  }

  // ───────────────────────── 렌더: 영향·심리 막대 ─────────────────────────
  const sentVal = (n) => (n.sent === 'pos' ? (n.aiDone ? 5 : 4) : n.sent === 'neg' ? (n.aiDone ? 1 : 2) : 3);
  const sentCls = (n) => (n.sent === 'pos' ? 'pos' : n.sent === 'neg' ? 'neg' : 'neu');
  const sentLabel = (n) => (n.sent === 'pos' ? '호재' : n.sent === 'neg' ? '악재' : '중립');
  const IMP_LABEL = ['', '낮음', '약함', '보통', '높음', '매우 높음'];
  const barsHTML = (v, cls) => `<div class="bars ${cls}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</div>`;
  function metersHTML(n, big = false) {
    if (big) {
      return `<div class="meter big"><span class="ml imp">AI 영향도</span>${barsHTML(n.impact, 'imp')}<em>${IMP_LABEL[n.impact] || '보통'}</em></div>
        <div class="meter big"><span class="ml snt">AI 심리 분석</span>${barsHTML(sentVal(n), sentCls(n))}<em>${sentLabel(n)}${n.aiDone ? '' : ' (자동 분류)'}</em></div>`;
    }
    return `<div class="meters" title="영향 ${n.impact}/5 · 심리 ${sentLabel(n)}"><div class="meter"><span class="ml imp">영향</span>${barsHTML(n.impact, 'imp')}</div><div class="meter"><span class="ml snt">심리</span>${barsHTML(sentVal(n), sentCls(n))}</div></div>`;
  }

  // ───────────────────────── 렌더: 행 ─────────────────────────
  const SRC_BADGE = { SEC: 'SEC', DART: 'DART', PR: '보도자료', NEWS: '뉴스' };
  function timeStr(n) {
    if (n.src === 'DART' && n.when) {
      const w = n.when;
      if (w.official) { const [d, hm] = w.official.split(' '); const s = w.seen ? fmtDT(new Date(w.seen)).s : null; return { t: `${d.replace(/-/g, '.')} ${hm}${s ? ':' + s : ''}`, title: `DART 공식 접수 ${w.official}` }; }
      if (w.seen) return { t: fmtDT(new Date(w.seen)).full, title: '수집 시각' };
      return { t: (n.raw.date || '').replace(/-/g, '.'), title: '' };
    }
    const k = fmtDT(new Date(n.ms));
    return { t: k.full, title: n.src === 'SEC' ? `SEC 접수 ${k.full} KST / ${fmtDT(new Date(n.ms), 'America/New_York').full} ET` : `${k.full} KST` };
  }
  function tagsHTML(n, max = 4, noKind = false) {
    const t = [];
    if (!noKind) t.push(`<span class="tag ${n.kind === 'FILING' ? 'k-f' : n.kind === 'PR' ? 'k-p' : 'k-n'}">${n.kind === 'FILING' ? '공시' : n.kind === 'PR' ? '보도자료' : '뉴스'}</span>`);
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
  const exShort = (e) => String(e || '').replace(/^NYSE MKT$/i, 'NYSE American').replace(/^NasdaqGS|NasdaqGM|NasdaqCM$/i, 'Nasdaq');
  function idLine(n) {
    const sec = sectorOf(n.market, n.ticker);
    const parts = [];
    if (n.ticker) parts.push(n.market === 'KR' ? `<span class="tk">${esc(n.name || n.ticker)}</span><span class="tk-ex mono">${esc(n.ticker)}${n.exchange ? ' : ' + esc(n.exchange) : ''}</span>` : `<span class="tk">${esc(n.ticker)}</span>${n.exchange ? `<span class="tk-ex">: ${esc(exShort(n.exchange))}</span>` : ''}${n.name ? `<span class="co">${esc(n.name)}</span>` : ''}`);
    else if (n.name) parts.push(`<span class="co">${esc(n.name)}</span>`);
    parts.push(`<span class="mk ${n.market === 'KR' ? 'kr' : 'us'}">${n.market === 'KR' ? '한국' : '미국'}</span>`);
    if (sec) parts.push(`<span class="sector" title="섹터·업종">${esc(sec)}</span>`);
    return parts.join('');
  }
  function rowHTML(n) {
    const tm = timeStr(n);
    const news = n.kind === 'NEWS' && !n.ticker;
    const cls = ['row', S.sel === n.id ? 'sel' : '', S.fresh.has(n.id) ? 'fresh' : '', n.impact >= 5 ? 'hot' : ''].join(' ');
    return `<article class="${cls}" data-id="${esc(n.id)}">
      ${logoHTML(n.market, n.ticker, news ? n.source : n.name, '', news)}
      ${metersHTML(n)}
      <div class="r-main">
        <div class="r-top"><span class="r-time" title="${esc(tm.title)}">${esc(tm.t)}<small>${rel(n.ms)}</small></span>${idLine(n)}${qchip(n)}<span class="src">${SRC_BADGE[n.src]}${n.kind === 'FILING' ? ' · ' + esc(n.kindLabel || '') : n.source ? ' · ' + esc(n.source) : ''}</span></div>
        <div class="r-head ${n.cls}">${esc(n.head)}</div>
        ${n.sub ? `<div class="r-sub">${esc(n.sub)}</div>` : ''}
      </div>
      <div class="r-side"><div class="tags">${tagsHTML(n)}</div>${starHTML(n)}</div>
    </article>`;
  }

  // ───────────────────────── 렌더: 피드·통계·트렌딩 ─────────────────────────
  const anyLoaded = () => S.loaded.sec || S.loaded.dart || S.loaded.news;
  // ── 지난 공시 불러오기 (서버 영구 보관소) ──
  const olderKey = () => `${S.type}|${S.mk}|${S.q || ''}|${S.view === 'watch' ? 'w' : ''}`;
  function addArchived(items) {
    let added = 0;
    for (const r of items || []) {
      if (S.items.has(r.id) && !S.extra.has(r.id)) continue;
      if (!S.extra.has(r.id)) added++;
      S.extra.set(r.id, r);
    }
    if (added) rebuild();
    return added;
  }
  async function loadOlder() {
    if (S.olderBusy) return;
    S.olderBusy = true; renderFeed();
    const arr = visible();
    const before = arr.length ? arr[arr.length - 1].ms : Date.now();
    const kind = S.type === 'ALL' ? 'ALL' : S.type;
    const qs = new URLSearchParams({ kind, mk: S.mk, before: String(Math.floor(before)), limit: '100' });
    if (S.q) qs.set('q', S.q);
    let n = 0;
    try {
      const j = await getJSON('/api/archive?' + qs.toString(), {});
      n = addArchived(j.items);
      if (!j.items?.length) { S.olderDone[olderKey()] = true; toast('더 이전 기록이 없습니다'); }
    } catch (e) { toast('불러오지 못했습니다: ' + e.message); }
    S.olderBusy = false;
    S.limit = Math.max(S.limit, Math.min(visible().length, S.limit + Math.max(n, 1)));
    renderFeed();
  }

  // 목록을 통째로 다시 그리지 않고 바뀐 줄만 교체 → 스크롤 중에 화면이 튀거나 흔들리지 않음
  function patchList(list, items, moreLabel) {
    if (list.firstElementChild && !list.firstElementChild.matches('.row, .more-btn')) list.innerHTML = '';
    const old = new Map();
    for (const el of list.querySelectorAll(':scope > .row')) old.set(el.dataset.id, el);
    const tpl = document.createElement('template');
    let prev = null;
    for (const n of items) {
      const r = rel(n.ms);
      chipKeyMode = true; const key = rowHTML(n).replace(r, ''); chipKeyMode = false;
      let h = null;
      let el = old.get(n.id);
      if (el && el.dataset.k === key) {
        const sm = el.querySelector('.r-time small');
        if (sm && sm.textContent !== r) sm.textContent = r; // 시간 글자만 갱신
      } else {
        h = rowHTML(n);
        tpl.innerHTML = h.trim();
        const fresh = tpl.content.firstElementChild;
        fresh.dataset.k = key;
        if (el) el.replaceWith(fresh);
        el = fresh;
      }
      old.delete(n.id);
      const want = prev ? prev.nextElementSibling : list.firstElementChild;
      if (want !== el) list.insertBefore(el, want);
      prev = el;
    }
    for (const el of old.values()) el.remove();
    let more = list.querySelector(':scope > .more-btn');
    if (moreLabel) {
      if (!more) { more = document.createElement('button'); more.className = 'btn more-btn'; more.id = 'moreRows'; }
      more.textContent = moreLabel;
      list.appendChild(more);
    } else if (more) more.remove();
  }
  function renderFeed() {
    const list = $('#list');
    if (!anyLoaded()) { list.innerHTML = Array.from({ length: 7 }, () => '<div class="skel"></div>').join(''); return; }
    const arr = visible();
    if (!arr.length) {
      const errs = Object.entries(S.errors).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()}: ${v}`);
      list.innerHTML = S.view === 'watch' && !S.watch.length
        ? '<div class="empty">관심종목이 없습니다.<br>목록의 ☆ 또는 상세 창의 ☆를 눌러 추가하세요.</div>'
        : `<div class="empty">조건에 맞는 항목이 없습니다.${errs.length ? `<br><small>${esc(errs.join(' / '))}</small>` : ''}</div>`;
    } else {
      queueTranslate(arr.slice(0, S.limit));
      const canOlder = S.type !== 'NEWS' && !S.olderDone[olderKey()];
      patchList(list, arr.slice(0, S.limit), arr.length > S.limit ? `더 보기 (${fmtInt(arr.length - S.limit)}건 남음)` : canOlder ? (S.olderBusy ? '불러오는 중…' : '⏷ 이전 공시·보도자료 더 보기') : '');
    }
    renderCounts();
    setTimeout(refreshChips, 50);
    const u = ['sec', 'dart', 'news'].map((k) => S.updated[k]).filter(Boolean).map((t) => Date.parse(t)).sort().pop();
    $('#feedUpd').textContent = u ? `업데이트 ${fmtDT(new Date(u)).hm}:${fmtDT(new Date(u)).s}` : '';
  }
  function renderCounts() {
    const c = { ALL: 0, FILING: 0, PR: 0 };
    for (const n of S.items.values()) if (baseFilter(n, { ignoreType: true })) { c.ALL++; c[n.kind]++; if (n.prLike) c.PR++; }
    for (const k in c) { const el = $('#c' + k); if (el) el.textContent = fmtInt(c[k]); }
    const T = [['major', '중요'], ['pos', '호재'], ['neg', '악재'], ['earnings', '실적'], ['bio', '임상·FDA'], ['deal', '계약·M&A'], ['offering', '증자·희석'], ['insider', '내부자'], ['inst', '기관·5%'], ['pr', '보도자료']];
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
    const today = kstDay(), hourAgo = Date.now() - 3600e3;
    const c = { SEC: [0, 0], DART: [0, 0], PR: [0, 0], WATCH: [0, 0] };
    for (const n of S.items.values()) {
      const isToday = fmtDT(new Date(n.ms)).date === today || (n.src === 'DART' && (n.raw.date || '').replace(/-/g, '.') === today);
      const keys = [n.src];
      if (n.ticker && inWatch(n.market, n.ticker)) keys.push('WATCH');
      for (const k of keys) { if (!c[k]) continue; if (isToday) c[k][0]++; if (n.ms > hourAgo) c[k][1]++; }
    }
    for (const k in c) {
      const src = k === 'SEC' ? 'sec' : k === 'DART' ? 'dart' : 'news';
      const el = $('#st' + k); if (!el) continue;
      el.textContent = k === 'WATCH' ? (S.watch.length ? fmtInt(c[k][0]) : '☆') : S.loaded[src] ? fmtInt(c[k][0]) : '–';
      $('#st' + k + 'd').textContent = k === 'WATCH' && !S.watch.length ? '관심종목 추가하기' : c[k][1] ? `1시간 +${c[k][1]}` : '';
    }
    $('#statUpd').textContent = kstDay().slice(5) + ' 기준';
    $$('.stats4 button').forEach((b) => b.classList.toggle('on', statActive(b.dataset.stat)));
  }
  function statActive(k) {
    if (k === 'WATCH') return S.view === 'watch';
    if (k === 'SEC') return S.type === 'FILING' && S.mk === 'US';
    if (k === 'DART') return S.type === 'FILING' && S.mk === 'KR';
    return S.type === k && S.mk === 'ALL';
  }
  // 트렌딩: 최근 36시간 공시·보도자료 중 "발표 후 상승률"이 가장 큰 종목 순
  //  한국 장중(9:00~15:30)엔 국내 우선, 미국 프리장(뉴욕 4:00)~애프터(20:00)엔 미국 우선
  function trendPrimary() {
    const z = (tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value])); return { wd: p.weekday, m: Number(p.hour) * 60 + Number(p.minute) }; };
    const kr = z('Asia/Seoul'), us = z('America/New_York');
    if (!['Sat', 'Sun'].includes(kr.wd) && kr.m >= 540 && kr.m < 930) return 'KR';
    if (!['Sat', 'Sun'].includes(us.wd) && us.m >= 240 && us.m < 1200) return 'US';
    return null;
  }
  let trendBusy = 0;
  function trendGain(n) {
    const q = quoteOf(n.market, n.ticker);
    const p0 = splitAdj(p0Of(n), q);
    if (!p0 || !q || q.price == null) return null;
    const cur = q.live ?? q.price;
    const g = ((cur - p0) / p0) * 100;
    return Number.isFinite(g) ? g : null;
  }
  function renderTrend() {
    const box = $('#trend');
    if (!anyLoaded()) { box.innerHTML = Array.from({ length: 6 }, () => '<div class="skel"></div>').join(''); return; }
    const since = Date.now() - 36 * 3600e3;
    const pool = [...S.items.values()].filter((n) => (S.mk === 'ALL' || n.market === S.mk) && (S.type === 'ALL' || n.kind === S.type));
    const cand = pool.filter((n) => n.ms > since && n.ticker && n.kind !== 'NEWS' && p0Of(n) && !/OTC/i.test(n.exchange || n.raw?.exchange || '')); // 장외(OTC) 종목 제외
    // 종목별로 발표 후 상승률이 가장 큰 공시 하나
    const best = new Map();
    for (const n of cand) { const g = trendGain(n); if (g == null) continue; const k = wkey(n.market, n.ticker); if (!best.has(k) || g > best.get(k).g) best.set(k, { n, g }); }
    const prim = trendPrimary();
    const ranked = [...best.values()].sort((a, b) => ((prim && b.n.market === prim) - (prim && a.n.market === prim)) || b.g - a.g);
    const pick = ranked.filter((x) => x.g > 0).slice(0, 10).map((x) => x.n);
    if (pick.length < 6) { // 오른 종목이 적으면 기존 기준(중요도·최신)으로 채움
      const seen = new Set(pick.map((n) => wkey(n.market, n.ticker)));
      const arr = pool.filter((n) => n.ms > since && n.ticker && n.impact >= 3).sort((a, b) => ((prim && b.market === prim) - (prim && a.market === prim)) || b.impact - a.impact || b.ms - a.ms);
      for (const n of arr) { const k = wkey(n.market, n.ticker); if (seen.has(k)) continue; seen.add(k); pick.push(n); if (pick.length >= 8) break; }
    }
    // 시세가 없는 후보는 뒤에서 받아 와서 다시 정렬
    const need = [...new Set(cand.map((n) => wkey(n.market, n.ticker)))].filter((k) => { const q = S.quotes.get(k); return !q || Date.now() - q._at > 90e3; }).slice(0, 80);
    if (need.length && Date.now() - trendBusy > 60e3) {
      trendBusy = Date.now();
      (async () => { for (let i = 0; i < need.length; i += 40) await fetchQuotes(need.slice(i, i + 40)); renderTrend(); })();
    }
    queueTranslate(pick);
    const sig = pick.map((n) => n.id).join('|');
    if (box.dataset.sig === sig && box.children.length) { paintChips(); return; }
    box.dataset.sig = sig;
    box.innerHTML = pick.map((n) => `<button class="tcard" data-id="${esc(n.id)}"><div class="t-top">${logoHTML(n.market, n.ticker, n.name, 'sm')}<span class="t-tk">${esc(n.market === 'KR' ? n.name : n.ticker)}</span><span class="mk ${n.market === 'KR' ? 'kr' : 'us'}">${n.market === 'KR' ? '한국' : '미국'}</span><span style="margin-left:auto">${rel(n.ms)}</span></div><div class="t-h">${esc(n.head)}</div><div class="t-f">${tagsHTML(n, 2, true)}${qchip(n)}</div></button>`).join('') || '<div class="empty">아직 표시할 항목이 없습니다.</div>';
    setTimeout(paintChips, 0);
  }
  function syncControls() {
    // 한국은 보도자료가 없음 (DART 공시가 그 역할) → 한국 선택 시 보도자료 탭 숨김
    if (S.mk === 'KR' && S.type === 'PR') {
      if (S.view === 'home') { S.type = 'FILING'; S.prAuto = true; } else S.mk = 'ALL';
    } else if (S.mk !== 'KR' && S.prAuto && S.view === 'home' && S.type === 'FILING') { S.type = 'PR'; S.prAuto = false; }
    if (S.type === 'NEWS') S.type = 'PR'; // 뉴스 탭 없어짐
    if (S.type !== 'FILING') S.prAuto = false;
    const prBtn = $('#tabs [data-type="PR"]');
    if (prBtn) prBtn.hidden = S.mk === 'KR';
    $$('#mkSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mk === S.mk));
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.type === S.type));
    $$('#themeChips button').forEach((b) => b.classList.toggle('on', b.dataset.theme === S.theme));
    $('#sortSel').value = S.sort;
    const t = { ALL: '실시간 공시 · 보도자료', FILING: '실시간 공시', PR: '실시간 기업 보도자료', NEWS: '주요 뉴스' }[S.type];
    $('#feedTitle').textContent = S.view === 'watch' ? '관심종목 피드' : S.q ? `"${S.q}" 검색 결과` : t;
    renderWatchbar();
  }
  function renderAll() { syncControls(); renderFeed(); renderStats(); renderTrend(); }

  function renderWatchbar() {
    const bar = $('#watchbar');
    if (S.view !== 'watch' && !S.q) { bar.hidden = true; return; }
    bar.hidden = false;
    if (S.q && S.view !== 'watch') { bar.innerHTML = `<span class="muted">검색어</span><span class="wchip">${esc(S.q)}<button data-clear-q title="검색 해제">✕</button></span>`; return; }
    if (!S.watch.length) { bar.innerHTML = '<span class="muted">관심종목이 없습니다. 목록이나 상세 창의 ☆를 눌러 추가하세요.</span>'; return; }
    bar.innerHTML = S.watch.map((w) => {
      const q = S.quotes.get(wkey(w.m, w.t));
      return `<span class="wchip" data-open-co="${esc(w.m)}|${esc(w.t)}|${esc(w.n || '')}">${esc(w.m === 'KR' ? w.n || w.t : w.t)}${q && q.pct != null ? ` <span class="${dirCls(q.livePct ?? q.pct)} mono">${q.session ? (q.session === 'AFTER' ? '애프터 ' : '프리 ') : ''}${fmtPct(q.livePct ?? q.pct)}</span>` : ''}<button data-unwatch="${esc(w.m)}|${esc(w.t)}" title="삭제">✕</button></span>`;
    }).join('');
    fetchQuotes(S.watch.map((w) => wkey(w.m, w.t))).then((ch) => { if (ch && S.view === 'watch') renderWatchbar(); });
  }

  // ───────────────────────── 현재가 ─────────────────────────
  async function fetchQuotes(keys) {
    const need = [...new Set(keys)].filter((k) => { const q = S.quotes.get(k); return !q || Date.now() - q._at > 55e3; }).slice(0, 40);
    if (!need.length) return false;
    need.forEach((k) => S.quotes.set(k, { ...(S.quotes.get(k) || {}), _at: Date.now() }));
    try {
      const j = await getJSON(`/api/quote?list=${encodeURIComponent(need.join(','))}`, {});
      for (const [k, v] of Object.entries(j.quotes || {})) if (v) S.quotes.set(k.toUpperCase(), { ...v, _at: Date.now() });
      return true;
    } catch { return false; }
  }
  const quoteOf = (m, t) => { const q = S.quotes.get(wkey(m, t)); return q && q.price !== undefined ? q : null; };
  // 실시간 등락 칩: 공시가 나온 뒤 지금 이 종목이 얼마나 움직이고 있는지 목록에서 바로 보여줌
  // 발표 시점 주가(px0)가 있으면 "발표 후 등락", 없으면 오늘 등락
  // 액면병합·분할 안전장치: 발표 시점 주가와 '전일 종가'가 정수배(×2 이상 또는 ½ 이하)로 벌어져 있으면 병합·분할로 보고 환산
  //  (미국은 서버에서 Nasdaq 주식분할 일정으로 먼저 보정, 이건 한국·누락분 대비)
  function splitAdj(p0, q) {
    if (!(p0 > 0) || !q || q.price == null || q.chg == null) return p0;
    const prev = q.price - q.chg;
    if (!(prev > 0)) return p0;
    const r = prev / p0;
    if (r < 1.8 && r > 0.55) return p0;
    const k = r >= 1 ? Math.round(r) : 1 / Math.round(1 / r);
    return Math.abs(r / k - 1) < 0.06 ? p0 * k : p0;
  }
  function qchipInner(m, t, p0) {
    const q = quoteOf(m, t);
    if (!q || q.price == null) return '';
    p0 = splitAdj(p0, q);
    // 미국 프리·애프터 시간엔 시간외 가격이 '지금 가격'
    const cur = q.live ?? q.price;
    let pct = q.livePct ?? q.pct, lbl = q.session ? (q.session === 'AFTER' ? '애프터 ' : '프리 ') : '오늘 ';
    if (p0 > 0) { pct = ((cur - p0) / p0) * 100; lbl = '발표후 '; }
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return '';
    const big = Math.abs(pct) >= 5 ? ' big' : '';
    return `<span class="${dirCls(pct)}${big}">${lbl}${pct > 0 ? '▲' : pct < 0 ? '▼' : ''}${Math.abs(pct).toFixed(2)}%</span>`;
  }
  let chipKeyMode = false; // 목록 비교용 키를 만들 때는 등락 숫자를 빼서, 숫자만 바뀐 줄은 다시 그리지 않음
  const p0Of = (n) => (n.raw?.px0 > 0 && Date.now() - n.ms < 7 * 86400e3 ? n.raw.px0 : 0);
  const qchip = (n) => {
    if (!n.ticker) return '';
    const p0 = p0Of(n);
    // 발표 시점 주가 기록이 없는 오래된 공시(하루 넘은 것)는 표시 안 함 — 오늘 등락을 붙이면 모든 공시가 같은 숫자로 보여 헷갈림
    if (!p0 && Date.now() - n.ms > 24 * 3600e3) return '';
    const tip = p0 ? `발표 시점 ${n.market === 'KR' ? fmtInt(p0) + '원' : '$' + fmtPx(p0)} 대비 현재 주가 등락 (1분마다 갱신)` : '오늘 주가 등락률 (1분마다 갱신)';
    return `<span class="qchip" data-q="${esc(wkey(n.market, n.ticker))}"${p0 ? ` data-p0="${p0}"` : ''} title="${esc(tip)}">${chipKeyMode ? '' : qchipInner(n.market, n.ticker, p0)}</span>`;
  };
  function paintChips() {
    $$('.qchip[data-q]').forEach((el) => { const [m, ...r] = el.dataset.q.split(':'); const h = qchipInner(m, r.join(':'), Number(el.dataset.p0) || 0); if (el.innerHTML !== h) el.innerHTML = h; });
  }
  let chipBusy = false;
  async function refreshChips() {
    if (chipBusy || document.hidden) return;
    const keys = [...new Set($$('.qchip[data-q]').map((el) => el.dataset.q))].slice(0, 80);
    if (!keys.length) return;
    chipBusy = true;
    try { for (let i = 0; i < keys.length; i += 40) await fetchQuotes(keys.slice(i, i + 40)); } finally { chipBusy = false; }
    paintChips();
  }

  // ───────────────────────── 실시간 인기 종목 ─────────────────────────
  function rankRow(x, i, big) {
    const label = x.market === 'KR' ? x.name || x.ticker : x.ticker;
    const sub = x.market === 'KR' ? x.ticker : x.name || '';
    const sec = sectorOf(x.market, x.ticker);
    const px = x.price != null ? (x.market === 'KR' ? `${fmtInt(x.price)}원` : `$${fmtPx(x.price)}`) : '';
    // 오늘 움직임 이유(AI 추정): 오른쪽 작은 목록에선 종목코드 줄 대신, 큰 목록에선 아래 줄에
    const rs = x.reason && !/^뚜렷한 개별 뉴스 없음/.test(x.reason) ? x.reason : null;
    const subHTML = !big && rs ? `<small class="rs" title="AI 추정 · ${esc(x.reason)}">${esc(rs)}</small>` : `<small>${esc(sub)}${sec ? ' · ' + esc(sec) : ''}</small>`;
    const whyHTML = big && x.reason ? `<span class="why rwhy ${rs ? '' : 'none'}"><i>AI 추정</i>${esc(x.reason)}</span>` : big && x.why ? `<span class="why">${esc(x.why)}</span>` : '';
    return `<li data-open-co="${esc(x.market)}|${esc(x.ticker)}|${esc(x.name || '')}"><span class="rk">${i + 1}</span>${logoHTML(x.market, x.ticker, x.name, big ? 'md' : 'sm')}<span class="nm"><b>${esc(label)}</b>${subHTML}</span><span class="px">${px ? `<b>${px}</b>` : ''}${x.pct != null ? `<em class="${dirCls(x.pct)}"${x.session ? ` title="정규장 ${fmtPct(x.regPct)}"` : ''}>${x.session ? `<i class="sess">${x.session === 'AFTER' ? '애프터' : '프리'}</i>` : ''}${fmtPct(x.pct)}</em>` : ''}</span>${whyHTML}</li>`;
  }
  // 인기 / 상승 / 하락 × 국내 / 미국
  const KIND_NAME = { pop: '인기', up: '상승', down: '하락' };
  function popList(p, mk, kind = S.popKind) {
    if (!p) return null;
    if (kind === 'up') return mk === 'KR' ? p.krUp : p.usUp;
    if (kind === 'down') return mk === 'KR' ? p.krDown : p.usDown;
    return mk === 'KR' ? p.kr : p.us;
  }
  function popSrcText(p, mk, kind = S.popKind) {
    if (kind === 'pop') return mk === 'KR' ? p?.krSrc || '네이버 증권 검색 상위' : p?.usSrc || '';
    if (mk === 'US' && p?.usSession) return `미국 ${p.usSession === 'AFTER' ? '애프터마켓' : '프리마켓'} ${kind === 'up' ? '상승률' : '하락률'} 상위 · ${p.usExt?.src === 'naver' ? '시총 상위 1,500 + 전일 급등락 종목 기준' : '미국 상장 주식 전체 (시간외 거래량 5천 주 이상)'}`;
    if (mk === 'KR' && p?.krSession) return `넥스트레이드 ${p.krSession === 'AFTER' ? '애프터마켓' : '프리마켓'} ${kind === 'up' ? '상승률' : '하락률'} 상위 · 코스피·코스닥 시총 상위 + 급등락 종목 기준`;
    return `네이버 증권 ${kind === 'up' ? '상승률' : '하락률'} 상위 · ${mk === 'KR' ? '코스피·코스닥 전체' : '미국 전체'}`;
  }
  function renderPopular() {
    const p = S.popular;
    $$('#popSeg button').forEach((b) => b.classList.toggle('on', b.dataset.pop === S.popTab));
    $$('#popKind button, #popKindPage button').forEach((b) => b.classList.toggle('on', b.dataset.kind === S.popKind));
    $('#popTitle').textContent = `실시간 ${KIND_NAME[S.popKind]} 종목`;
    if (!p) { $('#popList').innerHTML = '<li class="muted">불러오는 중…</li>'; return; }
    const list = popList(p, S.popTab);
    $('#popList').innerHTML = list?.length ? list.slice(0, 10).map((x, i) => rankRow(x, i)).join('') : `<li class="muted">${list ? '데이터를 불러오지 못했습니다.' : '불러오는 중…'}</li>`;
    $('#popSrc').textContent = `${popSrcText(p, S.popTab)} · ${fmtDT(new Date(p.at)).hm} 갱신 · 1분마다 업데이트`;
    if (S.view === 'popular') renderPopularPage();
  }
  function renderPopularPage() {
    const p = S.popular;
    const k = KIND_NAME[S.popKind];
    $('#popPageTitle').textContent = `실시간 ${k} 종목 TOP 10`;
    $('#popKRh').textContent = `국내 ${k} 종목`;
    $('#popUSh').textContent = `미국 ${k} 종목`;
    $('#popKRsrc').textContent = popSrcText(p, 'KR');
    $('#popUSsrc').textContent = popSrcText(p, 'US');
    const kr = popList(p, 'KR'), us = popList(p, 'US');
    $('#popKR').innerHTML = kr?.length ? kr.map((x, i) => rankRow(x, i, true)).join('') : '<li class="muted">불러오는 중이거나 가져오지 못했습니다.</li>';
    $('#popUS').innerHTML = us?.length ? us.map((x, i) => rankRow(x, i, true)).join('') : '<li class="muted">불러오는 중이거나 가져오지 못했습니다.</li>';
    $('#popMeta').textContent = p ? `${fmtDT(new Date(p.at)).full} 기준` : '';
    const v = (S.views?.top || []).map((x) => ({ market: x.src, ticker: x.ticker, name: x.name, ...(quoteOf(x.src, x.ticker) || {}) }));
    $('#popViews').innerHTML = v.length ? v.map((x, i) => rankRow(x, i, true)).join('') : '<li class="muted">오늘 조회된 종목이 아직 없습니다.</li>';
    $('#viewsMeta').textContent = `오늘 ${fmtInt(S.views?.total || 0)}회 · 매일 0시(KST) 초기화`;
  }
  async function pollPopular() {
    if (document.hidden && S.popular) return;
    try { S.popular = await getJSON('/api/popular', {}); } catch { S.popular = S.popular || { kr: [], us: [], at: Date.now(), krSrc: '', usSrc: '' }; }
    renderPopular();
  }

  // ───────────────────────── 데이터: 공시·뉴스 ─────────────────────────
  // 마지막으로 본 목록을 브라우저에 저장해 두고, 다음 방문 때 서버 응답을 기다리지 않고 즉시 표시
  const SNAP_KEY = 'gk_snap_v1';
  let snapTimer = null;
  function saveSnap() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      for (const n of [220, 120, 60]) {
        try {
          localStorage.setItem(SNAP_KEY, JSON.stringify({ at: Date.now(), updated: S.updated, sec: S.raw.sec.slice(0, n), dart: S.raw.dart.slice(0, n), news: S.raw.news.filter((x) => x.src === 'PR').slice(0, n).concat(S.raw.news.filter((x) => x.src !== 'PR').slice(0, n / 2)) }));
          return;
        } catch { try { localStorage.removeItem(SNAP_KEY); } catch {} }
      }
    }, 1500);
  }
  function loadSnap() {
    let j = null;
    try { j = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch {}
    if (!j || Date.now() - j.at > 36 * 3600e3) return false;
    for (const k of ['sec', 'dart', 'news']) { S.raw[k] = j[k] || []; S.loaded[k] = true; S.updated[k] = j.updated?.[k] || new Date(j.at).toISOString(); }
    rebuild();
    return true;
  }

  async function poll(kind) {
    if (document.hidden && S.booted && !S.watch.length) return; // 관심종목이 있으면 다른 탭을 보고 있어도 계속 확인
    if (document.hidden && S.booted && Date.now() - (S.hiddenPoll[kind] || 0) < 55e3) return;
    S.hiddenPoll[kind] = Date.now();
    try {
      const j = await getJSON(`/api/${kind}`);
      S.raw[kind] = j.items || [];
      S.errors[kind] = (j.errors || []).length && !(j.items || []).length ? j.errors.join(' / ') : null;
      S.updated[kind] = j.updatedAt || new Date().toISOString();
      S.real[kind] = true;
      saveSnap();
    } catch (e) { S.errors[kind] = e.message; S.real[kind] = true; }
    S.loaded[kind] = true;
    rebuild();
    if (S.view in FEED_VIEWS) { renderFeed(); renderStats(); renderTrend(); { const dg = S.digests[S.digestMk]; if (!dg || dg.error || !dg.items?.length) renderDigest(); } }
    if (S.view === 'flows' && ['usInsider', 'usInst', 'krInsider'].includes(S.flowTab)) renderFlows();
    if (S.view === 'company' && S.coCur) renderCoRecent();
    if (!S.booted && S.real.sec && S.real.dart && S.real.news) {
      S.booted = true;
      const id = itemIdFromUrl();
      if (id && S.view === 'item') showItem(id);
    }
  }

  // ───────────────────────── 알림 ─────────────────────────
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
  // 관심종목 전용 알림음 (세 번 울리는 높은 음)
  function watchChime() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;
      [784, 1047, 1319].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.14);
        g.gain.exponentialRampToValueAtTime(0.2, now + i * 0.14 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.45);
        o.connect(g).connect(actx.destination);
        o.start(now + i * 0.14); o.stop(now + i * 0.14 + 0.5);
      });
    } catch {}
  }
  // 화면 오른쪽 아래에 뜨는 관심종목 알림 카드
  function watchPopup(list) {
    let box = $('#watchPop');
    if (!box) { box = document.createElement('div'); box.id = 'watchPop'; document.body.appendChild(box); }
    for (const n of list) {
      const el = document.createElement('div');
      el.className = 'wpop';
      el.innerHTML = `<div class="wp-h"><span>⭐ 관심종목 새 ${n.kind === 'FILING' ? '공시' : n.kind === 'PR' ? '보도자료' : '뉴스'}</span><button aria-label="닫기">✕</button></div><b>${esc(n.market === 'KR' ? n.name : n.ticker)}${n.market === 'KR' ? '' : ` <small>${esc(n.name || '')}</small>`}</b><p>${esc(n.head)}</p>`;
      el.addEventListener('click', (e) => { el.remove(); if (!e.target.closest('button')) { window.focus(); openItem(n.id); } });
      box.prepend(el);
      setTimeout(() => el.classList.add('out'), 14000);
      setTimeout(() => el.remove(), 14600);
    }
    while (box.children.length > 4) box.lastElementChild.remove();
  }
  let titleFlash = null;
  function flashTitle(nWatch) {
    if (!document.hidden) return;
    const base = document.title.replace(/^\(\d+\) [^|]*\| /, '');
    let k = 0;
    clearInterval(titleFlash);
    titleFlash = setInterval(() => { document.title = k++ % 2 ? base : `(${nWatch}) 관심종목 새 소식 | ${base}`; }, 1200);
    const stop = () => { if (!document.hidden) { clearInterval(titleFlash); document.title = base; document.removeEventListener('visibilitychange', stop); } };
    document.addEventListener('visibilitychange', stop);
  }
  function askNotifyPermission() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    Notification.requestPermission().then((p) => { if (p === 'granted') toast('관심종목 알림이 켜졌습니다'); });
  }
  function onFresh(fresh) {
    fresh.forEach((n) => S.fresh.add(n.id));
    setTimeout(() => fresh.forEach((n) => S.fresh.delete(n.id)), 4000);
    const watched = fresh.filter((n) => n.ticker && inWatch(n.market, n.ticker) && n.kind !== 'NEWS');
    const imp = fresh.filter((n) => n.impact >= 4 || watched.includes(n));
    if (!imp.length) return;
    S.bell = [...imp.map((n) => ({ id: n.id })), ...S.bell].slice(0, 50);
    $('#bellDot').hidden = false;
    // 관심종목: 설정과 상관없이 항상 알림음 + 화면 알림 (+ 브라우저 알림 허용 시 바탕화면 알림)
    if (watched.length && S.watchAlert !== false) {
      watchChime();
      watchPopup(watched.slice(0, 3));
      flashTitle(watched.length);
      if ('Notification' in window && Notification.permission === 'granted') {
        watched.slice(0, 3).forEach((n) => {
          try { const x = new Notification(`⭐ ${n.market === 'KR' ? n.name : n.ticker} 새 ${n.kind === 'FILING' ? '공시' : '보도자료'}`, { body: n.head, tag: n.id, icon: '/img/gk-favicon.png', requireInteraction: true }); x.onclick = () => { window.focus(); openItem(n.id); x.close(); }; } catch {}
        });
      }
      return;
    }
    if (S.sound) chime(imp.some((n) => n.impact >= 5));
    if (S.notify && 'Notification' in window && Notification.permission === 'granted') {
      imp.filter((n) => n.impact >= 5).slice(0, 3).forEach((n) => {
        try { const x = new Notification(`${n.ticker || ''} ${n.name || ''}`.trim(), { body: n.head, tag: n.id }); x.onclick = () => { window.focus(); openItem(n.id); }; } catch {}
      });
    }
  }
  function renderBell() {
    const rows = S.bell.map((b) => S.items.get(b.id)).filter(Boolean);
    $('#bellPanel').innerHTML = `<h4>알림 <button class="link" data-close-bell>닫기 ✕</button></h4>
      <div class="set-row"><div>관심종목 알림<small>관심종목 새 공시·보도자료가 나오면 알림음 + 알림 창</small></div><input type="checkbox" class="tg" data-set="watchAlert" ${S.watchAlert !== false ? 'checked' : ''}></div>
      <div class="set-row"><div>알림음<small>중요 공시 소식이 오면 소리</small></div><input type="checkbox" class="tg" data-set="sound" ${S.sound ? 'checked' : ''}></div>
      <div class="set-row"><div>데스크톱 알림<small>관심종목·매우 중요한 항목</small></div><input type="checkbox" class="tg" data-set="notify" ${S.notify ? 'checked' : ''}></div>
      ${rows.length ? rows.map((n) => `<div class="al" data-id="${esc(n.id)}"><b>${esc(n.market === 'KR' ? n.name : n.ticker || n.name || '')}</b> ${esc(n.head)}<small>${fmtDT(new Date(n.ms)).full} · ${n.kind === 'FILING' ? '공시' : n.kind === 'PR' ? '보도자료' : '뉴스'}</small></div>`).join('')
        : '<div class="empty" style="padding:1.5rem 0">이 창을 연 뒤 새로 들어온 중요 공시·관심종목 소식이 여기에 쌓입니다.</div>'}`;
  }

  // ───────────────────────── 시장 지표 ─────────────────────────
  const FG_KO = { 'extreme fear': '극단적 공포', fear: '공포', neutral: '중립', greed: '탐욕', 'extreme greed': '극단적 탐욕' };
  const fgColor = (v) => (v < 25 ? '#ff5a6a' : v < 45 ? '#f5a524' : v <= 55 ? '#9aa0d0' : v <= 75 ? '#5ee6a8' : '#2fd08a');
  function gaugeSVG(score) {
    const cx = 64, cy = 66, r = 54;
    const pt = (v) => { const a = Math.PI * (1 - v / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
    const seg = (a, b, c) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${c}" stroke-width="9" fill="none" opacity=".9"/>`; };
    const segs = [[0, 24.5, '#ff5a6a'], [25.5, 44.5, '#f5a524'], [45.5, 54.5, '#6b7099'], [55.5, 74.5, '#5ee6a8'], [75.5, 100, '#2fd08a']].map((s) => seg(...s)).join('');
    const a = Math.PI * (1 - (score ?? 50) / 100);
    const nx = cx + (r - 14) * Math.cos(a), ny = cy - (r - 14) * Math.sin(a);
    return `<svg viewBox="0 0 128 74">${segs}<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#eef0ff" stroke-width="2.5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="4.5" fill="#eef0ff"/></svg>`;
  }
  function idxFmt(x) {
    const px = x.unit === '%' ? x.price.toFixed(3) + '%' : fmtPx(x.price);
    const ch = x.unit === '%' ? `${x.chg > 0 ? '+' : ''}${(x.chg * 100).toFixed(1)}bp` : fmtPct(x.pct);
    return { px, ch, dir: dirCls(x.pct ?? x.chg) };
  }
  function nightInfo() {
    const n = S.market?.night;
    if (n && n.ok) return { label: n.session === 'night' ? '코스피 야간선물' : '코스피200 선물', price: fmtPx(n.price), pct: n.pct, chg: n.chg, note: n.note };
    return null;
  }
  function renderTape() {
    const m = S.market, parts = [];
    const fg = m?.fearGreed;
    if (fg && !fg.error) parts.push(`<span class="tp" data-go="market"><b>공포·탐욕</b><span style="color:${fgColor(fg.score)}">${fg.score}</span><em style="color:${fgColor(fg.score)}">${FG_KO[fg.rating] || fg.rating}</em></span>`);
    const ni = nightInfo();
    if (ni) parts.push(`<span class="tp" data-go="market"><b>${ni.label}</b><span>${ni.price}</span><em class="${dirCls(ni.pct)}">${fmtPct(ni.pct)}</em></span>`);
    else if (m) parts.push(`<span class="tp" data-go="market"><b>코스피 야간선물</b><span class="muted">—</span></span>`);
    for (const x of m?.indices || []) {
      if (x.error || x.price === null || x.price === undefined) continue;
      const f = idxFmt(x);
      parts.push(`<span class="tp" data-go="market"><b>${esc(x.label)}</b><span>${f.px}</span><em class="${f.dir}">${f.ch}</em></span>`);
    }
    const box = $('#tapeIn');
    if (!parts.length) { box.innerHTML = `<span class="tp"><b>${m ? '시장 지표를 불러오지 못했습니다' : '시장 지표 불러오는 중…'}</b></span>`; return; }
    // 흐르는 전광판: 같은 목록을 두 번 이어 붙여 끊김 없이 왼쪽으로 계속 흐르게 (마우스를 올리면 멈춤)
    let track = box.querySelector('.tape-track');
    if (!track) { box.innerHTML = '<div class="tape-track"></div>'; track = box.querySelector('.tape-track'); }
    const one = `<div class="tape-set">${parts.join('')}</div>`;
    track.innerHTML = one + one.replace('class="tape-set"', 'class="tape-set" aria-hidden="true"');
    const w = track.firstElementChild.getBoundingClientRect().width;
    const dur = Math.max(20, Math.round(w / 55)); // 초당 약 55px
    if (track.dataset.dur !== String(dur)) { track.style.animationDuration = dur + 's'; track.dataset.dur = dur; }
  }
  function renderMarket() {
    const m = S.market, fg = m?.fearGreed;
    if (fg && !fg.error) {
      const c = fgColor(fg.score);
      const h = (label, v) => (v === null || v === undefined ? '' : `<span>${label} <b style="color:${fgColor(v)}">${v}</b></span>`);
      $('#fgCard').innerHTML = `<div class="lbl">CNN 공포·탐욕 지수 <small class="muted">${fg.time ? fmtDT(new Date(fg.time)).hm + ' 기준' : ''}</small></div>${gaugeSVG(fg.score)}
        <div><div class="fg-score" style="color:${c}">${fg.score}</div><div class="fg-rating" style="color:${c}">${FG_KO[fg.rating] || fg.rating}</div><div class="fg-hist">${h('전일', fg.prevClose)}${h('1주', fg.week)}${h('1개월', fg.month)}${h('1년', fg.year)}</div></div>`;
    } else $('#fgCard').innerHTML = `<div class="lbl">CNN 공포·탐욕 지수</div>${gaugeSVG(null)}<div class="fg-rating muted">${m ? '불러오기 실패' : '불러오는 중'}</div>`;
    const n = m?.night, ni = nightInfo();
    if (ni) {
      $('#nightCard').innerHTML = `<div class="lbl">${n.session === 'night' ? '코스피200 야간선물' : '코스피200 선물(주간)'} <small class="muted">${esc(n.code || '')}</small></div>
        <div class="night-price">${ni.price}</div><div class="night-chg ${dirCls(ni.chg)}">${ni.chg > 0 ? '▲' : ni.chg < 0 ? '▼' : ''} ${fmtPx(Math.abs(ni.chg || 0))} (${fmtPct(ni.pct)})</div>
        <p class="foot-note">${ni.note ? esc(ni.note) + ' · ' : ''}한국투자증권 · 야간 18:00~05:00 KST</p>`;
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

  // ───────────────────────── 사이트 조회수 ─────────────────────────
  async function pollViews() {
    if (document.hidden && S.views) return;
    try { S.views = await getJSON('/api/views'); } catch { S.views = S.views || { top: [] }; }
    if (S.view === 'popular') { await fetchQuotes((S.views.top || []).slice(0, 10).map((x) => wkey(x.src, x.ticker))); renderPopularPage(); }
  }
  function trackView(m, ticker, name) {
    if (!ticker) return;
    const day = kstDay();
    let v = load('gk_viewed', {});
    if (v.day !== day) v = { day, t: {} };
    const k = wkey(m, ticker);
    if (v.t[k]) return;
    v.t[k] = 1; save('gk_viewed', v);
    fetch('/api/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src: m, ticker, name }) }).catch(() => {});
  }

  // ───────────────────────── AI 오늘의 핵심 공시 (메인 상단) ─────────────────────────
  function setDigestMk(mk) {
    S.digestMk = mk;
    save('gk_dmk', mk);
    $$('#digestSeg button').forEach((b) => b.classList.toggle('on', b.dataset.dmk === mk));
    const d = S.digests[mk];
    renderDigest();
    if (!d || d.error || Date.now() - (d._at || 0) > 15 * 60e3) loadDigest();
  }
  async function loadDigest() {
    const mk = S.digestMk;
    try { S.digests[mk] = await getJSON(`/api/digest?mk=${mk}`, {}); S.digests[mk]._at = Date.now(); } catch (e) { S.digests[mk] = { error: e.message }; }
    if (mk === S.digestMk) renderDigest();
  }
  function renderDigest() {
    const box = $('#digestList');
    if (!box) return;
    const vc = (v) => (v === '긍정' ? 'pos' : v === '부정' ? 'neg' : 'neu');
    const d = S.digests[S.digestMk];
    const mkOk = (m) => S.digestMk === 'ALL' || m === S.digestMk;
    $$('#digestSeg button').forEach((b) => b.classList.toggle('on', b.dataset.dmk === S.digestMk));
    if (!d) { box.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'; $('#digestHead').textContent = 'AI가 공시를 고르는 중…'; return; }
    let cards = [];
    if (d && !d.error && d.items?.length) {
      $('#digestHead').textContent = d.headline || '';
      $('#digestMeta').textContent = `${d.at ? fmtDT(new Date(d.at)).hm + ' 분석 · ' : ''}${d.span && d.span !== '오늘' ? d.span + ' ' : ''}공시·보도자료 기준`;
      cards = d.items.filter((x) => !/^NEWS-/.test(x.id)).slice(0, 6).map((x, i) => {
        const n = S.items.get(x.id);
        const mk = x.market || n?.market;
        return `<button class="dcard" data-id="${esc(x.id)}"><span class="dn">${i + 1}</span><div><div class="dc"><span class="mk ${mk === 'KR' ? 'kr' : 'us'}">${mk === 'KR' ? '한국' : '미국'}</span><b>${esc(n ? (n.market === 'KR' ? n.name : n.ticker || n.name) : x.company || '')}</b><span class="verdict ${vc(x.verdict)}">${esc(x.verdict)}</span>${n ? qchip(n) : ''}</div><div class="dt">${esc(x.title)}</div><div class="dw">${esc(x.why)}</div></div></button>`;
      });
    }
    if (cards.length < 6) {
      // AI가 6건보다 적게 골랐거나 AI를 못 쓸 때: 자동 분류로 중요한 공시·보도자료를 채워 항상 6건
      const used = new Set((d?.items || []).map((x) => x.id));
      const aiCount = cards.length;
      const arr = [...S.items.values()].filter((n) => !used.has(n.id) && n.kind !== 'NEWS' && n.ticker && mkOk(n.market) && n.impact >= 4 && Date.now() - n.ms < 72 * 3600e3).sort((a, b) => b.impact - a.impact || b.ms - a.ms).slice(0, 6 - aiCount);
      if (!aiCount) {
        $('#digestHead').textContent = d?.error && !anyLoaded() ? '' : arr.length ? '' : '오늘은 아직 주요 공시가 없습니다.';
        $('#digestMeta').textContent = '자동 분류 기준 · 공시·보도자료';
      }
      cards = cards.concat(arr.map((n, j) => ({ n, i: aiCount + j })).map(({ n, i }) => `<button class="dcard" data-id="${esc(n.id)}"><span class="dn">${i + 1}</span><div><div class="dc"><span class="mk ${n.market === 'KR' ? 'kr' : 'us'}">${n.market === 'KR' ? '한국' : '미국'}</span><b>${esc(n.market === 'KR' ? n.name : n.ticker)}</b>${tagsHTML(n, 2, true)}${qchip(n)}</div><div class="dt">${esc(n.head)}</div></div></button>`));
    }
    setTimeout(refreshChips, 50); // 발표 후 주가 등락 채우기
    box.innerHTML = cards.join('') || (anyLoaded() ? '<p class="muted" style="margin:0">표시할 항목이 없습니다.</p>' : '<div class="skel"></div><div class="skel"></div><div class="skel"></div>');
  }

  // ───────────────────────── 오늘 주요 이슈 9 (AI가 시간대마다 자동 생성) ─────────────────────────
  const ISS_RE = /^\/i\/((?:kr|us)-\d{8}-\d{1,2})\/?$/;
  const issEd = new Map();
  S.issMk = load('gk_imk', 'KR'); S.iss = {}; S.issSel = {}; S.top = load('gk_top', 'issue');
  const issDate = (date) => { const d = new Date(date + 'T12:00:00Z'); return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${'일월화수목금토'[d.getUTCDay()]})`; };
  const issSlotTxt = (ed) => (ed.hour != null || ed.short !== '장중' ? ed.slot : `장중 · ${ed.slot}`);
  const issUrl = (id) => `${location.origin}/i/${id}`;

  function setTop(v) {
    S.top = v === 'digest' ? 'digest' : 'issue';
    save('gk_top', S.top);
    $('#issueBox').hidden = S.top !== 'issue';
    $('#digestBox').hidden = S.top !== 'digest';
    if (S.top === 'digest') { const d = S.digests[S.digestMk]; if (!d || d.error || Date.now() - (d._at || 0) > 15 * 60e3) loadDigest(); else renderDigest(); }
    else loadIssues();
  }
  async function loadIssues(force) {
    const mk = S.issMk;
    const c = S.iss[mk];
    if (c && !force && Date.now() - c._at < 4 * 60e3) { renderIssueBox(); return; }
    try {
      const j = await getJSON(`/api/issues?mk=${mk}`, {});
      S.iss[mk] = { ...j, _at: Date.now() };
      if (j.ed) issEd.set(j.ed.id, j.ed);
    } catch (e) { S.iss[mk] = { error: e.message, _at: Date.now() - 3 * 60e3 }; }
    if (mk === S.issMk) renderIssueBox();
  }
  async function getEd(id) {
    if (issEd.has(id)) return issEd.get(id);
    const j = await getJSON(`/api/issues?id=${encodeURIComponent(id)}`, {});
    issEd.set(id, j.ed);
    return j.ed;
  }
  function issCardHTML(ed, x, i, full) {
    const tone = x.tone === '호재' ? 'pos' : x.tone === '악재' ? 'neg' : 'neu';
    const stk = (x.stocks || []).map((s) => {
      const pct = s.pct != null ? `<em class="${dirCls(s.pct)}">${fmtPct(s.pct)}</em>` : '';
      return s.code ? `<button class="ic-s" data-open-co="${ed.mk}|${esc(s.code)}|${esc(s.name)}">${esc(ed.mk === 'US' && s.code !== s.name ? s.code : s.name)}${pct}</button>` : `<span class="ic-s">${esc(s.name)}</span>`;
    }).join('');
    return `<article class="ic t-${tone}${full ? ' full' : ''}" id="ic${i + 1}" ${full ? '' : `data-iss-open="${esc(ed.id)}#ic${i + 1}"`}>
      <div class="ic-h"><span class="ic-n">${i + 1}</span><span class="ic-tag">${esc(x.tag)}</span>${x.isNew ? '<span class="iss-new">NEW</span>' : ''}<span class="ic-tone">${esc(x.tone)}</span></div>
      <h4>${esc(x.title)}</h4>${x.sub ? `<p class="ic-sub">${esc(x.sub)}</p>` : ''}
      ${full && x.points?.length ? `<ul class="ic-pts">${x.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      ${stk ? `<div class="ic-stk">${stk}</div>` : ''}
      ${full && x.check ? `<div class="ic-chk"><b>체크포인트</b><span>${esc(x.check)}</span></div>` : ''}
    </article>`;
  }
  function issBoardHTML(ed, { full = false, list = [] } = {}) {
    const n = ed.issues.length;
    const ix = (ed.idx || []).slice(0, full ? 6 : 4).map((x) => `<div class="ib-ix"><span>${esc(x.label)}</span><b>${x.price != null ? Number(x.price).toLocaleString('en-US', { maximumFractionDigits: x.price > 100 ? 2 : 3 }) + (x.unit || '') : '—'}</b><em class="${dirCls(x.pct)}">${fmtPct(x.pct)}</em></div>`).join('');
    const today = list.filter((x) => x.date === ed.date);
    if (!today.some((x) => x.id === ed.id)) today.push({ id: ed.id, date: ed.date, n: ed.n, hour: ed.hour, slot: ed.slot, short: ed.short });
    today.sort((a, b) => (a.hour ?? a.n ?? 0) - (b.hour ?? b.n ?? 0));
    const slots = today.map((x) => `<button class="ib-sl${x.id === ed.id ? ' on' : ''}" data-iss-pick="${esc(x.id)}"><b>${x.hour != null ? (ed.mk === 'US' ? '뉴욕 ' : '') + x.hour + '시' : esc(x.slot)}</b><small>${esc(x.hour != null ? x.short || '' : '')}</small></button>`).join('');
    const past = list.filter((x) => x.date !== ed.date).slice(0, 30);
    const pastSel = past.length ? `<select class="ib-past" data-iss-past><option value="">지난 회차</option>${past.map((x) => `<option value="${esc(x.id)}">${esc(issDate(x.date))} ${esc(x.slot)}</option>`).join('')}</select>` : '';
    const cards = ed.issues.map((x, i) => issCardHTML(ed, x, i, full)).join('');
    const th = (ed.themes || []).filter((x) => x.pct != null).slice(0, 6).map((x) => `<span class="ib-th">${esc(x.name)}<em class="${dirCls(x.pct)}">${fmtPct(x.pct)}</em></span>`).join('');
    const made = ed.at ? fmtDT(new Date(ed.at)).hm : '';
    return `<div class="ib mk-${ed.mk.toLowerCase()}${full ? ' ib-full' : ''}">
      <div class="ib-top">
        <div class="ib-l"><div class="ib-date">${esc(issDate(ed.date))}<span class="ib-slot">${esc(issSlotTxt(ed))}</span></div><div class="ib-title">${ed.mk === 'KR' ? '국장' : '미장'} 주요 이슈 <em>${n}</em></div></div>
        ${ix ? `<div class="ib-ixs">${ix}</div>` : ''}
      </div>
      ${ed.headline ? `<p class="ib-head">${esc(ed.headline)}</p>` : ''}
      ${ed.keywords?.length ? `<div class="ib-kw">${ed.keywords.map((k) => `<span>#${esc(k)}</span>`).join('')}</div>` : ''}
      <div class="ib-slots">${slots}${pastSel}</div>
      <div class="ib-grid">${cards}</div>
      ${!full && n > 3 ? `<button class="btn block ib-more" data-iss-open="${esc(ed.id)}">나머지 ${n - 3}개 이슈 모두 보기 →</button>` : ''}
      ${th ? `<div class="ib-ths"><b>오늘 강세 테마</b>${th}</div>` : ''}
      <div class="ib-foot"><span>${made ? made + ' AI 생성 · ' : ''}뉴스·공시·시세 기반 · 투자 참고용</span><div class="ib-act"><button class="btn sm" data-iss-share="${esc(ed.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>링크 복사</button>${full ? '' : `<button class="btn sm primary" data-iss-open="${esc(ed.id)}">크게 보기</button>`}</div></div>
    </div>`;
  }
  // 메인 화면용 작은 요약판: 한 줄짜리 이슈 9개 (자세한 내용은 '크게 보기')
  function issCompactHTML(ed) {
    const made = ed.at ? fmtDT(new Date(ed.at)).hm : '';
    const th = (ed.themes || []).filter((x) => x.pct != null).slice(0, 6).map((x) => `<span class="ib-th">${esc(x.name)}<em class="${dirCls(x.pct)}">${fmtPct(x.pct)}</em></span>`).join('');
    const rows = ed.issues.slice(0, 6).map((x, i) => {
      const tone = x.tone === '호재' ? 'pos' : x.tone === '악재' ? 'neg' : 'neu';
      const s = (x.stocks || []).find((y) => y.code) || (x.stocks || [])[0];
      const stk = s ? `<span class="ibc-s">${esc(ed.mk === 'US' && s.code ? s.code : s.name)}${s.pct != null ? ` <em class="${dirCls(s.pct)}">${fmtPct(s.pct)}</em>` : ''}</span>` : '';
      return `<li class="t-${tone}" data-iss-open="${esc(ed.id)}#ic${i + 1}"><span class="ibc-n">${i + 1}</span><div class="ibc-b"><div class="ibc-r"><span class="ibc-tag">${esc(x.tag)}</span>${x.isNew ? '<span class="iss-new">NEW</span>' : ''}${stk}</div><b>${esc(x.title)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</div></li>`;
    }).join('');
    return `<div class="ibc mk-${ed.mk.toLowerCase()}">
      <div class="ibc-top"><span class="ib-slot">${esc(issSlotTxt(ed))}</span><span class="ibc-date">${esc(issDate(ed.date))}${made ? ' · ' + made : ''}</span>${ed.headline ? `<p class="ibc-head">${esc(ed.headline)}</p>` : ''}
        <div class="ibc-act"><button class="btn sm" data-iss-share="${esc(ed.id)}" title="링크 복사"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg><span>링크 복사</span></button><button class="btn sm primary" data-iss-open="${esc(ed.id)}">크게 보기 →</button></div></div>
      <ol class="ibc-list">${rows}</ol>
      ${th ? `<div class="ibc-ths"><b>오늘 강세 테마</b><div class="ibc-thl">${th}</div></div>` : ''}
      <button class="btn block ibc-more" data-iss-open="${esc(ed.id)}">${Math.min(6, ed.issues.length)}개 이슈 자세히 보기 →</button>
    </div>`;
  }
  async function renderIssueBox() {
    const box = $('#issBody');
    if (!box) return;
    $$('#issSeg button').forEach((b) => b.classList.toggle('on', b.dataset.imk === S.issMk));
    const c = S.iss[S.issMk];
    if (!c) { box.innerHTML = '<div class="skel"></div><div class="skel"></div>'; return; }
    if (c.error || !c.ed) {
      $('#issMeta').textContent = '';
      box.innerHTML = `<div class="ib-empty">${c.error ? '주요 이슈를 불러오지 못했습니다. 잠시 후 다시 시도합니다.' : 'AI가 첫 회차를 만드는 중입니다. 1~3분 뒤 자동으로 나타납니다.'}</div>`;
      if (c.building) setTimeout(() => { if (S.iss[S.issMk] === c) loadIssues(true); }, 60000);
      return;
    }
    let ed = c.ed;
    const sel = S.issSel[S.issMk];
    if (sel && sel !== ed.id) { try { ed = (await getEd(sel)) || ed; } catch {} }
    $('#issMeta').textContent = S.issMk === 'KR' ? '평일 8~16시 매시간 새 이슈 자동 반영' : '뉴욕 8~17시 매시간 새 이슈 자동 반영';
    box.innerHTML = issCompactHTML(ed);
  }
  function setIssMk(mk) { S.issMk = mk === 'US' ? 'US' : 'KR'; save('gk_imk', S.issMk); renderIssueBox(); loadIssues(); }
  async function showIssuePage(id, anchor) {
    S.view = 'issue';
    $('#viewFeed').hidden = true;
    for (const [k, sel] of Object.entries(PAGES)) $(sel).hidden = k !== 'issue';
    $$('#nav button').forEach((b) => b.classList.remove('on'));
    const el = $('#issPage');
    el.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    window.scrollTo({ top: 0 });
    let ed = null;
    try { ed = await getEd(id); } catch {}
    if (S.view !== 'issue') return;
    if (!ed) { el.innerHTML = '<div class="ib-empty">이 회차를 찾을 수 없습니다. <a href="/">홈으로</a></div>'; return; }
    let list = S.iss[ed.mk]?.list;
    if (!list) { try { list = (await getJSON(`/api/issues?mk=${ed.mk}`, {})).list || []; S.iss[ed.mk] = S.iss[ed.mk] || null; } catch { list = []; } }
    const d = new Date(ed.date + 'T12:00:00Z');
    document.title = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${ed.mk === 'KR' ? '국장' : '미장'} ${ed.slot} 주요 이슈 | GK의 공시레이더`;
    el.innerHTML = `<div class="ip-bar"><button class="btn sm" data-iss-back>← 홈으로</button><kbd class="esc-hint">ESC</kbd><span class="muted sm">오늘 주요 이슈 · ${ed.mk === 'KR' ? '한국' : '미국'}</span></div>${issBoardHTML(ed, { full: true, list })}<p class="note">GK의 공시레이더가 네이버 증권 뉴스, 공시·보도자료, 실시간 시세를 바탕으로 AI가 자동 정리한 내용입니다. 종목 등락률은 생성 시점 기준이며, 투자 권유가 아닌 참고용입니다.</p>`;
    if (anchor) { const a = document.getElementById(anchor); if (a) { a.scrollIntoView({ block: 'center' }); a.classList.add('flash'); } }
  }
  function openIssuePage(ref) {
    const [id, anchor] = String(ref).split('#');
    if (S.view !== 'issue') { S.listScroll = window.scrollY; S.returnUrl = location.pathname === '/' ? '/' + (location.hash || '#' + (S.view || 'home')) : '/#home'; S.fromList = true; }
    history.pushState({ issue: id }, '', '/i/' + id);
    showIssuePage(id, anchor);
  }
  function copyIssue(id) {
    const url = issUrl(id);
    (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => toast('링크를 복사했어요 — 카톡·오픈채팅에 붙여넣기 하세요')).catch(() => { prompt('아래 주소를 복사하세요', url); });
  }
  function bindIssues() {
    $('#issSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-imk]'); if (b) setIssMk(b.dataset.imk); });
    document.addEventListener('click', (e) => {
      const t = e.target;
      const sw = t.closest('[data-top]');
      if (sw) { setTop(sw.dataset.top); return; }
      const sh = t.closest('[data-iss-share]');
      if (sh) { e.stopPropagation(); copyIssue(sh.dataset.issShare); return; }
      const pk = t.closest('[data-iss-pick]');
      if (pk) { e.stopPropagation(); const id = pk.dataset.issPick; if (S.view === 'issue') { history.replaceState(null, '', '/i/' + id); showIssuePage(id); } else { S.issSel[S.issMk] = id; renderIssueBox(); } return; }
      if (t.closest('[data-iss-back]')) { e.stopPropagation(); if (S.fromList) { S.fromList = false; history.back(); } else { history.pushState(null, '', '/#home'); route(); } return; }
      if (t.closest('[data-open-co], select')) return;
      const op = t.closest('[data-iss-open]');
      if (op) { e.stopPropagation(); openIssuePage(op.dataset.issOpen); }
    }, true);
    document.addEventListener('change', (e) => {
      const s = e.target.closest('[data-iss-past]');
      if (!s || !s.value) return;
      if (S.view === 'issue') { history.replaceState(null, '', '/i/' + s.value); showIssuePage(s.value); } else { S.issSel[S.issMk] = s.value; renderIssueBox(); }
    });
  }

  // ───────────────────────── 내일 일정 (경제지표·실적·공모주/IPO + AI 요약) ─────────────────────────
  S.scMk = load('gk_scmk', 'KR'); S.sc = {}; S.scDay = {}; S.scAll = false;
  const SC_WD = '일월화수목금토';
  const scDayLabel = (date, s) => {
    const d = new Date(date + 'T12:00:00Z');
    const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    const t = todayOf(s.mk), tm = new Date(Date.parse(t + 'T12:00:00Z') + 86400e3).toISOString().slice(0, 10);
    const rel = date === t ? '오늘' : date === tm ? '내일' : date === s.focus ? '다음 거래일' : '';
    return { md, wd: SC_WD[d.getUTCDay()], rel };
  };
  const todayOf = (mk) => new Intl.DateTimeFormat('en-CA', { timeZone: mk === 'KR' ? 'Asia/Seoul' : 'America/New_York' }).format(new Date());
  const CFLAG = { KR: ['한국', 'kr'], US: ['미국', 'us'], CN: ['중국', 'cn'], JP: ['일본', 'jp'] };
  async function loadSched(force) {
    if (S.view !== 'sched') return;
    const mk = S.scMk;
    if (!S.sc[mk] || force || Date.now() - S.sc[mk]._at > 5 * 60e3) {
      if (!S.sc[mk]) renderSched();
      try { S.sc[mk] = { ...(await getJSON(`/api/schedule?mk=${mk}`, {})), _at: Date.now() }; } catch (e) { S.sc[mk] = { error: e.message, _at: Date.now() - 4 * 60e3 }; }
    }
    if (mk === S.scMk) renderSched();
  }
  function scEconRow(e, mk) {
    const [cn, cc] = CFLAG[e.country] || ['', ''];
    const stars = '★'.repeat(e.imp) + '☆'.repeat(Math.max(0, 3 - e.imp));
    const nextDay = e.kdate && e.kdate !== e.date ? '<small class="nd">+1</small>' : '';
    const vals = [e.actual != null ? `<b class="act">실제 ${esc(e.actual)}</b>` : '', e.cons ? `<span>예상 ${esc(e.cons)}</span>` : '', e.prev ? `<span>이전 ${esc(e.prev)}</span>` : ''].filter(Boolean).join('');
    return `<div class="sc-ev i${e.imp}${e.actual != null ? ' done' : ''}">
      <div class="sc-t"><b>${esc(e.time)}</b>${nextDay}${mk === 'US' && e.et ? `<small>뉴욕 ${esc(e.et)}</small>` : ''}</div>
      <div class="sc-n"><div class="sc-nh"><span class="sc-c ${cc}">${cn}</span><b>${esc(e.name)}</b><span class="sc-imp i${e.imp}">${stars}</span></div>${vals ? `<div class="sc-v">${vals}</div>` : ''}${e.ai ? `<div class="sc-ai">AI · ${esc(e.ai)}</div>` : ''}</div>
    </div>`;
  }
  function scIpoRow(x, mk) {
    const cls = /상장/.test(x.tag) ? 'lst' : /마감/.test(x.tag) ? 'end' : 'sub';
    const price = x.price ? `공모가 ${esc(x.price)}${mk === 'KR' ? '원' : '$'}` : x.range ? `${mk === 'KR' ? '희망가' : '예정가'} ${esc(x.range)}${mk === 'KR' ? '원' : '$'}` : '';
    const extra = [x.broker ? esc(x.broker) : '', x.size ? esc(String(x.size).replace(/\.00$/, '')) : '', x.exch ? esc(x.exch) : '', x.comp ? `경쟁률 ${esc(x.comp)}` : ''].filter(Boolean).join(' · ');
    return `<div class="sc-ipo"><span class="sc-tag ${cls}">${esc(x.tag)}</span><div class="sc-in"><b>${esc(x.name)}${x.ticker ? ` <em>${esc(x.ticker)}</em>` : ''}${x.spac ? '<i class="spac">스팩</i>' : ''}</b><small>${[price, extra].filter(Boolean).join(' · ')}</small></div></div>`;
  }
  function scEarnRow(x) {
    const cap = x.mcap ? (x.mcap >= 1e12 ? `$${(x.mcap / 1e12).toFixed(2)}T` : `$${Math.round(x.mcap / 1e9)}B`) : '';
    return `<button class="sc-earn" data-open-co="US|${esc(x.t)}|${esc(x.en || x.name || '')}">${logoHTML('US', x.t, x.en, 'sm')}<span class="sc-en"><b>${esc(x.name || x.t)}</b><small>${esc(x.t)}${cap ? ' · ' + cap : ''}</small></span><span class="sc-when ${x.time === '장전' ? 'pre' : x.time === '장후' ? 'post' : ''}">${esc(x.time)}</span><span class="sc-eps">${x.eps != null ? `예상 EPS <b>$${Number(x.eps).toFixed(2)}</b>` : ''}</span></button>`;
  }
  // 장 마감 브리핑 (국장·미장 마감 뒤 AI 정리 — 미장 브리핑은 국장 오전장 체크포인트 중심)
  S.brTab = null; S.brOpen = false;
  function briefHTML(briefs) {
    const has = ['US', 'KR'].filter((k) => briefs?.[k]);
    if (!has.length) return `<div class="br-card br-empty"><div class="br-h"><div class="br-ttl"><span class="br-badge">CLOSE</span><h3>장 마감 브리핑</h3></div></div><p class="muted" style="margin:.6rem 0 0">국장 마감 뒤(15:45)와 미장 마감 뒤(한국시간 새벽 5시 15분, 겨울엔 6시 15분)에 AI가 오늘 장을 정리하고 다음 장 체크포인트를 뽑아 여기에 올립니다.</p></div>`;
    const tab = S.brTab && briefs[S.brTab] ? S.brTab : has.sort((a, b) => briefs[b].at - briefs[a].at)[0];
    const b = briefs[tab];
    const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
    const tabs = ['US', 'KR'].map((k) => briefs[k] ? `<button class="${k === tab ? 'on ' : ''}${k.toLowerCase()}" data-br="${k}">${k === 'US' ? '미장' : '국장'} 마감 <small>${md(briefs[k].date)}</small></button>` : '').join('');
    const ix = (b.idx || []).slice(0, 4).map((x) => `<span class="br-ix">${esc(x.label)} <em class="${dirCls(x.pct)}">${fmtPct(x.pct)}</em></span>`).join('');
    const nextT = tab === 'US' ? '국장 오전장 체크포인트' : '다음 장 체크포인트';
    const next = b.next.map((x, i) => `<div class="br-nx"><span class="ibc-n">${i + 1}</span><div><b>${esc(x.title)}</b><small>${esc(x.desc)}</small>${x.targets?.length ? `<div class="sc-rel">${x.targets.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}</div></div>`).join('');
    const sec = (arr, cls) => arr.map((x) => `<span class="br-sec ${cls}" title="${esc(x.why)}">${esc(x.name)}<small>${esc(x.why)}</small></span>`).join('');
    const movers = b.movers.map((x) => `<${x.code ? `button data-open-co="${tab}|${esc(x.code)}|${esc(x.name)}"` : 'div'} class="br-mv"><b>${esc(x.name)}</b>${x.pct != null ? `<em class="${dirCls(x.pct)}">${fmtPct(x.pct)}</em>` : ''}<small>${esc(x.why)}</small></${x.code ? 'button' : 'div'}>`).join('');
    const more = S.brOpen ? `<div class="br-more">
        <div class="br-col"><h4>오늘 장 요약</h4><ul class="ic-pts">${b.summary.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          ${b.sectors.up.length || b.sectors.down.length ? `<h4>섹터 흐름</h4><div class="br-secs">${sec(b.sectors.up, 'up')}${sec(b.sectors.down, 'down')}</div>` : ''}</div>
        <div class="br-col"><h4>특징주</h4><div class="br-mvs">${movers}</div></div>
      </div>${b.risk ? `<p class="br-risk"><b>주의</b>${esc(b.risk)}</p>` : ''}` : '';
    return `<div class="br-card br-${tab.toLowerCase()}">
      <div class="br-h"><div class="br-ttl"><span class="br-badge">CLOSE</span><h3>장 마감 브리핑</h3></div><div class="br-tabs">${tabs}</div></div>
      <p class="br-head">${esc(b.headline)}</p>${ix ? `<div class="br-ixs">${ix}</div>` : ''}
      <div class="br-next"><h4>${nextT}</h4><div class="br-nxs">${next}</div></div>
      ${more}
      <div class="br-foot"><span class="muted sm">${fmtDT(new Date(b.at)).hm} AI 정리 · 투자 참고용</span><button class="btn sm" data-br-toggle>${S.brOpen ? '접기 ▴' : '오늘 장 요약·특징주 보기 ▾'}</button></div>
    </div>`;
  }
  function renderSched() {
    $$('#scSeg button').forEach((b) => b.classList.toggle('on', b.dataset.sc === S.scMk));
    const s = S.sc[S.scMk], body = $('#scBody');
    if (!s) { body.innerHTML = '<div class="skel"></div><div class="skel"></div>'; $('#scDays').innerHTML = ''; return; }
    if (s.error || !s.days) { body.innerHTML = `<div class="empty">일정을 불러오지 못했습니다${s.error ? ': ' + esc(s.error) : ''}</div>`; return; }
    const mk = S.scMk;
    const sel = s.focus; // 하루치만: 장 마감 전이면 오늘, 마감 뒤면 다음 거래일
    $('#scMeta').textContent = `${mk === 'KR' ? '한국 장 마감(15:30) 뒤엔 다음 거래일 기준' : '미국 장 마감(뉴욕 16:00) 뒤엔 다음 거래일 기준'} · 시간은 모두 한국시간`;
    const fl = scDayLabel(sel, s);
    const ft = new Date(sel + 'T12:00:00Z');
    $('#scDays').innerHTML = `<div class="sc-daybar"><span class="sc-dtag ${mk.toLowerCase()}">${fl.rel === '오늘' ? '오늘' : fl.rel === '내일' ? '내일' : '다음 거래일'}</span><b>${ft.getUTCMonth() + 1}월 ${ft.getUTCDate()}일 (${fl.wd})</b><small>${mk === 'KR' ? (s.closed ? '국장 마감 · 다음 거래일 일정' : '국장 오늘 일정 · 15:30 마감 뒤엔 다음 거래일로 바뀝니다') : (s.closed ? '미장 마감 · 다음 거래일 일정' : '미장 오늘 일정 · 뉴욕 16:00 마감 뒤엔 다음 거래일로 바뀝니다')}</small></div>`;
    const d = s.days.find((x) => x.date === sel);
    if (d.holiday) { body.innerHTML = `<div class="sc-holi"><b>${esc(d.holiday)}</b><span>${mk === 'KR' ? '한국' : '미국'} 증시 휴장일입니다.</span></div>`; return; }
    const econ = d.econ.filter((e) => S.scAll || (mk === 'KR' ? e.country === 'KR' || e.imp >= 2 : e.imp >= 2));
    const seenAi = new Set(); // 같은 시각에 함께 나온 지표의 AI 해석은 한 번만
    for (const e of econ) { if (e.ai && seenAi.has(e.ai)) e.ai = null; else if (e.ai) seenAi.add(e.ai); }
    const hidden = d.econ.length - econ.length;
    const ai = s.ai && s.ai.date === d.date ? s.ai : null;
    const aiHTML = ai ? `<div class="sc-brief"><div class="sc-bh"><span class="ai-pill">AI</span><h3>오늘 일정</h3><span class="muted sm">${esc(ai.headline || '')}</span></div><div class="sc-pts">${ai.points.map((p, i) => `<div class="sc-pt"><span class="ibc-n">${i + 1}</span><div><b>${esc(p.title)}</b><small>${esc(p.why)}</small></div></div>`).join('')}</div></div>` : '';
    const stat = '' && `<div class="sc-stats">${mk === 'US' ? `<div><span>실적 발표</span><b>${d.earnTotal || d.earnings.length}</b><small>시총 3억$ 이상 ${d.earnings.length}</small></div>` : ''}<div><span>${mk === 'KR' ? '공모주' : 'IPO'}</span><b>${d.ipo.length}</b><small>${mk === 'KR' ? '청약·상장' : '상장 예정'}</small></div></div>`;
    const econCard = `<div class="card sc-card"><div class="card-h"><h3>경제지표 <b>${econ.length}</b></h3><button class="btn sm" data-sc-all>${S.scAll ? '중요 지표만' : `전체 보기${hidden ? ` (+${hidden})` : ''}`}</button></div>${econ.length ? `<div class="sc-evs">${econ.map((e) => scEconRow(e, mk)).join('')}</div>` : '<div class="empty sm">예정된 주요 경제지표가 없습니다.</div>'}<p class="note">★★★ 시장을 크게 움직이는 지표 · ★★ 중요 · ★ 참고${mk === 'KR' ? ' · 중국·일본은 중요 지표만' : ''}</p></div>`;
    const earnCard = mk === 'US' ? `<div class="card sc-card"><div class="card-h"><h3>실적 발표 <b>${d.earnTotal || d.earnings.length}</b></h3><button class="btn sm" data-go="earnings">실적 캘린더 →</button></div>${d.earnings.length ? `<div class="sc-earns">${d.earnings.slice(0, 15).map(scEarnRow).join('')}</div>` : '<div class="empty sm">시총 3억 달러 이상 기업의 실적 발표가 없습니다.</div>'}<p class="note">장전 = 미국 정규장 전(한국 밤) · 장후 = 장 마감 뒤(한국 새벽)</p></div>` : '';
    // 이 날 일정이 없으면 다가오는 일정을 대신 보여줌
    const later = []; void s.days.filter((x) => x.date > d.date).flatMap((x) => x.ipo.filter((y) => !/중/.test(y.tag)).map((y) => ({ ...y, _d: x.date }))).slice(0, 8);
    const ipoCard = `<div class="card sc-card"><div class="card-h"><h3>${mk === 'KR' ? '공모주 청약·상장' : 'IPO 상장 예정'} <b>${d.ipo.length}</b></h3></div>${d.ipo.length ? `<div class="sc-ipos">${d.ipo.map((x) => scIpoRow(x, mk)).join('')}</div>` : `<div class="empty sm">${mk === 'KR' ? '이 날은 청약·상장 일정이 없습니다.' : '이 날은 상장 예정 기업이 없습니다.'}</div>${later.length ? `<h4 class="sc-later">다가오는 일정</h4><div class="sc-ipos">${later.map((x) => scIpoRow({ ...x, tag: `${scDayLabel(x._d, s).md} ${x.tag}` }, mk)).join('')}</div>` : ''}`}${mk === 'US' ? '<p class="note">날짜는 예상 상장일이며 공모가 확정 뒤 바뀔 수 있습니다.</p>' : '<p class="note">출처: 38커뮤니케이션 · 증권신고서 정정에 따라 일정이 바뀔 수 있습니다.</p>'}</div>`;
    const evs = d.events || [];
    const srcs = (d.evSources || []).filter((x) => x.uri).slice(0, 5);
    const evCard = `<div class="card sc-card sc-evcard"><div class="card-h"><h3>주요 일정 <b>${evs.length}</b></h3><span class="muted sm">${mk === 'KR' ? '정부·정책·기업 행사' : '연준·정책·기업 행사'} · AI가 뉴스 검색으로 확인</span></div>${evs.length ? `<div class="sc-news">${evs.map((e) => `<div class="sc-nw i${e.imp}"><div class="sc-t"><b>${esc(e.time || '종일')}</b></div><div class="sc-n"><div class="sc-nh"><span class="sc-tg">${esc(e.tag)}</span><b>${esc(e.title)}</b><span class="sc-imp i${e.imp}">${'★'.repeat(e.imp)}${'☆'.repeat(3 - e.imp)}</span></div>${e.desc ? `<small>${esc(e.desc)}</small>` : ''}${e.stocks?.length ? `<div class="sc-rel">${e.stocks.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}</div></div>`).join('')}</div>${srcs.length ? `<p class="note sc-src">출처: ${srcs.map((x) => `<a href="${esc(x.uri)}" target="_blank" rel="noopener nofollow">${esc(x.title || '링크')}</a>`).join(' · ')}</p>` : ''}` : `<div class="empty sm">${d.evAt ? '확인된 주요 일정이 없습니다.' : '장 시작 전·마감 뒤에 AI가 이 날의 주요 일정을 찾아 채웁니다.'}</div>`}</div>`;
    // 경제지표는 '경제지표' 메뉴와 겹치므로 여기선 빼고, 주요 일정·공모주·IPO를 앞에
    const key = d.econ.filter((e) => e.imp >= 3);
    const keyCard = key.length ? `<div class="card sc-card"><div class="card-h"><h3>핵심 경제지표 <b>${key.length}</b></h3><button class="btn sm" data-go="econ">경제지표 전체 →</button></div><div class="sc-keys">${key.map((e) => { const [cn, cc] = CFLAG[e.country] || ['', '']; return `<div class="sc-key"><b class="mono">${esc(e.time)}</b><span class="sc-c ${cc}">${cn}</span><span class="sc-kn">${esc(e.name)}</span><small>${e.actual != null ? `<b>실제 ${esc(e.actual)}</b> · ` : ''}${e.cons ? `예상 ${esc(e.cons)}` : ''}${e.prev ? ` · 이전 ${esc(e.prev)}` : ''}</small></div>`; }).join('')}</div></div>` : '';
    body.innerHTML = `${aiHTML}${stat}<div class="sc-grid"><div>${evCard}${keyCard}</div><div>${ipoCard}</div></div>`;
  }
  function bindSched() {
    $('#scSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-sc]'); if (!b) return; S.scMk = b.dataset.sc; save('gk_scmk', S.scMk); renderSched(); loadSched(); });
    $('#scDays').addEventListener('click', (e) => { const b = e.target.closest('[data-sc-day]'); if (!b) return; S.scDay[S.scMk] = b.dataset.scDay; renderSched(); });
    $('#scBody').addEventListener('click', (e) => {
      if (e.target.closest('[data-sc-all]')) { S.scAll = !S.scAll; renderSched(); return; }
      const br = e.target.closest('[data-br]'); if (br) { S.brTab = br.dataset.br; renderSched(); return; }
      if (e.target.closest('[data-br-toggle]')) { S.brOpen = !S.brOpen; renderSched(); }
    });
  }

  // ───────────────────────── 실적 캘린더 ─────────────────────────
  async function loadEarnings() {
    if (S.earn && Date.now() - S.earn._at < 30 * 60e3) { renderEarnings(); return; }
    $('#earnBody').innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    try { S.earn = await getJSON('/api/earnings?days=20', {}); S.earn._at = Date.now(); } catch (e) { S.earn = { error: e.message, days: [], kr: [], _at: 0 }; }
    renderEarnings();
  }
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  function renderEarnings() {
    const e = S.earn;
    $$('#earnSeg button').forEach((b) => b.classList.toggle('on', b.dataset.em === S.earnMk));
    $$('#earnCap button').forEach((b) => b.classList.toggle('on', b.dataset.cap === S.earnCap));
    $('#earnCap').hidden = S.earnMk !== 'US';
    if (!e) return;
    if (e.error) { $('#earnBody').innerHTML = `<div class="empty">실적 캘린더를 불러오지 못했습니다: ${esc(e.error)}</div>`; return; }
    $('#earnMeta').textContent = `${fmtDT(new Date(e.at)).full} 기준 · 미국: Nasdaq 컨센서스 · 한국: DART IR·실적 공시`;
    if (S.earnMk === 'KR') {
      $('#earnDays').innerHTML = '';
      const kr = e.kr || [];
      $('#earnBody').innerHTML = kr.length ? `<table class="etable"><tr><th>기업</th><th>구분</th><th>내용</th><th class="num">공시일</th></tr>${kr.map((x) => `<tr data-id="${esc(x.id)}"><td><div class="co">${logoHTML('KR', x.ticker, x.name, 'sm')}<div><b>${esc(x.name)}</b><small>${esc(x.ticker || '')}${x.sector ? ' · ' + esc(x.sector) : ''}</small></div></div></td><td><span class="tm ${x.kind === '실적 발표' ? 'pre' : 'post'}">${esc(x.kind)}</span></td><td>${esc(x.title)}</td><td class="num">${esc((x.date || '').slice(5).replace('-', '.'))}</td></tr>`).join('')}</table><p class="note">한국은 공식 실적 발표 일정표가 공개되지 않아, 최근 2주간 DART에 올라온 기업설명회(IR) 개최·잠정실적 공시를 모아 보여줍니다.</p>`
        : '<div class="empty">최근 2주간 IR·잠정실적 공시가 없습니다. (DART 수집 상태를 확인하세요)</div>';
      return;
    }
    const days = e.days || [];
    if (S.earnDay >= days.length) S.earnDay = 0;
    const popSet = new Set([...(S.popular?.us || []).map((x) => x.ticker), ...S.watch.filter((w) => w.m === 'US').map((w) => w.t), ...(S.views?.top || []).filter((x) => x.src === 'US').map((x) => x.ticker)]);
    const pass = (x) => (S.earnCap === 'w' ? popSet.has(x.t) : (x.mcap || 0) >= Number(S.earnCap) * 1e9);
    $('#earnDays').innerHTML = earnCalHTML(days, pass, popSet);
    const day = days[S.earnDay];
    const rows = day ? day.us.filter(pass) : [];
    const cap = (v) => (v ? '$' + fmtBig(v) : '—');
    const tm = (t) => `<span class="tm ${t === '장전' ? 'pre' : t === '장후' ? 'post' : 'na'}">${esc(t)}</span>`;
    $('#earnBody').innerHTML = rows.length ? `<table class="etable"><tr><th>기업</th><th>발표</th><th class="num hide-m">시가총액</th><th class="num">예상 EPS</th><th class="num hide-m">작년 EPS</th><th class="num hide-m">예상 매출</th><th class="num hide-m">분기</th></tr>${rows.map((x) => `<tr data-open-co="US|${esc(x.t)}|${esc(x.n || '')}"><td><div class="co">${logoHTML('US', x.t, x.n, 'sm')}<div><b>${esc(x.ko || x.n || x.t)}${popSet.has(x.t) ? '<span class="hl">★</span>' : ''}</b><small><span class="mono">${esc(x.t)}</span>${x.sector ? ' · ' + esc(x.sector) : ''}</small></div></div></td><td>${tm(x.time)}</td><td class="num hide-m">${cap(x.mcap)}</td><td class="num">${x.eps != null ? '$' + x.eps.toFixed(2) : '—'}</td><td class="num hide-m">${x.lastEps != null ? '$' + x.lastEps.toFixed(2) : '—'}</td><td class="num hide-m">${x.rev ? '$' + fmtBig(x.rev) : '—'}</td><td class="num hide-m">${esc(x.fq || '')}</td></tr>`).join('')}</table><p class="note">장전 = 미국 정규장 시작 전(한국 시간 밤), 장후 = 미국 장 마감 후(한국 시간 새벽) 발표. ★ = 관심·인기 종목</p>`
      : `<div class="empty">${day ? '이 조건에 맞는 실적 발표 기업이 없습니다. 위에서 "전체"를 눌러 보세요.' : '일정이 없습니다.'}</div>`;
  }

  // 실적 캘린더 — 달력(월~금) 형태
  function earnCalHTML(days, pass, popSet) {
    if (!days.length) return '';
    const byDate = new Map(days.map((d, i) => [d.date, i]));
    const addD = (iso, n) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
    const first = days[0].date, last = days[days.length - 1].date;
    const wd0 = new Date(first + 'T12:00:00Z').getUTCDay();
    let cur = addD(first, -(wd0 === 0 ? 6 : wd0 - 1)); // 그 주 월요일부터
    const today = first;
    const counts = days.map((d) => d.us.filter(pass).length);
    const max = Math.max(1, ...counts);
    const total = counts.reduce((a, c) => a + c, 0);
    const m1 = Number(first.slice(5, 7)), m2 = Number(last.slice(5, 7));
    const weeks = []; let wk = [];
    while (cur <= last) {
      const wd = new Date(cur + 'T12:00:00Z').getUTCDay();
      if (wd >= 1 && wd <= 5) {
        const i = byDate.get(cur);
        const dnum = Number(cur.slice(8, 10)), mon = Number(cur.slice(5, 7));
        const mtag = dnum === 1 || cur === first ? `<em class="ec-mon">${mon}월</em>` : '';
        if (i == null) wk.push(`<div class="ec-cell past"><div class="ec-h"><span class="ec-d">${mtag}${dnum}</span></div></div>`);
        else {
          const list = days[i].us.filter(pass);
          const n = list.length, r = n / max;
          const lvl = !n ? 0 : r > .66 ? 3 : r > .33 ? 2 : 1;
          const stars = list.filter((x) => popSet.has(x.t)).length;
          const top = list.slice(0, 3);
          const pre = list.filter((x) => x.time === '장전').length, post = list.filter((x) => x.time === '장후').length;
          wk.push(`<button data-eday="${i}" class="ec-cell lv${lvl}${i === S.earnDay ? ' on' : ''}${cur === today ? ' today' : ''}" style="--r:${r.toFixed(2)}">
            <div class="ec-h"><span class="ec-d">${mtag}${dnum}</span>${cur === today ? '<i class="ec-today">오늘</i>' : stars ? `<i class="ec-star">★${stars}</i>` : ''}</div>
            <div class="ec-n">${n}<small class="pc">개 기업</small><small class="mo">곳</small></div>
            <div class="ec-bar"><span style="width:${Math.max(n ? 6 : 0, Math.round(r * 100))}%"></span></div>
            ${n ? `<div class="ec-tops">${top.map((x) => `<div class="ec-co${popSet.has(x.t) ? ' star' : ''}">${logoHTML('US', x.t, x.n, 'xs')}<b>${esc(x.ko || x.n || x.t)}</b><span class="mono">${esc(x.t)}</span></div>`).join('')}</div>
            <div class="ec-stack">${top.map((x) => logoHTML('US', x.t, x.n, 'xs')).join('')}</div>
            <div class="ec-foot">${pre ? `<span class="pre">장전 ${pre}</span>` : ''}${post ? `<span class="post">장후 ${post}</span>` : ''}${n > 2 ? `<span class="more">+${n - 2}</span>` : ''}</div>` : '<div class="ec-none">발표 없음</div>'}
          </button>`);
        }
        if (wd === 5) { weeks.push(wk); wk = []; }
      }
      cur = addD(cur, 1);
    }
    if (wk.length) { while (wk.length < 5) wk.push('<div class="ec-cell past"></div>'); weeks.push(wk); }
    const wkName = ['이번 주', '다음 주', '2주 후', '3주 후', '4주 후'];
    const sel = days[S.earnDay];
    const sdt = sel ? new Date(sel.date + 'T12:00:00Z') : null;
    return `<div class="ec-card">
      <div class="ec-top">
        <div><span class="ec-kicker">EARNINGS CALENDAR</span><b class="ec-title">${first.slice(0, 4)}년 ${m1}월${m2 !== m1 ? ` – ${m2}월` : ''}</b></div>
        <div class="ec-sum"><span><b>${total}</b>개 기업 발표 예정</span><span class="ec-legend"><i class="l1"></i><i class="l2"></i><i class="l3"></i>발표 많음</span></div>
      </div>
      <div class="ec-grid"><div class="ec-wl"></div>${['월', '화', '수', '목', '금'].map((w) => `<div class="ec-wd">${w}</div>`).join('')}
        ${weeks.map((w, k) => `<div class="ec-wl"><span>${wkName[k] || ''}</span></div>${w.join('')}`).join('')}
      </div>
    </div>
    ${sel ? `<div class="ec-selhead"><b>${Number(sel.date.slice(5, 7))}월 ${Number(sel.date.slice(8, 10))}일 (${WD[sdt.getUTCDay()]})</b><span>${counts[S.earnDay]}개 기업 · 미국 동부 기준</span></div>` : ''}`;
  }

  // ───────────────────────── 오늘의 주도 테마·섹터 ─────────────────────────
  S.thMk = load('gk_thmk', 'KR');
  const pctTxt = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
  async function loadThemes(force) {
    if (S.view !== 'themes') return;
    if (!S.themes || force || Date.now() - (S.themesAt || 0) > 60e3) {
      try { S.themes = await getJSON('/api/themes', {}); S.themesAt = Date.now(); } catch (e) { if (!S.themes) S.themes = { error: e.message }; }
    }
    renderThemes();
  }
  function thLeader(s, mk) {
    const lim = s.limit === 'up' ? '<b class="lim up">상한</b>' : s.limit === 'down' ? '<b class="lim down">하한</b>' : '';
    const label = mk === 'KR' ? s.name : s.t;
    return `<button class="th-chip" data-open-co="${mk}|${esc(s.t)}|${esc(s.name || s.nameKo || '')}">${esc(label)} <em class="${dirCls(s.pct)}">${pctTxt(s.pct)}</em>${lim}</button>`;
  }
  function thRow(g, i, kind) {
    const tot = Math.max(1, g.rise + g.fall + g.flat);
    return `<div class="th-row" data-th-no="${g.no}" data-th-kind="${kind}">
      <div class="th-top"><span class="rk">${i + 1}</span><b class="th-name">${esc(g.name)}</b><span class="th-cnt">${g.total}종목</span><span class="th-rate ${dirCls(g.rate)}">${pctTxt(g.rate)}</span><span class="th-caret">▾</span></div>
      <div class="th-breadth" title="상승 ${g.rise} · 하락 ${g.fall} · 보합 ${g.flat}"><i class="r" style="width:${(g.rise / tot) * 100}%"></i><i class="f" style="width:${(g.fall / tot) * 100}%"></i></div>
      ${g.why ? `<p class="th-why"><i>AI 추정</i>${esc(g.why)}</p>` : ''}
      ${g.leaders?.length ? `<div class="th-leaders">${g.leaders.map((s) => thLeader(s, 'KR')).join('')}</div>` : ''}
      <div class="th-more" hidden></div></div>`;
  }
  async function toggleTheme(el) {
    const box = el.querySelector('.th-more');
    if (!box) return;
    if (!box.hidden) { box.hidden = true; el.classList.remove('open'); return; }
    box.hidden = false; el.classList.add('open');
    box.innerHTML = '<div class="loading"><span class="spin"></span>종목 불러오는 중…</div>';
    try {
      const j = await getJSON(`/api/themes?kind=${el.dataset.thKind}&no=${el.dataset.thNo}`, {});
      box.innerHTML = `<ol class="rank">${(j.stocks || []).map((s, i) => rankRow({ market: 'KR', ticker: s.t, name: s.name, price: s.price, pct: s.pct }, i)).join('')}</ol>`;
    } catch (e) { box.innerHTML = `<p class="muted">불러오지 못했습니다: ${esc(e.message)}</p>`; }
  }
  function renderThemes() {
    const d = S.themes;
    $$('#thSeg button').forEach((b) => b.classList.toggle('on', b.dataset.th === S.thMk));
    if (!d) return;
    if (d.error) { $('#thBody').innerHTML = `<div class="empty">테마 정보를 불러오지 못했습니다: ${esc(d.error)}</div>`; return; }
    $('#thMeta').textContent = `${fmtDT(new Date(d.at)).full} 기준 · 1분마다 갱신`;
    if (S.thMk === 'KR') {
      const k = d.kr;
      if (!k) { $('#thBody').innerHTML = '<div class="empty">한국 테마 데이터를 불러오지 못했습니다.</div>'; return; }
      $('#thBody').innerHTML = `<div class="th-grid">
        <div class="card"><div class="card-h"><h3>오늘의 주도 테마 <b>TOP ${k.themes.length}</b></h3><span class="muted sm">네이버 증권 테마 ${k.themeCount}개 · 평균 등락률</span></div><div class="th-list">${k.themes.map((g, i) => thRow(g, i, 'theme')).join('')}</div></div>
        <div><div class="card"><div class="card-h"><h3>강한 업종 <b>TOP ${k.industries.length}</b></h3><span class="muted sm">업종 ${k.industryCount}개 중</span></div><div class="th-list">${k.industries.map((g, i) => thRow(g, i, 'industry')).join('')}</div></div>
        <div class="card" style="margin-top:1rem"><div class="card-h"><h3>약한 테마</h3><span class="muted sm">오늘 가장 많이 내린 테마</span></div><div class="th-list">${k.worstThemes.map((g, i) => thRow(g, i, 'theme')).join('')}</div></div>
        <div class="card" style="margin-top:1rem"><div class="card-h"><h3>약한 업종</h3></div><div class="th-list">${k.worstIndustries.map((g, i) => thRow(g, i, 'industry')).join('')}</div></div></div>
      </div><p class="note">테마를 누르면 소속 종목 전체가 펼쳐지고, 종목을 누르면 기업 분석(오늘 주가 움직임 이유 포함)으로 이동합니다. 막대 = 테마 안 상승(빨강)·하락(파랑) 종목 비율.</p>`;
    } else {
      const u = d.us;
      if (!u) { $('#thBody').innerHTML = '<div class="empty">미국 섹터 데이터를 불러오지 못했습니다.</div>'; return; }
      const max = Math.max(1, ...u.sectors.map((x) => Math.abs(x.pct || 0)));
      $('#thBody').innerHTML = `<div class="card"><div class="card-h"><h3>S&P 500 섹터</h3><span class="muted sm">섹터 ETF 등락률 (미국 장 기준)</span></div>
        <div class="sec-tiles">${u.sectors.map((x) => `<div class="sec-tile ${dirCls(x.pct)}" style="--a:${Math.min(1, Math.abs(x.pct || 0) / max).toFixed(2)}"><b>${esc(x.name)}</b><em>${pctTxt(x.pct)}</em><small>${esc(x.t)}</small></div>`).join('')}</div></div>
        <div class="card" style="margin-top:1rem"><div class="card-h"><h3>테마별 흐름</h3><span class="muted sm">테마 ETF 등락률 · 대표 종목</span></div>
        <div class="th-list">${u.themes.map((g, i) => `<div class="th-row us"><div class="th-top"><span class="rk">${i + 1}</span><b class="th-name">${esc(g.name)}</b><span class="th-cnt mono">${esc(g.t)}</span><span class="th-rate ${dirCls(g.pct)}">${pctTxt(g.pct)}</span></div>
          ${g.why ? `<p class="th-why"><i>AI 추정</i>${esc(g.why)}</p>` : ''}<div class="th-leaders">${(g.stocks || []).map((s) => thLeader(s, 'US')).join('')}</div></div>`).join('')}</div></div>
        <p class="note">미국은 테마 순위 데이터가 따로 없어, 섹터·테마별 대표 ETF의 등락률로 오늘 돈이 몰린 곳을 보여줍니다. 장 시작 전·후에는 직전 거래일 기준입니다.</p>`;
    }
  }

  // ───────────────────────── 미국 경제지표 ─────────────────────────
  S.ecImp = load('gk_ecimp', '2');
  S.ecSeen = null;
  async function loadEcon(scroll) {
    try { S.econ = await getJSON('/api/econ', {}); } catch (e) { if (!S.econ) S.econ = { error: e.message }; }
    econAlerts();
    if (S.view === 'econ') renderEcon();
  }
  // 새로 발표된 중요 지표 알림 (사이트를 열어두고 있을 때)
  function econAlerts() {
    const evs = (S.econ?.days || []).flatMap((d) => d.events || []).filter((e) => e.imp >= 2 && e.actual);
    if (!S.ecSeen) { S.ecSeen = new Set(evs.map((e) => e.id)); return; }
    const fresh = evs.filter((e) => !S.ecSeen.has(e.id) && Date.now() - e.ms < 3 * 3600e3);
    for (const e of evs) S.ecSeen.add(e.id);
    const top = fresh.sort((a, b) => b.imp - a.imp)[0];
    if (top) toast(`미국 ${top.ko || top.name} 발표 · 실제 ${top.actual}${top.cons ? ` (예상 ${top.cons})` : ''} — 경제지표 메뉴에서 AI 해석 확인`, 8000);
  }
  const numOf = (v) => { const m = String(v || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); if (!m) return null; let x = Number(m[0]); const u = String(v).match(/[KMBT]\b/i)?.[0]?.toUpperCase(); if (u) x *= { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[u]; return x; };
  function surprise(e) {
    if (!e.actual || !e.cons) return '';
    const a = numOf(e.actual), c = numOf(e.cons);
    if (a == null || c == null) return '';
    return a > c ? '<span class="ec-s hi">예상 상회</span>' : a < c ? '<span class="ec-s lo">예상 하회</span>' : '<span class="ec-s eq">예상 부합</span>';
  }
  const stars = (n) => `<span class="ec-imp i${n}">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span>`;
  function econAI(a) {
    const v = a.stock === '호재' ? 'pos' : a.stock === '악재' ? 'neg' : 'neu';
    const li = (arr) => (arr?.length ? arr.map((x) => `<li><b>${esc(x.sector)}</b> — ${esc(x.why)}</li>`).join('') : '<li class="muted">뚜렷한 섹터 없음</li>');
    return `<div class="ec-ai"><div class="ec-ai-h"><span class="ai-pill">AI 해석</span><b>${esc(a.headline)}</b>${a.surprise ? `<span class="ec-s">${esc(a.surprise)}</span>` : ''}<span class="verdict ${v}">미국 증시 ${esc(a.stock || '중립')}</span></div>
      ${a.summary?.length ? `<ul class="ec-sum">${a.summary.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="ec-grid2">${a.impact ? `<div><h6>주가 영향 <em class="imp-size s-${a.impact.size === '큼' ? 'big' : a.impact.size === '제한적' ? 'low' : 'mid'}">${esc(a.impact.size || '')}</em></h6><p>${esc(a.impact.text || '')}</p></div>` : ''}${a.rates ? `<div><h6>금리·달러</h6><p>${esc(a.rates)}</p></div>` : ''}${a.korea ? `<div><h6>한국 증시·환율</h6><p>${esc(a.korea)}</p></div>` : ''}</div>
      <div class="pn-big"><div class="pos"><h5><i></i>호재 섹터<em>${(a.good || []).length}</em></h5><ul>${li(a.good)}</ul></div><div class="neg"><h5><i></i>악재 섹터<em>${(a.bad || []).length}</em></h5><ul>${li(a.bad)}</ul></div></div>
      ${a.watch ? `<p class="note">다음 체크 포인트: ${esc(a.watch)}</p>` : ''}</div>`;
  }
  function renderEcon() {
    const d = S.econ;
    $$('#ecImp button').forEach((b) => b.classList.toggle('on', b.dataset.imp === S.ecImp));
    if (!d) return;
    if (d.error) { $('#ecBody').innerHTML = `<div class="empty">경제지표를 불러오지 못했습니다: ${esc(d.error)}</div>`; return; }
    $('#ecMeta').textContent = `한국 시간 기준 · ${fmtDT(new Date(d.at)).hm} 갱신 · 출처 Nasdaq 경제 일정`;
    const min = Number(S.ecImp);
    const evs = (d.days || []).flatMap((x) => x.events || []).filter((e) => e.imp >= min).sort((a, b) => a.ms - b.ms);
    const byDay = new Map();
    for (const e of evs) { const k = fmtDT(new Date(e.ms)).date; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); }
    const today = kstDay();
    const next = evs.find((e) => !e.actual && e.imp >= 3 && e.ms > Date.now());
    const shownAI = new Set();
    $('#ecBody').innerHTML = (next ? `<div class="ec-next"><span>다음 핵심 지표</span><b>${esc(next.ko || next.name)}</b><em>${fmtDT(new Date(next.ms)).md} ${fmtDT(new Date(next.ms)).hm} (${rel2(next.ms)})</em></div>` : '') +
      // 순서: 오늘 → 앞으로 발표될 날(가까운 순) → 지난 날(최근 순)
      ([...byDay.entries()].sort(([a], [b]) => { const r = (d) => (d === today ? 0 : d > today ? 1 : 2); return r(a) - r(b) || (r(a) === 2 ? b.localeCompare(a) : a.localeCompare(b)); }).map(([day, list], i, arr) => {
        const grp = day === today ? 0 : day > today ? 1 : 2, prevGrp = i ? (arr[i - 1][0] === today ? 0 : arr[i - 1][0] > today ? 1 : 2) : -1;
        const label = grp !== prevGrp && grp !== 0 ? `<div class="ec-sep">${grp === 1 ? '앞으로 발표 예정' : '지난 발표'}</div>` : '';
        const dt = new Date(list[0].ms);
        return `${label}<section class="ec-day ${day === today ? 'today' : ''}"><h3>${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일 (${WD[new Date(dt.getTime() + 9 * 3600e3).getUTCDay()]})${day === today ? '<i>오늘</i>' : ''}</h3>
          ${list.map((e) => {
            const done = !!e.actual;
            let ai = '';
            if (e.imp >= 2 && e.g && !shownAI.has(e.g)) {
              if (e.ai) { ai = econAI(e.ai); shownAI.add(e.g); }
              else if (done && Date.now() - e.ms < 3 * 3600e3) { ai = '<div class="ec-ai wait"><span class="spin"></span>발표됐습니다 · AI 해석을 준비하는 중 (1~2분)</div>'; shownAI.add(e.g); }
            }
            return `<div class="ec-row ${done ? 'done' : ''} i${e.imp}">
              <span class="ec-time mono">${fmtDT(new Date(e.ms)).hm}</span>${stars(e.imp)}
              <div class="ec-name"><b>${esc(e.ko || e.name)}</b><small>${esc(e.ko ? e.name : '')}</small>${!done && e.desc && e.imp >= 2 ? `<p>${esc(e.desc)}</p>` : ''}</div>
              <div class="ec-vals"><span><small>실제</small><b class="${done ? 'act' : ''}">${esc(e.actual || '—')}</b></span><span><small>예상</small>${esc(e.cons || '—')}</span><span><small>이전</small>${esc(e.prev || '—')}</span>${surprise(e)}</div>
            </div>${ai}`;
          }).join('')}</section>`;
      }).join('') || '<div class="empty">표시할 지표가 없습니다.</div>') +
      '<p class="note">★★★ 시장을 크게 움직이는 핵심 지표 · ★★ 중요 · ★ 참고. 중요 지표가 발표되면 1~2분 안에 AI가 결과를 해석해 주가 영향과 호재·악재 섹터를 올려드립니다. 투자 참고용입니다.</p>';
  }
  function rel2(ms) { const m = Math.round((ms - Date.now()) / 60e3); return m < 60 ? `${m}분 후` : m < 1440 ? `${Math.floor(m / 60)}시간 ${m % 60}분 후` : `${Math.floor(m / 1440)}일 후`; }

  // ───────────────────────── 모달 ─────────────────────────
  function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; }
  async function openDigestModal() {
    openModal(`<h2>AI가 고른 오늘의 핵심 공시 ${S.digestMk === 'KR' ? '· 국내' : S.digestMk === 'US' ? '· 미국' : ''}</h2><div class="loading"><span class="spin"></span>AI가 오늘의 공시·보도자료를 살펴보는 중… (최대 20초)</div>`);
    let d;
    try { d = await getJSON(`/api/digest?mk=${S.digestMk}`, {}); } catch (e) {
      if ($('#modal').hidden) return;
      $('#modalBody').innerHTML = `<h2>AI가 고른 오늘의 핵심 공시</h2>${e.data?.needsKey ? aiKeyHelp() : `<p class="err">AI 분석을 불러오지 못했습니다: ${esc(e.message)}</p>${aiKeyHelp(true)}`}${digestFallback()}`;
      return;
    }
    if ($('#modal').hidden) return;
    const vc = (v) => (v === '긍정' ? 'pos' : v === '부정' ? 'neg' : 'neu');
    $('#modalBody').innerHTML = `<h2>AI가 고른 오늘의 핵심 공시</h2><p class="dg-head">${esc(d.headline || '')}</p>
      ${(d.items || []).map((x, i) => `<div class="dg-item" data-id="${esc(x.id)}"><span class="dg-n">${i + 1}</span><div><div class="dg-c">${x.market === 'KR' ? '한국' : '미국'} · ${esc(x.company || '')}</div><div class="dg-t">${esc(x.title)}</div><div class="dg-w">${esc(x.why)}</div></div><span class="verdict ${vc(x.verdict)}">${esc(x.verdict)}</span></div>`).join('') || '<div class="empty">오늘은 아직 주요 공시가 없습니다.</div>'}
      <p class="note">${d.at ? fmtDT(new Date(d.at)).full + ' 분석 · ' : ''}1시간마다 새로 분석합니다. 투자 참고용이며 투자 권유가 아닙니다.</p>`;
  }
  function digestFallback() {
    const arr = [...S.items.values()].filter((n) => n.kind !== 'NEWS' && (S.digestMk === 'ALL' || n.market === S.digestMk) && n.impact >= 4 && Date.now() - n.ms < 72 * 3600e3).sort((a, b) => b.impact - a.impact || b.ms - a.ms).slice(0, 7);
    if (!arr.length) return '';
    return `<h3 style="margin:1.2rem 0 .3rem;font-size:1rem">자동 분류 기준 중요 공시·보도자료</h3>${arr.map((n, i) => `<div class="dg-item" data-id="${esc(n.id)}"><span class="dg-n">${i + 1}</span><div><div class="dg-c">${n.market === 'KR' ? '한국' : '미국'} · ${esc(n.name || n.ticker || '')}</div><div class="dg-t">${esc(n.head)}</div><div class="dg-w">${esc(n.sub || '')}</div></div><span>${tagsHTML(n, 2, true)}</span></div>`).join('')}`;
  }
  function aiKeyHelp(invalid) {
    return `<div class="box"><h4>AI 분석을 켜는 방법</h4><div style="font-size:.88rem;color:var(--text2);line-height:1.8">
      ${invalid ? '현재 등록된 AI 키가 인식되지 않습니다(키 오류 또는 사용 한도 초과).<br>' : ''}
      1) <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>에서 무료 Gemini API 키(AIza… 또는 AQ.… 형식) 발급<br>
      2) Cloudflare → Workers 및 Pages → gkstock-cf → 설정 → 변수 및 비밀에 <b>GEMINI_API_KEY</b>(비밀 유형)로 등록<br>
      3) 저장 후 <code>/api/health?ai=1</code> 에서 확인</div></div>`;
  }
  function openSettings() {
    const fsOpt = [['fs-m', '보통'], ['fs-l', '크게'], ['fs-xl', '아주 크게']];
    openModal(`<h2>설정</h2>
      <div class="set-row"><div>글자 크기<small>화면 전체 글자 크기</small></div><div class="seg" id="fsSeg">${fsOpt.map(([v, l]) => `<button data-fs="${v}" class="${S.fs === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="set-row"><div>관심종목 알림<small>관심종목 새 공시·보도자료가 나오면 알림음 + 알림 창</small></div><input type="checkbox" class="tg" data-set="watchAlert" ${S.watchAlert !== false ? 'checked' : ''}></div>
      <div class="set-row"><div>알림음<small>중요 공시 소식이 오면 소리</small></div><input type="checkbox" class="tg" data-set="sound" ${S.sound ? 'checked' : ''}></div>
      <div class="set-row"><div>데스크톱 알림<small>관심종목·매우 중요한 항목</small></div><input type="checkbox" class="tg" data-set="notify" ${S.notify ? 'checked' : ''}></div>
      <h3 style="margin:1.2rem 0 .5rem;font-size:1rem">관심종목 (${S.watch.length})</h3>
      <div class="chips">${S.watch.map((w) => `<span class="wchip">${esc(w.m === 'KR' ? w.n || w.t : w.t)}<button data-unwatch="${esc(w.m)}|${esc(w.t)}">✕</button></span>`).join('') || '<span class="muted">없음 — 목록의 ☆를 눌러 추가하세요.</span>'}</div>
      <p class="note">설정과 관심종목은 이 브라우저에만 저장됩니다.</p>`);
  }

  // ───────────────────────── 상세 페이지 (공시·보도자료·뉴스를 누르면 전체 화면으로) ─────────────────────────
  const verdictCls = (v) => (v === '긍정' ? 'pos' : v === '부정' ? 'neg' : 'neu');
  // 공시별 고유 주소: gk-stock.com/p/공시ID (공유·검색용). 예전 #item/ID 주소도 계속 열림
  const ITEM_RE = /^\/p\/((?:SEC|DART)-[\d-]+|(?:NEWS|PR)-[a-z0-9]+)\/?$/;
  function itemIdFromUrl() {
    const m = location.pathname.match(ITEM_RE);
    if (m) return m[1];
    const h = location.hash.match(/^#item\/(.+)$/);
    return h ? decodeURIComponent(h[1]) : null;
  }
  function openItem(id) {
    if (!S.items.has(id)) return;
    if (S.view !== 'item') { S.listScroll = window.scrollY; S.returnUrl = location.pathname === '/' ? '/' + (location.hash || '#' + (S.view || 'home')) : '/#home'; S.fromList = true; }
    history.pushState({ item: id }, '', '/p/' + id);
    showItem(id);
  }
  function backToList() {
    if (S.fromList) { S.fromList = false; history.back(); return; }
    history.pushState(null, '', S.returnUrl || '/#home');
    route();
  }
  function showItem(id) {
    S.view = 'item';
    $('#viewFeed').hidden = true;
    for (const [k, sel] of Object.entries(PAGES)) $(sel).hidden = k !== 'item';
    $$('#nav button').forEach((b) => b.classList.remove('on'));
    const n = S.items.get(id);
    if (!n) {
      // 목록에 없는 항목(오래된 공시·공유 링크) → 서버에서 한 건만 받아오기
      const tried = S.extraTried.get(id);
      if (!tried) {
        S.extraTried.set(id, 'loading');
        getJSON(`/api/item?id=${encodeURIComponent(id)}`, {}).then((j) => {
          const r = j.item; if (!r) throw new Error('없음');
          S.extra.set(id, r); S.extraTried.set(id, 'ok');
          S.items.set(id, normRaw(r));
        }).catch(() => S.extraTried.set(id, 'fail')).finally(() => { if (itemIdFromUrl() === id) showItem(id); });
      }
      $('#itemBody').innerHTML = tried === 'fail' ? `<div class="empty-big">이 항목을 찾을 수 없습니다.<div class="chips center"><button data-go="home">목록으로</button></div></div>` : '<div class="empty-big"><span class="spin"></span>불러오는 중…</div>';
      return;
    }
    S.sel = id;
    S.aTab = 'fin';
    trackItem(id);
    $('#itemBody').innerHTML = articleHTML(n);
    loadAdminViews(id);
    queueTranslate([n]);
    window.scrollTo({ top: 0 });
    document.title = `${n.head} | GK의 공시레이더`;
    if (n.ticker) { trackView(n.market, n.ticker, n.name); loadQuoteHead(n); }
    loadAI(n);
    loadArticleDoc(n);
    loadArticleSide(n);
  }
  function articleHTML(n) {
    let when;
    if (n.src === 'DART' && n.when) {
      when = n.when.official ? `DART 접수 ${n.when.official.replace(/-/g, '.')}` : n.raw.date;
      if (n.when.seen) when += ` · 수집 ${fmtDT(new Date(n.when.seen)).full}`;
    } else {
      when = `${fmtDT(new Date(n.ms)).full} KST`;
      if (n.src === 'SEC') when += ` · ${fmtDT(new Date(n.ms), 'America/New_York').full} ET`;
    }
    const on = n.ticker && inWatch(n.market, n.ticker);
    const sec = sectorOf(n.market, n.ticker);
    const news = n.kind === 'NEWS' && !n.ticker;
    const kindKo = n.kind === 'FILING' ? '공시' : n.kind === 'PR' ? '보도자료' : '뉴스';
    return `<div class="a-top"><button class="btn sm" data-back>← 목록으로</button><button class="btn sm" data-share="${esc(n.id)}" title="이 공시의 고유 주소를 복사합니다">🔗 링크 복사</button><span id="aAdmin"></span><span class="crumb">${kindKo} · ${n.market === 'KR' ? '한국' : '미국'}${n.ticker ? ' · ' + esc(n.market === 'KR' ? n.name : n.ticker) : ''}</span></div>
      <header class="a-head card">
        <div class="a-co">
          ${logoHTML(n.market, n.ticker, news ? n.source : n.name, 'lg', news)}
          <div class="dp-co"><div class="t1"><b>${esc(n.market === 'KR' ? n.name || n.ticker || '' : n.name || n.ticker || n.source || '')}</b>${n.ticker ? `<span class="tk">${esc(n.ticker)}</span>` : ''}</div>
            <div class="t2"><span class="mk ${n.market === 'KR' ? 'kr' : 'us'}">${n.market === 'KR' ? '한국' : '미국'}</span>${n.exchange ? `<span>${esc(exShort(n.exchange))}</span>` : ''}${sec ? `<span class="sector">${esc(sec)}</span>` : ''}${n.ticker ? `<button class="link" data-star="${esc(n.market)}|${esc(n.ticker)}|${esc(n.name || '')}">${on ? '★ 관심종목' : '☆ 관심종목 추가'}</button>` : ''}</div></div>
          <div class="dp-px" id="aPx"></div>
        </div>
        <div class="dp-meta" style="margin-top:1rem"><span class="src">${SRC_BADGE[n.src]}${n.form && n.kind === 'FILING' ? ' · ' + esc(n.form) : ''}</span>${n.source && n.kind !== 'FILING' ? `<span>${esc(n.source)}</span>` : ''}<span class="mono">${esc(when)}</span></div>
        <h1 class="a-title ${n.cls}" id="aHead">${esc(n.head)}</h1>
        <div class="dp-meta" id="aTags">${tagsHTML(n, 6, true)}</div>
        ${n.orig ? `<div class="orig">원문 제목: ${esc(n.orig)}</div>` : ''}
        <div class="dp-meters" id="aMeters">${metersHTML(n, true)}</div>
      </header>
      <div class="article">
        <section class="a-sec"><h3>AI 애널리스트 분석 <small>섹터 전문 애널리스트 관점의 핵심 요약 · 호재/악재 · 체크포인트</small></h3><div id="aAI">${aiPane(n)}</div></section>
        ${extraCards(n) ? `<section class="a-sec">${extraCards(n)}</section>` : ''}
        ${n.ticker ? `<section class="a-sec a-fin"><h3>기업 정보 <small>${n.market === 'KR' ? 'DART' : 'Nasdaq'} 기준</small></h3><div id="aCo">${coPane(n, null, { chart: false, metrics: false })}</div>
          <div class="box ftabs-box"><div class="ftabs" id="aTabs" role="tablist">${finTabs(n).map(([k, l]) => `<button role="tab" data-ftab="${k}" class="${(S.aTab || 'fin') === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="aTab">${finTabBody(n)}</div></div></section>
        <section class="a-sec a-two"><div class="box"><h4>차트 <small>${n.market === 'KR' ? '네이버 증권 일봉' : 'TradingView'}</small></h4>${chartHTML(n.market, n.ticker, n.exchange)}</div><div><div class="box" id="aRel"></div><button class="btn block" style="margin-top:.7rem" data-open-co="${esc(n.market)}|${esc(n.ticker)}|${esc(n.name || '')}">기업 분석 페이지로 →</button></div></section>` : ''}
        <section class="a-sec"><div id="aDoc">${docPane(n, null)}</div></section>
        ${n.ticker ? '' : '<section class="a-sec"><div class="box" id="aRel"></div></section>'}
      </div>`;
  }

  function extraCards(n) {
    const r = n.raw;
    if (r.tx?.main) {
      const t = r.tx, m = t.main, buy = m.code === 'P';
      return `<div class="box"><h4>내부자 거래 내역 <small>SEC Form 4 원문</small></h4><div class="metrics">
        <div><span>거래</span><b class="${buy ? 'buy' : m.code === 'S' ? 'sell' : ''}">${esc(m.label)}</b></div><div><span>수량</span><b>${fmtInt(m.shares)}주</b></div><div><span>금액</span><b>${usd(m.value)}</b></div><div><span>평균 단가</span><b>${m.price ? '$' + fmtPx(m.price) : '—'}</b></div></div>
        <dl class="kv" style="margin-top:.8rem"><dt>보고자</dt><dd>${esc(personName(t.owner))}${t.relation ? ` · ${esc(t.relation)}` : ''}</dd><dt>거래일</dt><dd class="mono">${esc(t.date || '')}</dd><dt>거래 후 보유</dt><dd class="mono">${fmtInt(t.after)}주</dd>${t.tenb51 ? '<dt>비고</dt><dd>10b5-1 사전계획 거래</dd>' : ''}</dl></div>`;
    }
    if (r.detail && n.src === 'DART') {
      const d = r.detail;
      return `<div class="box"><h4>지분 변동 <small>DART</small></h4><div class="metrics">
        <div><span>증감</span><b class="${d.change > 0 ? 'buy' : d.change < 0 ? 'sell' : ''}">${signedInt(d.change)}주</b></div><div><span>보유</span><b>${fmtInt(d.shares)}주</b></div><div><span>지분율</span><b>${d.rate ?? '—'}%</b></div><div><span>보고자</span><b>${esc(d.who || '—')}</b></div></div>${d.reason ? `<p class="note">사유: ${esc(d.reason)}</p>` : ''}</div>`;
    }
    if (r.items?.length && n.src === 'SEC') return `<div class="box"><h4>8-K 보고 항목</h4><dl class="kv">${r.items.map((x) => `<dt class="mono">Item ${esc(x.code)}</dt><dd>${esc(x.ko)}</dd>`).join('')}</dl></div>`;
    return '';
  }
  // AI 탭
  function aiPane(n) {
    const a = S.ai.get(n.id);
    if (!a) {
      const q = S.aiq.get(n.id);
      if (q) return `<div class="box a-sum"><h4>AI 빠른 요약 <span class="verdict ${verdictCls(q.verdict)}">주가 영향: ${esc(q.verdict || '중립')}</span></h4>
        ${q.headline ? `<p style="margin:.2rem 0 .5rem;font-weight:700">${esc(q.headline)}</p>` : ''}<ol class="sum5">${q.summary.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
        <div class="box"><div class="loading"><span class="spin"></span>섹터 애널리스트 AI가 긍정·부정 요인과 심층 코멘트를 작성하는 중… (끝나면 자동으로 바뀝니다)</div></div>`;
      return `<div class="box"><h4>AI 분석</h4><div class="loading"><span class="spin"></span>AI가 원문을 읽는 중… 핵심 요약이 곧 나오고, 심층 분석은 이어서 표시됩니다</div></div>`;
    }
    if (a.error) return `<div class="box"><h4>AI 분석</h4><p class="err">분석하지 못했습니다: ${esc(a.error)}</p><button class="btn sm" data-ai-retry>다시 시도</button></div>`;
    const li = (arr) => (arr && arr.length ? arr.map((x) => `<li>${esc(x)}</li>`).join('') : `<li class="muted">${a.fallback ? 'AI 분석이 끝나면 표시됩니다' : '뚜렷한 요인 없음'}</li>`);
    return `<div class="box a-sum"><h4>${a.fallback ? '핵심 내용 (자동 요약)' : 'AI 핵심 요약'} <span class="verdict ${verdictCls(a.verdict)}">주가 영향: ${esc(a.verdict || '중립')}</span></h4>
        <ol class="sum5">${(a.summary || []).slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
      <div class="pn-big">
        <div class="pos"><h5><i></i>긍정적 요인<em>${(a.positive || []).length}</em></h5><ul>${li(a.positive)}</ul></div>
        <div class="neg"><h5><i></i>부정적 요인<em>${(a.negative || []).length}</em></h5><ul>${li(a.negative)}</ul></div>
      </div>
      ${a.analyst ? `<div class="box analyst"><h4>애널리스트 코멘트 ${a.sector ? `<small>${esc(a.sector)} 섹터 시니어 애널리스트 관점</small>` : ''}</h4>
        ${a.impact ? `<div class="impact-row"><span class="imp-size s-${a.impact.size === '큼' ? 'big' : a.impact.size === '제한적' ? 'low' : 'mid'}">주가 영향 ${esc(a.impact.size)}</span>${a.impact.short ? `<span><b>단기</b>${esc(a.impact.short)}</span>` : ''}${a.impact.mid ? `<span><b>중기</b>${esc(a.impact.mid)}</span>` : ''}</div>` : ''}
        <p class="take">${esc(a.analyst)}</p>
        ${a.points?.length ? `<div class="apoints">${a.points.map((x) => `<div><h6>${esc(x.t)}</h6><p>${esc(x.d)}</p></div>`).join('')}</div>` : ''}
        ${a.watch?.length ? `<h4 style="margin:1rem 0 0">앞으로 체크할 포인트</h4><ul class="watch">${a.watch.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : ''}
      ${a.fallback ? `<p class="note">AI 분석이 잠시 준비되지 않아 원문의 핵심 문장과 키워드로 자동 정리했습니다. <button class="link" data-ai-retry>AI로 다시 분석</button></p>`
        : `<p class="note">${esc(a.provider || 'AI')}가 ${a.basis ? esc(a.basis) : '원문'}을 읽고 작성한 참고용 분석입니다. 투자 판단 전 원문을 확인하세요.</p>`}`;
  }

  // 마우스를 올려두면(0.25초) 클릭 전에 AI 분석·원문·기업 정보를 미리 요청 → 누르는 순간 이미 준비됨
  const aiPending = new Map();
  const qPending = new Set();
  // 빠른 요약(3~5초) 먼저 받아서, 심층 분석이 오기 전까지 보여줌
  function startQuick(id) {
    if (S.ai.has(id) || S.aiq.has(id) || qPending.has(id)) return;
    qPending.add(id);
    getJSON(`/api/analyze?id=${encodeURIComponent(id)}&quick=1`, {}).then((q) => {
      if (!q?.summary?.length) return;
      if (!q.quick) { if (!S.ai.has(id)) { S.ai.set(id, q); aiPending.delete(id); } } // 이미 심층 분석이 있었음
      else S.aiq.set(id, q);
      const n = S.items.get(id);
      if (n && S.sel === id && S.view === 'item' && $('#aAI')) { $('#aAI').innerHTML = aiPane(n); if (!q.quick) applyAI(n); }
    }).catch(() => {}).finally(() => qPending.delete(id));
  }
  function prefetchItem(id) {
    const n = S.items.get(id);
    if (!n) return;
    startQuick(id);
    if (!S.ai.has(id) && !aiPending.has(id)) aiPending.set(id, getJSON(`/api/analyze?id=${encodeURIComponent(id)}`, {}).catch((e) => ({ error: e.message })));
    if (!S.doc.has(id)) loadDoc(n);
    if (n.ticker && hasCo(n)) fetchCo(coUrl(n.market, n.ticker, n.corpCode, n.exchange));
  }
  let hoverTimer = null;
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('[data-id]');
    if (!el || !el.closest('#list, #trend, #digestList, #aRel')) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => prefetchItem(el.dataset.id), 250);
  });
  document.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-id]')) clearTimeout(hoverTimer); });
  document.addEventListener('touchstart', (e) => { const el = e.target.closest?.('[data-id]'); if (el) prefetchItem(el.dataset.id); }, { passive: true });

  async function loadAI(n, force) {
    const had = S.ai.get(n.id);
    if (had && !force && !had.error && !had.fallback) { if (S.sel === n.id && $('#aAI')) $('#aAI').innerHTML = aiPane(n); return; }
    S.ai.delete(n.id);
    if (!force) startQuick(n.id);
    if (S.sel === n.id && $('#aAI')) $('#aAI').innerHTML = aiPane(n);
    let a;
    const pre = !force && aiPending.get(n.id);
    const fresh = force || had?.fallback; // 자동 요약이었으면 AI로 다시 요청
    try { a = pre && !fresh ? await pre : await getJSON(`/api/analyze?id=${encodeURIComponent(n.id)}${fresh ? '&r=' + Date.now() : ''}`, fresh ? { cache: 'no-store' } : {}); }
    catch (e) { a = { error: e.message }; }
    aiPending.delete(n.id);
    S.ai.set(n.id, a);
    applyAI(n);
    if (a.fallback && !force && !n._aiAuto) { n._aiAuto = true; setTimeout(() => { if (S.sel === n.id && S.view === 'item' && S.ai.get(n.id)?.fallback) loadAI(n, true); }, 20000); }
    if (S.sel !== n.id || S.view !== 'item') return;
    $('#aAI').innerHTML = aiPane(n);
    $('#aHead').textContent = n.head;
    $('#aTags').innerHTML = tagsHTML(n, 6, true);
    $('#aMeters').innerHTML = metersHTML(n, true);
    if (a.overview) { const d = coOf(n); if (d && !d.overviewKo) { d.overviewKo = a.overview; $('#aCo').innerHTML = coPane(n, d, { chart: false, compact: true, metrics: false }); } }
  }
  async function loadQuoteHead(n) {
    await fetchQuotes([wkey(n.market, n.ticker)]);
    const q = quoteOf(n.market, n.ticker);
    if (S.sel !== n.id || !$('#aPx')) return;
    const p0 = p0Of(n);
    const after = q && p0 ? ((q.price - p0) / p0) * 100 : null;
    $('#aPx').innerHTML = q ? `<b>${pxStr({ ...q, market: n.market })}</b><em class="${dirCls(q.pct)}">오늘 ${q.pct > 0 ? '▲' : q.pct < 0 ? '▼' : ''} ${fmtPct(q.pct)}</em>${after != null ? `<span class="px-after ${dirCls(after)}" title="발표 시점 주가 대비">발표 후 <b>${after > 0 ? '▲' : after < 0 ? '▼' : ''}${fmtPct(after)}</b><small>발표 시점 ${n.market === 'KR' ? fmtInt(p0) + '원' : '$' + fmtPx(p0)}</small></span>` : ''}` : '';
  }

  // 기업·재무
  const hasCo = (n) => !!n.ticker && (n.market !== 'KR' || !!n.corpCode) && !/^13F/i.test(n.form || '');
  function coUrl(m, t, corp, ex) {
    if (m === 'KR') return corp ? `/api/company?src=KR&t=${encodeURIComponent(t || '')}&corp=${corp}&ex=${encodeURIComponent(ex || '')}` : null;
    return t ? `/api/company?src=US&t=${encodeURIComponent(t)}` : null;
  }
  const coOf = (n) => S.co.get(coUrl(n.market, n.ticker, n.corpCode, n.exchange));
  const coPending = new Map();
  async function fetchCo(url) {
    if (!url) return null;
    if (S.co.has(url)) return S.co.get(url);
    if (coPending.has(url)) return coPending.get(url);
    const p = getJSON(url, {}).catch((e) => ({ error: e.message })).then((d) => { S.co.set(url, d); coPending.delete(url); if (d && !d.error && d.src === 'US' && d.overviewRaw && !d.overviewKo) pollOvKo(url); return d; });
    coPending.set(url, p);
    return p;
  }
  // 영문 기업 소개는 서버에서 AI가 한국어로 옮기는 중 → 잠시 뒤 다시 받아서 화면의 소개 문단만 바꿔 끼움
  function pollOvKo(url, i = 0) {
    if (i >= 4) return;
    setTimeout(async () => {
      let d = null;
      try { d = await getJSON(url + '&ko=' + Date.now(), { cache: 'no-store' }); } catch {}
      if (!d?.overviewKo) return pollOvKo(url, i + 1);
      const cur = S.co.get(url); if (cur && !cur.error) cur.overviewKo = d.overviewKo;
      const ko = d.overviewKo.length > 600 ? d.overviewKo.slice(0, 598) + '…' : d.overviewKo;
      $$('p.ov[data-co]').forEach((el) => { if (el.dataset.co === url) el.textContent = ko; });
    }, [12, 20, 30, 45][i] * 1000);
  }
  function metricsHTML(d) {
    const f = d.fin || {}, r = d.ratios || {}, cur = d.currency;
    const yoy = (a, b) => (a !== null && a !== undefined && b ? ((a - b) / Math.abs(b)) * 100 : null);
    const y = (a, b) => { const v = yoy(a, b); return v === null ? '<em>&nbsp;</em>' : `<em class="${dirCls(v)}">전년비 ${fmtPct(v)}</em>`; };
    const x = (v, suf = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(Math.abs(v) >= 100 ? 0 : 2) + suf);
    return `<div class="metrics">
      <div class="wide"><span>시가총액</span><b>${money(d.marketCap, cur)}</b><em>${d.price ? `현재가 ${cur === 'KRW' ? fmtInt(d.price) + '원' : '$' + fmtPx(d.price)}` : '&nbsp;'}</em></div>
      <div><span>매출</span><b>${money(f.revenue, cur)}</b>${y(f.revenue, f.revenuePrev)}</div>
      <div><span>영업이익</span><b>${money(f.opIncome, cur)}</b>${y(f.opIncome, f.opIncomePrev)}</div>
      <div><span>순이익</span><b>${money(f.netIncome, cur)}</b>${y(f.netIncome, f.netIncomePrev)}</div>
      <div><span>부채비율</span><b>${x(r.debt, '%')}</b></div>
      <div><span>ROE</span><b>${x(r.roe, '%')}</b></div>
      <div><span>ROA</span><b>${x(r.roa, '%')}</b></div>
      <div><span>PER</span><b>${x(r.per, '배')}</b></div>
      <div><span>PBR</span><b>${x(r.pbr, '배')}</b></div>
      <div><span>EPS</span><b>${perShare(r.eps, cur)}</b></div>
      <div><span>BPS</span><b>${perShare(r.bps, cur)}</b></div>
    </div>
    <p class="note">재무: ${esc(f.period || '-')} · 지표: ${esc(r.basis || '-')} · 출처 ${d.src === 'KR' ? 'DART' : 'Nasdaq'} · 부채비율 = 부채총계 ÷ 자본총계</p>`;
  }
  function tvSymbol(t, ex) {
    ex = String(ex || '').toUpperCase();
    const pre = ex.includes('NASDAQ') ? 'NASDAQ:' : ex.includes('NYSE') ? 'NYSE:' : ex.includes('CBOE') ? 'CBOE:' : '';
    return pre + String(t).replace('-', '.');
  }
  function chartHTML(m, t, ex) {
    if (m === 'KR') return `<div style="background:#fff;border-radius:12px;overflow:hidden;margin-top:.6rem"><img src="https://ssl.pstatic.net/imgfinance/chart/item/candle/day/${esc(t)}.png?t=${(Date.now() / 6e4) | 0}" alt="일봉 차트" style="width:100%;display:block" referrerpolicy="no-referrer"></div>`;
    const url = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSymbol(t, ex))}&interval=D&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=12153a&theme=dark&style=1&timezone=Asia%2FSeoul&withdateranges=1&locale=kr`;
    return `<div class="chart"><iframe src="${url}" loading="lazy" title="차트"></iframe></div>`;
  }
  function coPane(n, d, { chart = true, compact = false, metrics = true } = {}) {
    if (!n.ticker) return '<div class="box"><p class="muted" style="margin:0">이 항목은 연결된 상장 종목이 없어 기업 정보를 표시할 수 없습니다.</p></div>';
    if (n.market === 'KR' && !n.corpCode) return '<div class="box"><p class="muted" style="margin:0">DART 고유번호를 찾지 못해 기업 정보를 표시할 수 없습니다.</p></div>';
    if (!d) return '<div class="box"><div class="loading"><span class="spin"></span>기업 정보·재무 불러오는 중…</div></div>';
    if (d.error) return `<div class="box"><p class="err">기업 정보를 불러오지 못했습니다: ${esc(d.error)}</p>${/DART_API_KEY/.test(d.error) ? '<p class="note">Cloudflare 변수에 DART_API_KEY를 등록하면 표시됩니다.</p>' : ''}</div>`;
    const ov = d.overviewKo || d.overviewRaw || '';
    const tags = [d.sectorKo || sectorOf(n.market, n.ticker) || d.sector, d.industry && !d.sectorKo ? d.industry : '', d.ceo ? `대표 ${d.ceo}` : '', d.founded ? `설립 ${d.founded}` : ''].filter(Boolean);
    return `<div class="box"><h4>${esc(d.name || n.name || n.ticker)} <small>${esc(d.products ? '주요 제품: ' + d.products : '')}</small></h4>
      <p class="ov" data-co="${esc(coUrl(n.market, n.ticker, n.corpCode, n.exchange) || '')}">${ov ? esc(ov.length > 600 ? ov.slice(0, 598) + '…' : ov) : '사업 개요 정보를 찾지 못했습니다.'}${!d.overviewKo && d.overviewRaw && d.src === 'US' ? ' <small class="muted">(영문 원문 · 잠시 뒤 한국어로 바뀝니다)</small>' : ''}</p>
      <div class="co-tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}${d.homepage ? `<a class="link" href="${esc(d.homepage)}" target="_blank" rel="noopener">홈페이지 ↗</a>` : ''}</div></div>
      ${metrics ? `<div class="box"><h4>핵심 재무·투자지표</h4>${metricsHTML(d)}</div>` : ''}
      ${chart ? `<div class="box"><h4>차트 <small>${n.market === 'KR' ? '네이버 증권 일봉' : 'TradingView'}</small></h4>${chartHTML(n.market, n.ticker, n.exchange)}</div>` : ''}`;
  }
  // 공매도·수급
  const stockUrl = (m, t, corp) => (m === 'KR' ? `/api/stock?src=KR&t=${encodeURIComponent(t)}${corp ? '&corp=' + corp : ''}` : `/api/stock?src=US&t=${encodeURIComponent(t)}`);
  async function fetchStock(url) {
    let d = S.stock.get(url);
    if (d && Date.now() - d._at < 5 * 60e3) return d;
    try { d = await getJSON(url, {}); d._at = Date.now(); S.stock.set(url, d); return d; } catch (e) { return { error: e.message }; }
  }
  const note = (m) => `<p class="muted" style="margin:0;font-size:.88rem">${esc(m)}</p>`;
  function stockHTML(m, d) {
    if (!d) return '<div class="box"><div class="loading"><span class="spin"></span>공매도·내부자·기관 데이터 불러오는 중…</div></div>';
    if (d.error) return `<div class="box"><p class="err">불러오지 못했습니다: ${esc(d.error)}</p></div>`;
    return m === 'KR' ? krStockHTML(d) : usStockHTML(d);
  }
  function usShortHTML(d) {
    if (!d.short?.length) return `<h4>공매도 잔고</h4>${note(d.errors?.short || '데이터 없음')}`;
    const s0 = d.short[0], s1 = d.short[1];
    const chg = s1 && s1.interest ? ((s0.interest - s1.interest) / s1.interest) * 100 : null;
    return `<h4>공매도 잔고 <small>FINRA · ${esc(s0.date)} 결제일 기준 · 월 2회 발표</small></h4><div class="mini-stats"><div><span>공매도 잔고</span><b>${fmtBig(s0.interest)}주</b></div><div><span>직전 대비</span><b class="${dirCls(chg)}">${fmtPct(chg)}</b></div><div><span>숏커버 소요일</span><b>${s0.days !== null && s0.days !== undefined ? s0.days.toFixed(1) + '일' : '—'}</b></div></div>
      <table class="tbl"><tr><th>결제일</th><th>잔고</th><th class="hide-m">일평균 거래량</th><th>커버일</th></tr>${d.short.map((r) => `<tr><td>${esc(r.date)}</td><td>${nx(r.interest, false)}</td><td class="hide-m">${nx(r.avgVol, false)}</td><td>${r.days !== null && r.days !== undefined ? r.days.toFixed(2) : '—'}</td></tr>`).join('')}</table>`;
  }
  function usInsiderHTML(d) {
    const i = d.insider;
    if (!i) return `<h4>내부자 거래</h4>${note(d.errors?.insider || '데이터 없음')}`;
    return `<h4>내부자 거래 <small>최근 3개월 매수 ${i.buys3m ?? 0}건 · 매도 ${i.sells3m ?? 0}건</small></h4><div class="mini-stats"><div><span>3개월 순매매</span><b class="${dirCls(i.net3m)}">${signedInt(i.net3m)}주</b></div><div><span>12개월 순매매</span><b class="${dirCls(i.net12m)}">${signedInt(i.net12m)}주</b></div><div><span>거래 건수</span><b>${fmtInt((i.rows || []).length)}건</b></div></div>
      <table class="tbl"><tr><th>내부자</th><th>일자</th><th>거래</th><th>수량</th><th class="hide-m">가격</th></tr>${(i.rows || []).slice(0, 15).map((r) => `<tr><td class="t">${esc(titleCase(r.who))}<br><small>${esc(r.relation || '')}</small></td><td>${esc(r.date)}</td><td class="t ${/Buy/i.test(r.type) ? 'buy' : /Sell/i.test(r.type) ? 'sell' : ''}">${esc(r.type)}</td><td>${nx(r.shares, false)}</td><td class="hide-m">${r.price ? '$' + fmtPx(r.price) : '—'}</td></tr>`).join('')}</table>`;
  }
  function usInstHTML(d) {
    const s = d.inst;
    if (!s) return `<h4>기관 보유</h4>${note(d.errors?.inst || '데이터 없음')}`;
    return `<h4>기관 보유 <small>13F · 분기 단위</small></h4><div class="metrics"><div><span>기관 보유율</span><b>${esc(s.pct || '—')}</b></div><div><span>비중 확대</span><b class="up">${fmtInt(s.increased?.holders)}곳</b></div><div><span>비중 축소</span><b class="down">${fmtInt(s.decreased?.holders)}곳</b></div><div><span>신규 / 청산</span><b>${fmtInt(s.newPos?.holders)} / ${fmtInt(s.soldOut?.holders)}</b></div></div>
      <table class="tbl" style="margin-top:.7rem"><tr><th>기관</th><th>기준일</th><th>보유 주식</th><th>변동</th></tr>${(s.top || []).slice(0, 15).map((r) => `<tr><td class="t">${esc(r.name)}</td><td>${esc(r.date)}</td><td>${fmtBig(r.shares)}</td><td class="${dirCls(r.change)}">${nx(r.change)}<br><small>${esc(r.changePct || '')}</small></td></tr>`).join('')}</table>`;
  }
  function usStockHTML(d) { return [usShortHTML, usInsiderHTML, usInstHTML].map((f) => `<div class="box">${f(d)}</div>`).join(''); }
  const krYmd = (s) => (s && s.length === 8 ? `${s.slice(4, 6)}.${s.slice(6, 8)}` : esc(s || ''));
  const kisMsg = (e) => (e === 'KIS_APP_KEY 미설정' ? '한국투자증권 API 키(KIS_APP_KEY·KIS_APP_SECRET)를 등록하면 표시됩니다.' : e || '데이터 없음');
  function krInvHTML(d) {
    if (!d.investors?.length) return `<h4>투자자별 순매수 (기관·외국인)</h4>${note(kisMsg(d.errors?.investors))}`;
    const sum = (k) => d.investors.slice(0, 5).reduce((a, r) => a + (r[k] || 0), 0);
    return `<h4>투자자별 순매수 <small>최근 ${d.investors.length}거래일 · 주</small></h4><div class="mini-stats"><div><span>외국인 5일 누적</span><b class="${dirCls(sum('foreign'))}">${nx(sum('foreign'))}주</b></div><div><span>기관 5일 누적</span><b class="${dirCls(sum('inst'))}">${nx(sum('inst'))}주</b></div><div><span>개인 5일 누적</span><b class="${dirCls(sum('person'))}">${nx(sum('person'))}주</b></div></div>
      <table class="tbl"><tr><th>일자</th><th class="hide-m">종가</th><th>개인</th><th>외국인</th><th>기관</th></tr>${d.investors.map((r) => `<tr><td>${krYmd(r.date)}</td><td class="hide-m">${fmtInt(r.close)}</td><td class="${dirCls(r.person)}">${nx(r.person)}</td><td class="${dirCls(r.foreign)}">${nx(r.foreign)}</td><td class="${dirCls(r.inst)}">${nx(r.inst)}</td></tr>`).join('')}</table>`;
  }
  function krShortHTML(d) {
    if (!d.short?.length) return `<h4>공매도</h4>${note(kisMsg(d.errors?.short))}`;
    return `<h4>공매도 거래 <small>일별 · 잔고는 KRX 로그인 전용</small></h4><table class="tbl"><tr><th>일자</th><th>종가</th><th>공매도 수량</th><th>거래 비중</th></tr>${d.short.map((r) => `<tr><td>${krYmd(r.date)}</td><td>${fmtInt(r.close)}</td><td>${nx(r.qty, false)}</td><td>${r.ratio !== null && r.ratio !== undefined ? r.ratio.toFixed(2) + '%' : '—'}</td></tr>`).join('')}</table>`;
  }
  function krInsHTML(d) {
    if (!d.insider?.length) return `<h4>임원·주요주주 지분 변동</h4>${note(d.errors?.insider || '최근 보고 없음')}`;
    return `<h4>임원·주요주주 지분 변동 <small>DART · 내부자 거래</small></h4><table class="tbl"><tr><th>보고자</th><th>보고일</th><th>증감</th><th class="hide-m">보유</th><th>비율</th></tr>${d.insider.map((r) => `<tr><td class="t">${esc(r.who)}<br><small>${esc(r.role || '')}</small></td><td>${esc(r.date)}</td><td class="${dirCls(r.change)}">${nx(r.change)}</td><td class="hide-m">${nx(r.shares, false)}</td><td>${r.rate ?? '—'}%</td></tr>`).join('')}</table>`;
  }
  function krMajorHTML(d) {
    if (!d.major?.length) return `<h4>5% 이상 대량보유</h4>${note(d.errors?.major || '최근 보고 없음')}`;
    return `<h4>5% 이상 대량보유 <small>DART · 기관 지분</small></h4><table class="tbl"><tr><th>보고자</th><th>보고일</th><th>증감</th><th>지분율</th></tr>${d.major.map((r) => `<tr><td class="t">${esc(r.who)}<br><small>${esc(r.reason || r.type || '')}</small></td><td>${esc(r.date)}</td><td class="${dirCls(r.change)}">${nx(r.change)}</td><td>${r.rate ?? '—'}%<br><small class="${dirCls(r.rateChange)}">(${r.rateChange > 0 ? '+' : ''}${r.rateChange ?? 0})</small></td></tr>`).join('')}</table>`;
  }
  function krStockHTML(d) { return [krInvHTML, krShortHTML, krInsHTML, krMajorHTML].map((f) => `<div class="box">${f(d)}</div>`).join(''); }

  // 상세 페이지의 재무/수급 탭 (한 번에 하나만 보여줌)
  const finTabs = (n) => (n.market === 'KR'
    ? [['fin', '핵심 재무제표'], ['inv', '투자자별 수급'], ['short', '공매도'], ['ins', '임원·주요주주'], ['major', '5% 대량보유']]
    : [['fin', '핵심 재무제표'], ['short', '공매도 잔고'], ['ins', '내부자 거래'], ['inst', '기관 보유']]);
  function finTabBody(n) {
    const tab = finTabs(n).some(([k]) => k === S.aTab) ? S.aTab : 'fin';
    if (tab === 'fin') {
      if (!hasCo(n)) return note(n.market === 'KR' ? 'DART 고유번호를 찾지 못해 재무제표를 표시할 수 없습니다.' : '재무 정보를 표시할 수 없는 종목입니다.');
      const d = coOf(n);
      if (!d) return '<div class="loading"><span class="spin"></span>핵심 재무제표 불러오는 중…</div>';
      if (d.error) return `<p class="err">재무 정보를 불러오지 못했습니다: ${esc(d.error)}</p>`;
      return metricsHTML(d);
    }
    const d = S.stock.get(stockUrl(n.market, n.ticker, n.corpCode));
    if (!d) return '<div class="loading"><span class="spin"></span>데이터 불러오는 중…</div>';
    if (d.error) return `<p class="err">불러오지 못했습니다: ${esc(d.error)}</p>`;
    const f = n.market === 'KR' ? { inv: krInvHTML, short: krShortHTML, ins: krInsHTML, major: krMajorHTML }[tab] : { short: usShortHTML, ins: usInsiderHTML, inst: usInstHTML }[tab];
    return f(d);
  }
  function paintFinTab(n) {
    if (S.sel !== n.id || !$('#aTab')) return;
    $('#aTab').innerHTML = finTabBody(n);
    $$('#aTabs button').forEach((b) => b.classList.toggle('on', b.dataset.ftab === (finTabs(n).some(([k]) => k === S.aTab) ? S.aTab : 'fin')));
  }
  // 원문
  async function loadDoc(n) {
    if (S.doc.has(n.id)) return S.doc.get(n.id);
    try { const d = await getJSON(`/api/doc?id=${encodeURIComponent(n.id)}`, {}); S.doc.set(n.id, d); return d; } catch (e) { const d = { error: e.message }; S.doc.set(n.id, d); setTimeout(() => S.doc.get(n.id) === d && S.doc.delete(n.id), 30000); return d; }
  }
  const koRatio = (txt) => { const t = String(txt || '').replace(/\s/g, '').slice(0, 4000); return t ? (t.match(/[가-힣]/g) || []).length / t.length : 0; };
  const isEnglishDoc = (d) => !!d && !d.error && (d.lines || []).length > 0 && koRatio((d.lines || []).join(' ')) < 0.08;
  function docBody(n, d, full) {
    return d.html ? `<div class="doc html${full ? ' full' : ''}">${d.html}</div>` : `<div class="doc${full ? ' full' : ''}">${esc((d.lines || []).join('\n')) || '<span class="muted">내용이 없습니다.</span>'}</div>`;
  }
  function trBody(n, full) {
    const t = S.trdoc.get(n.id);
    if (!t || t.pending) return `<div class="loading tr-wait"><span class="spin"></span>AI가 원문 전체를 한국어로 번역하고 있습니다… (길이에 따라 10~40초, 한 번 번역된 문서는 바로 열립니다)</div>`;
    if (t.error) return `<p class="err">번역하지 못했습니다: ${esc(t.error)}</p><button class="btn sm" data-tr-retry>다시 번역</button> <button class="btn sm" data-doclang="en">영어 원문 보기</button>`;
    return `<div class="doc ko${full ? ' full' : ''}">${(t.lines || []).map((l) => `<p>${esc(l)}</p>`).join('')}</div>${t.cut ? '<p class="note">문서가 매우 길어 앞부분(약 15,000자)만 번역했습니다. 나머지는 영어 원문 탭에서 볼 수 있습니다.</p>' : ''}${t.partial ? '<p class="note">일부 문단은 번역에 실패해 영어로 남아 있습니다. <button class="link" data-tr-retry>다시 번역</button></p>' : ''}`;
  }
  function docPane(n, d, full) {
    const title = n.kind === 'FILING' ? '공시 원문' : n.kind === 'PR' ? '보도자료 전문' : '기사 본문';
    if (!d) return `<div class="box"><h4>${title}</h4><div class="loading"><span class="spin"></span>원문 불러오는 중…</div></div>`;
    const link = `<a class="link" href="${esc(d.url || n.url || '#')}" target="_blank" rel="noopener">원문 사이트 ↗</a>`;
    if (d.error) return `<div class="box"><h4>원문 ${link}</h4><p class="err">원문을 불러오지 못했습니다: ${esc(d.error)}</p></div>`;
    const en = isEnglishDoc(d);
    const lang = en ? S.docLang || 'ko' : 'orig';
    const tabs = en ? `<div class="ftabs doc-tabs"><button data-doclang="ko" class="${lang === 'ko' ? 'on' : ''}">한국어 번역</button><button data-doclang="en" class="${lang === 'en' ? 'on' : ''}">영어 원문</button></div>` : '';
    return `<div class="box"><h4>${title} <small>${esc(n.source || (n.src === 'SEC' ? 'SEC EDGAR' : n.src === 'DART' ? 'DART' : ''))}</small> <span style="margin-left:auto">${link}</span></h4>${tabs}${d.note ? `<p class="note" style="margin-top:0">${esc(d.note)}</p>` : ''}${lang === 'ko' ? trBody(n, full) : docBody(n, d, full)}</div>`;
  }
  function paintDoc(n) {
    if (S.sel !== n.id || S.view !== 'item' || !$('#aDoc')) return;
    $('#aDoc').innerHTML = docPane(n, S.doc.get(n.id), true);
  }
  async function loadTrDoc(n, force) {
    const c = S.trdoc.get(n.id);
    if (c && !c.error && !force) return;
    S.trdoc.set(n.id, { pending: true });
    paintDoc(n);
    let t;
    try { t = await getJSON(`/api/translate-doc?id=${encodeURIComponent(n.id)}${force ? '&r=' + Date.now() : ''}`, force ? { cache: 'no-store' } : {}); if (!t.lines?.length) t = { error: t.error || '번역 결과가 비어 있습니다' }; }
    catch (e) { t = { error: e.message }; }
    S.trdoc.set(n.id, t);
    paintDoc(n);
  }
  async function loadArticleDoc(n) {
    const d = await loadDoc(n);
    if (S.sel !== n.id || S.view !== 'item') return;
    paintDoc(n);
    if (isEnglishDoc(d)) loadTrDoc(n);
  }
  async function loadArticleSide(n) {
    renderRelated(n);
    if (!n.ticker) return;
    if (hasCo(n)) fetchCo(coUrl(n.market, n.ticker, n.corpCode, n.exchange)).then((d) => { if (S.sel === n.id && $('#aCo')) { $('#aCo').innerHTML = coPane(n, d, { chart: false, compact: true, metrics: false }); paintFinTab(n); } });
    else paintFinTab(n);
    const su = stockUrl(n.market, n.ticker, n.corpCode);
    fetchStock(su).then((d) => { if (!S.stock.has(su)) S.stock.set(su, d); paintFinTab(n); });
  }
  function renderRelated(n) {
    const box = $('#aRel');
    if (!box) return;
    const arr = n.ticker ? [...S.items.values()].filter((x) => x.id !== n.id && x.market === n.market && x.ticker === n.ticker).sort((a, b) => b.ms - a.ms).slice(0, 6) : [];
    const more = arr.length ? arr : [...S.items.values()].filter((x) => x.id !== n.id && x.kind === n.kind && x.market === n.market).sort((a, b) => b.ms - a.ms).slice(0, 6);
    box.innerHTML = `<h4>${arr.length ? '이 종목의 다른 소식' : '최신 ' + (n.kind === 'FILING' ? '공시' : n.kind === 'PR' ? '보도자료' : '뉴스')}</h4>${more.map((x) => `<div class="rel" data-id="${esc(x.id)}"><span class="mono">${fmtDT(new Date(x.ms)).md} ${fmtDT(new Date(x.ms)).hm}</span><b>${esc(x.market === 'KR' ? x.name || '' : x.ticker || x.name || '')}</b><p>${esc(x.head)}</p></div>`).join('') || '<p class="muted" style="margin:0">없음</p>'}`;
  }


  // ───────────────────────── 기업 분석 화면 ─────────────────────────
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
      try { const j = await getJSON(`/api/search?v=2&q=${encodeURIComponent(t)}`, {}); const x = (j.items || []).find((y) => y.market === 'KR' && y.ticker === t); if (x) { c.corpCode = x.corpCode; c.name = name || x.name; } } catch {}
    }
    S.coCur = c;
    closeModal();
    setView('company', `#company/${m}/${t}`);
    trackView(m, t, c.name);
    const on = inWatch(m, t), sec = sectorOf(m, t);
    const n = { market: m, ticker: t, corpCode: c.corpCode, name: c.name, exchange: c.exchange };
    $('#coBody').innerHTML = `<div class="co-hero">${logoHTML(m, t, c.name, 'lg')}<div><h3>${esc(c.name)}</h3><div class="dp-meta"><span class="mk ${m === 'KR' ? 'kr' : 'us'}">${m === 'KR' ? '한국' : '미국'}</span><span class="mono">${esc(t)}</span>${c.exchange ? `<span>${esc(exShort(c.exchange))}</span>` : ''}${sec ? `<span class="sector">${esc(sec)}</span>` : ''}<button class="link" data-star="${esc(m)}|${esc(t)}|${esc(c.name)}">${on ? '★ 관심종목' : '☆ 관심종목 추가'}</button></div></div><div class="px" id="coPx"></div></div>
      <div id="coWhy"></div>
      <div class="co-grid"><div><div id="coInfo">${coPane(n, null)}</div><div class="box"><h4>공시·보도자료 전체 기록 <small id="coRecentN"></small></h4><div id="coRecent"></div></div></div>
      <div><div id="coFlows">${stockHTML(m, null)}</div><div class="links">${coLinks(c)}</div></div></div>`;
    renderCoRecent();
    loadWhy(c);
    fetchQuotes([wkey(m, t)]).then(() => { const q = quoteOf(m, t); if (S.coCur === c && $('#coPx')) $('#coPx').innerHTML = q ? `<b>${pxStr({ ...q, market: m })}</b><span class="${dirCls(q.pct)} mono">${q.pct > 0 ? '▲' : q.pct < 0 ? '▼' : ''} ${fmtPct(q.pct)}</span>` : ''; });
    const url = coUrl(m, t, c.corpCode, c.exchange);
    if (url) fetchCo(url).then((d) => { if (S.coCur === c) $('#coInfo').innerHTML = coPane(n, d); });
    else $('#coInfo').innerHTML = coPane(n, null);
    fetchStock(stockUrl(m, t, c.corpCode)).then((d) => { if (S.coCur === c) $('#coFlows').innerHTML = stockHTML(m, d); });
  }
  // 오늘 주가 움직임 이유 (공시가 없어도 뉴스로)
  async function loadWhy(c) {
    const box = () => (S.coCur === c ? $('#coWhy') : null);
    if (box()) box().innerHTML = `<div class="box why-box"><h4>오늘 주가 움직임 <small>뉴스 · AI 추정</small></h4><div class="loading"><span class="spin"></span>관련 뉴스를 찾는 중…</div></div>`;
    let d;
    try { d = await getJSON(`/api/why?mk=${c.m}&t=${encodeURIComponent(c.t)}&name=${encodeURIComponent(c.name || '')}`, {}); } catch (e) { d = { error: e.message }; }
    if (!box()) return;
    box().innerHTML = whyHTML(d, c);
  }
  function whyHTML(d, c) {
    if (d.error) return `<div class="box why-box"><h4>오늘 주가 움직임</h4><p class="muted" style="margin:0">관련 뉴스를 불러오지 못했습니다.</p></div>`;
    const news = d.news || [];
    const used = new Set((d.basis || []).map((n) => n - 1));
    const hint = [d.peers?.group?.length ? `같은 그룹 동반 ${d.pct >= 0 ? '상승' : '하락'}: ${d.peers.group.join(', ')}` : '', d.peers?.sector ? `같은 업종(${d.peers.sector.name}) ${d.peers.sector.n}개 종목 동반 ${d.pct >= 0 ? '상승' : '하락'}` : ''].filter(Boolean);
    const pct = d.pct != null ? `<span class="${dirCls(d.pct)} mono">${d.pct > 0 ? '▲' : d.pct < 0 ? '▼' : ''} ${fmtPct(d.pct)}</span>` : '';
    const reason = d.reason
      ? `<div class="why-reason ${d.conf === '낮음' ? 'low' : ''}"><span class="ai-pill">AI 추정</span><b>${esc(d.reason)}</b>${d.conf ? `<em>신뢰도 ${esc(d.conf)}</em>` : ''}</div>`
      : `<div class="why-reason low"><b>${d.pct != null && Math.abs(d.pct) < 1 ? '오늘은 큰 움직임이 없습니다.' : news.length ? '아래 최근 뉴스를 참고하세요.' : '관련 뉴스를 찾지 못했습니다.'}</b></div>`;
    return `<div class="box why-box"><h4><span>오늘 주가 움직임 ${pct}</span><small>공시 외 뉴스 · 동반 움직임 기준</small></h4>
      ${reason}${hint.length ? `<div class="why-hint">${hint.map((h) => `<span>${esc(h)}</span>`).join('')}</div>` : ''}
      ${news.length ? `<ul class="why-news">${news.slice(0, 6).map((x, i) => `<li class="${used.has(i) ? 'used' : ''}"><a href="${esc(x.url || '#')}" target="_blank" rel="noopener">${esc(x.title)}</a><small>${esc(x.src || '')} · ${rel(Date.parse(x.at))}</small></li>`).join('')}</ul>` : ''}
      <p class="note">뉴스 제목과 동반 움직임을 바탕으로 AI가 추정한 내용입니다. 실제 원인과 다를 수 있으니 원문 기사를 확인하세요.</p></div>`;
  }
  function coLinks(c) {
    if (c.m === 'KR') return `<a class="btn" href="https://finance.naver.com/item/main.naver?code=${esc(c.t)}" target="_blank" rel="noopener">네이버 증권 ↗</a><a class="btn" href="https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm=${encodeURIComponent(c.name || '')}" target="_blank" rel="noopener">DART 공시 ↗</a>`;
    return `<a class="btn" href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(c.t)}&owner=include&count=40" target="_blank" rel="noopener">SEC 전체 공시 ↗</a><a class="btn" href="https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(c.t.toLowerCase())}" target="_blank" rel="noopener">Nasdaq ↗</a>`;
  }
  function renderCoRecent() {
    const c = S.coCur;
    if (!c || !$('#coRecent')) return;
    const all = [...S.items.values()].filter((n) => n.market === c.m && n.ticker && n.ticker.toUpperCase() === c.t && n.kind !== 'NEWS').sort((a, b) => b.ms - a.ms);
    const shown = all.slice(0, c.recentLimit || 20);
    $('#coRecentN').textContent = all.length ? `${fmtInt(all.length)}건${c.histLoading ? ' · 과거 공시 불러오는 중…' : ''}` : '';
    $('#coRecent').innerHTML = shown.length ? shown.map(rowHTML).join('') + (all.length > shown.length ? `<button class="btn more-btn" data-co-more>더 보기 (${fmtInt(all.length - shown.length)}건 남음)</button>` : '')
      : `<p class="muted" style="margin:0">${c.histLoading ? '<span class="spin"></span> 과거 공시를 불러오는 중…' : '보관된 공시가 없습니다.'}</p>`;
    // 이 회사의 과거 공시 전체를 서버 보관소에서 (처음 한 번)
    if (!c.histLoaded && !c.histLoading) {
      c.histLoading = true;
      const qs = new URLSearchParams({ ticker: c.t, mk: c.m, limit: '200', deep: '1' });
      if (c.corpCode) qs.set('corp', c.corpCode);
      getJSON('/api/archive?' + qs.toString(), {}).then((j) => addArchived(j.items)).catch(() => {}).finally(() => { c.histLoading = false; c.histLoaded = true; if (S.coCur === c) renderCoRecent(); });
      setTimeout(() => { if (S.coCur === c) renderCoRecent(); }, 0);
    }
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
    const byTime = (a, b) => b.ms - a.ms, all = [...S.items.values()];
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
      box.innerHTML = list.length ? list.slice(0, 100).map((n, i) => { const d = n.raw.detail; const val = d && d.change !== null && d.change !== undefined ? `${signedInt(d.change)}주` : n.raw.category === 'inst' ? '5%' : '임원'; return fRow(i + 1, 'KR', n.ticker, n.name, esc(d ? `${d.who || ''}${d.role ? ' · ' + d.role : ''}` : n.raw.formKo), val, n.when?.official ? n.when.official.slice(5).replace('-', '.') : '', d?.change > 0 ? 'buy' : d?.change < 0 ? 'sell' : '', `data-id="${esc(n.id)}"`); }).join('') : `<div class="empty">${S.loaded.dart ? '최근 임원·5% 보고가 없습니다. (DART_API_KEY가 필요합니다)' : '불러오는 중…'}</div>`;
      return;
    }
    const f = S.flows;
    if (!f) { box.innerHTML = '<div class="empty">불러오는 중…</div>'; pollFlows(); return; }
    if (f.needsKis) { box.innerHTML = '<div class="empty"><b>한국투자증권 Open API 키가 필요합니다.</b><br>국내 기관·외국인 순매수와 공매도 데이터는 증권사 API로만 무료 제공됩니다.<br>Cloudflare 변수에 <code>KIS_APP_KEY</code>, <code>KIS_APP_SECRET</code>를 등록하세요.</div>'; $('#flowMeta').textContent = ''; return; }
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
  const FEED_VIEWS = { home: 'PR', filings: 'FILING', pr: 'PR', watch: 'ALL' };
  const PAGES = { issue: '#viewIssue', sched: '#viewSched', themes: '#viewThemes', econ: '#viewEcon', admin: '#viewAdmin', item: '#viewItem', earnings: '#viewEarnings', popular: '#viewPopular', company: '#viewCompany', flows: '#viewFlows', market: '#viewMarket', guide: '#viewGuide' };
  function setView(v, hash) {
    S.view = v;
    const feed = v in FEED_VIEWS;
    $('#viewFeed').hidden = !feed;
    for (const [k, sel] of Object.entries(PAGES)) $(sel).hidden = k !== v;
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === v));
    if (hash !== false) { const u = '/' + (hash || '#' + v); if (location.pathname !== '/') history.pushState(null, '', u); else history.replaceState(null, '', u); }
    if (feed) { S.type = v === 'home' ? S.homeType || 'ALL' : FEED_VIEWS[v]; S.limit = 80; renderAll(); }
    if (v !== 'item') { S.sel = null; document.title = 'GK의 공시레이더 | 미국·한국 실시간 공시·보도자료'; }
    if (v === 'market') renderMarket();
    if (v === 'earnings') loadEarnings();
    if (v === 'themes') loadThemes();
    if (v === 'sched') loadSched();
    if (v === 'econ') loadEcon(true);
    if (v === 'admin') renderAdmin();
    if (v === 'popular') { renderPopularPage(); pollViews(); }
    if (v === 'flows') { renderFlows(); if (!S.flows || Date.now() - (S.flowsAt || 0) > 180e3) { S.flowsAt = Date.now(); pollFlows(); } }
    if (v === 'company' && !S.coCur) renderCoQuick();
    if (feed && S.listScroll != null) { const y = S.listScroll; S.listScroll = null; requestAnimationFrame(() => window.scrollTo({ top: y })); } else window.scrollTo({ top: 0 });
  }
  function renderCoQuick() {
    const base = (S.popular?.kr || []).slice(0, 4).map((x) => [x.market, x.ticker, x.name]).concat((S.popular?.us || []).slice(0, 4).map((x) => [x.market, x.ticker, x.name]));
    const list = base.length ? base : [['US', 'NVDA', 'NVIDIA'], ['US', 'TSLA', 'Tesla'], ['US', 'AAPL', 'Apple'], ['KR', '005930', '삼성전자'], ['KR', '000660', 'SK하이닉스']];
    $('#coQuick').innerHTML = list.map(([m, t, n]) => `<button data-open-co="${esc(m)}|${esc(t)}|${esc(n || '')}">${esc(m === 'KR' ? n || t : t)}</button>`).join('');
  }
  function route() {
    const im = location.pathname.match(ISS_RE);
    if (im) { showIssuePage(im[1], location.hash.slice(1) || null); return; }
    const id = itemIdFromUrl();
    if (id) {
      if (!ITEM_RE.test(location.pathname)) history.replaceState(null, '', '/p/' + id); // 예전 #item 주소 → 새 주소
      showItem(id);
      return;
    }
    const h = decodeURIComponent(location.hash.slice(1));
    const m = h.match(/^company\/(US|KR)\/([A-Z0-9.\-]+)/i);
    if (m) { openCompany(m[1].toUpperCase(), m[2]); return; }
    if (/^item\//.test(h)) { showItem(h.slice(5)); return; }
    setView(h in FEED_VIEWS || h in PAGES ? h : 'home', false); // (#news 등 없어진 메뉴는 홈으로)
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
      if (feed) opts.push(`<button data-kw="${esc(q)}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>"${esc(q)}" 키워드로 공시·뉴스 검색</button>`);
      if (list.length) opts.push('<div class="sg-h">종목</div>' + list.map((x) => `<button data-open-co="${esc(x.market)}|${esc(x.ticker)}|${esc(x.name || '')}" data-corp="${esc(x.corpCode || '')}" data-ex="${esc(x.exchange || '')}">${logoHTML(x.market, x.ticker, x.name, 'sm')}<span>${esc(x.name || x.ticker)}</span><small>${x.market === 'KR' ? '한국' : '미국'} · ${esc(x.ticker)}</small></button>`).join(''));
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
        try { remote = (await getJSON(`/api/search?v=2&q=${encodeURIComponent(q)}`, {})).items || []; } catch {}
        if (my !== seq) return;
        const seen = new Set(local.map((x) => wkey(x.market, x.ticker)));
        render(q, [...local, ...remote.filter((x) => !seen.has(wkey(x.market, x.ticker)))].slice(0, 12), false);
      }, 250);
    });
    input.addEventListener('keydown', (e) => {
      const btns = $$('button', box);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!btns.length) return; act = (act + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length; btns.forEach((b, i) => b.classList.toggle('act', i === act)); return; }
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
    for (const id of ['#search', '#search2']) { const el = $(id); if (el) { el.value = q; el.blur(); } }
    if (!(S.view in FEED_VIEWS) || S.view === 'watch') setView('home'); else renderAll();
    $('#search').blur();
  }

  // ───────────────────────── 관심종목·설정 ─────────────────────────
  function toggleWatch(m, t, n) {
    const k = wkey(m, t);
    if (S.watch.some((w) => wkey(w.m, w.t) === k)) { S.watch = S.watch.filter((w) => wkey(w.m, w.t) !== k); toast(`${m === 'KR' ? n || t : t} 관심종목 해제`); }
    else { S.watch.push({ m, t: t.toUpperCase(), n }); toast(`${m === 'KR' ? n || t : t} 관심종목 추가 ★ · 새 공시가 나오면 알림음과 알림이 뜹니다`); askNotifyPermission(); try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } catch {} }
    save('gk_watch2', S.watch);
    if (S.view in FEED_VIEWS) renderFeed();
    renderWatchbar();
    $$('[data-star]').forEach((b) => {
      const [bm, bt] = b.dataset.star.split('|');
      if (wkey(bm, bt) !== k) return;
      const on = inWatch(bm, bt);
      b.classList.toggle('on', on);
      b.textContent = b.classList.contains('star') ? (on ? '★' : '☆') : on ? '★ 관심종목' : '☆ 관심종목 추가';
    });
  }
  function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms); }
  async function setSetting(key, on, el) {
    if (key === 'notify' && on) {
      if (!('Notification' in window)) { toast('이 브라우저는 알림을 지원하지 않습니다'); if (el) el.checked = false; return; }
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') { toast('브라우저 알림 권한이 필요합니다'); if (el) el.checked = false; return; }
    }
    S[key] = on; save('gk_' + key, on);
    $$(`[data-set="${key}"]`).forEach((x) => (x.checked = on));
    if (key === 'sound' && on) chime(false);
    if (key === 'watchAlert') { if (on) { watchChime(); askNotifyPermission(); } toast(on ? '관심종목 알림 켜짐' : '관심종목 알림 꺼짐'); return; }
    toast(key === 'sound' ? (on ? '알림음 켜짐' : '알림음 꺼짐') : on ? '데스크톱 알림 켜짐' : '데스크톱 알림 꺼짐');
  }

  // ───────────────────────── 방문 통계 기록 (관리자 본인 방문은 제외) ─────────────────────────
  function sendTrack(body) {
    if (S.admin) return;
    try { fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {}); } catch {}
  }
  function trackPV() {
    let ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch {}
    sendTrack({ t: 'pv', ref, m: isMobile() });
  }
  function trackItem(id) {
    try { const k = 'gk_iv_' + id; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch {}
    sendTrack({ t: 'item', id });
  }
  async function loadAdminViews(id) {
    if (!S.admin) return;
    try {
      const j = await getJSON(`/api/admin?key=${encodeURIComponent(S.admin)}&item=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (S.sel === id && $('#aAdmin')) $('#aAdmin').innerHTML = `<span class="admin-badge" title="관리자에게만 보입니다">👁 조회 ${fmtInt(j.views?.[id] || 0)}회 <small>(최근 30일 · 관리자만 보임)</small></span>`;
    } catch {}
  }

  // ───────────────────────── 관리자 화면 (gk-stock.com/#admin) ─────────────────────────
  async function renderAdmin() {
    const box = $('#adminBody');
    if (!S.admin) {
      box.innerHTML = `<div class="page-head"><h2>관리자</h2></div><div class="card admin-login"><p>관리자 비밀번호(Cloudflare 변수 <code>ADMIN_KEY</code>에 등록한 값)를 입력하세요.</p><form id="adminForm"><input type="password" id="adminKey" placeholder="관리자 비밀번호" autocomplete="current-password"><button class="btn" type="submit">들어가기</button></form><p class="err" id="adminErr"></p></div>`;
      $('#adminForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const k = $('#adminKey').value.trim();
        try { await getJSON(`/api/admin?key=${encodeURIComponent(k)}&item=x`, { cache: 'no-store' }); S.admin = k; save('gk_admin', k); renderAdmin(); }
        catch (er) { $('#adminErr').textContent = er.message; }
      });
      return;
    }
    box.innerHTML = '<div class="page-head"><h2>관리자 · 방문 통계</h2></div><div class="card"><div class="loading"><span class="spin"></span>불러오는 중…</div></div>';
    let d;
    try { d = await getJSON(`/api/admin?key=${encodeURIComponent(S.admin)}`, { cache: 'no-store' }); }
    catch (e) { box.innerHTML = `<div class="page-head"><h2>관리자</h2></div><div class="card"><p class="err">${esc(e.message)}</p><button class="btn sm" data-admin-logout>다시 로그인</button></div>`; return; }
    const maxPv = Math.max(1, ...d.days.map((x) => x.pv));
    const maxHr = Math.max(1, ...d.hours);
    const devT = (d.dev.m || 0) + (d.dev.d || 0) || 1;
    const mon = d.monitor?.checks ? Object.values(d.monitor.checks) : [];
    box.innerHTML = `<div class="page-head"><h2>관리자 · 방문 통계</h2><div class="chips" style="margin:0"><button class="btn sm" data-admin-act="refresh">새로고침</button><button class="btn sm" data-admin-logout>로그아웃</button></div></div>
      <div class="adm-kpis">
        ${[['오늘', d.today], ['최근 7일', d.week], ['최근 30일', d.month]].map(([l, x]) => `<div class="card"><span>${l}</span><div><b>${fmtInt(x?.uv || 0)}</b><small>방문자</small></div><div><b>${fmtInt(x?.pv || 0)}</b><small>페이지뷰</small></div><div><b>${fmtInt(x?.iv || 0)}</b><small>게시물 조회</small></div></div>`).join('')}
      </div>
      <div class="adm-grid">
        <div class="card"><h3>일별 방문 (최근 30일)</h3><div class="adm-bars">${d.days.map((x) => `<div title="${x.d} · 방문자 ${x.uv} · 페이지뷰 ${x.pv}"><i style="height:${Math.round((x.pv / maxPv) * 100)}%"></i><i class="uv" style="height:${Math.round((x.uv / maxPv) * 100)}%"></i><span>${x.d.slice(8)}</span></div>`).join('')}</div><p class="note">■ 페이지뷰 ■ 방문자 · 막대에 마우스를 올리면 숫자가 보입니다</p></div>
        <div class="card"><h3>오늘 시간대별 (KST)</h3><div class="adm-bars hrs">${d.hours.map((v, i) => `<div title="${i}시 · ${v}회"><i style="height:${Math.round((v / maxHr) * 100)}%"></i><span>${i % 3 ? '' : i}</span></div>`).join('')}</div>
          <h3 style="margin-top:1rem">기기 (최근 7일)</h3><div class="adm-dev"><span style="width:${Math.round(((d.dev.m || 0) / devT) * 100)}%">휴대폰 ${Math.round(((d.dev.m || 0) / devT) * 100)}%</span><span>컴퓨터 ${Math.round(((d.dev.d || 0) / devT) * 100)}%</span></div></div>
      </div>
      <div class="adm-grid">
        <div class="card"><h3>많이 본 게시물 (최근 7일)</h3><ol class="adm-list">${d.topItems.map((x) => `<li data-id="${esc(x.id)}" data-adm-open="${esc(x.id)}"><b>${fmtInt(x.n)}</b><span>${x.ticker ? `<em>${esc(x.market === 'KR' ? x.name || x.ticker : x.ticker)}</em>` : ''}${esc(x.title)}</span></li>`).join('') || '<li class="muted">아직 기록이 없습니다.</li>'}</ol></div>
        <div class="card"><h3>유입 경로 (최근 7일)</h3><ol class="adm-list">${d.refs.map((x) => `<li><b>${fmtInt(x.n)}</b><span>${esc(x.r)}</span></li>`).join('') || '<li class="muted">아직 기록이 없습니다.</li>'}</ol></div>
      </div>
      <div class="card" style="margin-bottom:.8rem"><h3>공시 보관소 <small class="muted">지우지 않고 계속 쌓임</small></h3>
        <div class="adm-kpis" style="grid-template-columns:repeat(4,1fr);margin:0">${[['전체', d.archive?.total], ['미국 공시', d.archive?.bySrc?.SEC], ['한국 공시', d.archive?.bySrc?.DART], ['보도자료', d.archive?.bySrc?.PR]].map(([l, v]) => `<div class="card" style="display:block"><span>${l}</span><div><b>${fmtInt(v || 0)}</b><small>건</small></div></div>`).join('')}</div>
        <p class="note">가장 오래된 기록: ${d.archive?.oldest ? fmtDT(new Date(d.archive.oldest)).date : '—'} · 8-K 항목 보강 대기 ${fmtInt(d.archive?.pendingEnrich || 0)}건<br>과거 채우기 — 미국: ${d.backfill?.sec ? (d.backfill.sec.done ? '완료' : esc(d.backfill.sec.day) + ' 진행 중') + (d.backfill.sec.log ? ' (' + esc(d.backfill.sec.log) + ')' : '') : '대기'} · 한국: ${d.backfill?.dart ? (d.backfill.dart.done ? '완료' : esc(d.backfill.dart.day) + ' 진행 중') + (d.backfill.dart.log ? ' (' + esc(d.backfill.dart.log) + ')' : '') : '대기'}</p></div>
      ${(() => { // AI 사용량 (기능별 호출 수·토큰, 최근 7일)
        const u = d.usage || []; if (!u.length) return '';
        const tot = {}; for (const day of u) for (const [k, v] of Object.entries(day.tags || {})) { const t = tot[k] || (tot[k] = { n: 0, in: 0, out: 0, th: 0 }); t.n += v.n; t.in += v.in; t.out += v.out; t.th += v.th; }
        const rows = Object.entries(tot).sort((a, b) => (b[1].in + b[1].out * 8 + b[1].th * 8) - (a[1].in + a[1].out * 8 + a[1].th * 8));
        const sum = rows.reduce((a, [, v]) => a + v.in + (v.out + v.th) * 8, 0) || 1;
        const today = u[0]?.tags || {};
        const tk = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));
        return `<div class="card" style="margin-bottom:.8rem"><h3>AI 사용량 <small class="muted">최근 7일 · 기능별 (출력·생각 토큰은 입력보다 비싸서 비중 계산 시 8배로 반영)</small></h3>
          <table class="tbl"><tr><th>기능</th><th>오늘 호출</th><th>7일 호출</th><th>입력</th><th>출력</th><th>생각</th><th>비용 비중</th></tr>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${fmtInt(today[k]?.n || 0)}</td><td>${fmtInt(v.n)}</td><td>${tk(v.in)}</td><td>${tk(v.out)}</td><td>${tk(v.th)}</td><td><b>${Math.round(((v.in + (v.out + v.th) * 8) / sum) * 100)}%</b></td></tr>`).join('')}</table>
          <p class="note">토큰 = AI가 읽고 쓴 글자 양. 실제 요금은 Google AI Studio 결제 화면 기준입니다.</p></div>`;
      })()}
      <div class="card"><h3>고장 자동 감시 <small class="muted">${d.monitor?.at ? fmtDT(new Date(d.monitor.at)).full + ' 점검 · 약 9분마다 자동 점검' : '아직 점검 기록 없음'}</small></h3>
        <table class="tbl adm-mon"><tr><th>항목</th><th>상태</th><th>내용</th></tr>${mon.map((c) => `<tr><td>${esc(c.name)}</td><td><span class="mon ${c.ok ? 'ok' : c.fails >= 2 ? 'bad' : 'warn'}">${c.ok ? '정상' : c.fails >= 2 ? '이상' : '확인 중'}</span></td><td>${esc(c.msg)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">점검 기록이 없습니다. 아래 "지금 점검"을 눌러보세요.</td></tr>'}</table>
        <div class="chips" style="margin-top:.8rem"><button class="btn sm" data-admin-act="monitor">지금 점검</button><button class="btn sm" data-admin-act="issKR">주요 이슈 다시 만들기 (국장)</button><button class="btn sm" data-admin-act="issUS">주요 이슈 다시 만들기 (미장)</button><button class="btn sm" data-admin-act="tgfind">텔레그램 채팅 ID 찾기</button><button class="btn sm" data-admin-act="tgtest">텔레그램 테스트 알림</button></div>
        <p class="note">텔레그램 알림: ${d.telegram?.token ? '봇 토큰 등록됨' : '봇 토큰(TELEGRAM_BOT_TOKEN) 미등록'} · ${d.telegram?.chat ? '채팅 ID 등록됨' : '채팅 ID(TELEGRAM_CHAT_ID) 미등록'}. 둘 다 등록하면 이상이 생길 때 텔레그램으로 알려줍니다.</p><p class="note" id="admMsg"></p></div>`;
  }
  async function adminAct(act) {
    const msg = (t) => { if ($('#admMsg')) $('#admMsg').textContent = t; };
    const k = encodeURIComponent(S.admin);
    try {
      if (act === 'refresh') return renderAdmin();
      if (act === 'monitor') { msg('점검 중… (10~20초)'); await getJSON(`/api/admin?key=${k}&monitor=run`, { cache: 'no-store' }); return renderAdmin(); }
      if (act === 'issKR' || act === 'issUS') {
        const mk = act.slice(3);
        if (!confirm(`${mk === 'KR' ? '국장' : '미장'} 최신 "오늘 주요 이슈"를 지금 시세로 새로 써서 바꿀까요? (AI 1회 사용, 1~2분)`)) return;
        msg('AI가 새로 쓰는 중… (1~2분, 창을 닫지 마세요)');
        const j = await getJSON(`/api/issues?mk=${mk}&run=1&key=${k}`, { cache: 'no-store' });
        if (!j.ok) return msg('실패: ' + (j.error || ''));
        S.iss = S.iss || {}; S.iss[mk] = null;
        msg(`완료: "${j.ed.headline || ''}" 로 바뀌었습니다. 메인 화면은 1~2분 안에 새 내용으로 보입니다.`); return;
      }
      if (act === 'tgfind') { const j = await getJSON(`/api/admin?key=${k}&tg=find`, { cache: 'no-store' }); msg(j.error || (j.chats?.length ? '찾은 채팅 ID: ' + j.chats.map((c) => `${c.id} (${c.name || ''})`).join(', ') + ' → 이 숫자를 Cloudflare 변수 TELEGRAM_CHAT_ID로 등록하세요.' : j.hint)); return; }
      if (act === 'tgtest') { const j = await getJSON(`/api/admin?key=${k}&tg=test`, { cache: 'no-store' }); msg(j.ok ? '텔레그램으로 테스트 알림을 보냈습니다.' : '보내지 못했습니다. 봇 토큰과 채팅 ID를 확인하세요.'); }
    } catch (e) { msg(e.message); }
  }

  // ───────────────────────── 맨 위로 버튼 (스크롤을 내리면 나타나서 따라다님) ─────────────────────────
  function setupToTop() {
    const btn = $('#toTop');
    if (!btn) return;
    let ticking = false;
    const update = () => { ticking = false; btn.classList.toggle('show', scrollY > Math.max(500, innerHeight * 0.8)); };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    btn.addEventListener('click', () => {
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    });
    update();
  }

  // ───────────────────────── 앱 설치 (홈 화면·바탕화면에 추가) ─────────────────────────
  function setupInstall() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const btn = $('#btnInstall');
    if (!btn) return;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (standalone) return; // 이미 앱으로 실행 중
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; btn.hidden = false; });
    window.addEventListener('appinstalled', () => { btn.hidden = true; deferred = null; toast('앱으로 설치되었습니다'); });
    const mobile = ios || /Android|Mobi/i.test(ua) || matchMedia('(max-width: 720px)').matches;
    if (mobile) btn.hidden = false; // 휴대폰은 항상 표시 (설치 창이 안 뜨는 브라우저는 방법 안내)
    btn.addEventListener('click', async () => {
      if (deferred) {
        deferred.prompt();
        const r = await deferred.userChoice.catch(() => null);
        if (r?.outcome === 'accepted') btn.hidden = true;
        deferred = null;
        return;
      }
      const inApp = /KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|Line\//i.test(ua);
      openModal(`<h2>앱으로 설치하기</h2>
        ${inApp ? '<p class="note">지금은 카카오톡·네이버 등 앱 안의 브라우저라 설치가 안 됩니다. 오른쪽 위 메뉴에서 <b>"다른 브라우저로 열기"</b>를 누른 뒤 아래 방법으로 설치하세요.</p>' : ''}
        ${ios ? `<ol class="inst-steps"><li><b>사파리</b>로 gk-stock.com 을 엽니다</li><li>아래쪽(또는 위쪽)의 <b>공유 버튼</b> <span class="ib">⬆︎</span> 을 누릅니다</li><li><b>"홈 화면에 추가"</b>를 누릅니다</li><li>오른쪽 위 <b>"추가"</b>를 누르면 끝</li></ol>`
        : `<ol class="inst-steps"><li><b>크롬</b>으로 gk-stock.com 을 엽니다</li><li>${mobile ? '오른쪽 위 <b>⋮ 메뉴 → "홈 화면에 추가"</b> 또는 <b>"앱 설치"</b>를 누릅니다 (삼성 인터넷은 <b>≡ 메뉴 → "현재 페이지 추가" → "홈 화면"</b>)' : '주소창 오른쪽의 <b>설치 아이콘</b> 또는 <b>⋮ 메뉴 → "앱 설치"</b>를 누릅니다'}</li><li><b>"설치"</b>를 누르면 바탕화면·홈 화면에 아이콘이 생깁니다</li></ol>`}
        <p class="note">설치하면 주소창 없이 앱처럼 바로 열리고, 관심종목 알림도 받을 수 있습니다.</p>`);
    });
  }

  // ───────────────────────── 이벤트 ─────────────────────────
  function bind() {
    $('#mkSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-mk]'); if (!b) return; S.mk = b.dataset.mk; S.limit = 80; renderAll(); });
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.type = b.dataset.type; if (S.view === 'home') S.homeType = S.type; S.limit = 80; renderAll(); });
    $('#themeChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.theme = S.theme === b.dataset.theme ? null : b.dataset.theme; S.limit = 80; renderAll(); });
    $('#themes').addEventListener('click', (e) => { const li = e.target.closest('li'); if (!li) return; S.theme = S.theme === li.dataset.theme ? null : li.dataset.theme; S.limit = 80; renderAll(); $('.feed-wrap').scrollIntoView({ behavior: 'smooth' }); });
    $('#sortSel').addEventListener('change', (e) => { S.sort = e.target.value; renderFeed(); });
    $('#earnSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.earnMk = b.dataset.em; renderEarnings(); });
    $('#earnCap').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.earnCap = b.dataset.cap; renderEarnings(); });
    $('#earnDays').addEventListener('click', (e) => { const b = e.target.closest('[data-eday]'); if (!b) return; S.earnDay = Number(b.dataset.eday); renderEarnings(); if (innerWidth <= 720) $('.ec-selhead')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('#digestMore').addEventListener('click', openDigestModal);
    $('#digestSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-dmk]'); if (b) setDigestMk(b.dataset.dmk); });
    $('#thSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-th]'); if (!b) return; S.thMk = b.dataset.th; save('gk_thmk', S.thMk); renderThemes(); });
    $('#ecImp').addEventListener('click', (e) => { const b = e.target.closest('[data-imp]'); if (!b) return; S.ecImp = b.dataset.imp; save('gk_ecimp', S.ecImp); renderEcon(); });
    $('#popSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.popTab = b.dataset.pop; save('gk_poptab', S.popTab); renderPopular(); });
    for (const id of ['#popKind', '#popKindPage']) $(id).addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (!b) return; S.popKind = b.dataset.kind; save('gk_popkind', S.popKind); renderPopular(); if (S.view === 'popular') renderPopularPage(); });
    $('#btnRefresh').addEventListener('click', async (e) => { const svg = e.currentTarget.querySelector('svg'); svg.style.animation = 'spin .8s linear infinite'; await Promise.all([poll('sec'), poll('dart'), poll('news'), pollPopular()]); svg.style.animation = ''; toast('새로고침 완료'); });
    $$('.stats4 button').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.stat;
      if (k === 'WATCH') { setView(S.view === 'watch' ? 'home' : 'watch'); return; }
      if (statActive(k)) { S.type = 'ALL'; S.mk = 'ALL'; }
      else if (k === 'SEC' || k === 'DART') { S.type = 'FILING'; S.mk = k === 'SEC' ? 'US' : 'KR'; }
      else { S.type = k; S.mk = 'ALL'; }
      S.limit = 80; renderAll();
      $('.feed-wrap').scrollIntoView({ behavior: 'smooth' });
    }));
    $('.trend-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-trend]'); if (b) $('#trend').scrollBy({ left: Number(b.dataset.trend) * $('#trend').clientWidth * 0.8, behavior: 'smooth' }); });
    bindSearch($('#search'), $('#suggest'), { feed: true });
    bindSearch($('#search2'), $('#suggest2'), { feed: true });
    bindSearch($('#coSearch'), $('#coSuggest'), { feed: false });
    $('#btnBell').addEventListener('click', (e) => { e.stopPropagation(); const p = $('#bellPanel'); p.hidden = !p.hidden; if (!p.hidden) { renderBell(); $('#bellDot').hidden = true; } });
    $('#btnUser').addEventListener('click', openSettings);
    $('#flowTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.flowTab = b.dataset.tab; save('gk_flowtab', S.flowTab); renderFlows(); });
    $('#flowSub').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; S[b.parentElement.dataset.sub] = b.dataset.v; renderFlows(); });

    document.addEventListener('change', (e) => { const el = e.target.closest('[data-set]'); if (el) setSetting(el.dataset.set, el.checked, el); });
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t.closest('#bellPanel') && !t.closest('#btnBell')) $('#bellPanel').hidden = true;
      const go = t.closest('[data-go]');
      if (go) {
        e.preventDefault();
        const v = go.dataset.go;
        if (v === 'company') { S.coCur = null; $('#coBody').innerHTML = CO_EMPTY; }
        if (v === 'home' && go.classList.contains('brand')) { S.q = ''; S.theme = null; S.mk = 'ALL'; $('#search').value = ''; $('#search2').value = ''; }
        if (S.q && !(v in FEED_VIEWS)) { S.q = ''; $('#search').value = ''; $('#search2').value = ''; }
        setView(v);
        return;
      }
      const star = t.closest('[data-star]');
      if (star) { e.stopPropagation(); const [m, tk, n] = star.dataset.star.split('|'); toggleWatch(m, tk, n); return; }
      const un = t.closest('[data-unwatch]');
      if (un) { e.stopPropagation(); const [m, tk] = un.dataset.unwatch.split('|'); toggleWatch(m, tk); if (!$('#modal').hidden) openSettings(); return; }
      if (t.closest('[data-clear-q]')) { S.q = ''; $('#search').value = ''; $('#search2').value = ''; renderAll(); return; }
      if (t.closest('[data-close-bell]')) { $('#bellPanel').hidden = true; return; }
      if (t.closest('[data-close-modal]') || t.id === 'modal') { closeModal(); return; }
      if (t.closest('[data-back]')) { backToList(); return; }
      const fs = t.closest('[data-fs]');
      if (fs) { S.fs = fs.dataset.fs; save('gk_fs', S.fs); document.documentElement.className = 'js notranslate ' + S.fs; $$('#fsSeg button').forEach((b) => b.classList.toggle('on', b === fs)); return; }
      if (t.closest('[data-co-more]')) { if (S.coCur) { S.coCur.recentLimit = (S.coCur.recentLimit || 20) + 40; renderCoRecent(); } return; }
      if (t.closest('#moreRows')) { if (visible().length > S.limit) { S.limit += 80; renderFeed(); } else loadOlder(); return; }
      const kw = t.closest('[data-kw]');
      if (kw) { applyKeyword(kw.dataset.kw); $('#suggest').hidden = true; $('#suggest2').hidden = true; return; }
      if (t.closest('[data-share]')) {
        const url = `${location.origin}/p/${t.closest('[data-share]').dataset.share}`;
        (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => toast('링크를 복사했습니다: ' + url)).catch(() => { prompt('아래 주소를 복사하세요', url); });
        return;
      }
      if (t.closest('[data-adm-open]')) { const id = t.closest('[data-adm-open]').dataset.admOpen; if (S.items.has(id)) openItem(id); else { history.pushState(null, '', '/p/' + id); showItem(id); } return; }
      if (t.closest('[data-admin-act]')) { adminAct(t.closest('[data-admin-act]').dataset.adminAct); return; }
      if (t.closest('[data-admin-logout]')) { S.admin = ''; save('gk_admin', ''); renderAdmin(); return; }
      if (t.closest('[data-ftab]')) { S.aTab = t.closest('[data-ftab]').dataset.ftab; const n = S.items.get(S.sel); if (n) paintFinTab(n); return; }
      if (t.closest('[data-doclang]')) { S.docLang = t.closest('[data-doclang]').dataset.doclang; const n = S.items.get(S.sel); if (n) paintDoc(n); return; }
      if (t.closest('[data-tr-retry]')) { const n = S.items.get(S.sel); if (n) { S.trdoc.delete(n.id); loadTrDoc(n, true); } return; }
      if (t.closest('[data-ai-retry]')) { const n = S.items.get(S.sel); if (n) loadAI(n, true); return; }
      const mo = t.closest('[data-modal]');
      if (mo) { openDigestModal(); return; }
      const co = t.closest('[data-open-co]');
      if (co) { const [m, tk, n] = co.dataset.openCo.split('|'); if (co.closest('#suggest')) $('#search').value = ''; if (co.closest('#suggest2')) $('#search2').value = ''; $('#suggest').hidden = true; $('#suggest2').hidden = true; $('#coSuggest').hidden = true; openCompany(m, tk, n, { corpCode: co.dataset.corp || undefined, exchange: co.dataset.ex || undefined }); return; }
      const thr = t.closest('[data-th-no]');
      if (thr && !t.closest('a')) { toggleTheme(thr); return; }
      const row = t.closest('[data-id]');
      if (row && !t.closest('a')) {
        const id = row.dataset.id;
        if (!S.items.has(id)) { toast('이 항목은 현재 목록에서 찾을 수 없습니다'); return; }
        closeModal(); $('#bellPanel').hidden = true;
        openItem(id);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else if (S.view === 'item') backToList(); else if (S.view === 'issue') { if (S.fromList) { S.fromList = false; history.back(); } else { history.pushState(null, '', '/#home'); route(); } } $('#bellPanel').hidden = true; }
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#search').focus(); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll('sec'); poll('dart'); poll('news'); pollMarket(); pollPopular(); } });
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);
  }
  const CO_EMPTY = document.getElementById('coBody').innerHTML;

  // ───────────────────────── 시작 ─────────────────────────
  function every(ms, fn) { fn(); setInterval(fn, ms); }
  // 오른쪽 사이드(인기 종목·수집 현황)가 화면보다 길면: 페이지와 함께 내려가다가 맨 아래가 보이는 위치에서 멈춤
  // (예전처럼 위에 고정되어 아래쪽이 잘리지 않도록)
  function fitSide() {
    const el = $('.side');
    if (!el) return;
    if (getComputedStyle(el).position !== 'sticky') { el.style.top = ''; return; }
    const hdr = $('.hdr')?.getBoundingClientRect().height || 0;
    const top = hdr + 10, h = el.offsetHeight, vh = window.innerHeight;
    el.style.top = (h + top + 16 <= vh ? top : vh - h - 16) + 'px';
  }
  window.addEventListener('resize', fitSide);
  if (window.ResizeObserver && $('.side')) new ResizeObserver(fitSide).observe($('.side'));
  document.getElementById('ssr')?.remove(); // 검색엔진용 미리보기 글은 앱이 뜨면 치움
  setupInstall();
  setupToTop();
  bind();
  bindIssues();
  bindSched();
  setTop(S.top);
  loadSnap();
  trackPV();
  route();
  renderTape();
  renderFeed();
  renderTrend();
  loadSectors();
  every(30000, () => poll('sec'));
  every(30000, () => poll('dart'));
  every(60000, () => poll('news'));
  every(60000, pollMarket);
  every(60000, pollPopular);
  every(60000, () => { if (S.view === 'themes') loadThemes(true); });
  every(5 * 60000, () => { if (S.view === 'sched') loadSched(true); });
  every(45000, () => loadEcon(false));
  setInterval(refreshChips, 60000);
  every(15 * 60000, () => { if (S.top === 'digest') loadDigest(); });
  every(5 * 60000, () => { if (S.top === 'issue' && S.view in FEED_VIEWS && !document.hidden) loadIssues(true); });
  every(120000, pollViews);
  setInterval(() => { if (S.view === 'flows' && !document.hidden) pollFlows(); }, 180000);
  setInterval(() => { if (S.view in FEED_VIEWS && !document.hidden && !S.sel) renderFeed(); }, 60000);
})();
