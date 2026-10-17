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
    // 서버가 멈춰도 '불러오는 중'에 영원히 머물지 않게 기본 45초 제한 (AI 분석 등은 120초, 따로 정한 제한이 있으면 그걸 씀)
    const o = { ...(opt || { cache: 'no-store' }) };
    let tm = null;
    const lim = /\/api\/(analyze|translate|doc|admin)/.test(url) ? 120000 : /\/api\/(issues|company|stock)/.test(url) ? 20000 : 45000; // AI 분석·원문 번역은 오래 걸릴 수 있음 · v222: 이슈·기업 정보는 20초 넘으면 끊고 다시 시도
    if (!o.signal && typeof AbortController !== 'undefined') { const ac = new AbortController(); tm = setTimeout(() => ac.abort(), lim); o.signal = ac.signal; }
    let r;
    try { r = await fetch(url, o); }
    catch (e) { if (e.name === 'AbortError' && tm) throw new Error(`서버 응답이 ${lim / 1000}초 넘게 없어요 — 잠시 뒤 다시 시도해 주세요`); throw e; }
    finally { if (tm) clearTimeout(tm); }
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
  S.push = load('gk_push', false); S.pushBig = load('gk_pushBig', false);
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
    // v214: 'industrial'(trial)·'Blackwell'(BLA)·'agenda/Honda'(NDA)·'behind/kind'(IND)·'breakthrough'가 임상·FDA로 잘못 잡히던 문제 → 단어 경계·대문자 약어만
    bio: { test: (t) => /임상|품목허가|신약|치료제|바이오시밀러/.test(t) || /\b(FDA|BLA|NDA|IND|PDUFA)\b|\bPhase\s?(?:[123]|I{1,3})\b/.test(t) || /\bclinical\b|\btrials?\b|\btopline\b|breakthrough therapy|\bbiosimilar/i.test(t) },
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
    else if (theme === 'offering') sent = /premium|above (the )?market|프리미엄|할증/i.test(text) ? null : 'neg'; // 할증(프리미엄) 발행은 무조건 악재로 보지 않음 (AI 판단이 나오면 그걸로 바뀜)
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
    if (!a || a.error) { const v = S.verd?.[n.id]; if (v) { n.sent = v === '긍정' ? 'pos' : v === '부정' ? 'neg' : null; n.aiDone = true; } return; } // 서버에 저장된 AI 판단 (상세 화면과 같은 호재·악재)
    if (a.quick && S.verd?.[n.id]) { n.sent = S.verd[n.id] === '긍정' ? 'pos' : S.verd[n.id] === '부정' ? 'neg' : null; n.aiDone = true; return; }
    if (!a.fallback) { n.sent = a.verdict === '긍정' ? 'pos' : a.verdict === '부정' ? 'neg' : null; n.aiDone = true; }
    if (a.headline && !a.fallback && !n.raw.tx) { if (!n.orig) n.orig = n.head; n.head = a.headline; }
  }
  const hasKo = (x) => /[가-힣]/.test(x || '');
  function applyTr(n) {
    const t = S.tr[n.id];
    if (t && !hasKo(n.head) && !n.raw.tx) { if (!n.orig) n.orig = n.head; n.head = t; }
  }
  // 목록·트렌딩에 보이는 항목의 AI 호재·악재 판단을 서버에서 받아 반영 (상세 화면과 표시가 다르지 않게)
  S.verd = {};
  const verdAsked = new Map();
  let verdTimer = null;
  function queueVerdicts(list) {
    for (const n of list) if (n && n.kind !== 'NEWS' && !(n.id in S.verd) && Date.now() - (verdAsked.get(n.id) || 0) > 5 * 60e3) verdAsked.set(n.id, -1);
    if (verdTimer) return;
    verdTimer = setTimeout(async () => {
      verdTimer = null;
      const ids = [...verdAsked].filter(([, t]) => t === -1).map(([id]) => id).slice(0, 80);
      if (!ids.length) return;
      ids.forEach((id) => verdAsked.set(id, Date.now()));
      try {
        const j = await getJSON('/api/verdicts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
        let ch = false;
        for (const [id, v] of Object.entries(j.v || {})) { if (S.verd[id] === v) continue; S.verd[id] = v; const n = S.items.get(id); if (n) { applyAI(n); ch = true; } }
        if (ch && S.view in FEED_VIEWS) { renderFeed(); renderTrend(); }
      } catch {}
    }, 600);
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
  // 실적 발표 판정 배지 (컨센서스 대비 상회·부합·하회)
  S.earnv = {};
  function evHTML(n, big) {
    const v = S.earnv[n.id];
    if (!v) return '';
    const c = v.v === '상회' ? 'up' : v.v === '하회' ? 'dn' : 'eq';
    return `<div class="ev-badge ${c}${big ? ' big' : ''}" title="시장 예상치(컨센서스) 대비 · ${esc(v.mk === 'KR' ? '네이버 증권' : 'Finnhub·Nasdaq')} 기준"><b>📊 컨센서스 ${esc(v.v)}</b><span>${esc(v.line)}</span></div>`;
  }
  async function pollEarnv() {
    try { const j = await getJSON('/api/earnv?t=' + Math.floor(Date.now() / 60e3), {}); const ch = JSON.stringify(j.map || {}) !== JSON.stringify(S.earnv); S.earnv = j.map || {}; if (ch && S.view in FEED_VIEWS) renderFeed(); } catch {}
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
        ${evHTML(n)}
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
      queueTranslate(arr.slice(0, S.limit)); queueVerdicts(arr.slice(0, 60));
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
    const today = kstDay(), hourAgo = Date.now() - 3600e3, dayAgo = Date.now() - 86400e3;
    const c = { SEC: [0, 0, 0], DART: [0, 0, 0], PR: [0, 0, 0], WATCH: [0, 0, 0] }; // [오늘, 1시간, 24시간]
    for (const n of S.items.values()) {
      const isToday = fmtDT(new Date(n.ms)).date === today || (n.src === 'DART' && (n.raw.date || '').replace(/-/g, '.') === today);
      const keys = [n.src];
      if (n.ticker && inWatch(n.market, n.ticker)) keys.push('WATCH');
      for (const k of keys) { if (!c[k]) continue; if (isToday) c[k][0]++; if (n.ms > hourAgo) c[k][1]++; if (n.ms > dayAgo) c[k][2]++; }
    }
    // 주말·휴일 아침처럼 '오늘' 들어온 게 없으면 0만 보이지 않게 최근 24시간 기준으로
    const use24 = c.SEC[0] + c.DART[0] + c.PR[0] === 0;
    for (const k in c) {
      const src = k === 'SEC' ? 'sec' : k === 'DART' ? 'dart' : 'news';
      const el = $('#st' + k); if (!el) continue;
      const v = c[k][use24 ? 2 : 0];
      el.textContent = k === 'WATCH' ? (S.watch.length ? fmtInt(v) : '☆') : S.loaded[src] ? fmtInt(v) : '–';
      $('#st' + k + 'd').textContent = k === 'WATCH' && !S.watch.length ? '관심종목 추가하기' : c[k][1] ? `1시간 +${c[k][1]}` : '';
    }
    $('#statUpd').textContent = use24 ? '최근 24시간' : kstDay().slice(5) + ' 기준';
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
  let trendBusy = 0, trendPrimLast = null;
  setInterval(() => { const p = trendPrimary(); if (p !== trendPrimLast) { trendPrimLast = p; if (S.view in FEED_VIEWS) renderTrend(); } }, 60e3); // 국장↔미장 시간이 바뀌면 다시 그림
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
    // 장이 열린 시장이 있으면 그 시장 종목만 (시세가 아직 안 받아진 순간에 다른 시장 종목이 끼어들던 문제)
    const inPrim = (n) => !prim || n.market === prim;
    const pick = ranked.filter((x) => x.g > 0 && inPrim(x.n)).slice(0, 6).map((x) => x.n); // 6개 (PC 한 줄에 딱 맞게, 모바일은 슬라이드)
    const seen = new Set(pick.map((n) => wkey(n.market, n.ticker)));
    const fill = (arr) => { for (const n of arr) { if (pick.length >= 6) break; const k = wkey(n.market, n.ticker); if (seen.has(k)) continue; seen.add(k); pick.push(n); } };
    if (pick.length < 6) { // 오른 종목이 적으면 같은 시장의 중요 공시(중요도·최신)로 채움
      fill(pool.filter((n) => n.ms > since && n.ticker && n.impact >= 3 && inPrim(n)).sort((a, b) => b.impact - a.impact || b.ms - a.ms));
    }
    if (pick.length < 6 && prim) { // 그래도 모자라면 그때만 다른 시장
      fill(ranked.filter((x) => x.g > 0).map((x) => x.n));
      fill(pool.filter((n) => n.ms > since && n.ticker && n.impact >= 3).sort((a, b) => b.impact - a.impact || b.ms - a.ms));
    }
    // 시세가 없는 후보는 뒤에서 받아 와서 다시 정렬
    //  후보가 많을 때 앞쪽 80개만 계속 받던 문제 → 시세를 한 번도 안 받은 종목 먼저, 그다음 오래된 순 (지금 장이 열린 시장 우선)
    const age = (k) => { const q = S.quotes.get(k); return q ? Date.now() - q._at : Infinity; };
    const need = [...new Set([...cand].sort((a, b) => b.ms - a.ms).map((n) => wkey(n.market, n.ticker)))].filter((k) => age(k) > 90e3)
      .sort((a, b) => ((prim && b.startsWith(prim + ':')) - (prim && a.startsWith(prim + ':'))) || (age(b) === age(a) ? 0 : age(b) > age(a) ? 1 : -1)).slice(0, 120);
    if (need.length && Date.now() - trendBusy > 60e3) {
      trendBusy = Date.now();
      (async () => { for (let i = 0; i < need.length; i += 40) await fetchQuotes(need.slice(i, i + 40)); renderTrend(); })();
    }
    queueTranslate(pick); queueVerdicts(pick);
    const sig = pick.map((n) => n.id + (n.sent || '')).join('|');
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
    $$('#mkSeg button[data-mk]').forEach((b) => b.classList.toggle('on', b.dataset.mk === S.mk));
    $('#mkSeg [data-watch]')?.classList.toggle('on', S.view === 'watch');
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
      return `<span class="wchip" data-open-co="${esc(w.m)}|${esc(w.t)}|${esc(w.n || '')}">${esc(w.m === 'KR' ? w.n || w.t : w.t)}${q && q.pct != null ? ` <span class="${dirCls(q.livePct ?? q.pct)} mono">${q.session ? (q.session === 'AFTER' ? '애프터 ' : q.session === 'DAY' ? '데이 ' : '프리 ') : ''}${fmtPct(q.livePct ?? q.pct)}</span>` : ''}<button data-unwatch="${esc(w.m)}|${esc(w.t)}" title="삭제">✕</button></span>`;
    }).join('');
    fetchQuotes(S.watch.map((w) => wkey(w.m, w.t))).then((ch) => { if (ch && S.view === 'watch') renderWatchbar(); });
  }

  // ───────────────────────── 현재가 ─────────────────────────
  async function fetchQuotes(keys) {
    const need = [...new Set(keys)].filter((k) => { const q = S.quotes.get(k); return !q || Date.now() - q._at > 13e3; }).slice(0, 40);
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
    let pct = q.livePct ?? q.pct, lbl = q.session ? (q.session === 'AFTER' ? '애프터 ' : q.session === 'DAY' ? '데이 ' : '프리 ') : '오늘 ';
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
    const tip = p0 ? `발표 시점 ${n.market === 'KR' ? fmtInt(p0) + '원' : '$' + fmtPx(p0)} 대비 현재 주가 등락 (15초마다 갱신)` : '오늘 주가 등락률 (15초마다 갱신)';
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
    const rs0 = x.reason && !/^뚜렷한 개별 뉴스 없음/.test(x.reason) ? x.reason : null;
    const rs = rs0 || x.pr?.t || null; // AI 이유가 아직 없으면 최근 공시·보도자료 제목
    const subHTML = !big && rs ? `<small class="rs" title="${rs0 ? 'AI 추정 · ' + esc(x.reason) : esc(rs)}">${esc(rs)}</small>` : `<small>${esc(sub)}${sec ? ' · ' + esc(sec) : ''}</small>`;
    const whyHTML = big && rs0 ? `<span class="why rwhy"><i>AI 추정</i>${esc(x.reason)}</span>` : big && x.pr?.t ? `<span class="why rwhy">${esc(x.pr.t)}</span>` : big && x.reason ? `<span class="why rwhy none"><i>AI 추정</i>${esc(x.reason)}</span>` : big && x.why ? `<span class="why">${esc(x.why)}</span>` : '';
    return `<li data-open-co="${esc(x.market)}|${esc(x.ticker)}|${esc(x.name || '')}"><span class="rk">${i + 1}</span>${logoHTML(x.market, x.ticker, x.name, big ? 'md' : 'sm')}<span class="nm"><b>${esc(label)}${x.ipo ? ' <i class="ipo-tag" title="오늘 신규 상장 · 공모가 대비 등락">신규상장</i>' : ''}</b>${subHTML}</span><span class="px">${px ? `<b>${px}</b>` : ''}${x.pct != null ? `<em class="${dirCls(x.pct)}"${x.session ? ` title="정규장 ${fmtPct(x.regPct)}"` : ''}>${x.session ? `<i class="sess">${x.session === 'AFTER' ? '애프터' : x.session === 'DAY' ? '데이' : '프리'}</i>` : ''}${fmtPct(x.pct)}</em>` : ''}</span>${whyHTML}</li>`;
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
    if (mk === 'US' && p?.usSession === 'DAY') return `미국 주간거래(데이마켓) ${kind === 'up' ? '상승률' : '하락률'} 상위 · 한국투자증권 시세 · 나스닥·뉴욕·아멕스`;
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
    const wkEnd = (tz) => { const d = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()); const wd = d.find((x) => x.type === 'weekday').value, h = Number(d.find((x) => x.type === 'hour').value); return tz === 'Asia/Seoul' ? wd === 'Sat' || wd === 'Sun' : wd === 'Sat' || (wd === 'Sun' && h < 20); };
    const closed = !(S.popTab === 'US' && p.usSession) && wkEnd(S.popTab === 'KR' ? 'Asia/Seoul' : 'America/New_York');
    $('#popSrc').textContent = `${popSrcText(p, S.popTab)} · ${closed ? '주말 휴장 · 마지막 거래일 기준' : `${fmtDT(new Date(p.at)).hm} 갱신 · ${S.popTab === 'US' && p.usSession === 'DAY' ? '1분' : '15초'}마다 업데이트`}`;
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
    // 10초 단위 주소로 받아서 브라우저·중간 캐시에 묵은 목록이 남지 않게 (켜 두기만 해도 자동 갱신)
    try { const j = await getJSON('/api/popular?t=' + Math.floor(Date.now() / 10e3)); if (!S.popular || !(j.at < S.popular.at)) S.popular = j; } catch { S.popular = S.popular || { kr: [], us: [], at: Date.now(), krSrc: '', usSrc: '' }; }
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
      <div class="set-row"><div>데스크톱 알림<small>관심종목·매우 중요한 항목</small></div><input type="checkbox" class="tg" data-set="notify" ${S.notify ? 'checked' : ''}></div>${pushRows()}
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
        <div class="night-body"><div class="night-info"><div class="night-price">${ni.price}</div><div class="night-chg ${dirCls(ni.chg)}">${ni.chg > 0 ? '▲' : ni.chg < 0 ? '▼' : ''} ${fmtPx(Math.abs(ni.chg || 0))} (${fmtPct(ni.pct)})</div></div>
        ${n.series?.length >= 2 ? sparkSVG({ t: n.series.map((p) => p[0]), c: n.series.map((p) => p[1]) }, { key: 'night', price: n.price, prev: n.chg != null ? n.price - n.chg : null }, dirCls(ni.chg)) : ''}</div>
        <p class="foot-note">${ni.note ? esc(ni.note) + ' · ' : ''}한국투자증권 · 야간 18:00~05:00 KST${n.series?.length >= 2 ? ' · 차트: 이번 세션 1분 간격' : ''}</p>`;
    } else $('#nightCard').innerHTML = `<div class="lbl">코스피200 야간선물</div><div class="night-price muted">—</div><p class="foot-note">${m ? esc(n?.reason || '시세 없음') : '불러오는 중'}</p>`;
    const list = (m?.indices || []).filter((x) => !x.error && x.price !== null && x.price !== undefined);
    const sp = S.spark?.data || {};
    $('#sparkNote').hidden = !Object.keys(sp).length;
    $('#idxGrid').innerHTML = list.map((x) => { const f = idxFmt(x); return `<div class="idx" title="${esc(x.src || '')}"><div class="l">${esc(x.label)}</div><div class="p">${f.px}</div><div class="c ${f.dir}">${f.ch}</div>${sparkSVG(sp[x.key], x, f.dir)}</div>`; }).join('') || '<div class="muted">지수 데이터를 불러오는 중이거나 가져오지 못했습니다.</div>';
    $('#mktMeta').textContent = m?.fetchedAt ? `${fmtDT(new Date(m.fetchedAt)).hm} 갱신` : '';
  }
  // 시장 지표 카드 속 작은 차트 (최근 5거래일 · 60분봉). 점선 = 전일 종가, 옅은 세로선 = 날짜 경계
  function sparkSVG(d, x, dir) {
    if (!d?.c?.length) return '';
    let c = d.c.slice();
    if (x.key === 'TNX:INDEXCBOE' && c[c.length - 1] > 20) c = c.map((v) => v / 10); // 금리 단위 맞춤
    // 마지막 점을 지금 시세로 (차트가 몇 분 늦어도 카드 숫자와 끝이 맞게)
    const last = c[c.length - 1];
    if (x.price != null && Number.isFinite(x.price) && Math.abs(x.price - last) / Math.abs(last || 1) < 0.03) c[c.length - 1] = x.price; // 단위가 다르면(3% 넘게 차이) 건드리지 않음
    const prev = x.prev != null && Number.isFinite(x.prev) && Math.abs(x.prev - last) / Math.abs(last || 1) < 0.15 ? x.prev : null;
    const W = 200, H = 44, P = 3;
    let lo = Math.min(...c), hi = Math.max(...c);
    if (prev != null && prev > lo - (hi - lo) * 0.5 && prev < hi + (hi - lo) * 0.5) { lo = Math.min(lo, prev); hi = Math.max(hi, prev); }
    if (hi === lo) { hi += 1; lo -= 1; }
    const X = (i) => (i / (c.length - 1)) * W, Y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - P * 2);
    const pts = c.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const days = [];
    for (let i = 1; i < d.t.length && i < c.length; i++) if (d.t[i] - d.t[i - 1] > 3 * 3600) days.push(X(i).toFixed(1));
    const cls = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat';
    return `<svg class="spark ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      ${days.map((xx) => `<line class="sp-day" x1="${xx}" x2="${xx}" y1="0" y2="${H}"/>`).join('')}
      ${prev != null && prev >= lo && prev <= hi ? `<line class="sp-prev" x1="0" x2="${W}" y1="${Y(prev).toFixed(1)}" y2="${Y(prev).toFixed(1)}"/>` : ''}
      <polygon class="sp-fill" points="0,${H} ${pts} ${W},${H}"/><polyline class="sp-line" points="${pts}"/></svg>`;
  }
  async function pollSpark() {
    if (S.spark && Date.now() - S.spark._at < 5 * 60e3) return;
    try { S.spark = { ...(await getJSON('/api/spark')), _at: Date.now() }; } catch { return; }
    if (S.view === 'market') { renderMarket(); pollSpark(); }
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
  const ISS_RE = /^\/i\/((?:kr|us)-\d{8}-(?:\d{4}|\d{1,2}))\/?$/;
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
    } catch (e) { S.iss[mk] = { error: e.message, _at: Date.now() - 3 * 60e3 }; setTimeout(() => { if (S.iss[mk]?.error) loadIssues(true); }, 15000); } // 실패하면 15초 뒤 자동 재시도
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
    if (!today.some((x) => x.id === ed.id)) today.push({ id: ed.id, date: ed.date, n: ed.n, hour: ed.hour, min: ed.min, slot: ed.slot, short: ed.short });
    const tm = (x) => (x.hour ?? x.n ?? 0) * 60 + (x.min || 0);
    today.sort((a, b) => tm(a) - tm(b));
    const slots = today.map((x) => `<button class="ib-sl${x.id === ed.id ? ' on' : ''}" data-iss-pick="${esc(x.id)}"><b>${x.hour != null ? (ed.mk === 'US' ? '뉴욕 ' : '') + (x.min ? `${x.hour}:${String(x.min).padStart(2, '0')}` : x.hour + '시') : esc(x.slot)}</b><small>${esc(x.hour != null ? x.short || '' : '')}</small></button>`).join('');
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
      ${th ? `<div class="ib-ths"><b>${(ed.themes || []).filter((x) => x.pct != null).slice(0, 6).every((x) => x.pct <= 0) ? '오늘 덜 빠진 테마' : '오늘 강세 테마'}</b>${th}</div>` : ''}
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
      ${th ? `<div class="ibc-ths"><b>${(ed.themes || []).filter((x) => x.pct != null).slice(0, 6).every((x) => x.pct <= 0) ? '오늘 덜 빠진 테마' : '오늘 강세 테마'}</b><div class="ibc-thl">${th}</div></div>` : ''}
      <button class="btn block ibc-more" data-iss-open="${esc(ed.id)}">${Math.min(6, ed.issues.length)}개 이슈 자세히 보기 →</button>
    </div>`;
  }
  async function renderIssueBox() {
    const box = $('#issBody');
    if (!box) return;
    $$('#issSeg button').forEach((b) => b.classList.toggle('on', b.dataset.imk === S.issMk));
    const c = S.iss[S.issMk];
    if (!c) { box.innerHTML = '<div class="skel"></div><div class="skel"></div>'; const mk0 = S.issMk; clearTimeout(S.issRetry); S.issRetry = setTimeout(() => { if (!S.iss[mk0]) loadIssues(true); }, 8000); return; } // v222: 8초 안에 안 오면 한 번 더 요청
    if (c.error || !c.ed) {
      $('#issMeta').textContent = '';
      box.innerHTML = `<div class="ib-empty">${c.error ? '주요 이슈를 불러오지 못했습니다. 잠시 후 다시 시도합니다.' : 'AI가 첫 회차를 만드는 중입니다. 1~3분 뒤 자동으로 나타납니다.'}</div>`;
      if (c.building) setTimeout(() => { if (S.iss[S.issMk] === c) loadIssues(true); }, 60000);
      return;
    }
    let ed = c.ed;
    const sel = S.issSel[S.issMk];
    if (sel && sel !== ed.id) { try { ed = (await getEd(sel)) || ed; } catch {} }
    $('#issMeta').textContent = S.issMk === 'KR' ? '평일 8~16시 매시간 새 이슈 자동 반영' : '뉴욕 8~17시 매시간 · 밤사이(한국 낮) 2시간마다 새 이슈 자동 반영';
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
    el.innerHTML = `<div class="ip-bar"><button class="btn sm" data-iss-back>← 홈으로</button><kbd class="esc-hint">ESC</kbd><span class="muted sm ip-what">오늘 주요 이슈 · ${ed.mk === 'KR' ? '한국' : '미국'}</span><button class="btn sm primary ip-share" data-iss-share="${esc(ed.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>링크 복사</button></div>${issBoardHTML(ed, { full: true, list })}<p class="note">GK의 공시레이더가 네이버 증권 뉴스, 공시·보도자료, 실시간 시세를 바탕으로 AI가 자동 정리한 내용입니다. 종목 등락률은 생성 시점 기준이며, 투자 권유가 아닌 참고용입니다.</p>`;
    if (anchor) { const a = document.getElementById(anchor); if (a) { a.scrollIntoView({ block: 'center' }); a.classList.add('flash'); } }
  }
  function openIssuePage(ref) {
    const [id, anchor] = String(ref).split('#');
    if (S.view !== 'issue') { S.listScroll = window.scrollY; S.returnUrl = location.pathname === '/' ? '/' + (location.hash || '#' + (S.view || 'home')) : PATH_SEC[location.pathname.slice(1)] ? location.pathname : '/#home'; S.fromList = true; }
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
      if (t.closest('[data-dg-share]')) { // AI 핵심 공시 목록 링크 (열면 이 목록·시장이 바로 보임)
        e.stopPropagation();
        const url = `${location.origin}/?top=digest&mk=${S.digestMk || 'ALL'}`;
        (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => toast('링크를 복사했어요 — 카톡·오픈채팅에 붙여넣기 하세요')).catch(() => { prompt('아래 주소를 복사하세요', url); });
        return;
      }
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

  // ───────────────────────── 메뉴 '더보기' (화면이 좁을 때 숨는 메뉴를 묶음) ─────────────────────────
  const navHidden = () => $$('#nav > button[data-go]').filter((b) => getComputedStyle(b).display === 'none' && (b.dataset.adminOnly == null || S.admin)); // 관리자 전용 메뉴는 관리자 키가 있는 기기에서만
  function syncNavMore() {
    const mb = $('#nav [data-nav-more]');
    if (!mb) return;
    const hid = navHidden();
    mb.hidden = !hid.length;
    const act = hid.find((b) => b.classList.contains('on'));
    mb.classList.toggle('on', !!act);
    mb.firstChild.textContent = act ? act.dataset.short || act.textContent : '더보기';
  }
  function toggleNavPop(open) {
    const pop = $('#navPop');
    if (!pop) return;
    const show = open ?? pop.hidden;
    if (show) {
      pop.innerHTML = navHidden().map((b) => `<button data-go="${esc(b.dataset.go)}" class="${b.classList.contains('on') ? 'on' : ''}">${esc(b.textContent)}</button>`).join('');
      const mb = $('#nav [data-nav-more]').getBoundingClientRect();
      pop.style.top = `${mb.bottom + 6}px`;
      pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 200, mb.right - 190))}px`;
    }
    pop.hidden = !show;
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-nav-more]')) { e.preventDefault(); e.stopPropagation(); toggleNavPop(); return; }
    if (!e.target.closest('#navPop')) toggleNavPop(false);
    else if (e.target.closest('[data-go]')) setTimeout(() => toggleNavPop(false), 0);
  }, true);
  addEventListener('resize', () => { toggleNavPop(false); syncNavMore(); });
  addEventListener('scroll', () => { if (!$('#navPop')?.hidden) toggleNavPop(false); }, { passive: true });

  // ───────────────────────── 권리 일정: 분할·병합 / 배당락 / 유·무상증자·감자 ─────────────────────────
  S.ca = { tab: 'split', mk: load('gk_camk', 'KR'), data: {}, at: {} };
  const CA_TITLE = { split: '분할 캘린더', div: '배당락 일정', rights: '유·무상증자 일정' };
  const CA_VIEW = { split: 'cact', div: 'cdiv', rights: 'crights' };
  async function loadCact(force) {
    const mk = S.ca.tab === 'rights' ? 'KR' : S.ca.mk;
    renderCact();
    if (!force && S.ca.data[mk] && Date.now() - (S.ca.at[mk] || 0) < 5 * 60e3) return;
    try { S.ca.data[mk] = await getJSON(`/api/cact?mk=${mk}`, {}); S.ca.at[mk] = Date.now(); } catch (e) { if (!S.ca.data[mk]) S.ca.data[mk] = { error: e.message }; }
    if (S.view in CA_VIEW_SET) renderCact();
  }
  const CA_VIEW_SET = { cact: 1, cdiv: 1, crights: 1 };
  function caDay(d, today) {
    const dt = new Date(d + 'T12:00:00Z'), n = Math.round((Date.parse(d) - Date.parse(today)) / 86400e3);
    return `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일 (${'일월화수목금토'[dt.getUTCDay()]})<em class="${n === 0 ? 'today' : n < 0 ? 'past' : ''}">${n === 0 ? '오늘' : n > 0 ? 'D-' + n : Math.abs(n) + '일 전'}</em>`;
  }
  const md = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
  function caRow(e) {
    const mk = e.mk, nm = mk === 'KR' ? e.name || e.t : e.t;
    let badge = '', info = [];
    if (e.kind === 'split' || e.kind === 'merge') {
      const r = mk === 'US' ? e.ratio : e.before && e.after ? (e.before > e.after ? `1→${+(e.before / e.after).toFixed(2)}주` : `${+(e.after / e.before).toFixed(2)}→1주`) : '';
      badge = `<b class="ca-b ${e.kind}">${e.kind === 'split' ? '분할' : mk === 'US' ? '역분할' : '병합'}${r ? ' ' + esc(r) : ''}</b>`;
      if (mk === 'KR' && e.before && e.after) info.push(`액면 ${fmtInt(e.before)}원 → ${fmtInt(e.after)}원`);
      if (e.haltFrom) info.push(`매매정지 ${md(e.haltFrom)}${e.haltTo ? '~' + md(e.haltTo) : ''}`);
      if (e.list) info.push(`신주 상장 ${md(e.list)}`);
      if (mk === 'US') info.push(`${e.date === e.pay ? '' : ''}적용일 ${md(e.date)}`);
    } else if (e.kind === 'capred') {
      badge = `<b class="ca-b merge">감자${e.capRatio ? ' ' + e.capRatio + '%' : ''}</b>`;
      if (e.haltFrom) info.push(`매매정지 ${md(e.haltFrom)}${e.haltTo ? '~' + md(e.haltTo) : ''}`);
      if (e.list) info.push(`신주 상장 ${md(e.list)}`);
    } else if (e.kind === 'div') {
      badge = `<b class="ca-b div">배당락${e.amount != null ? ' ' + (mk === 'KR' ? fmtInt(e.amount) + '원' : '$' + e.amount) : ''}</b>`;
      if (e.kindNote) info.push(e.kindNote);
      if (e.record) info.push(`기준일 ${md(e.record)}`);
      if (e.pay) info.push(`지급 ${md(e.pay)}`);
      if (e.yield) info.push(`시가배당률 ${e.yield}%`);
      if (mk === 'US' && e.annual) info.push(`연 배당 $${e.annual}`);
    } else {
      const free = e.kind === 'bonus' || e.kind === 'both';
      badge = `<b class="ca-b ${free ? 'bonus' : 'rights'}">${e.kind === 'both' ? '유무상' : free ? '무상증자' : '유상증자'}${free && e.ratio ? ` 1주당 ${e.ratio}주` : ''}</b>`;
      if (e.method) info.push(e.method);
      if (e.price) info.push(`발행가 ${fmtInt(e.price)}원`);
      if (e.record) info.push(`기준일 ${md(e.record)}`);
      if (e.sub?.length) info.push(`청약 ${md(e.sub[0])}${e.sub[1] && e.sub[1] !== e.sub[0] ? '~' + md(e.sub[1]) : ''}`);
      if (e.pay) info.push(`납입 ${md(e.pay)}`);
      if (e.list) info.push(`상장 ${md(e.list)}`);
    }
    return `<li class="ca-row"><button class="ca-co" data-open-co="${esc(mk)}|${esc(e.t)}|${esc(e.ko || e.name || '')}">${logoHTML(mk, e.t, e.name, 'sm')}<span><b>${esc(nm)}</b><small>${esc(mk === 'KR' ? e.t : e.ko || S.koName?.get?.(e.t) || e.name || '')}</small></span></button>${badge}<span class="ca-info">${esc(info.join(' · '))}${e.fix ? ' <i class="ca-fix">정정</i>' : ''}</span>${e.id ? `<button class="link ca-src" data-adm-open="${esc(e.id)}">공시 보기</button>` : ''}</li>`;
  }
  function renderCact() {
    const { tab } = S.ca;
    const mk = tab === 'rights' ? 'KR' : S.ca.mk; // 유·무상증자는 국장만 (미국은 이런 일정이 따로 공시되지 않음)
    const d = S.ca.data[mk];
    $('#caSeg').hidden = tab === 'rights';
    $('#caTitle').textContent = CA_TITLE[tab];
    $$('#caTab button').forEach((b) => b.classList.toggle('on', b.dataset.ca === tab));
    $$('#caSeg button').forEach((b) => b.classList.toggle('on', b.dataset.cam === mk));
    const box = $('#caBody');
    if (!d) { box.innerHTML = '<div class="skel"></div><div class="skel"></div>'; return; }
    if (d.error) { box.innerHTML = `<div class="empty">불러오지 못했습니다: ${esc(d.error)}</div>`; return; }
    const pick = { split: ['split', 'merge'], div: ['div'], rights: ['rights', 'bonus', 'both', 'capred'] }[tab];
    const list = (d.list || []).filter((e) => pick.includes(e.kind));
    const byDay = new Map();
    for (const e of list) (byDay.get(e.date) || byDay.set(e.date, []).get(e.date)).push(e);
    $('#caMeta').textContent = `${mk === 'KR' ? 'DART 공시 기준' : tab === 'div' ? 'Nasdaq 기준 · 시총 상위·인기 종목' : 'Nasdaq 기준'} · ${list.filter((e) => e.date >= d.today).length}건 예정`;
    box.innerHTML = list.length ? [...byDay].map(([day, arr]) => `<div class="card ca-day${day < d.today ? ' past' : ''}"><h3>${caDay(day, d.today)}</h3><ul class="ca-list">${arr.map(caRow).join('')}</ul></div>`).join('')
      + `<p class="note">${tab === 'div' ? '배당락일에는 배당금만큼 주가가 낮아진 채로 시작할 수 있어요. 국장 배당락일 = 배당기준일 전 거래일.' : tab === 'rights' ? '권리락일 = 신주배정기준일 전 거래일 (이날부터 사도 신주를 못 받음). 제3자배정은 신주 상장일 기준으로 표시해요.' : '날짜는 신주 상장일(국장)·분할 적용일(미장) 기준. 매매정지 기간에는 거래가 안 돼요.'} 공시 정정으로 날짜가 바뀔 수 있으니 원문을 확인하세요.</p>`
      : `<div class="empty">${mk === 'KR' && tab !== 'div' ? '최근 공시된 일정이 아직 없어요.' : '예정된 일정이 없어요.'} (공시가 나오면 자동으로 추가돼요)</div>`;
  }
  function bindCact() {
    $('#caTab').addEventListener('click', (e) => { const b = e.target.closest('[data-ca]'); if (!b) return; setView(CA_VIEW[b.dataset.ca]); });
    $('#caSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-cam]'); if (!b) return; S.ca.mk = b.dataset.cam; save('gk_camk', S.ca.mk); loadCact(); });
  }

  // ───────────────────────── 실적 컨센서스 TOP (이번 주·지난주 상회/하회) ─────────────────────────
  S.ew = { w: '0', mk: load('gk_ewmk2', 'KR'), data: {}, at: {} };
  async function loadEwk(force) {
    renderEwk();
    const w = S.ew.w;
    if (!force && S.ew.data[w] && Date.now() - (S.ew.at[w] || 0) < 3 * 60e3) return;
    try { S.ew.data[w] = await getJSON(`/api/earnv?week=${w}`, {}); S.ew.at[w] = Date.now(); } catch (e) { if (!S.ew.data[w]) S.ew.data[w] = { error: e.message }; }
    if (S.view === 'ewk') renderEwk();
  }
  function ewRow(x, i, mk) {
    const nm = mk === 'KR' ? x.n || x.t : x.t, sub = mk === 'KR' ? x.t : x.ko || x.n || '';
    const pct = x.pct != null ? `${x.pct > 0 ? '+' : ''}${Math.abs(x.pct) >= 1000 ? Math.round(x.pct) : x.pct}%` : '';
    return `<li class="ew-row"><span class="f-rk">${i + 1}</span><button class="ca-co" data-open-co="${esc(mk)}|${esc(x.t)}|${esc(x.ko || x.n || '')}">${logoHTML(mk, x.t, x.n, 'sm')}<span><b>${esc(nm)}</b><small>${esc(sub)}${x.period ? ' · ' + esc(x.period) : ''}</small></span></button><span class="ew-line">${esc(x.line || '')}</span><span class="ew-pct ${x.v === '상회' ? 'beat' : x.v === '하회' ? 'miss' : 'inl'}">${esc(pct || x.v)}<small>${esc(x.b || '')} 예상 대비</small></span>${x.id ? `<button class="link ew-src" data-ew-open="${esc(x.id)}">공시 →</button>` : ''}</li>`;
  }
  function renderEwk() {
    const d = S.ew.data[S.ew.w], mk = S.ew.mk;
    $$('#ewWeek button').forEach((b) => b.classList.toggle('on', b.dataset.ew === S.ew.w));
    $$('#ewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.ewm === mk));
    const box = $('#ewBody');
    if (!d) { box.innerHTML = '<div class="skel"></div><div class="skel"></div>'; $('#ewMeta').textContent = ''; return; }
    if (d.error) { box.innerHTML = `<div class="empty">불러오지 못했습니다: ${esc(d.error)}</div>`; return; }
    const m = d[mk] || { beat: [], miss: [], n: 0, inline: 0 };
    $('#ewMeta').textContent = `${md(d.from)}~${md(d.to)} · 판정 ${m.n}건 (상회 ${m.beat.length} · 부합 ${m.inline} · 하회 ${m.miss.length})`;
    const part = (cls, title, arr, empty) => `<div class="card ew-card ${cls}"><h3>${title}</h3>${arr.length ? `<ul class="ew-list">${arr.map((x, i) => ewRow(x, i, mk)).join('')}</ul>` : `<div class="empty sm">${empty}</div>`}</div>`;
    const other = mk === 'US' ? 'KR' : 'US', om = d[other] || { n: 0 };
    const none = !m.beat.length && !m.miss.length;
    const hint = none ? `<div class="card ew-empty"><b>${S.ew.w === '0' ? '이번 주' : '지난주'} ${mk === 'KR' ? '국장' : '미장'}에는 예상치를 크게 웃돌거나 밑돈 실적이 아직 없어요.${m.inline ? ` (예상치에 부합한 실적 ${m.inline}건은 아래에)` : ''}</b><span>${mk === 'US' ? '미국 3분기 실적 시즌은 10월 중순 대형 은행부터 시작해 하순에 본격화돼요.' : '국내는 잠정실적 공시(대형주 10월 초·하순)가 나올 때마다 채워져요.'} 실적 공시가 나오면 몇 분 안에 자동으로 추가됩니다.</span><div class="chips">${S.ew.w === '0' ? '<button class="btn sm" data-ew-go="1">지난주 보기</button>' : ''}${om.n ? `<button class="btn sm primary" data-ew-mk="${other}">${other === 'KR' ? '국장' : '미장'} 보기 (${om.n}건)</button>` : ''}</div></div>` : '';
    box.innerHTML = hint + `<div class="ew-grid">${part('beat', '🟢 컨센서스 상회 TOP', m.beat, '아직 상회한 실적 발표가 없어요')}${part('miss', '🔴 컨센서스 하회 TOP', m.miss, '아직 하회한 실적 발표가 없어요')}</div>`
      + ((m.inl || []).length ? `<div class="card ew-card inl" style="margin-top:.8rem"><h3>⚪ 예상치 부합 <small class="muted">예상과 거의 같음 (영업이익 ±3% · EPS ±2% 이내)</small></h3><ul class="ew-list">${m.inl.map((x, i) => ewRow(x, i, mk)).join('')}</ul></div>` : '');
  }
  function bindEwk() {
    $('#ewWeek').addEventListener('click', (e) => { const b = e.target.closest('[data-ew]'); if (!b) return; S.ew.w = b.dataset.ew; loadEwk(); });
    $('#ewSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-ewm]'); if (!b) return; S.ew.mk = b.dataset.ewm; save('gk_ewmk2', S.ew.mk); renderEwk(); });
    $('#ewBody').addEventListener('click', (e) => {
      let b = e.target.closest('[data-ew-open]'); if (b) { showItem(b.dataset.ewOpen); return; }
      if ((b = e.target.closest('[data-ew-go]'))) { S.ew.w = b.dataset.ewGo; loadEwk(); return; }
      if ((b = e.target.closest('[data-ew-mk]'))) { S.ew.mk = b.dataset.ewMk; save('gk_ewmk2', S.ew.mk); renderEwk(); }
    });
  }

  // ───────────────────────── 투자 대가 포트폴리오 (SEC 13F) ─────────────────────────
  S.gu = { list: null, at: 0, one: {}, cur: null };
  const usdB = (v) => (v == null ? '—' : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}조` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${Math.round(v / 1e6)}M` : `$${fmtInt(v)}`);
  const CHG = { new: ['신규', 'new'], add: ['추가 매수', 'add'], cut: ['일부 매도', 'cut'], sold: ['전량 매도', 'sold'], same: ['', ''] };
  async function loadGuru(id) {
    S.gu.cur = id || null;
    renderGuru();
    try {
      if (id) { if (!S.gu.one[id] || Date.now() - S.gu.one[id]._at > 600e3) { const d = await getJSON(`/api/guru?id=${encodeURIComponent(id)}`, {}); S.gu.one[id] = { ...d, _at: Date.now() }; } }
      else if (!S.gu.list || Date.now() - S.gu.at > 600e3) { S.gu.list = await getJSON('/api/guru', {}); S.gu.at = Date.now(); }
    } catch (e) { if (id) S.gu.one[id] = { error: e.message, _at: 0 }; else S.gu.list = { error: e.message }; }
    if (S.view === 'guru') renderGuru();
  }
  const guName = (x) => (x.t ? (x.ko ? `${x.ko}` : x.t) : x.nm);
  function renderGuru() {
    const box = $('#guBody'), id = S.gu.cur;
    if (id) {
      const d = S.gu.one[id];
      if (!d) { box.innerHTML = '<div class="skel"></div><div class="skel"></div>'; return; }
      if (d.error) { box.innerHTML = `<div class="empty">불러오지 못했습니다: ${esc(d.error)}</div>`; return; }
      $('#guTitle').textContent = `${d.g.who} 포트폴리오`;
      if (d.none) { $('#guMeta').textContent = d.g.fund; box.innerHTML = `<button class="btn sm gu-back" data-gu-back>← 전체 투자자</button><div class="empty">보고 내용을 모으는 중이에요. 잠시 후 다시 확인해 주세요.</div>`; return; }
      $('#guMeta').textContent = `${d.g.fund} · ${d.q} 보고 (${md(d.filed)} 공개)`;
      const row = (x, i) => { const c = CHG[x.chg] || CHG.same; return `<li class="gu-row"><span class="f-rk">${i + 1}</span>${x.t ? `<button class="ca-co" data-open-co="US|${esc(x.t)}|${esc(x.ko || x.nm)}">${logoHTML('US', x.t, x.nm, 'sm')}<span><b>${esc(x.ko || x.t)}</b><small>${esc(x.t)} · ${esc(x.nm)}${x.pc ? ' · ' + (x.pc === 'PUT' ? '풋옵션' : '콜옵션') : ''}</small></span></button>` : `<span class="ca-co">${logoHTML('US', '', x.nm, 'sm')}<span><b>${esc(x.nm)}</b><small>${esc(x.cls || '')}${x.pc ? ' · ' + (x.pc === 'PUT' ? '풋옵션' : '콜옵션') : ''}</small></span></span>`}<span class="gu-v">${usdB(x.v)}${x.pct != null ? `<small>${x.pct}%</small>` : ''}</span><span class="gu-chg">${c[0] ? `<b class="gu-b ${c[1]}">${c[0]}${x.chg !== 'new' && x.chg !== 'sold' && x.dp != null ? ` ${x.dp > 0 ? '+' : ''}${x.dp}%` : ''}</b>` : ''}</span></li>`; };
      const bar = d.rows.filter((x) => !x.pc).slice(0, 8);
      box.innerHTML = `<button class="btn sm gu-back" data-gu-back>← 전체 투자자</button>
        <div class="card gu-hero"><div><b>${esc(d.g.who)}</b><span>${esc(d.g.fund)} · ${esc(d.g.style)}</span></div><div class="gu-stats"><span>총 평가액<b>${usdB(d.total)}</b></span><span>종목 수<b>${d.n}개</b></span><span>신규<b class="up">${d.cnt.new}</b></span><span>추가<b class="up">${d.cnt.add}</b></span><span>일부 매도<b class="down">${d.cnt.cut}</b></span><span>전량 매도<b class="down">${d.cnt.sold}</b></span></div>
        <div class="gu-bar">${bar.map((x, i) => `<i style="width:${Math.max(1, x.pct || 0)}%" class="c${i % 8}" title="${esc(guName(x))} ${x.pct}%"></i>`).join('')}</div><div class="gu-leg">${bar.map((x, i) => `<span><i class="c${i % 8}"></i>${esc(guName(x))} ${x.pct}%</span>`).join('')}</div></div>
        <div class="card"><h3 class="gu-h">보유 종목 <small>평가액 순 · ${d.prevQ ? d.prevQ + ' 대비 변화' : ''}</small></h3><ul class="gu-list">${d.rows.map(row).join('')}</ul></div>
        ${d.sold.length ? `<div class="card"><h3 class="gu-h">전량 매도한 종목 <small>${esc(d.prevQ || '')} 보유 → 이번 분기 0주 (직전 평가액)</small></h3><ul class="gu-list">${d.sold.map(row).join('')}</ul></div>` : ''}`;
      return;
    }
    $('#guTitle').textContent = '투자 대가 포트폴리오';
    const d = S.gu.list;
    if (!d) { box.innerHTML = '<div class="skel"></div><div class="skel"></div>'; $('#guMeta').textContent = ''; return; }
    if (d.error) { box.innerHTML = `<div class="empty">불러오지 못했습니다: ${esc(d.error)}</div>`; return; }
    const ready = d.list.filter((x) => !x.none).length;
    $('#guMeta').textContent = `${d.list.length}명 · SEC 13F`;
    const hot = (title, arr, cls) => arr.length ? `<div class="card gu-hot ${cls}"><h3 class="gu-h">${title} <small>${esc(d.hot.q)}</small></h3><ul class="gu-hl">${arr.slice(0, 8).map((x) => `<li>${x.t ? `<button class="ca-co" data-open-co="US|${esc(x.t)}|${esc(x.ko || x.nm)}">${logoHTML('US', x.t, x.nm, 'xs')}<b>${esc(x.ko || x.t)}</b></button>` : `<b>${esc(x.nm)}</b>`}<span class="gu-who">${x.who.length}명 · ${esc(x.who.slice(0, 3).join(', '))}${x.who.length > 3 ? ' 외' : ''}</span></li>`).join('')}</ul></div>` : '';
    box.innerHTML = `${ready < d.list.length ? `<p class="note">보고 내용을 모으는 중이에요 (${ready}/${d.list.length}명). 한 명씩 차례로 채워집니다.</p>` : ''}
      <div class="gu-hots">${hot('🟢 대가들이 함께 산 종목', d.hot.buy, 'gu-buy')}${hot('🔴 대가들이 함께 판 종목', d.hot.sell, 'gu-sell')}</div>
      <div class="gu-grid">${d.list.map((g) => `<button class="card gu-card" data-gu="${esc(g.id)}"><div class="gu-top"><b>${esc(g.who)}</b><span>${esc(g.fund)}</span></div><div class="gu-style">${esc(g.style)}</div>${g.none ? '<div class="muted gu-wait">불러오는 중…</div>' : `<div class="gu-meta">${esc(g.q)}${g.old ? ' (마지막 보고)' : ''} · ${usdB(g.total)} · ${g.n}종목</div><ol class="gu-top5">${(g.top || []).map((x) => `<li>${x.t ? logoHTML('US', x.t, x.nm, 'xs') : ''}<span>${esc(guName(x))}</span><em>${x.pct}%</em></li>`).join('')}</ol><div class="gu-cnt">${g.cnt.new ? `<b class="gu-b new">신규 ${g.cnt.new}</b>` : ''}${g.cnt.add ? `<b class="gu-b add">추가 ${g.cnt.add}</b>` : ''}${g.cnt.cut ? `<b class="gu-b cut">축소 ${g.cnt.cut}</b>` : ''}${g.cnt.sold ? `<b class="gu-b sold">전량 매도 ${g.cnt.sold}</b>` : ''}</div>`}</button>`).join('')}</div>`;
  }
  function bindGuru() {
    $('#guBody').addEventListener('click', (e) => {
      if (e.target.closest('[data-open-co]')) return;
      const b = e.target.closest('[data-gu]');
      if (b) { setView('guru', `gurus/${b.dataset.gu}`); loadGuru(b.dataset.gu); window.scrollTo({ top: 0 }); return; }
      if (e.target.closest('[data-gu-back]')) { setView('guru'); }
    });
  }

  // ───────────────────────── 공시 반응 통계 (이런 공시 뒤 주가는 보통 어떻게 됐나) ─────────────────────────
  S.rcMk = load('gk_rcmk', 'KR'); S.rc = {}; S.rcOpen = null;
  async function loadReact() {
    const mk = S.rcMk;
    renderReact();
    if (!S.rc[mk] || Date.now() - S.rc[mk]._at > 10 * 60e3) {
      try { S.rc[mk] = { ...(await getJSON(`/api/reaction?mk=${mk}`, {})), _at: Date.now() }; } catch (e) { S.rc[mk] = { error: e.message, _at: Date.now() }; }
      if (S.view === 'react' && S.rcMk === mk) renderReact();
    }
  }
  const rcPct = (v) => (v == null ? '—' : `<b class="${dirCls(v)}">${fmtPct(v)}</b>`);
  function rcBar(v, max) { if (v == null) return ''; const w = Math.min(50, (Math.abs(v) / max) * 50); return `<span class="rc-bar"><i class="${v >= 0 ? 'p' : 'n'}" style="${v >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></i></span>`; }
  function renderReact() {
    const mk = S.rcMk, d = S.rc[mk];
    $$('#rcSeg button').forEach((b) => b.classList.toggle('on', b.dataset.rc === mk));
    const box = $('#rcBody');
    if (!box) return;
    if (!d) { box.innerHTML = '<div class="skel"></div><div class="skel"></div>'; return; }
    if (d.error) { box.innerHTML = `<div class="card"><p class="err">불러오지 못했습니다: ${esc(d.error)}</p></div>`; return; }
    const types = d.types || [];
    $('#rcMeta').textContent = `${fmtInt(d.total || 0)}건 분석 · 최근 1년`;
    const max = Math.max(5, ...types.map((t) => Math.abs(t.avg1 ?? 0)), ...types.map((t) => Math.abs(t.avg5 ?? 0)));
    box.innerHTML = `<div class="ht-info"><b>이런 공시가 나오면 주가는 보통 어떻게 됐을까?</b> 지난 공시·보도자료마다 <em>발표 직전 종가</em> 대비 <em>다음 거래일 종가</em>와 <em>5거래일 뒤 종가</em> 수익률을 계산해 유형별로 모았어요. 평균은 극단값을 잘라 계산하고, <em>상승 비율</em>은 오른 경우의 비율이에요. 과거 통계일 뿐 앞으로를 보장하지 않아요.</div>
      ${types.length ? `<div class="card rc-card"><div class="rc-head"><span>공시 유형</span><span>다음 날</span><span>5일 뒤</span></div>
        <ul class="rc-list">${types.map((t) => `<li data-rck="${esc(t.k)}" class="${S.rcOpen === t.k ? 'open' : ''}"><div class="rc-n"><b>${esc(t.label)}</b><small>${fmtInt(t.n)}건</small></div>
          <div class="rc-c">${rcPct(t.avg1)}${rcBar(t.avg1, max)}<small>상승 ${t.up1 ?? '—'}% · 중간값 ${fmtPct(t.med1)}</small></div>
          <div class="rc-c">${rcPct(t.avg5)}${rcBar(t.avg5, max)}<small>상승 ${t.up5 ?? '—'}% · 중간값 ${fmtPct(t.med5)}</small></div></li>${S.rcOpen === t.k ? `<li class="rc-cases" id="rcCases"><div class="skel"></div></li>` : ''}`).join('')}</ul>
        <p class="note">유형을 누르면 최근 사례를 볼 수 있어요. 3건 이상 모인 유형만 보여요 · 매일 조금씩 쌓여요.</p></div>`
      : `<div class="card"><p class="muted" style="margin:.2rem 0">아직 통계를 모으는 중이에요. 지난 공시의 발표 후 주가를 하루 수백 건씩 계산하고 있어서, 며칠 안에 유형별 통계가 채워져요.</p></div>`}`;
    if (S.rcOpen) loadRcCases(mk, S.rcOpen);
  }
  async function loadRcCases(mk, k) {
    let j;
    try { j = await getJSON(`/api/reaction?mk=${mk}&k=${encodeURIComponent(k)}`, {}); } catch (e) { j = { cases: [], error: e.message }; }
    const el = $('#rcCases');
    if (!el || S.rcOpen !== k) return;
    el.innerHTML = (j.cases || []).length ? `<table class="tbl rc-t"><tr><th>발표</th><th>종목·내용</th><th>다음 날</th><th>5일 뒤</th></tr>${j.cases.map((c) => `<tr data-id="${esc(c.id)}"><td class="mono">${esc(fmtDT(new Date(c.ms)).date)}</td><td><b>${esc(c.tk)}</b> <span class="muted">${esc(c.title || '')}</span></td><td>${rcPct(c.r1)}</td><td>${rcPct(c.r5)}</td></tr>`).join('')}</table>` : `<p class="muted">사례가 없어요.${j.error ? ' ' + esc(j.error) : ''}</p>`;
  }
  // 공시 상세: 같은 유형 공시의 과거 반응
  async function loadItemReact(n) {
    const el = $('#aReact');
    if (!el || !n.ticker) return;
    let j;
    try { j = await getJSON(`/api/reaction?id=${encodeURIComponent(n.id)}`, {}); } catch { return; }
    if (S.sel !== n.id || !j.k || (!j.stat && !j.own)) return;
    const t = j.stat;
    el.hidden = false;
    el.innerHTML = `<div class="box rc-item"><h4>이런 공시 뒤 주가는? <small>${esc(j.label)} · ${j.mk === 'KR' ? '국장' : '미장'} 과거 통계</small></h4>
      ${t ? `<div class="rc-row"><div><span>다음 날 평균</span>${rcPct(t.avg1)}<small>상승 ${t.up1 ?? '—'}%</small></div><div><span>5일 뒤 평균</span>${rcPct(t.avg5)}<small>상승 ${t.up5 ?? '—'}%</small></div><div><span>표본</span><b>${fmtInt(t.n)}건</b><small>최근 1년</small></div>${j.own ? `<div class="own"><span>이 공시 실제</span><b>${j.own.r1 != null ? fmtPct(j.own.r1) : '—'} / ${j.own.r5 != null ? fmtPct(j.own.r5) : '—'}</b><small>다음 날 / 5일 뒤</small></div>` : ''}</div>` : `<p class="muted" style="margin:.3rem 0">이 유형은 아직 표본이 모이는 중이에요.${j.own ? ` 이 공시 실제: 다음 날 ${fmtPct(j.own.r1)}, 5일 뒤 ${fmtPct(j.own.r5)}` : ''}</p>`}
      <p class="note">발표 직전 종가 대비 수익률 · 과거 통계일 뿐 앞으로를 보장하지 않아요 · <button class="link" data-go="react">유형별 전체 보기 →</button></p></div>`;
  }
  function bindReact() {
    $('#rcSeg')?.addEventListener('click', (e) => { const b = e.target.closest('[data-rc]'); if (!b) return; S.rcMk = b.dataset.rc; S.rcOpen = null; save('gk_rcmk', S.rcMk); loadReact(); });
    $('#rcBody')?.addEventListener('click', (e) => { const li = e.target.closest('[data-rck]'); if (!li) return; S.rcOpen = S.rcOpen === li.dataset.rck ? null : li.dataset.rck; renderReact(); });
  }

  // ───────────────────────── VI·서킷 (국장 VI 발동·해제 / 미장 거래정지·재개) ─────────────────────────
  S.htMk = load('gk_htmk', 'KR'); S.ht = {}; S.htF = 'all';
  const HT_INFO = {
    KR: '<b>VI(변동성완화장치)</b> 주가가 짧은 시간에 크게 움직이면 2분 동안 단일가 매매로 바뀌어요. <em>정적 VI</em>는 시가·직전 단일가 대비 ±10% 안팎, <em>동적 VI</em>는 직전 체결가 대비 순간 급변 때 걸려요.',
    US: '<b>거래정지(서킷브레이커)</b> 미장 정규장(뉴욕 9:30~16:00)에 걸려요. 개별 종목은 5분 사이 급등락하면 <em>LULD 5분 정지</em>, 중요 뉴스를 앞두면 <em>뉴스 대기 정지</em>가 걸려요. S&P500이 7·13·20% 빠지면 <em>시장 전체 서킷브레이커</em>가 걸려요.',
  };
  // 뉴욕 시각 → 한국 시각
  function etToKst(date, t) {
    if (!date || !t) return '';
    try {
      const probe = new Date(`${date}T12:00:00Z`);
      const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(probe).find((x) => x.type === 'timeZoneName')?.value || 'GMT-4';
      const oh = Number((off.match(/GMT([+-]\d+)/) || [])[1] || -4);
      const ms = Date.parse(`${date}T${t}Z`) - oh * 3600e3;
      return new Date(ms + 9 * 3600e3).toISOString().slice(11, 16);
    } catch { return ''; }
  }
  const secOf = (t) => { const m = String(t || '').match(/(\d+):(\d+):(\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
  const durTxt = (a, b) => { const x = secOf(a), y = secOf(b); if (x == null || y == null || y < x) return ''; const d = y - x; return d < 60 ? `${d}초` : d < 3600 ? `${Math.round(d / 60)}분` : `${Math.floor(d / 3600)}시간 ${Math.round((d % 3600) / 60)}분`; };
  async function loadHalts(quiet) {
    const mk = S.htMk;
    if (!quiet) renderHalts();
    try { S.ht[mk] = { ...(await getJSON(`/api/halts?mk=${mk}`, {})), _at: Date.now() }; } catch (e) { S.ht[mk] = { error: e.message, _at: Date.now() }; }
    if (S.view === 'halt' && S.htMk === mk) renderHalts();
    clearTimeout(loadHalts._t);
    loadHalts._t = setTimeout(() => { if (S.view === 'halt' && !document.hidden) loadHalts(true); }, 20000); // 20초마다
  }
  function htName(x, mk) { return mk === 'KR' ? x.name || x.code : x.sym; }
  function htActiveCard(x, mk) {
    const nm = htName(x, mk), code = mk === 'KR' ? x.code : x.sym;
    const sub = mk === 'KR' ? `${esc(x.code)}${x.kind ? ' · ' + esc(x.kind) + ' VI' : ''}` : `${esc(x.ko || x.name || '')}`;
    const onTxt = mk === 'KR' ? x.on?.slice(0, 5) : `뉴욕 ${x.on?.slice(0, 5)} · 한국 ${etToKst(x.date, x.on)}`;
    const tag = mk === 'KR'
      ? `<span class="ht-kind ${x.dir === 'down' ? 'down' : 'up'}">${x.dir === 'down' ? '하락 VI' : '상승 VI'}</span>`
      : `<span class="ht-kind ${x.luld ? 'luld' : 'news'}">${esc(x.reason || x.code || '정지')}</span>`;
    const until = mk === 'US' && x.off ? `<span class="ht-until">재개 예정 ${esc(x.off.slice(0, 5))}${x.rdate && x.rdate !== x.date ? ' (' + esc(x.rdate.slice(5)) + ')' : ''}</span>` : mk === 'KR' ? '<span class="ht-until">약 2분 뒤 해제</span>' : '<span class="ht-until">재개 시각 미정</span>';
    return `<button class="ht-live" data-open-co="${esc(mk)}|${esc(code)}|${esc(nm)}">${logoHTML(mk, code, nm, 'md')}<div class="ht-lm"><div class="ht-lt"><b>${esc(nm)}</b>${tag}</div><small>${sub}</small><div class="ht-lx"><span><i class="ht-dot"></i>${esc(onTxt)} 발동</span>${until}</div></div>
      <div class="ht-lp">${x.nowPct != null ? `<b class="${dirCls(x.nowPct)}">${fmtPct(x.nowPct)}</b><small>${mk === 'US' ? '정규장 등락' : '오늘 등락'}</small>` : ''}${mk === 'KR' && x.gap != null ? `<small>기준가 대비 <span class="${dirCls(x.gap)}">${fmtPct(x.gap)}</span></small>` : ''}${x.times > 1 ? `<em class="ht-times">오늘 ${x.times}회</em>` : ''}</div></button>`;
  }
  function htRow(x, mk) {
    const nm = htName(x, mk), code = mk === 'KR' ? x.code : x.sym;
    const on = x.on ? x.on.slice(0, 5) : '—', off = x.off ? x.off.slice(0, 5) : '';
    const dur = x.off ? durTxt(x.on, x.off) : '';
    const time = `<div class="ht-t"><b>${esc(on)}</b>${x.active ? '<span class="ht-on">발동 중</span>' : off ? `<small>→ ${esc(off)}${x.est ? '쯤' : ''}${dur ? ' · ' + dur : ''}</small>` : ''}${mk === 'US' ? `<small class="ht-kst">한국 ${etToKst(x.date, x.on)}</small>` : ''}</div>`;
    const what = mk === 'KR'
      ? `<span class="ht-kind sm ${x.dir === 'down' ? 'down' : 'up'}">${x.dir === 'down' ? '하락' : '상승'}${x.kind ? ' · ' + esc(x.kind) : ''}</span>`
      : `<span class="ht-kind sm ${x.luld ? 'luld' : x.mwc ? 'mwc' : 'news'}">${esc(x.reason || x.code)}</span>`;
    const right = mk === 'KR'
      ? (x.nowPct != null ? `<b class="${dirCls(x.nowPct)}">${fmtPct(x.nowPct)}</b><small>오늘 등락</small>` : '') + (x.price ? `<small class="ht-vp">발동가 ${fmtInt(x.price)}원${x.gap != null ? ` <span class="${dirCls(x.gap)}">(${fmtPct(x.gap)})</span>` : ''}</small>` : '')
      : (x.nowPct != null ? `<b class="${dirCls(x.nowPct)}">${fmtPct(x.nowPct)}</b><small>정규장 등락</small>` : '') + (x.price ? `<small class="ht-vp">정지 기준가 $${esc(fmtPx(x.price))}</small>` : x.now != null ? `<small class="ht-vp">$${esc(fmtPx(x.now))}</small>` : '');
    return `<li class="${x.active ? 'is-on' : ''}" data-open-co="${esc(mk)}|${esc(code)}|${esc(nm)}">${time}<div class="ht-n"><b>${esc(nm)}</b><small>${mk === 'KR' ? esc(x.code) : esc(x.ko || x.name || '')}${x.times > 1 ? ` <em class="ht-times">오늘 ${x.times}회</em>` : ''}</small>${what}</div><div class="ht-r">${right}</div></li>`;
  }
  function renderHalts() {
    const mk = S.htMk, d = S.ht[mk];
    $$('#htSeg button').forEach((b) => b.classList.toggle('on', b.dataset.ht === mk));
    const box = $('#htBody');
    if (!box) return;
    if (!d) { box.innerHTML = '<div class="skel"></div><div class="skel"></div>'; $('#htMeta').textContent = ''; return; }
    if (d.error) { box.innerHTML = `<div class="card"><p class="err">불러오지 못했습니다: ${esc(d.error)}</p></div>`; return; }
    const dd = new Date(d.date + 'T12:00:00Z');
    const dateTxt = `${dd.getUTCMonth() + 1}월 ${dd.getUTCDate()}일 (${'일월화수목금토'[dd.getUTCDay()]})`;
    $('#htMeta').textContent = `${d.today ? '오늘' : '최근 거래일'} ${dateTxt}${mk === 'US' ? ' · 뉴욕 기준' : ''}${d.at ? ' · ' + fmtDT(new Date(d.at)).hm + ' 확인 · 1분마다 기록' : ''}`;
    const hist = d.history || [];
    const f = S.htF;
    const pick = (x) => f === 'all' || (mk === 'KR' ? (f === 'up' ? x.dir !== 'down' : x.dir === 'down') : f === 'luld' ? x.luld : !x.luld);
    const shown = hist.filter(pick);
    const nUp = hist.filter((x) => x.dir !== 'down').length, nDn = hist.length - nUp, nL = hist.filter((x) => x.luld).length;
    const chips = mk === 'KR'
      ? [['all', '전체', hist.length], ['up', '상승 VI', nUp], ['down', '하락 VI', nDn]]
      : [['all', '전체', hist.length], ['luld', '급등락(LULD)', nL], ['etc', '뉴스·기타', hist.length - nL]];
    const mwc = (d.stats?.mwc || [])[0];
    box.innerHTML = `
      ${mwc ? `<div class="ht-mwc"><b>⚠ ${esc(mwc.reason)}</b><span>뉴욕 ${esc(mwc.on?.slice(0, 5))} 발동${mwc.off ? ' · ' + esc(mwc.off.slice(0, 5)) + ' 재개' : ''}</span></div>` : ''}
      <div class="ht-info">${HT_INFO[mk]}</div>
      ${d.err ? `<p class="note err">최근 확인 중 오류: ${esc(d.err)}</p>` : ''}
      <div class="card ht-now"><div class="card-h"><h3><i class="ht-pulse"></i>지금 걸려 있는 종목 <b>${d.active?.length || 0}</b></h3></div>
        ${d.active?.length ? `<div class="ht-lives">${d.active.map((x) => htActiveCard(x, mk)).join('')}</div>` : `<p class="muted ht-empty">${d.open ? (mk === 'KR' ? '지금 VI가 걸린 종목이 없어요.' : '지금 거래정지된 종목이 없어요.') : mk === 'KR' ? '지금은 정규장(9:00~15:30) 시간이 아니에요.' : `지금은 미장 정규장 시간이 아니에요. 정규장: 뉴욕 9:30~16:00 (한국 ${etToKst(d.date, '09:30:00')}~${etToKst(d.date, '16:00:00')})`}</p>`}</div>
      <div class="card ht-hist"><div class="card-h"><h3>${d.today ? '오늘' : dateTxt} ${mk === 'KR' ? 'VI 발동 내역' : '거래정지 내역'} <b>${hist.length}</b></h3><span class="muted sm">${d.stats?.stocks || 0}종목</span></div>
        <div class="chips ht-f">${chips.map(([k, l, n]) => `<button class="${f === k ? 'on' : ''}" data-htf="${k}">${l} ${n}</button>`).join('')}</div>
        ${shown.length ? `<ul class="ht-list">${shown.map((x) => htRow(x, mk)).join('')}</ul>` : `<p class="muted ht-empty">${hist.length ? '해당하는 내역이 없어요.' : mk === 'KR' ? '아직 VI 발동 내역이 없어요. 장중(9:00~15:30)에 1분마다 기록해요.' : '아직 거래정지 내역이 없어요. 미장 정규장(뉴욕 9:30~16:00)에 1분마다 기록해요.'}</p>`}
        <p class="note">${mk === 'KR' ? '출처: 한국투자증권 · 괴리율은 VI 기준가 대비 · 종목을 누르면 기업 분석' : '출처: 나스닥 공식 거래정지 목록(나스닥·뉴욕·아멕스 전체) · 시각은 뉴욕 기준, 아래는 한국 시각 · 종목을 누르면 기업 분석'}</p></div>`;
  }
  function bindHalts() {
    $('#htSeg')?.addEventListener('click', (e) => { const b = e.target.closest('[data-ht]'); if (!b) return; S.htMk = b.dataset.ht; S.htF = 'all'; save('gk_htmk', S.htMk); if (S.ht[S.htMk] && Date.now() - S.ht[S.htMk]._at < 20e3) renderHalts(); else loadHalts(); });
    $('#htBody')?.addEventListener('click', (e) => { const b = e.target.closest('[data-htf]'); if (!b) return; S.htF = b.dataset.htf; renderHalts(); });
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
  // ───────── 테마·섹터 관련주 사전 ─────────
  S.td = { mk: load('gk_tdmk', 'KR'), k: 't', q: '', open: new Set(), data: {}, live: {} };
  async function loadTdir() {
    const mk = S.td.mk;
    if (!S.td.data[mk] || Date.now() - S.td.data[mk]._at > (S.td.data[mk].groups?.some((g) => !g.s) ? 60e3 : 10 * 60e3)) {
      try { S.td.data[mk] = { ...(await getJSON('/api/themes?dir=' + mk)), _at: Date.now() }; } catch (e) { if (!S.td.data[mk]) S.td.data[mk] = { error: e.message, groups: [] }; }
    }
    renderTdir();
  }
  const tdKey = (g) => `${S.td.mk}:${g.k}:${g.no || g.name}`;
  function tdChip(mk, t, name, q) {
    const pc = q ? (q.livePct ?? q.pct) : null;
    return `<button class="th-chip td-chip" data-open-co="${mk}|${esc(t)}|${esc(name || '')}">${logoHTML(mk, t, name, 'xs')}${esc(mk === 'KR' ? name : t)}${pc != null ? ` <em class="${dirCls(pc)}">${pctTxt(pc)}</em>` : ''}</button>`;
  }
  function renderTdir() {
    const { mk, k, q } = S.td, d = S.td.data[mk];
    $$('#tdSeg button').forEach((b) => b.classList.toggle('on', b.dataset.td === mk));
    $$('#tdKind button').forEach((b) => b.classList.toggle('on', b.dataset.tk === k));
    const box = $('#tdBody');
    if (!d) { box.innerHTML = '<div class="skel"></div><div class="skel"></div>'; return; }
    if (d.error) { box.innerHTML = `<div class="empty">불러오지 못했습니다: ${esc(d.error)}</div>`; return; }
    const ql = q.trim().toLowerCase();
    let list = d.groups.filter((g) => g.k === k);
    if (ql) list = d.groups.filter((g) => g.name.toLowerCase().includes(ql) || (g.s || []).some(([t, n]) => String(n).toLowerCase().includes(ql) || String(t).toLowerCase() === ql));
    if (!ql) list.sort((a, b) => (b.s ? 1 : 0) - (a.s ? 1 : 0) || (k === 't' && mk === 'KR' ? (b.n || 0) - (a.n || 0) : 0));
    const filled = d.groups.filter((g) => g.s).length;
    $('#tdMeta').textContent = mk === 'KR' ? `테마 ${d.groups.filter((g) => g.k === 't').length}개 · 업종 ${d.groups.filter((g) => g.k === 'i').length}개${filled < d.groups.length ? ` · 종목 정리 중 ${filled}/${d.groups.length}` : ''}` : `테마 ${d.groups.filter((g) => g.k === 't').length}개 · 섹터 ${d.groups.filter((g) => g.k === 'i').length}개`;
    if (!list.length) { box.innerHTML = `<div class="empty">${ql ? `"${esc(q)}"에 맞는 테마·종목이 없어요.` : '목록을 준비하는 중이에요. 잠시 후 다시 확인해 주세요.'}</div>`; return; }
    const keys = [];
    box.innerHTML = list.slice(0, ql ? 60 : 400).map((g) => {
      const key = tdKey(g), open = S.td.open.has(key), s = g.s || [];
      const hit = ql ? s.filter(([t, n]) => String(n).toLowerCase().includes(ql) || String(t).toLowerCase() === ql).map(([t]) => t) : [];
      const rep = [...s.filter(([t]) => hit.includes(t)), ...s.filter(([t]) => !hit.includes(t))].slice(0, 4);
      const show = open ? s : rep;
      for (const [t] of show) keys.push(wkey(mk, t));
      const live = S.td.live[key];
      const rows = open ? (mk === 'KR' && live?.length ? [...live.map((x) => tdChip('KR', x.t, x.name, { pct: x.pct })), ...s.filter(([t]) => !live.some((x) => x.t === t)).map(([t, n]) => tdChip('KR', t, n, quoteOf('KR', t)))] : s.map(([t, n]) => tdChip(mk, t, n, quoteOf(mk, t)))) : rep.map(([t, n]) => tdChip(mk, t, n, quoteOf(mk, t)));
      return `<div class="card td-card${open ? ' open' : ''}" data-td-key="${esc(key)}" data-td-no="${esc(g.no || '')}" data-td-k="${g.k}">
        <div class="td-h"><b>${esc(g.name)}</b><span class="muted sm">${s.length || g.n || 0}종목${g.etf ? ' · ' + esc(g.etf) : ''}</span><i class="td-car">${open ? '접기 ▴' : (s.length > 4 ? `+${s.length - 4} 더보기 ▾` : '▾')}</i></div>
        <div class="td-chips">${s.length ? rows.join('') : '<span class="muted sm">종목 정리 중…</span>'}</div></div>`;
    }).join('');
    // 보이는 종목 시세 (미국은 오늘 등락률, 한국은 펼친 카드만 네이버 실시간)
    //  시세를 못 받는 종목(상장폐지·조회 실패)은 1분 동안 다시 묻지 않음 — 예전엔 '받기 실패 → 다시 그림 → 또 요청'이 끝없이 돌아 화면이 멈췄음
    const need = [...new Set(keys)].filter((x) => { if (quoteOf(...x.split(':'))) return false; const q = S.quotes.get(x); return !q?._at || Date.now() - q._at > 60e3; });
    if (need.length && !renderTdir._busy) { renderTdir._busy = true; (async () => { let got = false; for (let i = 0; i < Math.min(need.length, 120); i += 40) got = (await fetchQuotes(need.slice(i, i + 40))) || got; renderTdir._busy = false; if (got && S.view === 'tdir') renderTdir(); })(); }
  }
  function bindTdir() {
    $('#tdSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-td]'); if (!b) return; S.td.mk = b.dataset.td; save('gk_tdmk', S.td.mk); loadTdir(); });
    $('#tdKind').addEventListener('click', (e) => { const b = e.target.closest('[data-tk]'); if (!b) return; S.td.k = b.dataset.tk; renderTdir(); });
    let t; $('#tdQ').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.td.q = e.target.value; renderTdir(); }, 150); });
    $('#tdBody').addEventListener('click', async (e) => {
      if (e.target.closest('[data-open-co]')) return; // 종목 누르면 기업 분석 (전역 처리)
      const c = e.target.closest('.td-card'); if (!c) return;
      const key = c.dataset.tdKey;
      if (S.td.open.has(key)) { S.td.open.delete(key); renderTdir(); return; }
      S.td.open.add(key); renderTdir();
      if (S.td.mk === 'KR' && c.dataset.tdNo) { // 한국: 펼친 테마는 오늘 등락률 순으로 (네이버)
        try { const j = await getJSON(`/api/themes?kind=${c.dataset.tdK === 'i' ? 'industry' : 'theme'}&no=${c.dataset.tdNo}`); S.td.live[key] = j.stocks || []; if (S.view === 'tdir') renderTdir(); } catch {}
      }
    });
  }
  async function loadThemes(force) {
    if (S.view !== 'themes') return;
    if (!S.themes || force || Date.now() - (S.themesAt || 0) > 60e3) {
      try { S.themes = await getJSON('/api/themes?t=' + Math.floor(Date.now() / 30e3), {}); S.themesAt = Date.now(); } catch (e) { if (!S.themes) S.themes = { error: e.message }; }
    }
    renderThemes();
  }
  function thLeader(s, mk) {
    const lim = s.limit === 'up' ? '<b class="lim up">상한</b>' : s.limit === 'down' ? '<b class="lim down">하한</b>' : '';
    const label = mk === 'KR' ? s.name : s.t;
    return `<button class="th-chip td-chip" data-open-co="${mk}|${esc(s.t)}|${esc(s.name || s.nameKo || '')}">${logoHTML(mk, s.t, s.name || s.nameKo || s.t, 'xs')}${esc(label)} <em class="${dirCls(s.pct)}">${pctTxt(s.pct)}</em>${lim}</button>`;
  }
  function thRow(g, i, kind, key) {
    const tot = Math.max(1, g.rise + g.fall + g.flat);
    const us = kind === 'us';
    return `<div class="th-row" ${us ? `data-th-us="${esc(key)}"` : `data-th-no="${g.no}" data-th-kind="${kind}"`}>
      <div class="th-top"><span class="rk">${i + 1}</span><b class="th-name">${esc(g.name)}</b><span class="th-cnt">${g.total}종목${us && g.etf ? ` · <span class="mono">${esc(g.etf)}</span>${g.etfPct != null ? ` <em class="${dirCls(g.etfPct)}">${pctTxt(g.etfPct)}</em>` : ''}` : ''}</span><span class="th-rate ${dirCls(g.rate)}">${pctTxt(g.rate)}</span><span class="th-caret">▾</span></div>
      <div class="th-breadth" title="상승 ${g.rise} · 하락 ${g.fall} · 보합 ${g.flat}"><i class="r" style="width:${(g.rise / tot) * 100}%"></i><i class="f" style="width:${(g.fall / tot) * 100}%"></i></div>
      ${g.why ? `<p class="th-why"><i>AI 추정</i>${esc(g.why)}</p>` : ''}
      ${g.leaders?.length ? `<div class="th-leaders">${g.leaders.map((s) => thLeader(s, us ? 'US' : 'KR')).join('')}</div>` : ''}
      <div class="th-more" hidden></div></div>`;
  }
  async function toggleTheme(el) {
    const box = el.querySelector('.th-more');
    if (!box) return;
    if (!box.hidden) { box.hidden = true; el.classList.remove('open'); return; }
    box.hidden = false; el.classList.add('open');
    if (el.dataset.thUs) { // 미국: 소속 종목은 이미 받아 둠
      const [k, i] = el.dataset.thUs.split(':');
      const g = (S.themes?.us?.[k] || [])[Number(i)];
      box.innerHTML = `<ol class="rank">${(g?.members || []).map((s, j) => rankRow({ market: 'US', ticker: s.t, name: s.name, price: s.price, pct: s.pct }, j)).join('')}</ol>`;
      return;
    }
    box.innerHTML = '<div class="loading"><span class="spin"></span>종목 불러오는 중…</div>';
    try {
      const j = await getJSON(`/api/themes?kind=${el.dataset.thKind}&no=${el.dataset.thNo}`, {});
      box.innerHTML = `<ol class="rank">${(j.stocks || []).map((s, i) => rankRow({ market: 'KR', ticker: s.t, name: s.name, price: s.price, pct: s.pct }, i)).join('')}</ol>`;
    } catch (e) { box.innerHTML = `<p class="muted">불러오지 못했습니다: ${esc(e.message)}</p>`; }
  }
  try { matchMedia('(min-width: 1101px)').addEventListener('change', () => { if (S.view === 'themes' && S.themes) renderThemes(); }); } catch {}
  function renderThemes() {
    const d = S.themes;
    $$('#thSeg button').forEach((b) => b.classList.toggle('on', b.dataset.th === S.thMk));
    if (!d) return;
    if (d.error) { $('#thBody').innerHTML = `<div class="empty">테마 정보를 불러오지 못했습니다: ${esc(d.error)}</div>`; return; }
    const thSes = S.thMk === 'US' && d.us?.session ? (d.us.session === 'DAY' ? ' · 주간거래(데이마켓) 등락률' : ' · 프리마켓 등락률') : '';
    $('#thMeta').textContent = `${fmtDT(new Date(d.at)).full} 기준${thSes} · 1분마다 갱신`;
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
      if (u.groups?.length) { // 국장과 같은 모양: 테마·섹터별 평균 등락률 + 상승/하락 비율 + 대장주 (누르면 소속 종목 전체)
        const G = u.groups, SG = u.sectorGroups || [];
        const idx = (arr, g) => arr.indexOf(g);
        //  PC는 좌우 칸 길이를 맞춤: 테마 위 8개 | 아래 8개, 섹터 위 6개 | 아래 5개 (모바일은 기존 그대로)
        const pc = matchMedia('(min-width: 1101px)').matches;
        const up = pc ? G.slice(0, 8) : G.filter((g) => g.rate >= 0).slice(0, 15), down = pc ? [...G].reverse().slice(0, 8) : [...G].reverse().filter((g) => g.rate < 0).slice(0, 6);
        const sUp = pc ? SG.slice(0, 6) : SG.filter((g) => g.rate >= 0), sDown = pc ? [...SG].reverse().slice(0, Math.max(0, SG.length - 6)) : [...SG].reverse().filter((g) => g.rate < 0);
        const IG = u.indexGroups || [];
        $('#thBody').innerHTML = `${IG.length ? `<div class="card th-idx"><div class="card-h"><h3>지수 흐름</h3><span class="muted sm">구성 종목 중 오른 종목·내린 종목 비율 · 누르면 전체 종목</span></div><div class="th-list th-idx-list">${IG.map((g, i) => thRow(g, i, 'us', 'indexGroups:' + i)).join('')}</div></div>` : ''}
          <div class="th-quad">
          <div class="card q-tt"><div class="card-h"><h3>오늘의 주도 테마 <b>TOP ${up.length}</b></h3><span class="muted sm">미국 테마 ${u.groupCount || G.length}개 · 소속 종목 평균 등락률</span></div><div class="th-list">${up.map((g, i) => thRow(g, i, 'us', 'groups:' + idx(G, g))).join('') || '<p class="muted">오른 테마가 없어요.</p>'}</div></div>
          <div class="card q-wt"><div class="card-h"><h3>약한 테마</h3><span class="muted sm">오늘 가장 많이 내린 테마</span></div><div class="th-list">${down.map((g, i) => thRow(g, i, 'us', 'groups:' + idx(G, g))).join('') || '<p class="muted">내린 테마가 없어요.</p>'}</div></div>
          <div class="card q-st"><div class="card-h"><h3>강한 섹터</h3><span class="muted sm">섹터 11개 · S&P 500 대형주 + 나스닥100 평균</span></div><div class="th-list">${sUp.map((g, i) => thRow(g, i, 'us', 'sectorGroups:' + idx(SG, g))).join('') || '<p class="muted">오른 섹터가 없어요.</p>'}</div></div>
          <div class="card q-ws"><div class="card-h"><h3>약한 섹터</h3></div><div class="th-list">${sDown.map((g, i) => thRow(g, i, 'us', 'sectorGroups:' + idx(SG, g))).join('') || '<p class="muted">내린 섹터가 없어요.</p>'}</div></div>
        </div><p class="note">미국 테마는 대표 종목들의 평균 등락률이에요(직전 정규장 기준). 테마를 누르면 소속 종목이 펼쳐지고, 종목을 누르면 기업 분석으로 이동합니다. 막대 = 상승(빨강)·하락(파랑) 종목 비율 · 옆 숫자는 대표 ETF 등락률.</p>`;
        return;
      }
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
      <div class="set-row"><div>데스크톱 알림<small>관심종목·매우 중요한 항목</small></div><input type="checkbox" class="tg" data-set="notify" ${S.notify ? 'checked' : ''}></div>${pushRows()}
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
    if (S.view !== 'item') { S.listScroll = window.scrollY; S.returnUrl = location.pathname === '/' ? '/' + (location.hash || '#' + (S.view || 'home')) : PATH_SEC[location.pathname.slice(1)] ? location.pathname : '/#home'; S.fromList = true; }
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
    loadItemReact(n);
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
        ${evHTML(n, true)}
        <section class="a-sec"><h3>AI 애널리스트 분석 <small>섹터 전문 애널리스트 관점의 핵심 요약 · 호재/악재 · 체크포인트</small></h3><div id="aAI">${aiPane(n)}</div></section>
        <section class="a-sec" id="aReact" hidden></section>
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
        : `<p class="note">${esc(a.provider || 'AI')}가 ${a.basis ? esc(a.basis) : '원문'}을 읽고 작성한 참고용 분석입니다.${a.numDrop ? ` 원문에서 확인되지 않는 숫자가 든 문장 ${a.numDrop}개는 자동으로 뺐어요.` : ' 숫자는 원문과 자동 대조했어요.'} 투자 판단 전 원문을 확인하세요.</p>`}`;
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
    if (S.co.has(url) && !S.co.get(url)?.error) return S.co.get(url); // v222: 실패했던 건 다시 열 때 다시 받음
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
  // 월가 시각 (핀허브): 애널리스트 투자의견 · 실적 서프라이즈 · 내부자 거래 심리
  function wallHTML(d) {
    const w = d?.wall;
    if (!w || w.none) return '';
    const parts = [];
    // 오래된 자료는 지금 의견처럼 보이지 않게 뺌 (투자의견 9개월·실적 2년 넘은 것)
    const recOld = w.rec?.period && Date.now() - Date.parse(String(w.rec.period).slice(0, 7) + '-01') > 270 * 864e5;
    const earnNew = (w.earn || []).filter((x) => !x.y || x.y >= new Date().getFullYear() - 1);
    if (w.rec && !recOld) {
      const r = w.rec, tot = r.sb + r.b + r.h + r.s + r.ss || 1;
      const buyP = Math.round(((r.sb + r.b) / tot) * 100);
      const pv = r.prev && r.prev.period !== r.period ? r.prev : null;
      const pvTot = pv ? pv.sb + pv.b + pv.h + pv.s + pv.ss : 0;
      const pvP = pvTot ? Math.round(((pv.sb + pv.b) / pvTot) * 100) : null;
      const seg = [['sb', r.sb, '강력 매수'], ['b', r.b, '매수'], ['h', r.h, '보유'], ['s', r.s, '매도'], ['ss', r.ss, '강력 매도']].filter((x) => x[1] > 0);
      parts.push(`<div class="wl-rec"><div class="wl-t"><b>애널리스트 투자의견</b><span>${esc(r.period)} 기준 · ${tot}명</span></div>
        <div class="wl-bar">${seg.map(([k, v, l]) => `<i class="${k}" style="flex:${v}" title="${l} ${v}명"></i>`).join('')}</div>
        <div class="wl-leg">${seg.map(([k, v, l]) => `<span><i class="${k}"></i>${l} ${v}</span>`).join('')}</div>
        <p class="wl-sum">매수 의견 <b class="${buyP >= 60 ? 'up' : buyP < 40 ? 'down' : ''}">${buyP}%</b>${pvP != null ? ` <span class="muted">(${esc(pv.period)} ${pvP}% → ${buyP >= pvP ? (buyP > pvP ? '상향' : '유지') : '하향'})</span>` : ''}</p></div>`);
    }
    if (earnNew.length) {
      const f = (v) => (v == null ? '—' : '$' + Number(v).toFixed(2));
      parts.push(`<div class="wl-earn"><div class="wl-t"><b>실적 서프라이즈</b><span>주당순이익(EPS) 예상 vs 실제</span></div><table class="tbl"><tr><th>분기</th><th>예상</th><th>실제</th><th>결과</th></tr>${earnNew.map((x) => {
        const beat = x.pct == null || x.act == null ? '' : x.pct > 0.5 ? `<b class="up">상회 ${fmtPct(x.pct)}</b>` : x.pct < -0.5 ? `<b class="down">하회 ${fmtPct(x.pct)}</b>` : '<b>부합</b>';
        return `<tr><td>${x.y ? `${x.y} ${x.q}Q` : esc(x.period)}</td><td class="mono">${f(x.est)}</td><td class="mono">${f(x.act)}</td><td>${beat}</td></tr>`;
      }).join('')}</table></div>`);
    }
    if (w.insider?.length) {
      const mx = Math.max(1, ...w.insider.map((x) => Math.abs(x.mspr || 0)));
      const net = w.insider.reduce((a, x) => a + (x.change || 0), 0);
      parts.push(`<div class="wl-ins"><div class="wl-t"><b>내부자 거래 심리</b><span>최근 ${w.insider.length}개월 · 임원·대주주 순매수(+)/순매도(−)</span></div>
        <div class="wl-mspr">${w.insider.map((x) => `<div title="${esc(x.ym)} · 심리지수 ${x.mspr != null ? Number(x.mspr).toFixed(1) : '—'} · 순변동 ${fmtInt(x.change)}주"><span class="bar"><i class="${(x.mspr || 0) >= 0 ? 'p' : 'n'}" style="height:${Math.max(3, Math.round((Math.abs(x.mspr || 0) / mx) * 100))}%"></i></span><em>${Number(x.ym.slice(5))}월</em></div>`).join('')}</div>
        <p class="wl-sum">기간 합계 <b class="${net > 0 ? 'up' : net < 0 ? 'down' : ''}">${net > 0 ? '순매수' : net < 0 ? '순매도' : '변동 없음'} ${net ? fmtInt(Math.abs(net)) + '주' : ''}</b></p></div>`);
    }
    if (!parts.length) return '';
    return `<div class="box wall"><h4>월가 시각 <small>Finnhub · 참고용</small></h4><div class="wl-grid">${parts.join('')}</div></div>`;
  }
  function metricsHTML(d0, n) {
    // 기업 정보는 서버에 최대 1~2시간 저장돼 가격이 옛날 값일 수 있음 → 지금 시세로 현재가·시가총액·PER·PBR을 다시 맞춤
    let d = d0;
    const lq = n?.ticker ? quoteOf(n.market, n.ticker)?.price : null;
    if (lq && d0.price && Math.abs(lq / d0.price - 1) > 0.001) {
      const k = lq / d0.price, r0 = d0.ratios || {};
      d = { ...d0, price: lq, marketCap: d0.marketCap ? d0.marketCap * k : d0.marketCap, ratios: { ...r0, per: r0.per != null ? r0.per * k : r0.per, pbr: r0.pbr != null ? r0.pbr * k : r0.pbr } };
    }
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
      ${metrics ? `<div class="box"><h4>핵심 재무·투자지표</h4>${metricsHTML(d, n)}</div>${wallHTML(d)}` : ''}
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
  // FINRA 일별 공매도 거래 비중 (매일 발표 · 잔고가 아니라 그날 거래 중 공매도 비율)
  function usShortVolHTML(d) {
    const v = d.shortVol || [];
    if (!v.length) return `<h4 style="margin-top:1.2rem">일별 공매도 거래 비중 <small>FINRA · 매 거래일 발표</small></h4><p class="note">데이터를 모으는 중이에요.</p>`;
    const avg = v.reduce((a, x) => a + x.pct, 0) / v.length, v0 = v[0];
    return `<h4 style="margin-top:1.2rem">일별 공매도 거래 비중 <small>FINRA · 매 거래일 발표 · ${esc(v0.date)} 기준</small></h4>
      <div class="mini-stats"><div><span>최근 거래일 비중</span><b class="${v0.pct >= 50 ? 'down' : ''}">${v0.pct.toFixed(1)}%</b></div><div><span>${v.length}일 평균</span><b>${avg.toFixed(1)}%</b></div><div><span>공매도 거래량</span><b>${fmtBig(v0.short)}주</b></div></div>
      <table class="tbl"><tr><th>일자</th><th>공매도 거래량</th><th class="hide-m">전체 거래량</th><th>비중</th></tr>${v.map((r) => `<tr><td>${esc(r.date)}</td><td>${nx(r.short, false)}</td><td class="hide-m">${nx(r.total, false)}</td><td class="${r.pct >= 50 ? 'down' : ''}">${r.pct.toFixed(1)}%</td></tr>`).join('')}</table>
      <p class="note">장외 거래소(FINRA 보고분) 기준이라 전체 시장 거래량과 다를 수 있어요. 50%가 넘으면 공매도 거래가 많은 날이에요.</p>`;
  }
  // IBKR 공매도 가능 수량 (빌릴 수 있는 주식 수 · 대차 수수료, 15분마다 확인)
  function usBorrowHTML(d) {
    const b = d.borrow;
    if (!b) return `<h4>공매도 가능 수량 <small>IBKR · 15분마다 확인</small></h4><p class="note">데이터를 모으는 중이거나 IBKR 목록에 없는 종목이에요.</p><div style="height:.6rem"></div>`;
    const av = (v) => (v == null ? '—' : v >= 10000000 ? '1,000만+' : fmtInt(v));
    const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60e3); return m < 60 ? `${Math.max(1, m)}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
    const kt = (ms) => { const k = fmtDT(new Date(ms)); return `${k.md} ${k.hm}`; };
    const fee = (v) => (v == null ? '—' : v.toFixed(2) + '%');
    return `<h4>공매도 가능 수량 <small>IBKR · 15분마다 확인${b.at ? ' · ' + ago(b.at) + ' 갱신' : ''}</small></h4>
      <div class="mini-stats"><div><span>지금 빌릴 수 있는 주식</span><b class="${b.avail === 0 ? 'up' : ''}">${b.avail === 0 ? '없음' : av(b.avail) + '주'}</b></div><div><span>대차 수수료(연)</span><b class="${b.fee >= 20 ? 'up' : ''}">${fee(b.fee)}</b></div><div><span>최근 변동</span><b>${b.rows[0] ? ago(b.rows[0].at) : '—'}</b></div></div>
      ${b.rows.length ? `<table class="tbl"><tr><th>변동 시점</th><th class="hide-m">시각 (KST)</th><th>가능 수량</th><th>수수료</th></tr>${b.rows.map((r, i) => { const nx2 = b.rows[i + 1]; const dir = nx2 ? (r.avail > nx2.avail ? 'up' : r.avail < nx2.avail ? 'down' : '') : ''; return `<tr><td>${ago(r.at)}</td><td class="hide-m">${kt(r.at)}</td><td class="${dir}">${av(r.avail)}</td><td>${fee(r.fee)}</td></tr>`; }).join('')}</table>` : '<p class="note">최근 4일 동안 변동이 없었어요.</p>'}
      <p class="note">가능 수량이 줄거나 0이 되면 공매도 물량이 바닥났다는 뜻이에요. 수수료가 높을수록 빌리기 어려운 종목이에요(숏스퀴즈 참고 지표).</p><div style="height:1rem"></div>`;
  }
  function usShortHTML(d) {
    if (!d.short?.length) return usBorrowHTML(d) + `<h4>공매도 잔고</h4>${note(d.errors?.short || '데이터 없음')}` + usShortVolHTML(d);
    const s0 = d.short[0], s1 = d.short[1];
    const chg = s1 && s1.interest ? ((s0.interest - s1.interest) / s1.interest) * 100 : null;
    return usBorrowHTML(d) + `<h4>공매도 잔고 <small>FINRA · ${esc(s0.date)} 결제일 기준 · 월 2회 발표</small></h4><div class="mini-stats"><div><span>공매도 잔고</span><b>${fmtBig(s0.interest)}주</b></div><div><span>직전 대비</span><b class="${dirCls(chg)}">${fmtPct(chg)}</b></div><div><span>숏커버 소요일</span><b>${s0.days !== null && s0.days !== undefined ? s0.days.toFixed(1) + '일' : '—'}</b></div></div>
      <table class="tbl"><tr><th>결제일</th><th>잔고</th><th class="hide-m">일평균 거래량</th><th>커버일</th></tr>${d.short.map((r) => `<tr><td>${esc(r.date)}</td><td>${nx(r.interest, false)}</td><td class="hide-m">${nx(r.avgVol, false)}</td><td>${r.days !== null && r.days !== undefined ? r.days.toFixed(2) : '—'}</td></tr>`).join('')}</table>` + usShortVolHTML(d);
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
      return metricsHTML(d, n) + wallHTML(d);
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
    setView('company', `s/${m}/${encodeURIComponent(t)}`); // 공유·검색용 종목 주소 (/s/US/NVDA)
    trackView(m, t, c.name);
    const on = inWatch(m, t), sec = sectorOf(m, t);
    const n = { market: m, ticker: t, corpCode: c.corpCode, name: c.name, exchange: c.exchange };
    $('#coBody').innerHTML = `<div class="co-hero">${logoHTML(m, t, c.name, 'lg')}<div><h3>${esc(c.name)}</h3><div class="dp-meta"><span class="mk ${m === 'KR' ? 'kr' : 'us'}">${m === 'KR' ? '한국' : '미국'}</span><span class="mono">${esc(t)}</span>${c.exchange ? `<span>${esc(exShort(c.exchange))}</span>` : ''}${sec ? `<span class="sector">${esc(sec)}</span>` : ''}<button class="link" data-star="${esc(m)}|${esc(t)}|${esc(c.name)}">${on ? '★ 관심종목' : '☆ 관심종목 추가'}</button><button class="link" data-alert-new="${esc(m)}|${esc(t)}|${esc(c.name)}">🎯 가격 알림</button></div></div><div class="px" id="coPx"></div></div>
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
      ${news.length ? `<ul class="why-news">${news.map((x, i) => [x, i]).filter(([x], k, arr) => { const key = String(x.titleKo || x.title || '').replace(/\s+/g, '').slice(0, 36); return arr.findIndex(([y]) => String(y.titleKo || y.title || '').replace(/\s+/g, '').slice(0, 36) === key) === k; }).slice(0, 6).map(([x, i]) => `<li class="${used.has(i) ? 'used' : ''}"><a href="${esc(x.url || '#')}" target="_blank" rel="noopener"${x.titleKo ? ` title="${esc(x.title)}"` : ''}>${esc(x.titleKo || x.title)}</a><small>${esc(x.src || '')} · ${rel(Date.parse(x.at))}</small></li>`).join('')}</ul>` : ''}
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
    krShort: '그날 거래량 중 공매도로 거래된 비중 상위 (한국투자증권). 쌓여 있는 물량은 \'국내 대차잔고\' 탭에서 보세요.',
    krLoan: '대차잔고 = 기관·외국인이 빌려 가서 아직 갚지 않은 주식 (공매도 대기 물량으로 많이 봅니다). 대형주와 공매도 상위 종목 약 80개를 하루 두 번(아침·저녁) 확인합니다 · 한국투자증권.',
    krInsider: 'DART 임원·주요주주 소유상황 / 주식등의 대량보유(5%) 보고.',
  };
  function fRow(i, m, t, name, sub, val, small, cls, attr) {
    return `<div class="f-row" ${attr}><span class="f-rk">${i}</span>${logoHTML(m, t, name, 'sm')}<div style="min-width:0"><div class="f-name">${esc(name)}</div><div class="f-sub">${sub}</div></div><div class="f-val ${cls || ''}">${val}${small ? `<small>${small}</small>` : ''}</div></div>`;
  }
  // 미국 회사 이름 한글로 (네이버 한글 종목명, 시세 받을 때 같이 옴)
  const usKo = (t, name) => { const q = t ? S.quotes.get(wkey('US', t)) : null; return q?.nameKo && hasKo(q.nameKo) ? q.nameKo : name; };
  const flowKoTried = new Set();
  function flowKoFetch(list) {
    const keys = [...new Set(list.filter((n) => n.ticker).map((n) => wkey('US', n.ticker)))].filter((k) => !S.quotes.get(k)?.nameKo && !flowKoTried.has(k));
    if (!keys.length) return;
    keys.forEach((k) => flowKoTried.add(k));
    (async () => { let ch = false; for (let i = 0; i < keys.length; i += 40) ch = (await fetchQuotes(keys.slice(i, i + 40))) || ch; if (ch && S.view === 'flows') renderFlows(); })();
  }
  // 임원 직함 한글로
  const ROLE_KO = [
    [/Chief Executive Officer/gi, 'CEO'], [/Chief Financial Officer/gi, 'CFO'], [/Chief Operating Officer/gi, 'COO'], [/Chief Technology Officer/gi, 'CTO'],
    [/Chief Investment Officer/gi, '최고투자책임자'], [/Chief Accounting Officer/gi, '최고회계책임자'], [/Chief Legal Officer|General Counsel/gi, '법무총괄'], [/Chief Medical Officer/gi, '최고의학책임자'],
    [/Chief Scientific Officer/gi, '최고과학책임자'], [/Chief Commercial Officer/gi, '최고사업책임자'], [/Chief Revenue Officer/gi, '최고매출책임자'], [/Chief People Officer|Chief Human Resources Officer/gi, '최고인사책임자'],
    [/Chief Information Officer/gi, '최고정보책임자'], [/Chief Marketing Officer/gi, '최고마케팅책임자'], [/Chief Risk Officer/gi, '최고위험관리책임자'], [/Chief Credit Officer/gi, '최고여신책임자'], [/Chief Strategy Officer/gi, '최고전략책임자'],
    [/Executive Vice President|\bEVP\b/gi, '수석부사장'], [/Senior Vice President|\bSVP\b/gi, '전무'], [/Vice President|\bVP\b/gi, '부사장'],
    [/Executive Chair(man|person)?/gi, '집행의장'], [/Chair(man|person|woman)? of the Board|Board Chair/gi, '이사회 의장'], [/\bChair(man|person|woman)?\b/gi, '의장'],
    [/President/gi, '사장'], [/\bDirector\b/gi, '이사'], [/Treasurer/gi, '재무담당'], [/Secretary/gi, '총무이사'], [/Controller/gi, '회계책임자'], [/\bOfficer\b/gi, '임원'], [/\bFounder\b/gi, '창업자'], [/\band\b/gi, '·'], [/\bCo-/gi, '공동 '],
  ];
  const roleKo = (s) => ROLE_KO.reduce((a, [re, k]) => a.replace(re, k), String(s || '')).replace(/\s*·\s*/g, '·').replace(/\s{2,}/g, ' ').trim();
  function renderFlows() {
    const box = $('#flows'), tab = S.flowTab;
    $$('#flowTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#flowFoot').textContent = TAB_INFO[tab] || '';
    const sub = $('#flowSub');
    if (tab === 'usInsider') sub.innerHTML = `<div class="seg" data-sub="insiderSide">${[['all', '전체'], ['P', '장내 매수'], ['S', '장내 매도']].map(([v, l]) => `<button data-v="${v}" class="${S.insiderSide === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    else if (tab === 'krLoan') sub.innerHTML = `<div class="seg" data-sub="loanSide">${[['top', '잔고 많은 순'], ['up', '최근 5일 급증']].map(([v, l]) => `<button data-v="${v}" class="${(S.loanSide || 'top') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    else if (tab === 'krInst' || tab === 'krFrgn') sub.innerHTML = `<div class="seg" data-sub="flowSide">${[['buy', '순매수 상위'], ['sell', '순매도 상위']].map(([v, l]) => `<button data-v="${v}" class="${S.flowSide === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    else sub.innerHTML = '';
    const byTime = (a, b) => b.ms - a.ms, all = [...S.items.values()];
    if (tab === 'usInsider') {
      let list = all.filter((n) => n.src === 'SEC' && n.raw.tx?.main && ['P', 'S'].includes(n.raw.tx.main.code));
      if (S.insiderSide !== 'all') list = list.filter((n) => n.raw.tx.main.code === S.insiderSide);
      list.sort(byTime);
      $('#flowMeta').textContent = `Form 4 ${list.length}건`;
      flowKoFetch(list.slice(0, 100));
      box.innerHTML = list.length ? list.slice(0, 100).map((n, i) => { const m = n.raw.tx.main, buy = m.code === 'P', k = fmtDT(new Date(n.ms)); return fRow(i + 1, 'US', n.ticker, `${n.ticker} · ${usKo(n.ticker, n.name)}`, `${esc(personName(n.raw.tx.owner))}${n.raw.tx.relation ? ' · ' + esc(roleKo(n.raw.tx.relation)) : ''}`, `${buy ? '+' : '-'}${usd(m.value)}`, `${fmtInt(m.shares)}주 · ${k.md} ${k.hm}:${k.s}`, buy ? 'buy' : 'sell', `data-id="${esc(n.id)}"`); }).join('') : `<div class="empty">${S.loaded.sec ? '아직 매수·매도가 파악된 Form 4가 없습니다.' : '불러오는 중…'}</div>`;
      return;
    }
    if (tab === 'usInst') {
      const list = all.filter((n) => n.src === 'SEC' && n.raw.category === 'inst').sort(byTime);
      $('#flowMeta').textContent = `${list.length}건`;
      flowKoFetch(list.slice(0, 100));
      box.innerHTML = list.length ? list.slice(0, 100).map((n, i) => { const k = fmtDT(new Date(n.ms)); return fRow(i + 1, 'US', n.ticker, n.ticker ? `${n.ticker} · ${usKo(n.ticker, n.name)}` : n.name, esc(n.head), esc(n.raw.form.replace('SCHEDULE ', 'SC ')), `${k.md} ${k.hm}:${k.s}`, '', `data-id="${esc(n.id)}"`); }).join('') : '<div class="empty">불러오는 중…</div>';
      return;
    }
    if (tab === 'krInsider') {
      const list = all.filter((n) => n.src === 'DART' && ['insider', 'inst'].includes(n.raw.category)).sort(byTime);
      $('#flowMeta').textContent = `${list.length}건`;
      box.innerHTML = list.length ? list.slice(0, 100).map((n, i) => { const d = n.raw.detail; const val = d && d.change !== null && d.change !== undefined ? `${signedInt(d.change)}주` : n.raw.category === 'inst' ? '5%' : '임원'; return fRow(i + 1, 'KR', n.ticker, n.name, esc(d ? `${d.who || ''}${d.role ? ' · ' + d.role : ''}` : n.raw.formKo), val, n.when?.official ? n.when.official.slice(5).replace('-', '.') : '', d?.change > 0 ? 'buy' : d?.change < 0 ? 'sell' : '', `data-id="${esc(n.id)}"`); }).join('') : `<div class="empty">${S.loaded.dart ? '최근 임원·5% 보고가 없습니다. (DART_API_KEY가 필요합니다)' : '불러오는 중…'}</div>`;
      return;
    }
    if (tab === 'krLoan') {
      const L = S.loan;
      if (!L || Date.now() - (S.loanAt || 0) > 600e3) { if (!S.loanBusy) { S.loanBusy = true; getJSON('/api/flows?loan=1', {}).then((j) => { S.loan = j; }).catch((e) => { S.loan = { error: e.message }; }).finally(() => { S.loanBusy = false; S.loanAt = Date.now(); if (S.view === 'flows' && S.flowTab === 'krLoan') renderFlows(); }); } if (!L) { box.innerHTML = '<div class="empty">불러오는 중…</div>'; return; } }
      if (L.error) { box.innerHTML = `<div class="empty">불러오지 못했습니다: ${esc(L.error)}</div>`; return; }
      if (!L.loan) { box.innerHTML = `<div class="empty">${L.needsKis ? '한국투자증권 Open API 키가 있어야 대차잔고를 받을 수 있습니다.' : '대차잔고를 모으는 중이에요. 처음엔 30분쯤 걸립니다 (아침 7시·저녁 6시에 새로 채움).'}</div>`; $('#flowMeta').textContent = ''; return; }
      const d = L.loan.date ? `${L.loan.date.slice(4, 6)}.${L.loan.date.slice(6, 8)}` : '';
      $('#flowMeta').textContent = d ? `${d} 기준` : '';
      const list = (S.loanSide || 'top') === 'up' ? L.loan.up : L.loan.top;
      const eok = (v) => (v == null ? '—' : v >= 1e12 ? `${(v / 1e12).toFixed(2)}조` : `${fmtInt(v / 1e8)}억`);
      box.innerHTML = list.length ? list.map((x, i) => fRow(i + 1, 'KR', x.t, x.name, `${x.price != null ? fmtInt(x.price) + '원 ' : ''}<span class="${dirCls(x.pct)}">${x.pct != null ? fmtPct(x.pct) : ''}</span> · 잔고 5일 <span class="${dirCls(x.d5)}">${x.d5p != null ? `${x.d5p > 0 ? '+' : ''}${x.d5p}%` : '—'}</span>`, (S.loanSide || 'top') === 'up' ? `${x.d5p > 0 ? '+' : ''}${x.d5p}%` : eok(x.amt), (S.loanSide || 'top') === 'up' ? `잔고 ${eok(x.amt)}` : `${fmtInt(x.bal)}주`, (S.loanSide || 'top') === 'up' ? 'sell' : '', `data-open-co="KR|${esc(x.t)}|${esc(x.name)}"`)).join('') : '<div class="empty">최근 5일 동안 대차잔고가 늘어난 종목이 없습니다.</div>';
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
  const PAGES = { issue: '#viewIssue', sched: '#viewSched', themes: '#viewThemes', econ: '#viewEcon', admin: '#viewAdmin', item: '#viewItem', earnings: '#viewEarnings', popular: '#viewPopular', company: '#viewCompany', tdir: '#viewTdir', flows: '#viewFlows', market: '#viewMarket', guide: '#viewGuide', halt: '#viewHalt', react: '#viewReact', cact: '#viewCact', ewk: '#viewEwk', guru: '#viewGuru', radar: '#viewRadar' };
  const VIEW_ALIAS = { cdiv: 'cact', crights: 'cact' }; // 같은 화면, 다른 탭
  // 메뉴별 고유 주소 (/popular, /themes …) ↔ 화면 이름
  const SEC_PATH = { guide: 'about', cact: 'splits', cdiv: 'dividends', crights: 'rights', popular: 'popular', themes: 'themes', tdir: 'sectors', sched: 'schedule', earnings: 'earnings', econ: 'econ', halt: 'halts', react: 'reaction', flows: 'flows', market: 'market', ewk: 'consensus', guru: 'gurus' };
  const PATH_SEC = Object.fromEntries(Object.entries(SEC_PATH).map(([v, p]) => [p, v]));
  function setView(v, hash) {
    S.view = v;
    if (v === 'guide') window.scrollTo({ top: 0 });
    const feed = v in FEED_VIEWS;
    $('#viewFeed').hidden = !feed;
    for (const [k, sel] of Object.entries(PAGES)) $(sel).hidden = k !== (VIEW_ALIAS[v] || v);
    $$('#nav button[data-go]').forEach((b) => b.classList.toggle('on', b.dataset.go === (VIEW_ALIAS[v] || v)));
    syncNavMore();
    //  화면을 옮길 때마다 방문 기록을 남김 (예전엔 같은 페이지 안에선 덮어써서, 모바일 앱에서 뒤로 가기를 누르면 앱이 꺼졌음)
    if (hash !== false) { const u = !hash && SEC_PATH[v] ? '/' + SEC_PATH[v] : '/' + (hash || '#' + v); if (location.pathname + location.hash !== u) history.pushState(null, '', u); }
    if (feed) { S.type = v === 'home' ? S.homeType || 'ALL' : FEED_VIEWS[v]; S.limit = 80; renderAll(); }
    if (v !== 'item') { S.sel = null; document.title = 'GK의 공시레이더 | 미국·한국 실시간 공시·보도자료'; }
    if (v === 'market') { renderMarket(); pollSpark(); }
    if (v === 'earnings') loadEarnings();
    if (v === 'themes') loadThemes();
    if (v === 'tdir') loadTdir();
    if (v === 'sched') loadSched();
    if (v === 'halt') loadHalts();
    if (v === 'react') loadReact();
    if (v === 'cact' || v === 'cdiv' || v === 'crights') { S.ca.tab = v === 'cdiv' ? 'div' : v === 'crights' ? 'rights' : 'split'; loadCact(); }
    if (v === 'econ') loadEcon(true);
    if (v === 'ewk') loadEwk();
    if (v === 'guru' && !(hash && /^gurus\//.test(hash))) loadGuru(null);
    if (v === 'admin') renderAdmin();
    if (v === 'radar') renderRadar();
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
    // 종목별 공개 페이지 (/s/KR/005930) → 그 종목 기업 분석 화면
    const sm = location.pathname.match(/^\/s\/(US|KR)\/([A-Za-z0-9.\-]+)\/?$/i);
    if (sm) { openCompany(sm[1].toUpperCase(), decodeURIComponent(sm[2]).toUpperCase()); return; }
    const id = itemIdFromUrl();
    if (id) {
      if (!ITEM_RE.test(location.pathname)) history.replaceState(null, '', '/p/' + id); // 예전 #item 주소 → 새 주소
      showItem(id);
      return;
    }
    { const gm = location.pathname.match(/^\/gurus\/([a-z]{2,12})\/?$/); if (gm) { setView('guru', false); loadGuru(gm[1]); return; } }
    { const sv = PATH_SEC[location.pathname.replace(/^\/|\/$/g, '')]; if (sv && !location.hash) { setView(sv, false); return; } }
    const h = decodeURIComponent(location.hash.slice(1));
    const m = h.match(/^company\/(US|KR)\/([A-Z0-9.\-]+)/i);
    if (m) { openCompany(m[1].toUpperCase(), m[2]); return; }
    if (/^item\//.test(h)) { showItem(h.slice(5)); return; }
    { const rm = h.match(/^radar(?:\/(\d{6}))?$/); if (rm) { S.radarCode = rm[1] || null; setView('radar', false); return; } }
    if (h === 'company') { S.coCur = null; $('#coBody').innerHTML = CO_EMPTY; } // 종목 화면에서 뒤로 → 기업 분석 첫 화면
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
  // ── 최근 검색 기록 (이 기기에만 저장, 최대 12개) ──
  S.shist = load('gk_shist', []);
  const histKey = (h) => (h.k === 'co' ? `co:${h.m}:${h.t}` : `kw:${h.q}`);
  function addHist(h) { S.shist = [h, ...S.shist.filter((x) => histKey(x) !== histKey(h))].slice(0, 12); save('gk_shist', S.shist); }
  function delHist(i) { S.shist.splice(i, 1); save('gk_shist', S.shist); }
  function histHTML(feed) {
    const list = S.shist.map((h, i) => ({ h, i })).filter(({ h }) => feed || h.k === 'co');
    if (!list.length) return '';
    return `<div class="sg-h sg-hh"><span>최근 검색</span><button class="sg-clear" data-hclear>전체 삭제</button></div>` + list.map(({ h, i }) => `<div class="sg-row">${h.k === 'co'
      ? `<button data-open-co="${esc(h.m)}|${esc(h.t)}|${esc(h.n || '')}"><svg class="sg-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${logoHTML(h.m, h.t, h.n, 'sm')}<span>${esc(h.m === 'KR' ? h.n || h.t : h.n || h.t)}</span><small>${h.m === 'KR' ? '한국' : '미국'} · ${esc(h.t)}</small></button>`
      : `<button data-kw="${esc(h.q)}"><svg class="sg-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>${esc(h.q)}</span><small>키워드</small></button>`}<i class="sg-x" data-hdel="${i}" title="기록 삭제" role="button" aria-label="기록 삭제">✕</i></div>`).join('');
  }
  function bindSearch(input, box, { feed }) {
    if (!S.koName) S.koName = new Map();
    let timer, seq = 0, act = -1;
    const showHist = () => { if (input.value.trim()) return; const h = histHTML(feed); box.innerHTML = h; box.hidden = !h; act = -1; };
    input.addEventListener('focus', showHist);
    input.addEventListener('click', showHist);
    box.addEventListener('click', (e) => {
      const d = e.target.closest('[data-hdel]');
      if (d) { e.stopPropagation(); e.preventDefault(); delHist(Number(d.dataset.hdel)); showHist(); input.focus(); return; }
      if (e.target.closest('[data-hclear]')) { e.stopPropagation(); e.preventDefault(); S.shist = []; save('gk_shist', []); box.hidden = true; input.focus(); }
    });
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
      if (!q) { showHist(); if (feed && S.q) { S.q = ''; renderAll(); } return; }
      const local = localCompanies(q).map((x) => { const n = x.market === 'US' ? (S.koName.get(x.ticker) || S.quotes.get(wkey('US', x.ticker))?.nameKo) : null; return n && hasKo(n) ? { ...x, name: n } : x; });
      render(q, local, true);
      const my = ++seq;
      timer = setTimeout(async () => {
        let remote = [];
        try { remote = (await getJSON(`/api/search?v=2&q=${encodeURIComponent(q)}`, {})).items || []; } catch {}
        if (my !== seq) return;
        // 서버가 준 한글 이름으로 바꿔서 보여줌 (미국 종목)
        for (const x of remote) if (x.market === 'US' && hasKo(x.name)) S.koName.set(x.ticker, x.name);
        const loc = local.map((x) => (x.market === 'US' && S.koName.has(x.ticker) ? { ...x, name: S.koName.get(x.ticker) } : x));
        const seen = new Set(loc.map((x) => wkey(x.market, x.ticker)));
        render(q, [...loc, ...remote.filter((x) => !seen.has(wkey(x.market, x.ticker)))].slice(0, 12), false);
        // 목록에 먼저 뜬 종목 중 한글 이름을 아직 모르는 건 한 번 더 받아서 바꿈
        const miss = loc.filter((x) => x.market === 'US' && !hasKo(x.name)).map((x) => wkey('US', x.ticker));
        if (miss.length) fetchQuotes(miss).then(() => { if (my !== seq) return; let ch = false; const l2 = loc.map((x) => { const n = x.market === 'US' ? S.quotes.get(wkey('US', x.ticker))?.nameKo : null; if (n && hasKo(n)) { S.koName.set(x.ticker, n); ch = true; return { ...x, name: n }; } return x; }); if (ch) render(q, [...l2, ...remote.filter((x) => !seen.has(wkey(x.market, x.ticker)))].slice(0, 12), false); });
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
    if (q && !/^[A-Z.]{1,6}$/.test(q)) addHist({ k: 'kw', q: q.slice(0, 40) });
    for (const id of ['#search', '#search2']) { const el = $(id); if (el) { el.value = q; el.blur(); } }
    if (!(S.view in FEED_VIEWS) || S.view === 'watch') setView('home'); else renderAll();
    $('#search').blur();
  }

  // ───────────────────────── 푸시 알림 (사이트·앱을 닫아도 관심종목 새 공시 알림) ─────────────────────────
  const pushOK = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function pushRows() {
    const hint = !pushOK() ? (isIOS() && !isStandalone() ? ' · 아이폰은 공유 버튼 → "홈 화면에 추가"로 앱을 설치한 뒤 켤 수 있어요' : ' · 이 브라우저는 지원하지 않아요') : '';
    return `<div class="set-row"><div>푸시 알림<small>사이트·앱을 닫아 둬도 관심종목 새 공시가 나오면 휴대폰·PC로 알려줘요${hint}</small></div><input type="checkbox" class="tg" data-set="push" ${S.push ? 'checked' : ''}></div>
      <div class="set-row"><div>중요 공시 푸시<small>관심종목이 아니어도 AI가 '매우 중요'로 본 공시 (하루 최대 8건)</small></div><input type="checkbox" class="tg" data-set="pushBig" ${S.pushBig ? 'checked' : ''}></div>
      <div class="set-row"><div>가격·키워드 알림<small>목표가 도달 · 관심 단어가 들어간 공시를 푸시로 (가격 ${S.alerts.length}개 · 키워드 ${S.kw.length}개)</small></div><button class="btn sm" data-alerts>관리</button></div>`;
  }
  const b64key = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  async function pushSub(create) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) { const j = await getJSON('/api/push', {}); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(j.key) }); }
    return sub;
  }
  // 관심종목이 바뀌거나 하루가 지나면 서버에 다시 알려 줌
  async function syncPush(force) {
    if (!S.push || !pushOK() || Notification.permission !== 'granted') return false;
    try {
      const sub = await pushSub(true); if (!sub) return false;
      const j = sub.toJSON(), w = S.watch.map((x) => wkey(x.m, x.t));
      const al = S.alerts.map((a) => ({ id: a.id, k: a.k, ty: a.ty, v: a.v, nm: a.nm }));
      const sig = `${j.endpoint}|${w.join(',')}|${S.pushBig ? 1 : 0}|${JSON.stringify(al)}|${S.kw.join(',')}|${S.kww ? 1 : 0}`;
      if (!force && load('gk_pushSig', '') === sig && Date.now() - load('gk_pushAt', 0) < 86400e3) return true;
      const r = await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ep: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, w, big: !!S.pushBig, al, kw: S.kw, kww: !!S.kww }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      save('gk_pushSig', sig); save('gk_pushAt', Date.now());
      return true;
    } catch (e) { console.warn('push', e); return false; }
  }
  async function pushOff() {
    try { const sub = pushOK() ? await pushSub(false) : null; if (sub) { await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unsub: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe().catch(() => {}); } } catch {}
    save('gk_pushSig', '');
  }

  // ───────────────────────── 가격·키워드 알림 (푸시) ─────────────────────────
  //  가격 알림: 목표가 이상·이하, 오늘 ±% 이상 → 한 번 울리면 끝(다시 켜기 가능) / 키워드: 공시 제목에 그 단어가 나오면
  S.alerts = load('gk_alerts', []); S.kw = load('gk_kw', []); S.kww = load('gk_kww', false); S.alFired = load('gk_alfired', {});
  const alMoney = (k, v) => (k.startsWith('KR:') ? `${fmtInt(v)}원` : `$${fmtPx(v)}`);
  const alText = (a) => (a.ty === 'ge' ? `${alMoney(a.k, a.v)} 이상` : a.ty === 'le' ? `${alMoney(a.k, a.v)} 이하` : a.ty === 'up' ? `오늘 +${a.v}% 이상 상승` : `오늘 -${a.v}% 이상 하락`);
  function saveAlerts() { save('gk_alerts', S.alerts); save('gk_kw', S.kw); save('gk_kww', S.kww); if (S.push) syncPush(true); }
  async function ensurePush() {
    if (S.push && pushOK() && Notification.permission === 'granted') return true;
    await setSetting('push', true);
    return !!S.push;
  }
  async function refreshAlFired() {
    if (!S.push || !pushOK() || !S.alerts.length) return;
    try {
      const sub = await pushSub(false); if (!sub) return;
      const j = await (await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: sub.endpoint }) })).json();
      S.alFired = Object.fromEntries((j.fired || []).map((x) => [x.aid, x.at || Date.now()]));
      save('gk_alfired', S.alFired);
    } catch {}
  }
  function openAlertNew(m, t, n) {
    const q = quoteOf(m, t), px = q ? q.live ?? q.price : null;
    const name = m === 'KR' ? n || t : `${t}${n && n !== t ? ' ' + n : ''}`;
    S.alNew = { m, t, n: n || t, px, ty: 'ge' };
    openModal(`<h2>🎯 가격 알림</h2>
      <div class="al-head">${logoHTML(m, t, n, 'sm')}<b>${esc(name)}</b><span class="muted">현재가 ${px != null ? esc(alMoney(wkey(m, t), px)) : '—'}${q?.pct != null ? ` <span class="${dirCls(q.livePct ?? q.pct)}">${fmtPct(q.livePct ?? q.pct)}</span>` : ''}</span></div>
      <div class="seg al-ty" id="alTy">${[['ge', '가격 이상'], ['le', '가격 이하'], ['up', '오늘 % 상승'], ['dn', '오늘 % 하락']].map(([v, l]) => `<button data-alty="${v}" class="${v === 'ge' ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="al-in"><input id="alVal" type="number" inputmode="decimal" step="any" min="0" value="${px != null ? (m === 'KR' ? Math.round(px * 1.05) : (Math.round(px * 105) / 100)) : ''}"><span id="alUnit">${m === 'KR' ? '원 이상이 되면' : '달러 이상이 되면'}</span></div>
      <p class="note" id="alHint">조건이 맞으면 휴대폰·PC로 푸시가 한 번 와요. (장 시간 중 1분마다 확인)</p>
      <div class="al-btns"><button class="btn primary" data-al-add>알림 추가</button><button class="btn" data-alerts>내 알림 목록 (${S.alerts.length})</button></div>`);
    if (!q) fetchQuotes([wkey(m, t)]).then(() => { if (S.alNew?.t === t && !$('#modal').hidden && $('#alVal') && !$('#alVal').value) { const q2 = quoteOf(m, t); if (q2) $('#alVal').value = m === 'KR' ? Math.round(q2.price * 1.05) : Math.round(q2.price * 105) / 100; } });
  }
  function setAlTy(ty) {
    const a = S.alNew; if (!a) return;
    a.ty = ty;
    $$('#alTy button').forEach((b) => b.classList.toggle('on', b.dataset.alty === ty));
    const price = ty === 'ge' || ty === 'le';
    $('#alUnit').textContent = price ? `${a.m === 'KR' ? '원' : '달러'} ${ty === 'ge' ? '이상이 되면' : '이하가 되면'}` : `% 이상 ${ty === 'up' ? '오르면' : '내리면'} (전일 종가 대비)`;
    if (a.px != null) $('#alVal').value = ty === 'ge' ? (a.m === 'KR' ? Math.round(a.px * 1.05) : Math.round(a.px * 105) / 100) : ty === 'le' ? (a.m === 'KR' ? Math.round(a.px * 0.95) : Math.round(a.px * 95) / 100) : 5;
    else if (!price) $('#alVal').value = 5;
  }
  async function addAlert() {
    const a = S.alNew; if (!a) return;
    const v = Number($('#alVal').value);
    if (!(v > 0)) { toast('숫자를 입력해 주세요'); return; }
    if ((a.ty === 'up' || a.ty === 'dn') && v > 60) { toast('등락률은 60% 이하로 입력해 주세요'); return; }
    if (S.alerts.length >= 30) { toast('가격 알림은 30개까지 만들 수 있어요'); return; }
    if (!(await ensurePush())) return;
    const al = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), k: wkey(a.m, a.t), ty: a.ty, v, nm: a.m === 'KR' ? a.n : a.t, n: a.n, at: Date.now() };
    S.alerts.unshift(al); saveAlerts();
    const now = a.px;
    const already = now != null && ((a.ty === 'ge' && now >= v) || (a.ty === 'le' && now <= v));
    toast(already ? '추가했어요 · 이미 조건을 넘은 가격이라 곧 알림이 올 수 있어요' : `🎯 ${a.m === 'KR' ? a.n : a.t} ${alText(al)} 알림 추가`, 3200);
    openAlerts();
  }
  function openAlerts() {
    const rows = S.alerts.map((a) => {
      const [m, t] = a.k.split(':'), fired = S.alFired[a.id];
      return `<li class="al-row ${fired ? 'done' : ''}">${logoHTML(m, t, a.n, 'xs')}<button class="link" data-open-co="${esc(m)}|${esc(t)}|${esc(a.n || '')}">${esc(m === 'KR' ? a.n || t : t)}</button><span class="al-c">${esc(alText(a))}</span><span class="al-st">${fired ? `✓ 울림 ${esc(fmtDT(new Date(fired)).md || '')}` : '대기 중'}</span>${fired ? `<button class="btn sm" data-al-re="${esc(a.id)}">다시 켜기</button>` : ''}<button class="al-x" data-al-del="${esc(a.id)}" title="삭제">✕</button></li>`;
    }).join('');
    openModal(`<h2>가격·키워드 알림</h2>
      <h3 class="al-h">🎯 가격 알림 <small>${S.alerts.length}/30 · 종목 화면의 '가격 알림' 버튼으로 추가</small></h3>
      ${rows ? `<ul class="al-list">${rows}</ul>` : '<p class="muted">아직 없어요. 종목 화면(기업 분석)에서 <b>🎯 가격 알림</b>을 눌러 추가하세요.</p>'}
      <h3 class="al-h">🔔 키워드 알림 <small>공시·보도자료 제목에 이 단어가 나오면 푸시 (최대 10개)</small></h3>
      <div class="al-kw">${S.kw.map((k, i) => `<span class="wchip">${esc(k)}<button data-kw-del="${i}">✕</button></span>`).join('') || '<span class="muted">예) 자사주, 수주, 무상증자, FDA, buyback</span>'}</div>
      <div class="al-in"><input id="kwVal" type="text" maxlength="20" placeholder="단어 입력 (2글자 이상)"><button class="btn primary" data-kw-add>추가</button></div>
      <label class="al-chk"><input type="checkbox" id="kwW" ${S.kww ? 'checked' : ''}> 관심종목 공시만 (끄면 모든 종목)</label>
      <p class="note">키워드 알림은 기기당 하루 최대 15건까지 와요. 설정은 이 기기에만 저장되고, 알림을 보내기 위해 서버에도 함께 저장됩니다.${!S.push ? '<br><b>푸시 알림이 꺼져 있어요.</b> 알림을 추가하면 자동으로 켜집니다.' : ''}</p>`);
    refreshAlFired().then(() => { if (!$('#modal').hidden && $('.al-list')) { const changed = S.alerts.some((a) => !!S.alFired[a.id] !== !!$(`[data-al-del="${a.id}"]`)?.closest('.al-row')?.classList.contains('done')); if (changed) openAlerts(); } });
  }
  async function addKw() {
    const v = ($('#kwVal')?.value || '').replace(/\s+/g, ' ').trim();
    if (v.length < 2) { toast('2글자 이상 입력해 주세요'); return; }
    if (S.kw.length >= 10) { toast('키워드는 10개까지예요'); return; }
    if (S.kw.some((k) => k.toLowerCase() === v.toLowerCase())) { toast('이미 있는 키워드예요'); return; }
    if (!(await ensurePush())) return;
    S.kw.push(v); saveAlerts(); toast(`🔔 '${v}' 키워드 알림 추가`); openAlerts();
  }
  document.addEventListener('click', (e) => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-alert-new]'))) { const [m, tk, n] = b.dataset.alertNew.split('|'); openAlertNew(m, tk, n); return; }
    if ((b = t.closest('[data-alty]'))) { setAlTy(b.dataset.alty); return; }
    if (t.closest('[data-al-add]')) { addAlert(); return; }
    if (t.closest('[data-alerts]')) { openAlerts(); return; }
    if ((b = t.closest('[data-al-del]'))) { S.alerts = S.alerts.filter((a) => a.id !== b.dataset.alDel); saveAlerts(); openAlerts(); return; }
    if ((b = t.closest('[data-al-re]'))) { const a = S.alerts.find((x) => x.id === b.dataset.alRe); if (a) { delete S.alFired[a.id]; a.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); save('gk_alfired', S.alFired); saveAlerts(); toast('다시 켰어요'); openAlerts(); } return; }
    if (t.closest('[data-kw-add]')) { addKw(); return; }
    if ((b = t.closest('[data-kw-del]'))) { S.kw.splice(Number(b.dataset.kwDel), 1); saveAlerts(); openAlerts(); return; }
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'kwW') { S.kww = e.target.checked; saveAlerts(); toast(S.kww ? '관심종목 공시만 키워드 알림' : '모든 종목 키워드 알림'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'kwVal') { e.preventDefault(); addKw(); } if (e.key === 'Enter' && e.target.id === 'alVal') { e.preventDefault(); addAlert(); } });

  // ───────────────────────── 관심종목·설정 ─────────────────────────
  function toggleWatch(m, t, n) {
    const k = wkey(m, t);
    if (S.watch.some((w) => wkey(w.m, w.t) === k)) { S.watch = S.watch.filter((w) => wkey(w.m, w.t) !== k); toast(`${m === 'KR' ? n || t : t} 관심종목 해제`); }
    else { S.watch.push({ m, t: t.toUpperCase(), n }); toast(`${m === 'KR' ? n || t : t} 관심종목 추가 ★ · 새 공시가 나오면 알림음과 알림이 뜹니다`); askNotifyPermission(); try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } catch {} }
    save('gk_watch2', S.watch);
    if (S.push) syncPush(true);
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
    if ((key === 'push' || key === 'pushBig') && on && !S.push) {
      if (!pushOK()) { toast(isIOS() && !isStandalone() ? '아이폰은 공유 버튼 → "홈 화면에 추가"로 앱을 설치한 뒤 켤 수 있어요' : '이 브라우저는 푸시 알림을 지원하지 않습니다', 4000); if (el) el.checked = false; return; }
      if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') { toast('알림 권한을 허용해야 받을 수 있어요 (브라우저 설정에서 허용)', 3500); if (el) el.checked = false; return; }
      S.push = true; save('gk_push', true); $$('[data-set="push"]').forEach((x) => (x.checked = true));
    }
    if (key === 'push' && !on) { S.pushBig = false; save('gk_pushBig', false); $$('[data-set="pushBig"]').forEach((x) => (x.checked = false)); await pushOff(); }
    if (key === 'push' || key === 'pushBig') {
      S[key] = on; save('gk_' + key, on); $$(`[data-set="${key}"]`).forEach((x) => (x.checked = on));
      if (S.push) { const ok = await syncPush(true); toast(ok ? (key === 'pushBig' ? (on ? '중요 공시 푸시 켜짐' : '중요 공시 푸시 꺼짐') : `푸시 알림 켜짐 · 관심종목 ${S.watch.length}개`) : '푸시 알림 연결에 실패했어요. 잠시 후 다시 시도해 주세요', 3000); }
      else toast('푸시 알림 꺼짐');
      return;
    }
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
    let vid = '';
    try { vid = localStorage.getItem('gk_vid') || ''; if (!vid) { vid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('gk_vid', vid); } } catch {}
    sendTrack({ t: 'pv', ref, m: isMobile(), vid }); // vid: 이 기기를 구분하는 임의 번호 (개인정보 아님 · 서버엔 해시로만 저장)
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
    const tab = S.admTab === 'daily' ? 'daily' : 'stats'; // 작전 레이더는 더보기 메뉴의 별도 페이지로 옮김
    if (tab === 'daily') {
      box.innerHTML = `${admHead()}<div class="card adm-vn"><h3>📝 당일 분석 <small class="muted">장 마감 뒤 자동 정리 (국장 16:45 · 미장 뉴욕 16:40 = 한국 새벽~아침) · 날짜별로 계속 보관</small></h3><div id="vnBody"><div class="loading"><span class="spin"></span>불러오는 중…</div></div>
        <div class="chips" style="margin-top:.6rem"><button class="btn sm" data-admin-act="vnKR">국장 분석 지금 만들기</button><button class="btn sm" data-admin-act="vnUS">미장 분석 지금 만들기</button><button class="btn sm" data-admin-act="wkMake">주간 정리 카드 미리 만들기</button><button class="btn sm" data-admin-act="wkSend">주간 카드 채널로 보내기</button></div>
        <p class="note" id="vnMsg">주간 정리 카드는 매주 토요일 아침 8:30 이후 텔레그램 채널에 자동 게시돼요.</p><div id="wkPrev"></div></div>`;
      loadVnote();
      return;
    }
    box.innerHTML = `${admHead()}<div class="card"><div class="loading"><span class="spin"></span>불러오는 중…</div></div>`;
    let d;
    try { d = await getJSON(`/api/admin?key=${encodeURIComponent(S.admin)}`, { cache: 'no-store' }); }
    catch (e) { box.innerHTML = `<div class="page-head"><h2>관리자</h2></div><div class="card"><p class="err">${esc(e.message)}</p><button class="btn sm" data-admin-logout>다시 로그인</button></div>`; return; }
    setTimeout(() => loadAnom(), 0);
    const maxPv = Math.max(1, ...d.days.map((x) => x.pv));
    const maxHr = Math.max(1, ...d.hours);
    const devT = (d.dev.m || 0) + (d.dev.d || 0) || 1;
    const mon = d.monitor?.checks ? Object.values(d.monitor.checks) : [];
    box.innerHTML = `${admHead()}
      <div class="adm-kpis">
        ${[['오늘', d.today], ['최근 7일', d.week], ['최근 30일', d.month]].map(([l, x]) => `<div class="card"><span>${l}</span><div><b>${fmtInt(x?.uv || 0)}</b><small>방문자</small></div><div><b>${fmtInt(x?.pv || 0)}</b><small>페이지뷰</small></div><div><b>${fmtInt(x?.iv || 0)}</b><small>게시물 조회</small></div></div>`).join('')}
      </div>
      <div class="adm-kpis adm-cum">
        <div class="card"><span>누적<small>${d.all?.since ? esc(d.all.since) + '부터' : ''}</small></span><div><b>${fmtInt(d.all?.uv || 0)}</b><small>방문자 (일별 합계)</small></div><div><b>${fmtInt(d.all?.pv || 0)}</b><small>페이지뷰</small></div><div><b>${fmtInt(d.all?.iv || 0)}</b><small>게시물 조회</small></div></div>
      </div>
      ${(() => { // 순수 방문자 · 같은 기기 반복 방문
        const v = d.devices; if (!v) return '';
        const t = d.today || {}, dist = Object.entries(v.dist || {}), dmax = Math.max(1, ...dist.map(([, n]) => n));
        const avg = v.n ? (v.visits / v.n).toFixed(1) : '0';
        return `<div class="card adm-uniq" style="margin-bottom:.8rem"><h3>순수 방문자 · 재방문 <small class="muted">${v.since ? esc(v.since) + '부터 기기 기준 집계' : '이번 업데이트부터 집계 시작'}</small></h3>
          <div class="adm-kpis" style="grid-template-columns:repeat(4,1fr);margin:0 0 .8rem">${[['누적 순수 방문자', v.n, '대 (중복 없는 기기 수)'], ['같은 기기 총 방문', v.visits, '회 (30분 넘게 쉬었다 오면 1회)'], ['기기당 평균 방문', avg, '회'], ['오늘 신규 / 재방문', `${fmtInt(t.nd || 0)} / ${fmtInt(t.rd || 0)}`, '대 (처음 온 기기 / 예전에 온 기기)']].map(([l, n, u]) => `<div class="card" style="display:block"><span>${l}</span><div><b>${typeof n === 'number' ? fmtInt(n) : n}</b><small>${u}</small></div></div>`).join('')}</div>
          <div class="adm-grid" style="margin:0"><div><h3>방문 횟수별 기기 수</h3><div class="adm-dist">${dist.map(([l, n]) => `<div><span>${l}</span><i style="width:${Math.round((n / dmax) * 100)}%"></i><b>${fmtInt(n)}</b></div>`).join('')}</div></div>
          <div><h3>가장 자주 온 기기 TOP 15</h3><table class="adm-tb"><tr><th>#</th><th>방문</th><th>방문일</th><th>페이지뷰</th><th>처음</th><th>마지막</th></tr>${(v.top || []).map((x, i) => `<tr><td>${i + 1} ${x.m ? '📱' : '💻'}</td><td><b>${fmtInt(x.visits)}회</b></td><td>${fmtInt(x.days)}일</td><td>${fmtInt(x.pv)}</td><td>${esc(String(x.first || '').slice(5))}</td><td>${esc(String(x.last || '').slice(5))}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">아직 기록이 없습니다.</td></tr>'}</table></div></div>
          <p class="note">기기 = 같은 브라우저. 같은 사람이 휴대폰·컴퓨터로 오면 2대로, 방문 기록을 지우면 새 기기로 셉니다. 관리자 본인 방문은 제외.</p></div>`;
      })()}
      <div class="adm-grid">
        <div class="card"><h3>일별 방문 (최근 30일)</h3><div class="adm-bars">${d.days.map((x) => `<div title="${x.d} · 방문자 ${x.uv} · 페이지뷰 ${x.pv}"><i style="height:${Math.round((x.pv / maxPv) * 100)}%"></i><i class="uv" style="height:${Math.round((x.uv / maxPv) * 100)}%"></i><span>${x.d.slice(8)}</span></div>`).join('')}</div><p class="note">■ 페이지뷰 ■ 방문자 · 막대에 마우스를 올리면 숫자가 보입니다</p></div>
        <div class="card"><h3>오늘 시간대별 (KST)</h3><div class="adm-bars hrs">${d.hours.map((v, i) => `<div title="${i}시 · ${v}회"><i style="height:${Math.round((v / maxHr) * 100)}%"></i><span>${i % 3 ? '' : i}</span></div>`).join('')}</div>
          <h3 style="margin-top:1rem">기기 (최근 7일)</h3><div class="adm-dev"><span style="width:${Math.round(((d.dev.m || 0) / devT) * 100)}%">휴대폰 ${Math.round(((d.dev.m || 0) / devT) * 100)}%</span><span>컴퓨터 ${Math.round(((d.dev.d || 0) / devT) * 100)}%</span></div></div>
      </div>
      <div class="adm-grid">
        <div class="card"><h3>많이 본 게시물 (최근 7일)</h3><ol class="adm-list">${d.topItems.map((x) => `<li data-id="${esc(x.id)}" data-adm-open="${esc(x.id)}"><b>${fmtInt(x.n)}</b><span>${x.ticker ? `<em>${esc(x.market === 'KR' ? x.name || x.ticker : x.ticker)}</em>` : ''}${esc(x.title)}</span></li>`).join('') || '<li class="muted">아직 기록이 없습니다.</li>'}</ol></div>
        <div class="card"><h3>유입 경로 (최근 7일)</h3><ol class="adm-list">${d.refs.map((x) => `<li><b>${fmtInt(x.n)}</b><span>${esc(x.r)}</span></li>`).join('') || '<li class="muted">아직 기록이 없습니다.</li>'}</ol></div>
      </div>
      <div class="card" style="margin-bottom:.8rem">
        <h3>알림 현황</h3><ol class="adm-list">
          <li><b>${fmtInt(d.push?.subs || 0)}</b><span>푸시 알림 구독 기기 (중요 공시 푸시 ${fmtInt(d.push?.big || 0)}대)${d.push?.last ? ` · 마지막 발송 ${esc(fmtDT(new Date(d.push.last.at)).full)} ${d.push.last.n}건` : ''}${d.push?.fail && (!d.push.last || d.push.fail.at > d.push.last.at) ? ` · <b class="err">최근 실패 ${d.push.fail.n}건</b>` : ''}</span></li>
          <li><b>${fmtInt(d.push?.al || 0)}</b><span>가격 알림 (울린 것 ${fmtInt(d.push?.alFired || 0)}개) · 키워드 알림 쓰는 기기 ${fmtInt(d.push?.kw || 0)}대${d.push?.alLast ? ` · 마지막 울림 ${esc(fmtDT(new Date(d.push.alLast.at)).full)} ${d.push.alLast.sent}건` : ''}</span></li>
          <li><b>${d.loan?.done ? '✓' : '—'}</b><span>국내 대차잔고 ${d.loan?.done ? esc(d.loan.done) + ' 회차 채움' : '아직 채우는 중'}${d.loan?.err ? ` · <span class="err">${esc(d.loan.err)}</span>` : ''} · 투자 대가 13F 티커 변환 대기 ${fmtInt(d.guru?.pend || 0)}개${d.guru?.err && Object.keys(d.guru.err).length ? ` · <span class="err">오류 ${esc(Object.entries(d.guru.err).map(([k, v]) => k + ': ' + v).join(' / ').slice(0, 160))}</span>` : ''}</span></li>
          <li><b>${d.close?.KR ? '✓' : '—'}</b><span>오늘 국장 마감 이미지 ${d.close?.KR ? `보냄 (${esc(fmtDT(new Date(d.close.KR.at)).hm)}) · <a href="${esc(d.close.KR.img)}" target="_blank">이미지 보기</a>` : '아직 안 보냄 (평일 16시 이후 자동)'}</span></li>
          <li><b>${d.close?.US ? '✓' : '—'}</b><span>오늘 미장 마감 이미지 ${d.close?.US ? `보냄 (${esc(fmtDT(new Date(d.close.US.at)).hm)}) · <a href="${esc(d.close.US.img)}" target="_blank">이미지 보기</a>` : '아직 안 보냄 (뉴욕 16시 이후 자동)'}</span></li>
          ${(d.earn || []).map((v) => `<li><b>${esc(v.v)}</b><span>📊 ${esc(v.n)} (${esc(v.t)}) — ${esc(v.line)}</span></li>`).join('') || '<li class="muted">최근 3일 실적 판정 없음</li>'}
        </ol></div>
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
      <div class="card" id="anomCard"><h3>🧪 자동 이상치 점검 <small class="muted">값이 말이 되는지 사이트 전체(작전 레이더 포함)를 3시간마다 훑어봐요 · 새 문제는 관리자 텔레그램</small></h3><div id="anomBody"><div class="loading"><span class="spin"></span>불러오는 중…</div></div><div class="chips" style="margin-top:.6rem"><button class="btn sm" data-anom-run>지금 점검</button></div></div>
      <div class="card"><h3>고장 자동 감시 <small class="muted">${d.monitor?.at ? fmtDT(new Date(d.monitor.at)).full + ' 점검 · 약 9분마다 자동 점검' : '아직 점검 기록 없음'}</small></h3>
        <table class="tbl adm-mon"><tr><th>항목</th><th>상태</th><th>내용</th></tr>${mon.map((c) => `<tr><td>${esc(c.name)}</td><td><span class="mon ${c.ok ? 'ok' : c.fails >= 2 ? 'bad' : 'warn'}">${c.ok ? '정상' : c.fails >= 2 ? '이상' : '확인 중'}</span></td><td>${esc(c.msg)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">점검 기록이 없습니다. 아래 "지금 점검"을 눌러보세요.</td></tr>'}</table>
        <div class="chips" style="margin-top:.8rem"><button class="btn sm" data-admin-act="monitor">지금 점검</button><button class="btn sm" data-admin-act="issKR">주요 이슈 다시 만들기 (국장)</button><button class="btn sm" data-admin-act="issUS">주요 이슈 다시 만들기 (미장)</button><button class="btn sm" data-admin-act="tgfind">텔레그램 채팅 ID 찾기</button><button class="btn sm" data-admin-act="tgtest">텔레그램 테스트 알림</button></div>
        <p class="note">텔레그램 알림: ${d.telegram?.token ? '봇 토큰 등록됨' : '봇 토큰(TELEGRAM_BOT_TOKEN) 미등록'} · ${d.telegram?.chat ? '채팅 ID 등록됨' : '채팅 ID(TELEGRAM_CHAT_ID) 미등록'}. 둘 다 등록하면 이상이 생길 때 텔레그램으로 알려줍니다.</p><p class="note" id="admMsg"></p></div>
      ${(() => { // 텔레그램 채널 자동 게시
        const c = d.channel || {}, g = c.cfg || {};
        if (!c.id) return `<div class="card" style="margin-top:.8rem"><h3>텔레그램 채널 자동 게시 <small class="muted">미설정</small></h3><ol class="note" style="line-height:1.8;padding-left:1.1rem;margin:.4rem 0 0">
          <li>텔레그램에서 <b>채널</b>을 만들고(공개 채널이면 @주소 지정), 알림용 봇을 <b>채널 관리자</b>로 추가하세요. (봇은 고장 알림에 쓰는 봇과 같은 것이어도 돼요)</li>
          <li>Cloudflare 변수에 <code>TELEGRAM_CHANNEL_ID</code>를 등록하세요. 값: <code>@채널주소</code> (비공개 채널이면 -100으로 시작하는 숫자)</li>
          <li>저장 후 이 화면을 새로고침하면 설정 버튼이 나와요.</li></ol></div>`;
        return `<div class="card" style="margin-top:.8rem"><h3>텔레그램 채널 자동 게시 <small class="muted">${esc(c.id)} · 오늘 ${c.today || 0}건 게시</small></h3>
          <p class="note" style="margin:.2rem 0 .6rem">① 중요 공시·보도자료가 나오면 AI 요약(호재·악재, 핵심 2줄)과 링크를 바로 올려요. ② <b>오늘 주요 이슈</b>는 사이트에 새 회차가 만들어질 때마다(국장 8~16시, 개장 직후 30분 간격 · 미장 뉴욕 8~17시) 올려요. ③ <b>AI 핵심 공시</b>는 하루 3번(국장 8:40·12:10·15:45 / 미장 뉴욕 8:50·12:30·16:15) 올려요. ④ <b>공시 후 급등</b>: 공시·보도자료 발표 후 6시간 안에 발표 시점 주가 대비 국장 +10%, 미장 +15% 넘게 오르면 중요도와 상관없이 올려요(같은 종목 하루 1번, 하루 최대 40건). ⑤ <b>장 마감 정리 이미지</b>: 국장(16시 이후)·미장(뉴욕 16시 이후) 마감 뒤 지수·핵심 이슈·급등락·테마를 한 장 이미지로 올려요(휴장일 제외). 시간당 최대 건수는 ①에만 적용돼요.</p>
          <div class="chips" style="align-items:center;gap:.4rem">
            <button class="btn sm ${g.on ? 'primary' : ''}" data-admin-act="${g.on ? 'choff' : 'chon'}">${g.on ? '● 게시 중 (끄기)' : '○ 꺼짐 (켜기)'}</button>
            <label class="muted sm">기준 <select id="chImp"><option value="5"${g.minImp === 5 ? ' selected' : ''}>최중요만</option><option value="4"${g.minImp === 4 ? ' selected' : ''}>중요 이상</option><option value="3"${g.minImp === 3 ? ' selected' : ''}>보통 이상 (많음)</option></select></label>
            <label class="muted sm">시간당 최대 <select id="chPer">${[4, 8, 12, 20, 30, 60, 120].map((v) => `<option value="${v}"${g.perHour === v ? ' selected' : ''}>${v}건</option>`).join('')}</select></label>
            <label class="muted sm"><input type="checkbox" id="chKr"${g.kr ? ' checked' : ''}> 국장</label><label class="muted sm"><input type="checkbox" id="chUs"${g.us ? ' checked' : ''}> 미장</label>
            <label class="muted sm"><input type="checkbox" id="chIss"${g.issues !== false ? ' checked' : ''}> 오늘 주요 이슈</label><label class="muted sm"><input type="checkbox" id="chDg"${g.digest !== false ? ' checked' : ''}> AI 핵심 공시</label><label class="muted sm"><input type="checkbox" id="chSg"${g.surge !== false ? ' checked' : ''}> 공시 후 급등</label><label class="muted sm"><input type="checkbox" id="chCl"${g.close !== false ? ' checked' : ''}> 장 마감 정리 이미지</label><label class="muted sm"><input type="checkbox" id="chWk"${g.weekly !== false ? ' checked' : ''}> 토요일 주간 정리 카드</label>
            <button class="btn sm" data-admin-act="chset">설정 저장</button><button class="btn sm" data-admin-act="chtest">테스트 발송</button><button class="btn sm" data-admin-act="chcloseKR">국장 마감 이미지 지금 보내기</button><button class="btn sm" data-admin-act="chcloseUS">미장 마감 이미지 지금 보내기</button>
          </div>
          <p class="note">${c.last ? `마지막 게시: ${fmtDT(new Date(c.last.at)).full} · ${esc(c.last.title || '')}` : '아직 게시한 글이 없어요.'}${c.err ? `<br><b class="err">⚠ ${esc(c.err)}</b> — 봇이 채널 관리자인지, 채널 주소가 맞는지 확인하세요.` : ''}${c.lastErr && !c.err ? `<br><span class="muted">최근 오류(${fmtDT(new Date(c.lastErr.at)).hm}): ${esc(c.lastErr.msg)}</span>` : ''}</p></div>`;
      })()}`;
  }
  S.admTab = load('gk_admtab', 'stats'); S.rpTab = load('gk_rptab', 'price'); S.fg = load('gk_fg', 'all'); S.fs = load('gk_fs', 'all');
  S.mpTab = load('gk_mptab', 'rank'); S.rkKind = load('gk_rkkind', 'all');
  // 작전 레이더 요청: 응답이 늦으면 멈춘 것처럼 보이지 않게 시간 제한
  async function mpGet(q, ms = 40000) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
    try { return await getJSON(`/api/admin?key=${encodeURIComponent(S.admin)}&${q}`, { cache: 'no-store', signal: ac.signal }); }
    catch (e) { if (e.name === 'AbortError') throw new Error(`서버 응답이 ${Math.round(ms / 1000)}초 넘게 없어요 (분석 작업이 몰려 있을 수 있어요)`); throw e; }
    finally { clearTimeout(t); }
  }
  // ───── 🕵️ 작전 레이더 (더보기 메뉴 · 관리자 키가 있는 기기에서만 보임 · 데이터도 관리자 키로만 받음) ─────
  function renderRadar() {
    const box = $('#radarBody'); if (!box) return;
    if (!S.admin) S.admin = load('gk_admin', '') || ''; // 다른 탭에서 로그인했을 수 있음
    document.body.classList.toggle('is-admin', !!S.admin);
    if (!S.admin) { box.innerHTML = '<div class="card"><h3>🕵️ 작전 레이더</h3><p class="muted">관리자 전용 페이지예요. <a href="/#admin">관리자 로그인</a> 후 다시 열어 주세요.</p></div>'; return; }
    document.title = '작전 레이더 | GK의 공시레이더';
    if (S.radarCode) { renderRadarStock(S.radarCode, S.radarOpt || {}); return; }
    box.innerHTML = `<div class="card adm-mp"><h3>🕵️ 작전 레이더 <small class="muted">국장 전 종목 · 매일 장 마감 뒤 자동 분석 + 장중 새 공시가 나오면 그 종목 자동 재판단 · 모든 기록 보관 · 나만 보는 페이지</small></h3>
        <div class="seg mp-tabs" id="mpTabs"><button data-mp-tab="rank" class="${(S.mpTab || 'rank') === 'rank' ? 'on' : ''}">작전 가능성 랭킹</button><button data-mp-tab="day" class="${S.mpTab === 'day' ? 'on' : ''}">날짜별 기록</button><button data-mp-tab="perf" class="${S.mpTab === 'perf' ? 'on' : ''}">📊 성적표</button><button data-mp-tab="my" class="${S.mpTab === 'my' ? 'on' : ''}">⭐ 내 세력주</button><button data-mp-tab="alerts" class="${S.mpTab === 'alerts' ? 'on' : ''}">🔔 알림 기록</button></div>
        <div class="mp-search"><input id="mpQ" type="search" placeholder="🔍 종목 검색 (이름·코드) — 랭킹에 없어도 지금 바로 같은 방식으로 분석" autocomplete="off"><div id="mpQList" class="mp-qlist" hidden></div></div>
        <div id="mpLook"></div>
        <div id="mpBody"><div class="loading"><span class="spin"></span>불러오는 중…</div></div></div>`;
    bindMpSearch();
    if ((S.mpTab || 'rank') === 'rank') loadRank(); else if (S.mpTab === 'perf') loadPerf(); else if (S.mpTab === 'my') loadMy(); else if (S.mpTab === 'alerts') loadAlerts(); else loadManip();
  }
  function goRadarStock(code, opt = {}) {
    S.radarCode = code; S.radarOpt = opt;
    setView('radar', '#radar/' + code);
    window.scrollTo({ top: 0 });
  }
  async function renderRadarStock(code, opt = {}) {
    const box = $('#radarBody'); if (!box) return;
    const my = (S.rpSeq = (S.rpSeq || 0) + 1);
    box.innerHTML = `<div class="rp"><button class="btn sm" data-rp-back>← 작전 레이더</button><div class="loading" style="margin-top:1rem"><span class="spin"></span>${opt.look || opt.refresh ? '분석 중… 공시 180일 · 일봉 · 공시 원문 가격 · 체크리스트 자료 · AI까지 확인해요 (최대 1~2분)' : '불러오는 중… (예전 기록이면 새 방식으로 다시 계산해요)'}</div></div>`;
    let j;
    const k = encodeURIComponent(S.admin);
    try {
      if (!opt.look && !opt.refresh) { j = await mpGet(`mp=prof&code=${code}`, 60000); if (!j?.prof) j = null; }
      if (!j) j = await mpGet(`mp=look&code=${code}&name=${encodeURIComponent(opt.name || '')}${opt.refresh ? '&refresh=1' : ''}`, 180000);
    } catch (e) { j = { ok: false, error: e.message }; }
    if (my !== S.rpSeq || S.view !== 'radar' || S.radarCode !== code) return;
    S.radarOpt = {};
    if (!j?.prof) { box.innerHTML = `<div class="rp"><button class="btn sm" data-rp-back>← 작전 레이더</button><p class="err">분석하지 못했어요: ${esc(j?.error || '결과 없음')}</p></div>`; return; }
    S.rpProf = j.prof; S.rpMeta = j;
    drawRadarStock();
  }
  function drawRadarStock() {
    const box = $('#radarBody'), x = S.rpProf, j = S.rpMeta || {}; if (!box || !x) return;
    const d = x.dir || {}, cl = x.cl, rk = x.rbk, f = x.f || {}, a = x.ai && !x.ai.error ? x.ai : null;
    const P = mpParts(x);
    const DIRB = { up: '<span class="mp-dirb up">📈 상승 가능성</span>', down: '<span class="mp-dirb down">📉 하락 위험</span>' };
    const RBS = { deadcat: '① 기술적 반등', dump: '② 털기 중 반등', second: '③ 2차 작전', wave2: '🔁 눌림 뒤 재상승', unclear: '판단 보류' };
    const nd = (d.dates || []).find((z) => !z.past);
    const tile = (label, val, sub, cls = '') => `<div class="rp-tile ${cls}"><em>${label}</em><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const tiles = [
      tile(d.old && !d.cost ? '지금 세력 평단' : '추정 세력 평단', d.cost ? (d.cost.rep && d.cost.high !== d.cost.low ? `약 ${fmtInt(d.cost.rep)}원` : `${fmtInt(d.cost.low)}${d.cost.high !== d.cost.low ? '~' + fmtInt(d.cost.high) : ''}원`) : d.old ? '<span class="muted">근거 없음</span>' : '—', [d.old && !d.cost ? `고점(${esc(d.old.topD)}) 뒤 새 원가 공시 없음` : '', d.old ? `<span class="muted">지난 판 평단 약 ${fmtInt(d.old.rep)}원 (급등 전 · 참고만)</span>` : '', d.gap != null ? `현재가는 평단 대비 <span class="${d.gap >= 0 ? 'up' : 'down'}">${d.gap >= 0 ? '+' : ''}${d.gap}%</span>` : '', d.cost?.rep && d.cost.high !== d.cost.low ? `범위 ${fmtInt(d.cost.low)}~${fmtInt(d.cost.high)}원 · ${esc(d.cost.repS || '')}` : ''].filter(Boolean).join('<br>')),
      tile('손익비', d.rr ? `1 : ${d.rr.v}${d.rr.big ? '+' : ''}` : '—', d.rr ? `목표 ${fmtInt(d.rr.t)} · 손절 ${fmtInt(d.rr.s)} (${d.rr.dn}%)${d.rr.near ? `<br><span class="muted">가까운 지지 ${fmtInt(d.rr.near.s)}(${d.rr.near.dn}%) 기준이면 1 : ${d.rr.near.v} (흔들기에 깨지기 쉬움)</span>` : ''}${d.rr.far ? `<br>단타 손절 −7%면 1 : ${d.rr.far}` : ''}` : '계산 안 됨', d.rr && (d.dir === 'down' || ['띄우기', '털기', '엑시트 후'].includes(x.stage)) ? 'warn' : ''),
      tile('1차 목표', d.tgt?.length && typeof d.tgt[0] !== 'number' ? `${fmtInt(d.tgt[0].p)}원` : '—', d.rr?.be ? `세력 본전 회복 자리 (${esc(d.tgt?.[0]?.s || '')})${d.rr.t2 ? `<br>다음 ${fmtInt(d.rr.t2)}원 · ${esc(d.rr.t2s || '')}` : ''}` : d.tgt?.[0]?.s ? esc(d.tgt[0].s) : '위쪽 근거 가격 없음'),
      tile(d.old ? '지난 판 매집 구간' : '매집 추정 구간', f.accStart ? `${esc(f.accStart.slice(2))}~${esc((f.accEnd || '').slice(2))}` : '—', f.accDays ? `${f.accDays}거래일${f.cyc ? (f.acc2 ? ' · 2차 매집 후보' : ' · 급등 전 박스') : d.old ? ' · 급등 전 (지금 근거 아님)' : ''}` : ''),
      tile('다음 물량 해제', nd ? esc(nd.d) : '—', nd ? (nd.real ? '공시 원문 기준' : '추정') : '예정 없음'),
      tile('성공 체크리스트', cl ? `${esc(cl.grade)}등급` : '—', cl ? `${cl.ws != null ? `중요도 점수 ${cl.ws}점 · ` : ''}위험 ${cl.nr}개${cl.bombs?.length ? ' (폭탄)' : ''}` : '', cl ? 'g' + cl.grade : ''),
      x.pex ? tile('털기 후 상승 가능성', esc(x.pex.lv), `근거 ${x.pex.su} vs ${x.pex.sd}${rk ? ' · ' + RBS[rk.type] : ''}`, 'pex-' + ({ 높음: 'h', 중간: 'm', 낮음: 'l' }[x.pex.lv])) : tile('반등 성격', rk ? RBS[rk.type] : '—', rk ? `바닥 대비 +${rk.rb.up}%` : '하락 뒤 반등 아님', rk ? 'rb-' + rk.type : ''),
      tile('투자경고 요건까지', f.wf?.min ? (f.wf.min.pct <= 0 ? '이미 도달' : f.wf.min.pct > 30 ? '아직 멂' : `+${f.wf.min.pct}%`) : '—', f.wf?.min ? `${f.wf.min.pct > 30 ? `내일 +${f.wf.min.pct}% 더 올라야 ` : ''}${esc(f.wf.min.lbl)} 요건 (근사)` : '', f.wf?.min && f.wf.min.pct <= 15 ? 'warn' : ''),
    ].join('');
    const TABS = [['price', '💰 가격·목표'], ['check', '✅ 체크리스트'], ['why', '📈📉 근거'], ['chart', '🕯 차트 신호'], ['docs', '📄 공시'], ['ai', '🤖 AI·기록']];
    const tab = TABS.some(([t]) => t === S.rpTab) ? S.rpTab : 'price';
    const planBox = x.plan ? `<div class="pf-planbox"><h5>💼 버티기 계획 <small class="muted">세력이 일부러 밀어 손절을 받아내는 '흔들기'를 버티는 기준 · ⭐ 내 세력주 탭에서 계좌 금액을 넣으면 살 금액까지 계산</small></h5>${planHTML(x.plan)}</div>` : '';
    const body = { price: P.accLine + planBox + P.tgtBox, check: P.ckBox, why: P.dirBox, chart: (P.pexBox + P.cycLine + P.rbBox + P.markBox + P.wf) || '<p class="muted">하락 뒤 반등·매집봉·시장경보 신호가 없어요</p>', docs: P.grid, ai: P.aiBox || '<p class="muted">AI 해석이 아직 없어요 (상위 종목은 장 마감 뒤 자동, 검색은 "지금 다시 분석")</p>' }[tab];
    box.innerHTML = `<div class="rp">
      <div class="rp-nav"><button class="btn sm" data-rp-back>← 작전 레이더</button><span class="muted sm">${x.at ? esc(rel(x.at)) + ' 분석' : ''}${j.cached ? ' · 저장된 결과' : ''}${x.migrated ? ' · 새 계산 방식으로 방금 갱신' : ''}</span></div>
      <div class="rp-head">
        <button class="ca-co" data-open-co="KR|${esc(x.code)}|${esc(x.name)}">${logoHTML('KR', x.code, x.name)}<span><b>${esc(x.name)}</b><small>${esc(x.code)}${x.mkt === 'P' ? ' · 코스피' : x.mkt === 'Q' ? ' · 코스닥' : ''}${x.ind ? ' · ' + esc(String(x.ind).split('|')[0]) : ''}</small></span></button>
        <div class="rp-px" data-lq="${esc(x.code)}" data-lqb="1"><b>${x.close != null ? fmtInt(x.close) + '원' : '—'}</b><small class="${dirCls(x.pct)}">${x.pct != null ? fmtPct(x.pct) : ''}</small></div>
        ${x.vd ? `<div class="vd vd-${esc(x.vd.c)}"><b>${{ g: '🟢 매수 검토', y: '🟡 지켜보기', r: '🔴 피하기' }[x.vd.c]}</b> <span>${esc(x.vd.t)}</span></div>` : ''}
        <div class="rp-chips"><span class="mp-stage ${MP_ST[x.stage] || 'watch'}">${esc(x.stage || '')}${a?.level ? `<small>의심 ${esc(a.level)}</small>` : ''}</span>${DIRB[d.dir] || '<span class="mp-dirb">분류 없음</span>'}${d.big ? `<span class="mp-big" title="시가총액 상위 ${d.big}% — 작전 패턴 해석 신뢰도 낮음">🏢 대형주 · 작전 해석 약함</span>` : ''}<span class="muted sm">상승 ${d.upS || 0}/10 · 하락 ${d.downS || 0}/10 · 종합 ${x.score ?? '-'}점</span></div>
        <div class="mp-chips rp-evchips">${(() => { const cb = (x.events || []).filter((e) => e.kind === 'cb').sort((p, q) => q.ms - p.ms); return mpChips(Object.entries(x.by || {}).filter(([, v]) => v > 0).sort((p, q) => q[1] - p[1]).map(([k]) => k), (x.sig || []).filter((t) => t && !/Infinity|NaN/.test(t)), x.warn?.lv, null, cb.length || null, cb[0] ? new Date(cb[0].ms + 9 * 3600e3).toISOString().slice(0, 10) : null); })()}</div>
      </div>
      <div class="rp-actions"><button class="btn sm" data-rp-refresh>지금 다시 분석</button>${P.myBtn}${j.aiLeft != null ? `<small class="muted">검색 AI 남은 횟수 ${j.aiLeft}회</small>` : ''}</div>
      ${j.aiErr ? `<p class="muted sm">AI: ${esc(j.aiErr)}</p>` : ''}
      <div class="rp-tiles">${tiles}</div>
      ${(() => { const cf = (x.story || []).find((t) => t.startsWith('ℹ️')); return cf ? `<p class="rp-conf">${hl(cf)}</p>` : ''; })()}
      ${(x.story || []).length ? `<div class="rp-story"><h4>📝 한눈에 보는 정리 <small class="muted">계산된 숫자로만 쓴 요약 (AI 아님)</small></h4>${x.story.filter((t) => !t.startsWith('ℹ️')).map((t, i, A) => (i === A.length - 1 ? `<p class="muted sm">${esc(t)}</p>` : `<p>${hl(t)}</p>`)).join('')}</div>` : ''}
      <div class="seg rp-tabs">${TABS.map(([t, l]) => `<button data-rp-tab="${t}" class="${t === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="rp-body">${body}</div>
    </div>`;
    setTimeout(radarLive, 300);
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-rp-back]')) { S.radarCode = null; setView('radar', '#radar'); return; }
    const t = e.target.closest('[data-rp-tab]'); if (t) { S.rpTab = t.dataset.rpTab; save('gk_rptab', S.rpTab); drawRadarStock(); return; }
    if (e.target.closest('[data-rp-refresh]') && S.radarCode) { renderRadarStock(S.radarCode, { refresh: true, name: S.rpProf?.name }); }
  });
  function admHead() {
    const T = [['stats', '방문 통계'], ['daily', '당일 분석']];
    return `<div class="page-head adm-head"><div class="adm-tabs">${T.map(([k, l]) => `<button data-adm-tab="${k}" class="${(S.admTab || 'stats') === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="chips" style="margin:0"><button class="btn sm" data-go="radar">🕵️ 작전 레이더</button><button class="btn sm" data-admin-act="refresh">새로고침</button><button class="btn sm" data-admin-logout>로그아웃</button></div></div>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-adm-tab]');
    if (b) { S.admTab = b.dataset.admTab; save('gk_admtab', S.admTab); renderAdmin(); return; }
    const t = e.target.closest('[data-mp-tab]');
    if (t) { S.mpTab = t.dataset.mpTab; save('gk_mptab', S.mpTab); $$('#mpTabs button').forEach((x) => x.classList.toggle('on', x === t)); if (S.mpTab === 'rank') loadRank(); else if (S.mpTab === 'perf') loadPerf(); else if (S.mpTab === 'my') loadMy(); else if (S.mpTab === 'alerts') loadAlerts(); else loadManip(); }
  });
  // ───── 작전 의심 레이더 ─────
  const MP_ST = { '판 깔기': 'setup', 매집: 'acc', 띄우기: 'pump', 털기: 'exit', '엑시트 후': 'done', 거래정지: 'halt', 관찰: 'watch' };
  const mpChips = (by, sig, wn, pn, cbn, cbd) => `${wn ? `<span class="mp-chip ev-risk">⚠ 거래소 ${esc(wn)}</span>` : ''}${cbn ? `<span class="mp-chip ev-cb">💳 최근 CB·BW ${cbn}건${cbd ? ` · ${esc(cbd.slice(2))}` : ''}</span>` : ''}${(by || []).filter((k) => !(k === 'cb' && cbn)).map((k) => `<span class="mp-chip ev-${esc(k)}">${esc(MP_EV[k] || k)}</span>`).join('')}${(sig || []).map((t) => `<span class="mp-chip vol">${esc(t)}</span>`).join('')}${pn != null ? `<span class="mp-chip ev-risk">📛 벌점 ${pn}점</span>` : ''}`;
  // 서술형 정리·AI 문장의 핵심 단어에 색 (가격·등락률·날짜·단계·좋은 점/조심할 점)
  const HL_RE = new RegExp([
    '(\\d{4}-\\d{2}-\\d{2}(?:\\s*~\\s*\\d{4}-\\d{2}-\\d{2})?)',
    '(1\\s*:\\s*\\d+(?:\\.\\d+)?\\+?)',
    '((?:약\\s)?\\d[\\d,]*(?:\\.\\d+)?원)',
    '([+\\-−]\\d+(?:\\.\\d+)?%)',
    '(\\d+(?:\\.\\d+)?%)',
    '([ABCD]등급)',
    '(\\d+(?:\\.\\d+)?\\/10점|\\d+(?:\\.\\d+)?점)',
    '(판 깔기|매집봉|매집|띄우기|털기|엑시트 후|거래정지|2차 작전)',
    '(상승 가능성|좋은 점|올라갈 근거|높음|지킴|이익 구간|수익 구간|되사기|바닥 확인|성공 조건)',
    '(하락 위험|조심할 점|걸림돌|못 올라갈 근거|위험 신호|위험|낮음|잠재 물량|물량|벌점|약세장|새 저점|손절|매도|차익 실현|불성실공시|의견거절|자본잠식)',
    '(3자배정(?: 증자| 유상증자| 발행가)?|CB·BW·EB|CB·BW|CB|BW|리픽싱|전환청구|전환가|유상증자|최대주주 변경|최대주주|투자조합|5% 지분 신고|담보|반대매매)',
  ].join('|'), 'g');
  const HL_C = ['hl-d', 'hl-rr', 'hl-p', null, 'hl-n', null, 'hl-sc', 'hl-st', 'hl-good', 'hl-bad', 'hl-ev'];
  const hl = (t) => esc(t).replace(HL_RE, (m, ...g) => {
    const i = g.slice(0, 11).findIndex((v) => v !== undefined);
    let c = HL_C[i];
    if (i === 3) c = m[0] === '+' ? 'hl-up' : 'hl-dn';
    if (i === 5) c = 'hl-g' + m[0];
    return c ? `<span class="${c}">${m}</span>` : m;
  });
  const MP_EV = { tsell: '자사주 처분', rename: '상호 변경', ceo: '대표이사 변경', agm: '주총 소집', mna: '최대주주·경영권', rights3: '3자배정 증자', rightsfix: '증자 정정', rights: '유상증자', rightsR: '구조조정 증자(제외)', cb: 'CB·BW', refix: '리픽싱', fund5: '투자조합 지분', purpose: '사업목적 변경', bonus: '무상증자', capred: '감자', contract: '공급계약', invest: 'MOU·투자판단', inquiry: '조회공시', conv: '전환청구', majsell: '최대주주 지분변동', pledge: '담보·질권', risk: '불성실·횡령 등' };
  async function loadManip(date, run) {
    const box = $('#mpBody'); if (!box) return;
    const seq = (S.mpSeq = (S.mpSeq || 0) + 1);
    if (run) box.innerHTML = '<div class="loading"><span class="spin"></span>분석을 시작했어요. 단계별로 진행돼 끝까지 약 1시간 걸려요 (중간 결과도 바로 보여요)…</div>';
    let j;
    try { j = await mpGet(`mp=${run ? 'run' : 'view'}${date ? '&date=' + date : ''}`); } catch (e) { j = { ok: false, error: e.message }; }
    if (!$('#mpBody') || seq !== S.mpSeq || (S.mpTab || 'rank') !== 'day') return; // 늦게 온 응답이 다른 탭 화면을 덮어쓰지 않게
    if (!j.ok) { $('#mpBody').innerHTML = `<p class="err">${esc(j.error || '불러오지 못했어요')}</p>`; return; }
    S.mp = j;
    const doc = j.doc, st = j.state || {};
    const PH = { snap: '전 종목 시세 받는 중', events: '공시 패턴 찾는 중', bars: `일봉 분석 중 (${st.bars || ''})`, docs: '공시 원문에서 가격 확인 중', extra: '체크리스트 자료 수집 중', recheck: '랭킹 종목 일봉 재확인 중', ai: 'AI 분석 중', done: '완료' };
    const status = st.phase && st.phase !== 'done' && st.date ? `<span class="mp-run"><span class="spin"></span>${esc(st.date)} ${esc(PH[st.phase] || st.phase)}</span>` : '';
    const dates = `<div class="chips vn-tabs">${(j.idx || []).slice(0, 20).map((x) => `<button class="${x === j.date ? 'on' : ''}" data-mp-date="${esc(x)}">${esc(md(x))}</button>`).join('')}${(j.idx || []).length > 20 ? `<select id="mpOld"><option value="">이전 날짜…</option>${j.idx.slice(20).map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>` : ''}</div>`;
    const btns = `<div class="chips" style="margin:.5rem 0"><button class="btn sm" data-mp-run>오늘 분석 지금 시작</button><button class="btn sm" data-mp-date="${esc(j.date || '')}">새로고침</button>${status}</div>`;
    if (!doc) { $('#mpBody').innerHTML = dates + btns + `<p class="muted">아직 분석 기록이 없어요. 거래일 15:50 이후 자동으로 시작되고, 위 버튼으로 바로 시작할 수도 있어요.</p>${st.log?.length ? `<pre class="mp-log">${esc(st.log.join('\n'))}</pre>` : ''}`; return; }
    const won = (v) => (v == null ? '—' : `${fmtInt(v)}원`);
    const gap = (c, p) => (c && p ? `${c >= p ? '+' : ''}${(((c / p) - 1) * 100).toFixed(0)}%` : '');
    const rows = doc.list.map((x, i) => {
      const a = x.ai && !x.ai.error ? x.ai : null;
      const evc = Object.entries(x.by || {}).filter(([, v]) => v > 0).map(([k]) => `<span class="mp-chip ev-${esc(k)}">${esc(MP_EV[k] || k)}</span>`).join('');
      const vc = (x.sig || []).filter((t) => !/Infinity|NaN/.test(t)).map((t) => `<span class="mp-chip vol">${esc(t)}</span>`).join('');
      const rcst = x.dir?.cost || a?.cost || null; // 규칙 계산 평단 우선
      const cost = rcst ? `${won(rcst.low)}${rcst.high && rcst.high !== rcst.low ? ' ~ ' + won(rcst.high) : ''}` : x.f?.vwapAcc && !x.dir?.old ? `${won(x.f.vwapAcc)} <small>(매집 구간 평균)</small>` : '—';
      const mid = rcst ? ((rcst.low || rcst.high) + (rcst.high || rcst.low)) / 2 : x.dir?.old ? null : x.f?.vwapAcc;
      return `<li class="mp-row" data-mp-i="${i}">
        <div class="mp-top"><span class="f-rk">${i + 1}</span><span class="ca-co" data-mp-go="${esc(x.code)}" title="작전 레이더 종목 페이지 열기">${logoHTML('KR', x.code, x.name, 'sm')}<span><b>${esc(x.name)}</b><small>${esc(x.code)} · ${x.mkt === 'P' ? '코스피' : x.mkt === 'Q' ? '코스닥' : ''}${x.streak > 1 ? ` · ${x.streak}일 연속` : ''}</small></span></span>
          <span class="mp-px" data-lq="${esc(x.code)}">${won(x.close)}<small class="${dirCls(x.pct)}">${x.pct != null ? fmtPct(x.pct) : ''}</small></span>
          <span class="mp-stage ${MP_ST[x.stage] || 'watch'}">${esc(x.stage)}${a?.level ? `<small>의심 ${esc(a.level)}</small>` : ''}</span>
          <span class="mp-score"><b>${x.score}</b><small>공시 ${x.es} · 거래 ${x.vs}</small></span></div>
        <div class="mp-chips">${evc}${vc}</div>
        <div class="mp-cost">추정 세력 평단 <b>${cost}</b>${mid && x.close ? ` · 현재가는 평단 대비 <b class="${x.close >= mid ? 'up' : 'down'}">${gap(x.close, mid)}</b>` : ''}</div>
        ${a?.summary ? `<p class="mp-sum">🤖 ${esc(a.summary)}</p>` : x.ai?.error ? `<p class="muted sm">AI 분석 실패: ${esc(x.ai.error)}</p>` : i < 15 && doc.building ? '<p class="muted sm">AI 분석 대기 중…</p>' : ''}
        <div class="mp-more" hidden></div></li>`;
    }).join('');
    $('#mpBody').innerHTML = dates + btns + `<p class="note">${esc(doc.date)} 기준 · 의심 종목 ${doc.list.length}개${doc.building ? ' (분석 진행 중 — 잠시 뒤 새로고침)' : ''} · 줄을 누르면 그 종목 페이지가 열려요.</p><ol class="mp-list">${rows}</ol>
      <p class="note">⚠ 공시·거래 패턴이 '작전 세력의 전형적인 흐름과 비슷하다'는 신호일 뿐, 불공정거래의 증거가 아닙니다. 평단가는 전환가·발행가·거래량 가중 평균으로 추정한 값입니다. 종목명을 공개적으로 '작전주'라고 지칭하면 법적 문제가 생길 수 있어요.</p>`;
  }
  const RK_KINDS = [['all', '전체 (의심 순)'], ['pick', '🎯 내 매매 후보'], ['up', '📈 상승 가능성'], ['down', '📉 하락 위험'], ['rr', '⚖️ 손익비 순'], ['ck', '✅ 체크리스트 순'], ['pex', '🔁 털기 후 상승']];
  const rkKindsHTML = () => `<div class="seg mp-kinds">${RK_KINDS.map(([k, l]) => `<button data-rk-kind="${k}" class="${(S.rkKind || 'all') === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  // 작전 레이더 가격 실시간(15초): 화면에 보이는 종목만 시세를 받아 가격·등락률을 바로 바꿈
  async function radarLive() {
    if (S.view !== 'radar' || document.hidden) return;
    const H = innerHeight;
    const els = [...document.querySelectorAll('#viewRadar [data-lq]')].filter((e) => { if (e.closest('[hidden]')) return false; const r = e.getBoundingClientRect(); return r.bottom > -H && r.top < H * 2; });
    if (!els.length) return;
    const keys = [...new Set(els.map((e) => wkey('KR', e.dataset.lq)))];
    keys.forEach((k) => { const q = S.quotes.get(k); if (q) q._at = 0; });
    for (let i = 0; i < keys.length; i += 40) await fetchQuotes(keys.slice(i, i + 40));
    for (const e of els) {
      const q = quoteOf('KR', e.dataset.lq); if (!q || q.price == null) continue;
      const pct = q.livePct ?? q.pct, px = q.live ?? q.price;
      if (e.dataset.entry !== undefined) { const en = Number(e.dataset.entry) || 0, pl = en ? Math.round((px / en - 1) * 1000) / 10 : null; e.innerHTML = `${fmtInt(px)}원<small class="${dirCls(pl)}">${pl != null ? (pl > 0 ? '+' : '') + pl + '%' : ''}</small>`; }
      else if (e.dataset.lqb) e.innerHTML = `<b>${fmtInt(px)}원</b><small class="${dirCls(pct)}">${pct != null ? fmtPct(pct) : ''}</small>`;
      else e.innerHTML = `${fmtInt(px)}원<small class="${dirCls(pct)}">${pct != null ? fmtPct(pct) : ''}</small>`;
      e.classList.add('lq-on'); e.title = '실시간 시세 (15초마다)';
    }
  }
  setInterval(radarLive, 15000);
  function applyRkFilter() {
    const box = $('#mpBody'); if (!box) return;
    const fg = S.fg || 'all', fs = S.fs || 'all';
    let shown = 0, total = 0;
    box.querySelectorAll('li.mp-rk').forEach((li) => { total++; const ok = (fg === 'all' || li.dataset.g === fg) && (fs === 'all' || li.dataset.st === fs); li.hidden = !ok; if (ok) shown++; });
    box.querySelectorAll('li.pk-sep').forEach((sep) => { let n = sep.nextElementSibling, any = false; while (n && !n.classList.contains('pk-sep')) { if (n.classList.contains('mp-rk') && !n.hidden) any = true; n = n.nextElementSibling; } sep.hidden = !any; });
    box.querySelectorAll('[data-fg]').forEach((b) => b.classList.toggle('on', b.dataset.fg === fg));
    box.querySelectorAll('[data-fs]').forEach((b) => b.classList.toggle('on', b.dataset.fs === fs));
    const fn = box.querySelector('.rk-fn'); if (fn) fn.textContent = fg === 'all' && fs === 'all' ? '' : `${shown}개 표시 (전체 ${total}개)`;
    let empty = box.querySelector('.rk-empty');
    if (!shown && total) { if (!empty) { empty = document.createElement('p'); empty.className = 'muted rk-empty'; box.querySelector('.mp-list')?.before(empty); } empty.textContent = '이 등급·단계에 해당하는 종목이 없어요. 위에서 다른 조건을 골라 보세요.'; } else empty?.remove();
  }
  async function loadRank(retry = 0) {
    const box = $('#mpBody'); if (!box) return;
    // 늦게 도착한 이전 요청이 화면을 덮어쓰지 않게 (탭을 빨리 바꿀 때 분류가 뒤섞여 보이던 문제)
    const seq = (S.rkSeq = (S.rkSeq || 0) + 1), kind = S.rkKind || 'all'; S.mpSeq = (S.mpSeq || 0) + 1;
    if (!box.querySelector('.mp-kinds')) box.innerHTML = rkKindsHTML() + '<div class="loading"><span class="spin"></span>불러오는 중…</div>';
    else { box.querySelectorAll('[data-rk-kind]').forEach((b) => b.classList.toggle('on', b.dataset.rkKind === kind)); box.classList.add('mp-loading'); }
    let j;
    const t0 = Date.now();
    try { j = await mpGet(`mp=rank&kind=${kind}`, 30000); } catch (e) { j = { ok: false, error: e.message }; }
    S.rkMs = Date.now() - t0;
    if (seq !== S.rkSeq) return;
    box.classList.remove('mp-loading');
    if (!$('#mpBody') || (S.mpTab || 'rank') !== 'rank') return;
    if (!j.ok) {
      if (retry < 1 && !/초 넘게/.test(j.error || '')) { setTimeout(() => { if (seq === S.rkSeq) loadRank(retry + 1); }, 1500); return; } // 잠깐 실패면 한 번 더 (시간 초과는 바로 알림)
      $('#mpBody').innerHTML = rkKindsHTML() + `<p class="err">불러오지 못했어요: ${esc(j.error || '')} <button class="btn sm" data-mp-rank-refresh>다시 시도</button></p>`; return;
    }
    try {
    S.mpRank = j.list || [];
    const st = j.state || {};
    const PH = { snap: '전 종목 시세 받는 중', events: '공시 패턴 찾는 중', bars: `일봉 분석 중 (${st.bars || ''})`, docs: '공시 원문에서 가격 확인 중', extra: '체크리스트 자료 수집 중', recheck: '랭킹 종목 일봉 재확인 중', ai: 'AI 분석 중' };
    const status = st.phase && st.phase !== 'done' ? `<span class="mp-run"><span class="spin"></span>${esc(st.date || '')} 정기 분석: ${esc(PH[st.phase] || st.phase)}</span>` : `<span class="muted sm">다음 정기 분석: 거래일 15:50 · 장중 새 공시 자동 반영${st.incrQ ? ` (대기 ${st.incrQ}종목)` : ''} · 가격은 15초마다 실시간</span>`;
    const won = (v) => (v == null ? '—' : `${fmtInt(v)}원`);
    const DIRB = { up: '<span class="mp-dirb up">📈 상승 가능성</span>', down: '<span class="mp-dirb down">📉 하락 위험</span>' };
    const rows = S.mpRank.map((r, i) => { try {
      const mid = r.cr || (r.cl || r.ch ? ((r.cl || r.ch) + (r.ch || r.cl)) / 2 : r.va);
      const g = mid && r.c ? Math.round((r.c / mid - 1) * 100) : null;
      const why = (S.rkKind === 'down' ? r.dr : S.rkKind === 'up' ? r.ur : r.d === 'down' ? r.dr : r.ur) || [];
      const pkBar = S.rkKind === 'pick' ? `<div class="pk-bar ${r.near ? 'near' : 'ok'}">${r.near ? `⚠ 조건 하나 부족: <b>${esc(r.pf?.[0] || '')}</b>` : '✅ 매매 후보 조건 모두 통과'}${r.pat ? ` · <span class="pk-pat${r.pat.on ? '' : ' off'}">📊 비슷한 패턴 20일 뒤 오른 비율 ${r.pat.on ? `<b>약 ${r.pat.est}%</b> (전체 ${r.pat.base}%)` : '데이터 모으는 중'}</span>` : ''}</div>` : '';
      const sep = S.rkKind === 'pick' && r.near && !S.mpRank[i - 1]?.near ? `<li class="pk-sep">조건 하나만 부족한 종목 (참고 · 그 조건이 풀리는지 지켜볼 후보)</li>` : '';
      return `${sep}<li class="mp-row mp-rk${r.near ? ' pk-near' : ''}" data-mp-code="${esc(r.code)}" data-g="${esc(r.ckg || '-')}" data-st="${esc(r.st || '관찰')}">${pkBar}
        <div class="mp-top"><span class="f-rk">${i + 1}</span><span class="ca-co" title="작전 레이더 종목 페이지 열기">${logoHTML('KR', r.code, r.n, 'sm')}<span><b>${esc(r.n)}</b><small>${esc(r.code)} · ${r.m === 'P' ? '코스피' : r.m === 'Q' ? '코스닥' : ''} · ${esc(rel(r.up))} 갱신</small></span></span>
          <span class="mp-px" data-lq="${esc(r.code)}">${won(r.c)}<small class="${dirCls(r.pct)}">${r.pct != null ? fmtPct(r.pct) : ''}</small></span>
          <span class="mp-stage ${MP_ST[r.st] || 'watch'}">${esc(r.st || '')}${r.lv ? `<small>의심 ${esc(r.lv)}</small>` : ''}</span>
          ${S.rkKind === 'pick' ? `<span class="mp-score"><b>${r.pat?.on ? r.pat.est + '<em>%</em>' : (r.ckg ? esc(r.ckg) + '<em>등급</em>' : '—')}</b><small>${r.pat?.on ? '비슷한 패턴 승률(추정)' : '체크 등급'}<br>손익비 ${r.rr ? '1:' + r.rr.v : '—'} · 종합 ${r.s ?? '-'}점</small></span>` : S.rkKind === 'pex' && r.pex ? `<span class="mp-score"><b>${esc(r.pex.lv)}</b><small>털기 후 상승<br>근거 차이 ${r.pex.net > 0 ? '+' : ''}${r.pex.net}</small></span>` : S.rkKind === 'rr' && r.rr ? `<span class="mp-score"><b>1:${r.rr.v}${r.rr.big ? '+' : ''}</b><small>손익비<br>종합 점수 ${r.s}</small></span>` : S.rkKind === 'up' || S.rkKind === 'down' ? `<span class="mp-score"><b>${S.rkKind === 'up' ? r.us || 0 : r.ds || 0}<em>/10</em></b><small>${S.rkKind === 'up' ? '상승' : '하락'} 근거 점수<br>종합 점수 ${r.s}</small></span>` : `<span class="mp-score"><b>${r.s}</b><small>종합 점수 ${r.s >= 20 ? '(매우 많음)' : r.s >= 10 ? '(많음)' : '(보통)'}</small></span>`}</div>
        ${r.vd && S.rkKind !== 'pick' ? `<div class="vd vd-${esc(r.vd.c)}"><b>${{ g: '🟢 매수 검토', y: '🟡 지켜보기', r: '🔴 피하기' }[r.vd.c]}</b> <span>${esc(r.vd.t)}</span></div>` : ''}
        <div class="rk-strip">
          ${DIRB[r.d] ? DIRB[r.d] : ''}
          ${r.ckg ? `<span class="mp-ckg g${esc(r.ckg)}">체크 ${esc(r.ckg)}</span>` : ''}
          ${r.pex ? `<span class="pex-chip pex-${{ 높음: 'h', 중간: 'm', 낮음: 'l' }[r.pex.lv]}">🔁 털기 후 상승 ${esc(r.pex.lv)}</span>` : ''}
          ${r.rbt && r.rbt !== 'unclear' ? `<span class="mp-rbchip rb-${esc(r.rbt)}">🔄 ${{ deadcat: '기술적 반등', dump: '털기 중 반등', second: '2차 작전', wave2: '눌림 뒤 재상승' }[r.rbt]}</span>` : ''}
          ${r.cm ? `<span class="mp-chip vol">🕯 매집봉 ${r.cm}</span>` : ''}${r.lk ? `<span class="mp-chip net">🕸 연결 ${r.lk}</span>` : ''}${r.big ? '<span class="mp-big">🏢 대형주 · 작전 해석 약함</span>' : ''}
        </div>
        <div class="mp-chips rk-chips">${mpChips(r.by, r.sig, r.wn, r.pn?.c, r.cbn, r.cbd)}</div>
        <div class="rk-kv">
          <span><em>추정 평단</em><b>${r.cr && r.ch && r.cl && r.ch !== r.cl ? `약 ${fmtInt(r.cr)}원` : r.cl || r.ch ? `${fmtInt(r.cl || r.ch)}${r.ch && r.cl && r.ch !== r.cl ? '~' + fmtInt(r.ch) : ''}원` : r.va ? fmtInt(r.va) + '원' : r.oc ? '—' : '—'}</b>${r.oc && !r.cr && !r.cl ? `<small class="muted">지난 판 약 ${fmtInt(r.oc)}원(참고)</small>` : ''}${g != null ? `<small class="${g >= 0 ? 'up' : 'down'}">현재 ${g >= 0 ? '+' : ''}${g}%${r.cr && r.ch !== r.cl ? ` · 범위 ${fmtInt(r.cl)}~${fmtInt(r.ch)}` : ''}</small>` : ''}</span>
          <span><em>손익비</em><b>${r.rr ? '1 : ' + r.rr.v + (r.rr.big ? '+' : '') : '—'}</b>${r.rr ? `<small>목표 ${fmtInt(r.rr.t)} · 손절 ${fmtInt(r.rr.s)}</small>` : ''}</span>
          <span><em>1차 목표</em><b>${r.tg?.length ? fmtInt(typeof r.tg[0] === 'number' ? r.tg[0] : r.tg[0].p) + '원' : '—'}</b>${r.tg?.length && typeof r.tg[0] !== 'number' ? `<small>${esc(r.tg[0].s)}</small>` : ''}</span>
          <span><em>다음 물량 해제</em>${(() => { const nd = r.nd && r.nd.slice(0, 10) >= new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) ? r.nd : null; return `<b>${nd ? esc(nd.split(' ')[0]) : '—'}</b>${nd ? `<small>${esc(nd.split(' ').slice(1).join(' '))}</small>` : ''}`; })()}</span>
        </div>
        ${why.length ? `<p class="rk-why ${r.d || ''}">${esc(why[0])}</p>` : ''}</li>`;
    } catch (er) { console.error('랭킹 줄 오류', r?.code, er); return `<li class="mp-row"><p class="err sm">${esc(r?.n || r?.code || '')} 줄을 그리지 못했어요: ${esc(er.message)}</p></li>`; }
    }).join('');
    const kinds = rkKindsHTML();
    const legend = `<details class="mp-legend"><summary>용어 설명 (단계·의심 수준·점수·상승/하락)</summary><ul>
      <li><b>판 깔기</b>: 최대주주 변경·투자조합 3자배정 증자·CB 발행·사업목적 추가처럼 '준비' 공시가 나왔지만 주가는 아직 크게 안 움직인 상태</li>
      <li><b>매집</b>: 주가는 박스권인데 거래량이 늘고, 오를 때 거래가 많고 내릴 때 적은 흐름 (조용히 사 모으는 모습)</li>
      <li><b>띄우기</b>: 거래량 폭증과 함께 급등 (테마·공급계약·MOU 공시가 같이 나오는 경우가 많음)</li>
      <li><b>엑시트 후</b>: 최근 약 300거래일(1년 2개월) 안에 저점 대비 +80% 이상 급등했다가 지금은 고점 대비 −45% 이하로 빠진 종목 (이미 한 번 해먹고 나간 흔적). 고점 뒤 새 CB·3자배정·최대주주 변경 공시가 나오면 '판 깔기'(2차), 고점 뒤 바닥을 40거래일 넘게 안 깨고 박스(폭 35% 미만)에서 매집 모양이 나오면 '매집'(2차)으로 바뀜 — 랭킹 종목은 공시가 없어도 매일 일봉으로 다시 확인, 바뀌면 관리자 텔레그램 '🔁 재매집 의심' 알림. 매집 평단은 급등 시작 전 구간으로만 계산</li>
      <li><b>🕯 매집봉 흔적</b>: 박스권에서 거래량이 평소 4배 넘게 실린 +6%↑ 양봉(매집봉), 거래량 실린 긴 윗꼬리, 거래량 실렸는데 안 빠진 음봉, 그 뒤 거래량 마름, 종가 관리 의심. 그날·전날 공시가 있거나 시장 전체가 ±2.5% 움직인 날은 빼고, 그 뒤 20거래일 안에 봉의 저점을 깨면 무효. 최대 +4점</li>
      <li><b>털기</b>: 급등 뒤 CB 전환청구·추가 상장·최대주주 지분 변동·고점 이탈 등 '물량을 파는' 신호</li>
      <li><b>의심 높음/중간/낮음</b>: AI가 여러 근거가 위 흐름과 얼마나 잘 맞는다고 봤는지 (불법이라는 뜻 아님)</li>
      <li><b>종합 점수</b>: 공시 점수 + 거래 점수. 정해진 만점은 없음(신호를 더해 가는 방식, 이론상 최대 약 77점). <b>4점 이상만 레이더에 올라오고, 10점 이상이면 신호가 많은 편, 20점 이상이면 매우 많은 편</b>. 높을수록 작전 흐름과 '닮은 신호가 많다'는 뜻 — 오른다/내린다는 뜻이 아님</li>
      <li><b>상승 근거 점수 · 하락 근거 점수</b>: 각각 <b>10점 만점</b> (근거가 아주 많아 10점을 넘으면 10점으로 표시). 상승 가능성·하락 위험 탭에서는 오른쪽 큰 숫자가 이 점수이고, 종합 점수(작전 패턴 신호 개수, 만점 없음)는 그 아래 작게 표시. 상승 가능성 탭은 '상승 근거 − 하락 근거'가 큰 순서. 60일 저점 대비 +50% 넘게 이미 올랐거나 띄우기·털기 단계면 상승 가능성에 넣지 않음</li>
      <li><b>📈 상승 가능성</b>: 흐름상 아직 판 깔기·매집 단계이고 주가가 추정 평단 근처라 '띄우기 전'일 수 있는 종목 (규칙으로 자동 판정)</li>
      <li><b>📉 하락 위험</b>: 이미 띄운 뒤이거나 전환청구·평단 대비 큰 차익 등 '털기' 신호가 있는 종목 (규칙으로 자동 판정)</li>
      <li><b>🕸 같은 세력 연결 의심</b>: 같은 투자조합·인물(공시 제출인·새 최대주주) 이름이 다른 종목 공시에도 나옴. 동명이인·우연일 수 있어 공시 링크로 꼭 확인 (+2점씩, 최대 4점)</li>
      <li><b>⚠ 거래소 경보</b>: 투자주의·경고·위험 지정(최근 30일). 보통 이미 급등한 뒤 나오므로 하락 쪽 근거로도 씀</li>
      <li><b>보정</b>: 시가총액 하위 40% 소형주 +1점 · 상위 10% 대형주는 점수 ×0.6 · 건설·조선 등 공급계약이 일상인 업종은 공급계약 점수 제외 · 채권단 출자전환 증자는 제외</li>
      <li><b>CB 원문</b>: 전환청구기간(물량 해제일), 리픽싱 하한가, 콜옵션(최대주주가 CB를 되사는 권리)을 원문에서 읽음 · <b>담보</b>: 1주당 대출액 × 1.4를 반대매매 추정가로 계산(비율은 가정)</li>
      <li><b>🔁 털기 후 상승 가능성</b>: 털기·엑시트 후(또는 고점에서 33%↑ 빠진) 종목이 다시 오를 근거와 못 오를 근거를 점수로 비교해 높음/중간/낮음. 반등을 시작하기 전에도 계산하고, '높음'으로 바뀌면 관리자 텔레그램 알림</li>
      <li><b>🔄 반등 성격</b>: 고점에서 33%↑ 빠진 뒤 바닥 대비 15%↑ 반등 중인 종목을 ① 기술적 반등(거래량 줄며 매물대에서 막힘) ② 털기 중 반등(윗꼬리·전환청구 계속·남은 CB 물량 많음·내부자 매도) ③ 2차 작전(바닥 유지·매집봉·새 판 깔기 공시·CB 되사기·물량 소진) 중 근거 점수가 높은 쪽으로 분류. 남은 CB 물량은 전환청구 공시의 미전환 잔액으로 추정. ③으로 바뀌면 관리자 텔레그램 알림</li>
      <li><b>✅ 성공 가능성 체크리스트</b>: 띄울 이유(세력 자금 실제 납입·원가 근처·물량 해제일 2~3개월 전) · 띄울 힘(소형주·최대주주 지분 40%↑·사업목적 추가·매집 흔적·업종/테마 강세·내부자 매수·창구 쏠림·손익비 2↑·기사/종토방 증가)과 위험 신호(납입 연기·철회, 벌점, 감사의견·자본잠식, 자금 외부 유출, 담보 반대매매, 내부자 매도, 같은 세력 실패 이력, 엑시트 후, 약세장, 신용잔고 7%↑, 투자경고 요건 근접)를 ✓/✗로 표시. 자료를 못 받은 항목은 '?'로 두고 계산에서 뺌</li>
      <li><b>⚖️ 손익비</b>: (1차 목표 − 현재가) ÷ (현재가 − 손절 기준). 손절 기준은 현재가 바로 아래의 세력 원가·지지 가격 — 그 아래로 빠지면 '세력 평단 근처'라는 근거가 깨짐. 1 : 3이면 3% 잃을 위험에 9% 오를 여지라는 뜻 (확률이 아니라 폭의 비율)</li>
      <li><b>🎯 참고 목표</b>: 현재가보다 위에 있는 '근거 있는 가격' — 공시에 적힌 CB 전환가·3자배정 발행가·인수 단가(세력이 이익을 보려면 넘어야 하는 원가)와 과거 고점(매물대). 배수 계산이 아님. 세력의 실제 목표가는 어떤 공시에도 안 나옴</li></ul></details>`;
    // 등급·단계로 거르기 (화면에서만 거름 — 다시 불러오지 않음)
    const cnt = (f) => S.mpRank.filter(f).length;
    const GR = [['all', '전체'], ['A', 'A등급'], ['B', 'B등급'], ['C', 'C등급'], ['D', 'D등급']];
    const STG = [['all', '전체'], ['판 깔기', '판 깔기'], ['매집', '매집'], ['띄우기', '띄우기'], ['털기', '털기'], ['엑시트 후', '엑시트 후'], ['관찰', '관찰']];
    const filt = `<div class="rk-filt"><div><em>✅ 등급</em>${GR.map(([k, l]) => { const n = k === 'all' ? S.mpRank.length : cnt((r) => r.ckg === k); return `<button data-fg="${k}" class="${(S.fg || 'all') === k ? 'on' : ''} g${k}"${n || k === 'all' ? '' : ' disabled'}>${l} <small>${n}</small></button>`; }).join('')}</div>
      <div><em>🧭 단계</em>${STG.map(([k, l]) => { const n = k === 'all' ? S.mpRank.length : cnt((r) => (r.st || '관찰') === k); return `<button data-fs="${esc(k)}" class="${(S.fs || 'all') === k ? 'on' : ''} ${MP_ST[k] || ''}"${n || k === 'all' ? '' : ' disabled'}>${l} <small>${n}</small></button>`; }).join('')}</div><span class="rk-fn muted sm"></span></div>`;
    $('#mpBody').innerHTML = `<div class="chips" style="margin:.5rem 0">${status}<button class="btn sm" data-mp-rank-refresh>새로고침</button></div>${kinds}${filt}${legend}
      <p class="note">${S.rkKind === 'pick' ? `🎯 <b>내 매매 후보</b> = 아래 조건을 <b>모두</b> 통과한 종목: ① 단계 매집·판 깔기 ② 상승 가능성 분류 ③ 체크리스트 A·B등급 ④ 손익비 1:2 이상 ⑤ 현재가가 추정 평단 대비 +15% 이하(이미 뜬 종목 제외) ⑥ 신호 엇갈림 없음 ⑦ 거래소 경보·벌점 10점↑·횡령/감사의견 등 위험 공시 없음. 순서는 ${j.pat?.on ? `<b>지난 성적표에서 비슷한 패턴이 20거래일 뒤 오른 비율(추정)</b> → 체크 등급 → 손익비 순 (성적표 20일 결과 ${j.pat.n}건 기준, 표본 적은 특징은 전체 평균 쪽으로 당겨 과장 방지)` : `체크 등급 → 손익비 순. <b>📊 패턴 우선순위는 성적표 20일 결과가 ${j.pat?.need || 100}건 쌓이면 자동으로 켜져요 (지금 ${j.pat?.n || 0}건)</b> — 그 뒤엔 실제로 잘 맞은 패턴(단계·등급·손익비·털기 후 상승·매집봉)을 가진 종목이 위로 올라와요`}. 통과 ${j.pat?.ok ?? 0}종목. 사는 자리는 추정 평단 근처, 손절은 화면의 손절 기준, 분할 매수 권장 — 결과를 보장하지 않아요.` : S.rkKind === 'pex' ? '🔁 털기·엑시트 후 종목(또는 고점에서 33% 넘게 빠진 종목) 중 다시 오를 근거가 많은 순. 올라갈 근거(바닥 유지·남은 CB 물량 소진/되사기·새 판 깔기 공시·바닥 뒤 매집 흔적·거래량 마름·내부자 매수·2차 작전 반등) − 못 올라갈 근거(남은 전환 물량·계속되는 전환청구/지분 매도·털기 중 반등·내부자 매도·새 저점·상장 위험·약세장·자금 문제). 높음 = 올라갈 근거 5점↑이고 차이 3점↑. 패턴상 가능성일 뿐이에요.' : S.rkKind === 'ck' ? '✅ 성공 가능성 체크리스트 순: (충족한 성공 조건 수) − 2×(위험 신호 수). 자료가 없는 항목은 계산에서 빼요. A = 충족 60%↑(4개 이상)·위험 0 · B = 충족 40%↑(3개 이상)·위험 1개 이하 · C = 나머지 · D = 종목 위험 신호 3개↑ (시장 전체 약세는 등급에서 제외). 하락 위험 종목 제외. 패턴상 기준일 뿐 결과를 보장하지 않아요.' : S.rkKind === 'rr' ? '⚖️ 손익비 = (1차 목표 − 현재가) ÷ (현재가 − 손절 기준). 1차 목표는 현재가 위 가장 가까운 근거 가격(공시 원가·매집 전 고점·매물대), 손절 기준은 현재가 3% 이상 아래의 가장 가까운 세력 원가·지지 가격(공시 원가·매집 구간 최저가·최근 20일 저점·버틴 매집봉 저점 — 이 아래로 빠지면 세력 평단 근거가 깨짐). 하락 위험·띄우기·털기·엑시트 후 종목은 제외. 손익비가 높아도 그 목표까지 간다는 보장은 없어요 — 매매 판단은 직접.' : S.rkKind === 'up' ? '상승 근거 점수 순.' : S.rkKind === 'down' ? '하락 근거 점수 순.' : 'AI 의심 수준(높음→중간→낮음) → 종합 점수 순.'} 근거는 공시·거래 데이터로 자동 계산한 사실이고, AI 문장은 그 사실 번호가 확인된 것만 남깁니다. 새 공시가 나오면 그 종목은 전체 공시·거래량과 함께 자동으로 다시 판단돼 순위·평단·단계가 바뀌어요. 줄을 누르면 그 종목 페이지가 열려요.</p>
      ${S.rkKind === 'pick' && rows && !j.pat?.ok ? '<p class="pk-none">지금 조건을 모두 통과한 종목은 없어요. 억지로 고르지 않는 것도 전략이에요 — 아래는 조건 하나만 부족한 참고 종목이에요.</p>' : ''}      ${rows ? `<ol class="mp-list">${rows}</ol>` : `<p class="muted">${S.rkKind === 'pick' ? '지금은 조건을 모두 통과한 종목도, 하나만 부족한 종목도 없어요. 억지로 고르지 않는 것도 전략이에요 — 새 분석이 끝나면 다시 확인해 보세요.' : S.rkKind === 'pex' ? '털기 후 상승 가능성을 계산한 종목이 아직 없어요 (장 마감 뒤 정기 분석·재확인부터 채워져요).' : S.rkKind === 'ck' ? '체크리스트가 계산된 종목이 아직 없어요 (장 마감 뒤 정기 분석부터 채워져요).' : S.rkKind === 'rr' ? '손익비를 계산할 수 있는 종목이 아직 없어요 (위쪽 목표와 아래쪽 원가·지지 가격이 모두 있어야 해요. 장 마감 뒤 정기 분석부터 채워져요).' : S.rkKind === 'up' ? '지금은 상승 가능성 쪽으로 분류된 종목이 없어요.' : S.rkKind === 'down' ? '지금은 하락 위험 쪽으로 분류된 종목이 없어요.' : '아직 랭킹이 없어요. 첫 정기 분석이 시작되면 약 10분 뒤 채워져요.'}</p>`}
      <p class="note">⚠ '작전 세력의 전형적인 흐름과 비슷하다'는 신호일 뿐 불공정거래의 증거가 아닙니다. 외부에 종목명을 '작전주'로 공개하지 마세요.</p>`;
    applyRkFilter(); setTimeout(radarLive, 300);
    if (S.reopen) { const c = S.reopen; S.reopen = null; const r2 = document.querySelector(`.mp-rk[data-mp-code="${c}"]`); if (r2) openRankRow(r2); }
    } catch (er) { // 한 줄이라도 그리다 오류가 나면 '불러오는 중'에 멈추지 않고 이유를 보여줌
      console.error('작전 레이더 랭킹 그리기 오류', er);
      $('#mpBody').innerHTML = rkKindsHTML() + `<p class="err">랭킹을 그리다 오류가 났어요: ${esc(er.message)} <button class="btn sm" data-mp-rank-refresh>다시 시도</button></p><p class="muted sm">이 화면을 캡처해 보내 주세요 (${esc(String(er.stack || '').split('\n')[1] || '').slice(0, 120)})</p>`;
    }
  }
  async function loadPerf() {
    const box = $('#mpBody'); if (!box) return;
    box.innerHTML = '<div class="loading"><span class="spin"></span>불러오는 중…</div>';
    const seq = (S.mpSeq = (S.mpSeq || 0) + 1);
    let j; try { j = await mpGet(`mp=perf`); } catch (e) { j = { ok: false, error: e.message }; }
    if (!$('#mpBody') || S.mpTab !== 'perf' || seq !== S.mpSeq) return;
    if (!j.ok) { $('#mpBody').innerHTML = `<p class="err">${esc(j.error || '')}</p>`; return; }
    const order = ['전체', '한 줄 결론:🟢 매수 검토', '한 줄 결론:🟡 지켜보기', '한 줄 결론:🔴 피하기', '매매 후보 조건:충족', '매매 후보 조건:미충족', '체크리스트:A등급', '체크리스트:B등급', '체크리스트:C등급', '체크리스트:D등급', '손익비:3 이상', '손익비:2~3', '손익비:2 미만', '분류:상승 가능성', '분류:하락 위험', '분류:분류 없음', '단계:판 깔기', '단계:매집', '단계:띄우기', '단계:털기', '단계:관찰', 'AI 의심:높음', 'AI 의심:중간', 'AI 의심:낮음'];
    const ordIx = (k) => { const i = order.indexOf(k); return i < 0 ? 999 : i; };
    const g = (j.groups || []).filter((r) => !r.g.startsWith('ck:')).sort((a, b) => ordIx(a.g) - ordIx(b.g));
    const CKK = { money: '세력 자금 실제 투입', cost: '평단 근처', acc: '매집 흔적', unlock: '물량 해제 2~3개월 전', rr: '손익비 2↑', small: '소형주', float: '최대주주 지분 40%↑', story: '사업목적 추가', theme: '업종·테마 강세', insider: '내부자 매수', broker: '창구 쏠림', buzz: '기사·종토방 증가' };
    const ckG = Object.fromEntries((j.groups || []).filter((r) => r.g.startsWith('ck:')).map((r) => [r.g, r]));
    const ckRows = Object.keys(CKK).map((k) => { const a = ckG[`ck:${k}:1`], b = ckG[`ck:${k}:0`]; if (!a?.n20 && !b?.n20) return ''; const d = a?.n20 && b?.n20 ? a.win20 - b.win20 : null; return `<tr><td class="t"><b>${esc(CKK[k])}</b></td><td>${a?.n20 ? `${a.win20}% <small>${a.n20}건</small>` : '—'}</td><td>${b?.n20 ? `${b.win20}% <small>${b.n20}건</small>` : '—'}</td><td>${d == null ? '—' : `<b class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}%p</b>${a.n20 >= 30 && b.n20 >= 30 ? ' <small>중요도에 반영</small>' : ' <small>30건씩 쌓이면 반영</small>'}`}</td></tr>`; }).join('');
    const cell = (r, h) => (r['n' + h] ? `<td><b class="${dirCls(r['avg' + h])}">${r['avg' + h] > 0 ? '+' : ''}${r['avg' + h]}%</b><small>오른 비율 ${r['win' + h]}% · +20%↑ ${r['big' + h]}% · −20%↓ ${r['loss' + h]}% · ${r['n' + h]}건</small></td>` : '<td class="muted">아직</td>');
    try { S.pfTab = load('gk_pftab') || 'sim'; } catch {}
    const pt = ['sim', 'day', 'inst', 'find'].includes(S.pfTab) ? S.pfTab : 'sim';
    $('#mpBody').innerHTML = `<div class="pf-tabs">${[['sim', '📈 따라 샀다면'], ['day', '📅 판정일 기준 결과'], ['inst', '🏛 기관식 검증'], ['find', '🔎 종목 검색']].map(([k, t]) => `<button data-pf-tab="${k}" class="${k === pt ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="pf-pane" data-pf="sim" ${pt === 'sim' ? '' : 'hidden'}><div id="simBox"><div class="loading"><span class="spin"></span>불러오는 중…</div></div></div>
      <div class="pf-pane" data-pf="find" ${pt === 'find' ? '' : 'hidden'}><div class="sx"><div class="sx-head"><h4>🔎 성과검증 종목 검색</h4><small class="muted">레이더가 판정했던 종목의 따라 샀다면 기록·판정 기록·AI 해설만 따로</small></div>
        <form class="sf-form" data-sf-form><input class="sf-in" name="q" placeholder="종목 이름 또는 코드 (예: 대원전선, 006340)" autocomplete="off" value="${esc(S.sfQ || '')}"><button class="btn">검색</button></form><div id="sfBox"></div></div></div>
      <div class="pf-pane" data-pf="inst" ${pt === 'inst' ? '' : 'hidden'}><div id="instBox"><div class="loading"><span class="spin"></span>불러오는 중…</div></div></div>
      <div class="pf-pane" data-pf="day" ${pt === 'day' ? '' : 'hidden'}><p class="note">레이더가 그날 판정한 종목이 <b>그 뒤 실제로 몇 % 움직였는지</b> 자동 집계 (판정일 종가 기준 5·20·60거래일 뒤). 기록 ${j.days}일치${j.dup ? ` · 같은 종목·같은 단계 중복 ${fmtInt(j.dup)}건은 처음 판정 1번만 셈 (${fmtInt(j.raw - j.dup)}건 집계)` : ''}${j.days ? '' : ' — 판정 후 5거래일이 지나야 첫 숫자가 나와요'}. 표본이 30건 미만이면 우연일 수 있어요.</p>
      ${ckRows ? `<details class="pb-ck"><summary>✅ 체크리스트 항목별 비교 (눌러서 보기)</summary><h4 style="margin:.8rem 0 .3rem">✅ 체크리스트 항목별 20거래일 뒤 오른 비율 <small class="muted">충족(✓)한 종목 vs 아닌(✗) 종목 · 차이가 클수록 등급 계산에서 그 항목의 중요도가 자동으로 커져요</small></h4><div class="mp-perf"><table class="tbl"><tr><th>항목</th><th>✓ 충족</th><th>✗ 미충족</th><th>차이</th></tr>${ckRows}</table></div></details>` : ''}
      ${g.length ? `<div id="pbPerf"></div>` : '<p class="muted">아직 집계할 기록이 없어요.</p>'}
      <div id="btBox"></div></div>
      <p class="note">📊 <b>월간 규칙 점검</b> — 매달 1일 아침 관리자 텔레그램으로 그룹별 승률과 ⚠ 거꾸로 나온 규칙을 보내요 (표본 30건 미만은 '아직 판단 이름'). <button class="btn sm" data-mp-rulechk>지금 한 번 받기</button> <span class="muted sm" data-mp-rulechk-msg></span></p>
      <p class="note">수집 상태 · 거래소 시장경보·관리종목·거래정지: ${j.warn ? `${j.warn.at ? `${j.warn.n || 0}종목 · ${esc(rel(j.warn.at))}` : '첫 확인 중'}${j.warn.src === 'KIS' ? ' (한국투자증권 기준)' : ''}${j.warn.scan && j.warn.scan.pos < j.warn.scan.of ? ` · 오늘 확인 ${j.warn.scan.pos}/${j.warn.scan.of}` : ''}${j.warn.err ? ` <span class="err">(${esc(j.warn.err)})</span>` : ''}` : '아직'} · 같은 세력 연결 색인: ${j.party ? `${j.party.n}개 이름 · ${esc(rel(j.party.at))}` : '아직'}</p>`;
    if (g.length) { S.pbData = S.pbData || {}; S.pbData.perf = g; renderBoard('perf'); }
    loadBt(); loadSim();
  }
  // ───── v222 📈 따라 샀다면 (단순 화면) ─────
  //  위: 한 줄 요약 · 버튼 3개(보기 / 기록 종류 / 방식) · 줄마다 숫자 1개 크게 + 10칸 점 + 판정 칩 · 나머지는 줄을 눌러 상세
  const SIM_WHY = { stop: '손절선', tgt: '목표가', view: '판정 🔴 전환', time: '60일 정리', halt: '거래정지', trail: '최고점 대비 −15%' };
  try { S.simSrc = load('gk_simsrc') || 'live'; S.simM = load('gk_simm') || 'T'; S.simB = load('gk_simb') || ''; S.simV = load('gk_simv') || 'trade'; S.pkH = +(load('gk_pkh') || 20); S.simNow = !!load('gk_simnow'); S.simX = !!load('gk_simx'); } catch {}
  const simMode = () => (S.simM === 'TR' || S.simM === 'TH' ? S.simM : (S.simB === 'S' ? 'S' : '') + (S.simM === 'U' ? 'U' : 'T'));
  const simBase = () => (S.simSrc === 'bt' ? 'bt' : S.simNow ? 'now' : 'live');
  const simSrcK = () => simBase() + (S.simX ? 'X' : ''); // v222: 시장 대비로 보기
  const ML = { T: '한 번에 사서 · 1차 목표에서 팔기', U: '한 번에 사서 · 끝까지 들고 가기', ST: '3번 나눠 사서 · 1차 목표에서 팔기', SU: '3번 나눠 사서 · 끝까지 들고 가기', TR: '한 번에 사서 · 최고점에서 −15% 빠지면 팔기', TH: '한 번에 사서 · +30%에 절반, 나머지는 최고점 −15%' };
  const VDC = { ok: 'v-ok', good: 'v-good', n: 'v-n', weak: 'v-weak', bad: 'v-bad', base: 'v-base' };
  const vdBadge = (v) => (v ? `<span class="simv ${VDC[v.k] || 'v-n'}">${esc(v.k === 'good' ? '좋아 보임' : v.k === 'weak' ? '나빠 보임' : v.k === 'base' ? '비교 기준' : v.t)}</span>` : '');
  const dots = (pct, n) => { const k = Math.round((pct || 0) / 10); return `<span class="sx-dots" title="${pct}%">${Array.from({ length: 10 }, (_, i) => `<i class="${i < k ? 'on' : ''}"></i>`).join('')}</span>`; };
  async function loadSim() {
    let j; try { j = await mpGet('mp=sim'); } catch (e) { const b = $('#simBox'); if (b) b.innerHTML = `<p class="muted sm">따라 샀다면 성적을 못 불러옴: ${esc(e.message)}</p>`; return; }
    S.simData = j; renderSim();
  }
  function spark(curve) {
    if (!curve || curve.length < 2) return '';
    const ys = curve.map((c) => c[1]), mn = Math.min(0, ...ys), mx = Math.max(0, ...ys), W = 220, H = 48;
    const y = (v) => H - 4 - ((v - mn) / (mx - mn || 1)) * (H - 8), x = (i) => (i / (curve.length - 1)) * W;
    return `<svg class="sim-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="z"/><polyline points="${curve.map((c, i) => `${x(i).toFixed(1)},${y(c[1]).toFixed(1)}`).join(' ')}" class="${ys[ys.length - 1] >= 0 ? 'up' : 'down'}"/></svg>`;
  }
  function icHTML(ic) {
    if (!ic?.factors?.length) return '';
    const rows = ic.factors.map((f) => { const z = f.h?.[20] || {};
      return `<li><b>${esc(f.ko)}</b> ${vdBadge(z.vd || { k: 'n', t: '아직 모름' })} <small class="muted">${z.ic != null ? `상관 ${z.ic > 0 ? '+' : ''}${z.ic} · 점수 위 20%가 아래 20%보다 20일 뒤 ${sgn(z.sp)}p` : '자료 부족'}</small></li>`; }).join('');
    return `<h5>🧮 점수가 높을수록 더 오르나 <small class="muted">매일 레이더 안에서 점수 순위와 20거래일 뒤(시장 대비) 수익 순위를 비교</small></h5><ul class="sx-ul">${rows}</ul>`;
  }
  // 위쪽 버튼
  function simCtl(D, j, inst = false) {
    const peak = !inst && S.simV === 'peak';
    const seg = (attr, list, cur) => `<div class="pb-seg">${list.map(([k, t]) => `<button data-${attr}="${k}" class="${String(k) === String(cur) ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    return `<div class="sx-ctl">${inst ? '' : seg('sim-v', [['trade', '💰 사고팔았다면'], ['peak', '🚀 최고·최저']], peak ? 'peak' : 'trade')}${seg('sim-src', [['live', '실제 기록'], ['bt', '과거 재현']], S.simSrc === 'bt' ? 'bt' : 'live')}
      ${peak ? seg('pk-h', [[5, '5일'], [20, '20일'], [60, '60일'], [120, '120일']], PKH.includes(S.pkH) ? S.pkH : 20)
        : `<select class="sx-sel" data-sim-mode aria-label="사고파는 방식">${Object.entries(ML).map(([k, t]) => `<option value="${k}" ${k === simMode() ? 'selected' : ''}>${t}</option>`).join('')}</select>`}
      ${S.simSrc !== 'bt' ? `<label class="sx-now"><input type="checkbox" data-sim-now ${S.simNow ? 'checked' : ''}> 지금 규칙만</label>` : ''}${peak ? '' : `<label class="sx-now" title="같은 기간 코스피·코스닥이 움직인 만큼을 빼고 봐요 — 시장 급락·급등의 영향 제거"><input type="checkbox" data-sim-x ${S.simX ? 'checked' : ''}> 시장 대비로 보기</label>`}</div>`;
  }
  // 실제 기록이 아직 비었을 때 안내
  function simEmpty(D, src) {
    if (src === 'bt') return '<p class="sx-empty">과거 재현 계산이 아직 안 끝났어요 — 24시간 3분마다 조금씩 채워져요 (레이더 정기 분석 중엔 잠깐 쉼).</p>';
    return `<div class="sx-empty"><b>실제 기록은 지금 쌓이는 중이에요</b> — 오류가 아니에요.<br>레이더가 매일 판정한 기록을 날짜 순서대로 정리하고 있어요 (지금 ${D.days || 0}일치 정리${D.left ? ` · 남은 계산 ${fmtInt(D.left)}종목` : ''}). 산 종목이 손절·목표·60일 중 하나에 닿아야 결과가 생겨서 첫 숫자는 보통 1~3주 뒤에 나와요.<br><button class="btn sm" data-sim-src="bt">과거 재현 먼저 보기</button></div>`;
  }
  const PKH = [5, 20, 60, 120];
  function renderSim() {
    renderInst();
    const box = $('#simBox'), j = S.simData; if (!box || !j) return;
    const src = simSrcK(), D = j[src] || {};
    if (S.simV === 'peak') { box.innerHTML = peakHTML(j[simBase()] || {}, simBase(), j); return; }
    const m = simMode(), G = D.groups || [];
    const has = G.some((x) => x[m]?.n);
    const base = G.find((x) => x.s === 'all')?.[m];
    const list = [...G.filter((x) => x.s === 'all'), ...G.filter((x) => x.s !== 'all')];
    const line = (x) => { const v = x[m], isB = x.s === 'all';
      if (!v) return `<button class="sx-row" data-sim-open="${x.s}"><span class="sx-n">${esc(x.ko)}<small>${x.open ? `진행 중 ${x.open}번` : '아직 없음'}</small></span><span class="sx-big muted">—</span><span class="sx-mid muted sm">끝난 거래가 아직 없어요</span><span></span><span class="pb-go">›</span></button>`;
      const wins = Math.round((v.win / 100) * v.n);
      return `<button class="sx-row${isB ? ' base' : ''}" data-sim-open="${x.s}"><span class="sx-n">${esc(isB ? '레이더 전체 (비교 기준)' : x.ko)}<small>${v.n}번 거래${x.open ? ` · 진행 중 ${x.open}` : ''}</small></span>
        <span class="sx-big ${dirCls(v.avg)}">${sgn(v.avg)}<small>한 번 사고팔 때 평균</small></span>
        <span class="sx-mid"><span class="sx-pct"><b class="${v.win >= 50 ? 'up' : 'down'}">${v.win}%</b> 수익 확률</span>${dots(v.win)}<small>${v.n}번 중 ${wins}번 수익</small></span>
        <span class="sx-vd">${isB ? '<span class="simv v-base">비교 기준</span>' : vdBadge(v.vd)}${!isB && v.vs != null ? `<small>전체보다 <b class="${dirCls(v.vs)}">${v.vs > 0 ? '+' : ''}${v.vs}%p</b></small>` : ''}</span><span class="pb-go">›</span></button>`; };
    // 한 줄 요약
    const sure = G.filter((x) => x.s !== 'all' && x[m]?.vd?.k === 'ok');
    const top = G.filter((x) => x.s !== 'all' && x[m]?.n).sort((a, b) => b[m].n - a[m].n)[0];
    const sum = !has ? '' : sure.length ? `✅ <b>${sure.map((x) => esc(x.ko)).join(', ')}</b>는 레이더 전체보다 확실히 나아요.` : `아직 확실한 신호는 없어요 — 우연인지 가리려면 신호마다 거래가 30번 넘게 쌓여야 해요${top ? ` (가장 많은 ${esc(top.ko)} ${top[m].n}번)` : ''}.`;
    box.innerHTML = `<div class="sx"><div class="sx-head"><h4>📈 따라 샀다면</h4><small class="muted">신호가 뜬 다음 날 시가에 샀다면 · 비용 0.5% 뺌</small></div>
      ${simCtl(D, j)}
      ${has ? `<p class="sx-sum">${sum}</p><div class="sx-list">${list.map(line).join('')}</div>` : simEmpty(D, src)}
      ${(j.gap || []).filter((g) => g.d <= -5).length && src !== 'bt' ? `<p class="err sm">⚠ 실제 기록이 과거 재현보다 많이 나빠요 — 규칙이 과거에만 맞았을 수 있어요</p>` : ''}
      <details class="sx-more"><summary>ⓘ 보는 법</summary><ul class="sx-ul"><li><b>판정 칩</b>: ✅ 효과 있음 = 거래 30번↑에서 앞·뒤 기간 모두 레이더 전체보다 확실히 나음 · 좋아 보임 = 확인 중 · 아직 모름 = 우연과 구별 안 됨</li><li><b>점 10칸</b> = 수익으로 끝난 거래 비율 (한 칸 = 10%)</li><li>같은 신호가 10거래일 안에 또 떠도 1번만 셈 · 산 게 끝나기 전엔 또 안 삼 → 같은 종목 겹쳐 세지 않음</li><li>팔기: 손절선 → 1차 목표(고른 방식일 때) → 판정이 🔴로 바뀌면 다음 날 → 60거래일 · 다음 날 시가가 +25%↑(상한가 근처)면 못 산 걸로 침</li><li>줄을 누르면 앞·뒤 기간, 계좌로 했다면, 운 나쁜 경우, 손절·목표를 바꿨다면, 종목별 거래와 AI 해설이 나와요</li></ul></details>
      ${has ? `<details class="sx-more"><summary>🔬 더 깊은 분석 (점수 검증·조건별 효과)</summary>${icHTML(D.ic)}${condsHTML(D)}</details>` : ''}</div>`;
  }
  function condsHTML(D) {
    const sure = (D.conds || []).filter((c) => c.vd?.k === 'ok' || c.vd?.k === 'bad');
    const ck = (c) => `<li><b>${esc(c.ko)}: ${esc(c.k === 'vd' ? ({ g: '🟢 매수 검토', y: '🟡 지켜보기', r: '🔴 피하기' }[c.v] || c.v) : c.v)}</b> <span class="${dirCls(c.diff)}">${c.diff > 0 ? '+' : ''}${c.diff}%p</span> <small class="muted">${c.n}번</small></li>`;
    return `<h5>🔬 성과를 확실히 올리거나 깎는 조건 <small class="muted">그 조건일 때 − 아닐 때</small></h5>${sure.length ? `<ul class="sx-ul">${sure.map(ck).join('')}</ul>` : '<p class="muted sm">아직 확실한 조건이 없어요.</p>'}`;
  }
  // 🚀 최고·최저 기록
  function peakHTML(D, src, j) {
    const h = PKH.includes(S.pkH) ? S.pkH : 20;
    const G = D.peak?.[h] || [];
    const has = G.some((x) => x.n);
    const list = [...G.filter((x) => x.s === 'all'), ...G.filter((x) => x.s !== 'all')];
    const line = (x) => { const isB = x.s === 'all';
      if (!x.n) return `<button class="sx-row" data-sim-open="${x.s}"><span class="sx-n">${esc(x.ko)}<small>아직 없음</small></span><span class="sx-big muted">—</span><span class="sx-mid muted sm">${h}거래일이 지난 매수가 아직 없어요</span><span></span><span class="pb-go">›</span></button>`;
      const n20 = Math.round((x.up[1] / 100) * x.n);
      return `<button class="sx-row${isB ? ' base' : ''}" data-sim-open="${x.s}"><span class="sx-n">${esc(isB ? '레이더 전체 (비교 기준)' : x.ko)}<small>${x.n}번 매수</small></span>
        <span class="sx-big up">${sgn(x.mu)}<small>절반이 이만큼 이상 오름</small><small>평균 ${sgn(x.au)}</small></span>
        <span class="sx-mid"><span class="sx-pct"><b class="${x.up[1] >= 30 ? 'up' : ''}">${x.up[1]}%</b> 확률로 +20%↑</span>${dots(x.up[1])}<small>${x.n}번 중 ${n20}번 · +10%↑ ${x.up[0]}% · +30%↑ ${x.up[2]}%</small></span>
        <span class="sx-vd"><b class="down">${sgn(x.md)}</b><small>오르기 전 절반이 이만큼까지 빠짐</small></span><span class="pb-go">›</span></button>`; };
    return `<div class="sx"><div class="sx-head"><h4>📈 따라 샀다면</h4><small class="muted">산 날(신호 다음 날 시가)부터 ${h}거래일 안에 최고 얼마까지 올랐나 — 손절·매도 상관없이</small></div>
      ${simCtl(D, j)}
      ${has ? `<div class="sx-list">${list.map(line).join('')}</div>` : simEmpty(D, src)}
      <details class="sx-more"><summary>ⓘ 보는 법</summary><ul class="sx-ul"><li><b>큰 숫자</b> = 산 날부터 ${h}거래일 안에 가장 높이 오른 지점을 매수마다 하나씩 구해 줄 세웠을 때 딱 가운데 값 → '절반이 이만큼 이상 올랐다'는 뜻 (평균은 한두 종목이 크게 튀면 왜곡돼서 작게만 표시)</li><li><b>점 10칸</b> = +20% 넘게 오른 적이 있는 매수 비율</li><li><b>오르기 전 최저</b> = 그 최고점이 나오기 <b>전에</b> 가장 많이 빠졌던 폭 (올랐다가 내린 건 안 셈) · 이것도 가운데 값</li><li>줄을 누르면 +10%·+30%·+50%·+100% 찍은 비율과 종목별 기록이 나와요</li></ul></details></div>`;
  }
  // ── 상세 창 ──
  const coName = (t) => `<span class="ca-co sx-co" data-mp-go="${esc(t.c)}" data-pbm-close-go>${logoHTML('KR', t.c, t.n || t.c, 'sm')}<b>${esc(t.n || t.c)}</b></span>`;
  const aiLine = (t) => (t.ai ? `<p class="sx-ai">🤖 ${esc(t.ai)}</p>` : '');
  function openModal(html) { let m = $('#pbModal'); if (!m) { m = document.createElement('div'); m.id = 'pbModal'; document.body.appendChild(m); } m.dataset.src = ''; m.dataset.g = ''; m.innerHTML = html; m.hidden = false; document.body.classList.add('pbm-open'); }
  function simModal(src, s, rows, gai) {
    const m0 = simMode();
    const D = S.simData?.[src] || {}, x = (D.groups || []).find((z) => z.s === s) || {}, v = x[m0];
    const GS = D.gridS || [7, 10, 15, 'c'], GT = D.gridT || [15, 30, 't', 0];
    const res = (z) => (z ? `<b class="${dirCls(z.r)}">${sgn(Math.round(z.r * 10) / 10)}</b><small>${esc(SIM_WHY[z.w] || z.w)}에서 팖 · ${z.h}일 보유</small>` : '<span class="muted">아직 들고 있음</span>');
    const grid = x.grid ? `<table class="sim-grid"><tr><th></th>${GT.map((t) => `<th>${t === 't' ? '1차 목표' : t ? '+' + t + '%' : '끝까지'}</th>`).join('')}</tr>${GS.map((sv, si) => `<tr><th>${sv === 'c' ? '세력 원가' : '−' + sv + '%'}</th>${GT.map((_, ti) => { const gi = si * 4 + ti, c = x.grid[gi]; return `<td class="${x.best?.gi === gi ? 'best' : ''}${gi === 14 ? ' cur' : ''}">${c?.[0] != null ? `<b class="${dirCls(c[0])}">${sgn(c[0])}</b>` : '—'}</td>`; }).join('')}</tr>`).join('')}</table>` : '';
    const tile = (k, val, cls, sub) => `<div class="sx-t"><em>${k}</em><b class="${cls || ''}">${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const card = v ? `${gai ? `<div class="sx-gai">🤖 <b>AI 정리</b><p>${esc(gai)}</p></div>` : ''}
      <div class="sx-tiles">${tile('판정', vdBadge(v.vd), '', v.vd?.why || (v.need ? `확실해지려면 약 ${fmtInt(v.need)}번` : ''))}${tile('한 번 평균', sgn(v.avg), dirCls(v.avg), `범위 ${sgn(v.lo)} ~ ${sgn(v.hi)}`)}${tile('수익 / 손실 평균', `<span class="up">${sgn(v.aw)}</span> / <span class="down">${sgn(v.al)}</span>`, '', `${v.n}번 중 ${Math.round((v.win / 100) * v.n)}번 수익`)}${tile('앞 기간 → 뒤 기간', `${sgn(v.half?.a)} → ${sgn(v.half?.z)}`, '', '두 기간 모두 좋아야 진짜')}${tile('시장 대비', sgn(v.ex), dirCls(v.ex), `평균 ${v.h}일 보유`)}${tile('비용 2배면', sgn(v.c1), dirCls(v.c1), '체결이 나빠도 남나')}</div>
      ${v.eq ? `<div class="sx-eq"><div>${tile('계좌로 했다면', sgn(v.eq.tot), dirCls(v.eq.tot), `동시에 5종목·20%씩 · 최대 낙폭 ${sgn(v.eq.mdd)}`)}${v.mc ? tile('운 나쁜 경우 (하위 5%)', sgn(v.mc.p5), dirCls(v.mc.p5), `손실로 끝날 확률 ${v.mc.loss}%`) : ''}</div>${spark(v.eq.curve)}</div>` : ''}
      <details class="sx-more"><summary>손절·목표를 바꿨다면 ${x.best ? `<small class="muted">· 과최적화 확률 ${x.pbo ?? '-'}%</small>` : ''}</summary>${grid}
      ${x.best ? `<p class="sm">가장 좋았던 <b>${esc(x.best.name)}</b> — 앞 기간 ${sgn(x.best.train)} → 안 본 뒤 기간 <b>${sgn(x.best.test)}</b> (지금 규칙 ${sgn(x.best.baseTest)}) ${x.best.test > x.best.baseTest && x.best.testN >= 20 && (x.pbo ?? 100) < 50 ? '<b class="up">→ 바꿀 만함</b>' : '<span class="muted">→ 아직 바꿀 근거 부족</span>'}</p>` : '<p class="muted sm">거래가 더 쌓이면 가장 좋은 손절·목표를 찾아 안 본 기간으로 검증해요.</p>'}</details>` : '';
    openModal(`<div class="pbm-back" data-pbm-close></div><div class="pbm" role="dialog" aria-label="거래 목록">
      <div class="pbm-head"><div><b>${esc(x.ko || s)}</b> <small class="muted">${src === 'bt' ? '과거 재현' : src === 'now' ? '지금 규칙만' : '실제 기록'} · ${ML[m0]}</small></div><button class="pbm-x" data-pbm-close aria-label="닫기">✕</button></div>
      <div class="pbm-list">${card}<h5 class="sx-h5">종목별 거래 ${rows.length}번 <small class="muted">끝난 거래 먼저 · 최근에 판 순</small></h5>${rows.length ? [...rows].sort((p1, p2) => (p1[m0] ? 0 : 1) - (p2[m0] ? 0 : 1) || String(p2[m0]?.xd || p2.d).localeCompare(String(p1[m0]?.xd || p1.d))).map((t) => `<div class="sx-tr"><div class="sx-tr1">${coName(t)}<span class="sx-res">${res(t[m0])}</span></div><small class="muted">${esc(t.d)} 신호 → 다음 날 ${fmtInt(t.e)}원에 삼 · 60일 안 최고 ${sgn(t.mf)} / 최저 ${sgn(t.ma)}</small>${aiLine(t)}</div>`).join('') : '<p class="muted sm">아직 거래가 없어요</p>'}</div></div>`);
  }
  function peakModal(src, s, rows) {
    const h = PKH.includes(S.pkH) ? S.pkH : 20, hi = PKH.indexOf(h);
    const D = S.simData?.[src] || {}, x = (D.peak?.[h] || []).find((z) => z.s === s) || {};
    const L = rows.filter((t) => t.pk?.[hi]).sort((a, b) => b.pk[hi][0] - a.pk[hi][0]);
    const reach = x.n ? `<div class="sx-reach">${[10, 20, 30, 50, 100].map((v, i) => `<div><b>${x.up[i]}%</b><i style="height:${Math.max(3, Math.round(x.up[i] * 0.5))}px"></i><small>+${v}%↑</small></div>`).join('')}</div>
      <div class="sx-tiles">${[['절반이 이만큼 이상 오름', sgn(x.mu), 'up', `평균 ${sgn(x.au)} · 가장 많이 ${sgn(x.best)}`], ['최고점까지', `${x.days}일`, '', '절반이 이 안에 최고점'], ['오르기 전 절반이 이만큼까지 빠짐', sgn(x.md), 'down', `−10%↓ ${x.dn[1]}% · −20%↓ ${x.dn[2]}%`], ['실패', `${x.flop}%`, 'down', '+10%도 못 가고 −10%↓']].map(([k, v, c, sub]) => `<div class="sx-t"><em>${k}</em><b class="${c}">${v}</b><small>${sub}</small></div>`).join('')}</div>` : '';
    openModal(`<div class="pbm-back" data-pbm-close></div><div class="pbm" role="dialog" aria-label="최고·최저 기록">
      <div class="pbm-head"><div><b>${esc(x.ko || s)}</b> <small class="muted">${h}거래일 안 최고·최저 · 많이 오른 순</small></div><button class="pbm-x" data-pbm-close aria-label="닫기">✕</button></div>
      <div class="pbm-list">${reach}<h5 class="sx-h5">종목별 ${L.length}번${rows.length - L.length ? ` <small class="muted">(${h}일 안 지난 ${rows.length - L.length}번 제외)</small>` : ''}</h5>${L.length ? L.map((t) => { const [u, d, dd, pd] = t.pk[hi]; return `<div class="sx-tr"><div class="sx-tr1">${coName(t)}<span class="sx-res"><b class="up">${sgn(u)}</b><small>${esc(pd)} · ${dd}일째 최고</small></span><span class="sx-res"><b class="down">${sgn(d)}</b><small>오르기 전 최저</small></span></div><small class="muted">${esc(t.d)} 신호 → 다음 날 ${fmtInt(t.e)}원에 삼</small>${aiLine(t)}</div>`; }).join('') : '<p class="muted sm">아직 기록이 없어요</p>'}</div></div>`);
  }
  document.addEventListener('click', (ev) => { const b = ev.target.closest?.('[data-pf-tab]'); if (!b) return; S.pfTab = b.dataset.pfTab; save('gk_pftab', S.pfTab); document.querySelectorAll('[data-pf-tab]').forEach((x) => x.classList.toggle('on', x === b)); document.querySelectorAll('.pf-pane').forEach((x) => { x.hidden = x.dataset.pf !== S.pfTab; }); });
  // 🏛 기관식 검증 탭: 헤지펀드·운용사가 백테스트를 믿을지 판단할 때 보는 것들을 한 화면에
  // 🧠 데이터로 다시 배운 기준 (앞 기간에서 배우고 안 본 뒤 기간에서 확인)
  function learnHTML(L) {
    if (!L) return '';
    if (L.need) return `<div class="in-card"><h5>🧠 데이터로 다시 배운 기준</h5><p class="muted sm">거래가 ${L.need}번 넘게 쌓이면 시작해요 (지금 ${L.n || 0}번).</p></div>`;
    const li = (x) => `<li>${esc(x.ko)}: <b>${esc(x.v)}</b> <span class="${dirCls(x.w)}">${x.w > 0 ? '+' : ''}${x.w}%p</span></li>`;
    return `<div class="in-card"><h5>🧠 데이터로 다시 배운 기준 <small class="muted">앞 기간(${L.train}번, ~${esc(L.cut)})에서 '어떤 조건이 성적을 올리고 깎았나'를 배우고, 그 점수로 안 본 뒤 기간(${L.test}번)을 줄 세워 확인 · 한 번에 사서 1차 목표 팔기 기준</small></h5>
      <div class="sx-tiles">${[['안 본 기간 점수 위 1/3', sgn(L.topAvg), dirCls(L.topAvg)], ['점수 아래 1/3', sgn(L.botAvg), dirCls(L.botAvg)], ['차이', `${L.diff > 0 ? '+' : ''}${L.diff}%p`, dirCls(L.diff)]].map(([k, v, c]) => `<div class="sx-t"><em>${k}</em><b class="${c}">${v}</b></div>`).join('')}</div>
      <p class="sm">${vdBadge(L.vd)} ${L.vd?.k === 'ok' ? '배운 기준이 안 본 기간에서도 통했어요 — 🟢 기준을 이 점수로 바꿀 근거가 생겼어요.' : '아직 안 본 기간에서 확실히 통한다고 말할 수 없어요 — 거래가 더 쌓이면 다시 확인해요.'} <span class="muted">(순위 상관 ${L.ic ?? '-'})</span></p>
      <div class="lr-2"><div><b class="up sm">성적을 올린 조건</b><ul class="sx-ul">${(L.plus || []).map(li).join('') || '<li class="muted">없음</li>'}</ul></div><div><b class="down sm">성적을 깎은 조건</b><ul class="sx-ul">${(L.minus || []).map(li).join('') || '<li class="muted">없음</li>'}</ul></div></div></div>`;
  }
  function renderInst() {
    const box = $('#instBox'), j = S.simData; if (!box || !j) return;
    const src = simSrcK(), D = j[src] || {}, m = simMode(), G = (D.groups || []).filter((x) => x.s !== 'all');
    const base = (D.groups || []).find((x) => x.s === 'all')?.[m];
    const cell = (k, v, cls, sub) => `<div class="in-c"><em>${k}</em><b class="${cls || ''}">${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const card = (x) => { const v = x[m]; if (!v) return `<div class="in-card"><div class="in-h"><b>${esc(x.ko)}</b><span class="muted sm">끝난 거래가 아직 없어요</span></div></div>`;
      const pass = [v.vd?.k === 'ok', v.half && v.half.a > 0 && v.half.z > 0, v.c1 > 0, v.mc && v.mc.p5 > 0, x.pbo != null && x.pbo < 50, v.n >= 30];
      return `<div class="in-card"><div class="in-h"><b>${esc(x.ko)}</b>${vdBadge(v.vd)}<span class="in-pass">통과 <b>${pass.filter(Boolean).length}</b>/6</span></div>
        <div class="in-grid">${cell('① 거래 수', `${v.n}번`, v.n >= 30 ? 'up' : '', v.n >= 30 ? '30번↑ 충분' : `30번 필요 (${30 - v.n}번 더)`)}
        ${cell('② 레이더 전체보다', v.vs != null ? `${v.vs > 0 ? '+' : ''}${v.vs}%p` : '-', dirCls(v.vs), v.vd?.p != null ? `나을 확률 ${v.vd.p}%` : '')}
        ${cell('③ 앞 → 뒤 기간', `${sgn(v.half?.a)} → ${sgn(v.half?.z)}`, v.half?.a > 0 && v.half?.z > 0 ? 'up' : '', '두 기간 모두 +여야')}
        ${cell('④ 비용 2배면', sgn(v.c1), dirCls(v.c1), '체결 나빠도 남나')}
        ${cell('⑤ 운 나쁜 경우', v.mc ? sgn(v.mc.p5) : '-', dirCls(v.mc?.p5), v.mc ? `하위 5% · 손실 확률 ${v.mc.loss}%` : '거래 20번↑부터')}
        ${cell('⑥ 과최적화 확률', x.pbo != null ? x.pbo + '%' : '-', x.pbo == null ? '' : x.pbo < 50 ? 'up' : 'down', x.pbo != null ? (x.pbo < 50 ? '고른 손절·목표가 통함' : '우연일 가능성') : '거래 80번↑부터')}</div></div>`; };
    box.innerHTML = `<div class="sx"><div class="sx-head"><h4>🏛 기관식 검증</h4><small class="muted">헤지펀드·운용사가 '이 전략을 믿어도 되나'를 판단할 때 보는 6가지 · ${esc(ML[m])}</small></div>
      ${simCtl(D, j, true)}
      ${base ? `<p class="sx-sum">비교 기준(레이더 전체): 한 번 평균 <b class="${dirCls(base.avg)}">${sgn(base.avg)}</b> · 수익 확률 <b>${base.win}%</b> · ${base.n}번</p>` : ''}
      ${G.length ? G.map(card).join('') : simEmpty(D, src)}
      ${learnHTML(D.learn)}
      <div class="in-card">${icHTML(D.ic) || '<p class="muted sm">점수 검증은 판정 기록이 더 쌓이면 나와요.</p>'}</div>
      <div class="in-card">${condsHTML(D)}</div>
      ${D.capStudy?.some((x) => x.n) ? `<div class="in-card"><h5>📏 시가총액별 성적 <small class="muted">세력주를 몇 억까지로 볼지 데이터로 정하기 · 판정 그날 시가총액 · 레이더 전체 · 지금 기준 ${fmtInt(j.capMax)}억 미만만 성적에 넣음</small></h5><div class="cap-grid">${D.capStudy.map((x) => `<div class="cap-r${x.n ? '' : ' muted'}"><b>${esc(x.ko)}</b><span>${x.n ? `${x.n}번` : '없음'}</span><span class="${dirCls(x.avg)}">${x.n ? '한 번 ' + sgn(x.avg) : ''}</span><span>${x.up != null ? `60일 최고 ${sgn(x.up)}` : ''}</span><span>${x.r20 != null ? `+20%↑ ${x.r20}%` : ''}</span></div>`).join('')}</div><p class="muted sm">구간마다 거래가 30번 넘게 쌓이면, 성적이 확 떨어지기 시작하는 시가총액이 '세력주 상한'이에요. 그 숫자로 기준을 바꿀 수 있어요 (Cloudflare 변수 RADAR_CAP_MAX).</p></div>` : ''}
      <details class="sx-more"><summary>ⓘ 6가지 검증이 뭔가요</summary><ul class="sx-ul">
        <li><b>① 거래 수</b> — 30번 미만이면 동전 던지기와 구별이 안 돼요.</li>
        <li><b>② 레이더 전체보다</b> — 레이더에 오른 종목을 아무거나 샀을 때보다 나은지. 같은 주에 산 거래는 한 묶음으로 보고 수백 번 다시 뽑아 '나을 확률'을 계산해요 (붓스트랩).</li>
        <li><b>③ 앞 → 뒤 기간</b> — 기간을 둘로 나눠 두 번 다 좋아야 해요. 한쪽만 좋으면 그 시기 장세 덕일 수 있어요 (표본 외 검증).</li>
        <li><b>④ 비용 2배</b> — 수수료·체결 차이를 1%로 잡아도 남는지 (비용 스트레스 테스트).</li>
        <li><b>⑤ 운 나쁜 경우</b> — 같은 거래들을 무작위 순서로 500번 다시 이어 붙였을 때 하위 5% 결과 (몬테카를로).</li>
        <li><b>⑥ 과최적화 확률</b> — 손절·목표를 과거에 맞춰 고르면 생기는 착시. 기간을 70가지로 나눠 고른 규칙이 안 본 기간에서도 통하는지 (PBO). 50% 넘으면 우연.</li>
        <li><b>🧮 점수 검증</b> — 점수가 높은 종목일수록 실제로 더 올랐는지 순위 상관(IC)으로 봐요. 운용사가 점수(팩터)를 쓸지 정할 때 쓰는 방법이에요.</li>
        <li>모든 계산은 판정 그날까지의 자료만 써요 (미래 자료 안 씀) · 같은 종목 겹쳐 세지 않음 · 상한가로 못 사는 날은 뺌.</li></ul></details></div>`;
  }
  // 🔎 성과검증 종목 검색
  async function sfSearch(q) {
    S.sfQ = q; const box = $('#sfBox'); if (!box) return;
    if (!q.trim()) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="loading"><span class="spin"></span>찾는 중…</div>';
    let j; try { j = await mpGet(`mp=simstock&q=${encodeURIComponent(q.trim())}`); } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    if (!$('#sfBox') || S.sfQ !== q) return;
    if (j.matches) { box.innerHTML = j.matches.length ? `<p class="muted sm">${j.matches.length}개 찾음 — 눌러서 보기</p><div class="sf-list">${j.matches.map((x) => `<button class="sf-m" data-sf-pick="${esc(x.c)}">${logoHTML('KR', x.c, x.n, 'sm')}<span><b>${esc(x.n)}</b><small>${esc(x.c)} · 실제 기록 ${x.live}번 · 과거 재현 ${x.bt}번</small></span></button>`).join('')}</div>` : '<p class="sx-empty">성과검증 기록에 없는 종목이에요. 레이더가 판정한 적이 있는 종목만 나와요 (과거 재현은 판 깔기 공시가 있던 종목).</p>'; return; }
    const m0 = simMode(), SG = j.sigs || {};
    const res = (z) => (z ? `<b class="${dirCls(z.r)}">${sgn(Math.round(z.r * 10) / 10)}</b><small>${esc(SIM_WHY[z.w] || z.w)}에서 팖 · ${esc(z.xd)} · ${z.h}일</small>` : '<span class="muted">아직 들고 있음</span>');
    const pkTxt = (t, hi, lb) => (t.pk?.[hi] ? `<span class="sf-pk">${lb} 최고 <b class="up">${sgn(t.pk[hi][0])}</b> <small>(오르기 전 ${sgn(t.pk[hi][1])})</small></span>` : '');
    const card = (t) => `<div class="sx-tr"><div class="sx-tr1"><span class="sf-d"><b>${esc(t.d)}</b> 신호 → 다음 날 ${fmtInt(t.e)}원</span><span class="sx-res">${res(t[m0])}</span></div>
      <div class="sf-sig">${t.sigs.map((k) => `<span class="sf-chip">${esc(SG[k] || k)}</span>`).join('')}</div>
      <div class="sf-pks">${pkTxt(t, 1, '20일')}${pkTxt(t, 2, '60일')}${pkTxt(t, 3, '120일')}<span class="muted sm">손절 ${fmtInt(t.sp)} · 목표 ${fmtInt(t.tp)}</span></div>${aiLine(t)}</div>`;
    const VK = { g: '🟢', y: '🟡', r: '🔴' };
    box.innerHTML = `<div class="sf-head">${logoHTML('KR', j.c, j.n, 'md')}<div><b>${esc(j.n)}</b> <small class="muted">${esc(j.c)}</small><br><button class="link" data-mp-go="${esc(j.c)}">작전 레이더 종목 페이지 열기 ›</button></div><span class="muted sm" style="margin-left:auto">결과 기준: ${esc(ML[m0])}</span></div>
      <h5 class="sx-h5">📈 실제 기록 ${j.live.length}번 매수</h5>${j.live.length ? j.live.map(card).join('') : '<p class="muted sm">실제 기록 매수가 아직 없어요.</p>'}
      <h5 class="sx-h5">🧪 과거 재현 ${j.bt.length}번 매수 <small class="muted">지금 규칙으로 지난 8개월을 다시 판정한 것</small></h5>${j.bt.length ? j.bt.map(card).join('') : '<p class="muted sm">과거 재현 기록이 없어요.</p>'}
      ${j.judg?.length ? `<details class="sx-more"><summary>📅 레이더 판정 기록 ${j.judg.length}일 (최근 순)</summary><div class="sf-judg">${j.judg.map((x) => `<span class="sf-j${x.bad ? ' bad' : ''}"><b>${esc(x.d.slice(5))}</b> ${x.vd ? VK[x.vd] || '' : ''} ${esc(x.st || '')}${x.ck ? ' · ' + esc(x.ck) : ''}</span>`).join('')}</div></details>` : ''}`;
  }
  document.addEventListener('submit', (ev) => { const f = ev.target.closest?.('[data-sf-form]'); if (!f) return; ev.preventDefault(); sfSearch(f.q.value); });
  document.addEventListener('click', (ev) => { const b = ev.target.closest?.('[data-sf-pick]'); if (!b) return; const i = document.querySelector('.sf-in'); if (i) i.value = b.dataset.sfPick; sfSearch(b.dataset.sfPick); });
  const simCache = new Map();
  document.addEventListener('change', (ev) => {
    const sel = ev.target.closest?.('[data-sim-mode]'); if (sel) { const v = sel.value; if (v === 'TR' || v === 'TH') { S.simM = v; S.simB = ''; } else { S.simB = v.startsWith('S') ? 'S' : ''; S.simM = v.endsWith('U') ? 'U' : 'T'; } save('gk_simb', S.simB); save('gk_simm', S.simM); renderSim(); return; }
    const sx = ev.target.closest?.('[data-sim-x]'); if (sx) { S.simX = sx.checked; save('gk_simx', S.simX); renderSim(); return; }
    const nw = ev.target.closest?.('[data-sim-now]'); if (nw) { S.simNow = nw.checked; save('gk_simnow', S.simNow); renderSim(); }
  });
  document.addEventListener('click', async (ev) => {
    const a = ev.target.closest?.('[data-sim-src]'); if (a) { S.simSrc = a.dataset.simSrc; save('gk_simsrc', S.simSrc); renderSim(); return; }
    const vv = ev.target.closest?.('[data-sim-v]'); if (vv) { S.simV = vv.dataset.simV; save('gk_simv', S.simV); renderSim(); return; }
    const ph = ev.target.closest?.('[data-pk-h]'); if (ph) { S.pkH = +ph.dataset.pkH; save('gk_pkh', S.pkH); renderSim(); return; }
    const r = ev.target.closest?.('[data-sim-open]'); if (!r) return;
    const src = simSrcK(), s = r.dataset.simOpen, k = src + '|' + s;
    if (!history.state?.pbm) history.pushState({ ...(history.state || {}), pbm: 1 }, '');
    const show = (c) => (S.simV === 'peak' ? peakModal(src, s, c?.rows || []) : simModal(src, s, c?.rows || [], c?.gai));
    show(simCache.get(k));
    if (!simCache.has(k)) { const L = $('#pbModal .pbm-list'); if (L) L.insertAdjacentHTML('beforeend', '<div class="loading"><span class="spin"></span>종목 불러오는 중…</div>');
      try { const j = await mpGet(`mp=simrows&src=${simBase()}&s=${encodeURIComponent(s)}`); simCache.set(k, { rows: j.rows || [], gai: j.gai || null }); } catch { simCache.set(k, { rows: [] }); }
      const mm = $('#pbModal'); if (mm && !mm.hidden) show(simCache.get(k)); }
  });
  // v218 성적표 칸: 진입 = 판정 다음 날 시가 · 기간 안 최고/최저(중앙값·평균) · N일째 종가(수수료 뺌)·시장 대비 · 먼저 닿은 쪽
  const sgn = (v) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v}%`);
  const WHY_KO = { 'f:conv': '전환청구(물량)', 'f:sell': '대주주 지분 매도', 'f:pledge': '담보·반대매매', 'f:fail': '증자·사채 철회·연기', 'f:risk': '위험 공시', 'f:tsell': '자사주 처분', 'f:dil': '추가 증자·CB', 'f:mkt': '시장 급락', 'f:gap': '추격 매수(갭 +10%↑)', 'f:shake': '흔들기(손절 뒤 반등)', 'f:stop': '거래정지·상폐', 'f:drift': '이유 없이 흘러내림', 's:news': '재료 공시', 's:bonus': '무상증자', 's:setup': '추가 판 깔기', 's:hot': '조회공시·시황 급변', 's:mkt': '시장 상승', 's:vol': '거래량 폭증', 's:plain': '공시 없이 수급' };
  const whyTxt = (L) => (L || []).map(([k, p]) => `${WHY_KO[k] || k} ${p}%`).join(' · ');
  function perfCell(r, h) {
    if (!r['n' + h]) return '<td class="muted">아직</td>';
    const mu = r['mu' + h], up = r['up' + h];
    return `<td><b class="${dirCls(mu ?? up ?? r['avg' + h])}">${up != null ? `최고 ${mu != null ? `중앙 ${sgn(mu)}` : sgn(up)}` : sgn(r['avg' + h])}</b><small>${up != null ? `기간 안 최고 평균 ${sgn(up)} · +20% 찍음 <b>${r['hu' + h]}%</b><br>최저 평균 ${sgn(r['dn' + h])} · −15% 찍음 ${r['hd' + h]}%<br>` : ''}${h}일째 ${r['mr' + h] != null ? `중앙 ${sgn(r['mr' + h])} · ` : ''}평균 ${sgn(r['avg' + h])}${r['ax' + h] != null ? ` · 시장 대비 ${sgn(r['ax' + h])}` : ''} · ${r['n' + h]}건${r['n' + h] < 30 ? ' (적음)' : ''}</small></td>`;
  }
  function ftCell(r) {
    if (!r.ftn) return '<td class="muted">아직</td>';
    return `<td><b class="${r.ftw >= r.ftl ? 'up' : 'down'}">${r.ftw}% : ${r.ftl}%</b><small>+20% 먼저 : −10% 먼저 · ${r.ftn}건${r.ftn < 30 ? ' (적음)' : ''}${r.ftd ? ` · +20%까지 평균 ${r.ftd}거래일` : ''}${r.stp ? ` · 거래 끊김 ${r.stp}건(손절로 셈)` : ''}${r.f2n ? `<br>종목별 1차 목표 먼저 ${r.f2w}% : 손절선 먼저 ${r.f2l}% (${r.f2n}건)` : ''}${r.gap != null ? `<br>다음 날 시가 갭 평균 ${sgn(r.gap)}` : ''}${r.whyW?.length ? `<br><span class="up">성공 이유</span> ${esc(whyTxt(r.whyW))}` : ''}${r.whyL?.length ? `<br><span class="down">실패 이유</span> ${esc(whyTxt(r.whyL))}` : ''}</small></td>`;
  }
  const grpName = (r, src, dflt) => `<td class="t"><button class="pg-open" data-pg="${esc(r.g)}" data-src="${src}" title="이 구분에 들어간 종목 보기"><b>${esc(r.g.replace(/^[^:]+:/, ''))}</b><small>${esc(r.g.includes(':') ? r.g.split(':')[0] : dflt)} · 종목 보기 ▾</small></button></td>`;
  const VDK = { g: '🟢', y: '🟡', r: '🔴' };
  function grpRowsHTML(rows, sort) {
    const key = { up: (x) => -(x.u20 ?? x.u5 ?? -999), down: (x) => (x.d20 ?? x.d5 ?? 999), new: (x) => -Date.parse(x.d) }[sort] || ((x) => -(x.u20 ?? -999));
    const L = [...rows].sort((a, b) => key(a) - key(b));
    const ft = (x) => (x.ft === 'w' ? '<b class="up">+20% 먼저</b>' : x.ft === 'l' ? `<b class="down">−10% 먼저${x.stop ? '(거래 끊김)' : ''}</b>` : x.ft === 'n' ? '둘 다 안 닿음' : '<span class="muted">진행 중</span>');
    return `<div class="pg-sort">정렬 <button data-pg-sort="up" class="${sort === 'up' ? 'on' : ''}">20일 안 최고 높은 순</button><button data-pg-sort="down" class="${sort === 'down' ? 'on' : ''}">최저 낮은 순</button><button data-pg-sort="new" class="${sort === 'new' ? 'on' : ''}">최근 판정 순</button> <span class="muted sm">${L.length}건 · 진입 = 판정 다음 날 시가</span></div>
      <div class="pg-wrap"><table class="tbl pg-tbl"><tr><th>종목</th><th>판정일</th><th>판정</th><th>갭</th><th>20일 안 최고 / 최저</th><th>20일째 (시장 대비)</th><th>먼저 닿은 쪽 · 이유</th><th>60일 안 최고</th><th>120일 안 최고</th></tr>
      ${L.map((x) => `<tr><td><span class="ca-co" data-mp-go="${esc(x.c)}"><b>${esc(x.n || x.c)}</b></span></td><td>${esc(x.d)}</td><td class="sm">${x.vd ? VDK[x.vd] + ' ' : ''}${esc(x.st || '')}${x.ck ? ' · ' + esc(x.ck) : ''}${x.rr != null ? ' · 1:' + x.rr : ''}</td><td class="${dirCls(x.gp)}">${sgn(x.gp)}</td><td><b class="up">${sgn(x.u20 ?? x.u5)}</b> / <span class="down">${sgn(x.d20 ?? x.d5)}</span></td><td class="${dirCls(x.r20)}">${sgn(x.r20)}${x.x20 != null ? ` <small class="muted">(${sgn(x.x20)})</small>` : ''}</td><td class="sm">${ft(x)}${x.ft2 ? `<br><small>${x.ft2 === 'w' ? '목표가 먼저' : x.ft2 === 'l' ? '손절선 먼저' : '목표·손절 둘 다 안 닿음'}</small>` : ''}${x.wy?.length ? `<br><small class="${x.ft === 'w' ? 'up' : 'down'}">${esc(x.wy.map((k) => WHY_KO[k] || k).join(' · '))}</small>` : ''}</td><td class="${dirCls(x.u60)}">${sgn(x.u60)}</td><td class="${dirCls(x.u120)}">${sgn(x.u120)}</td></tr>`).join('')}</table></div>`;
  }
  const pgCache = new Map();
  try { S.pbH = +(load('gk_pbh') || 20); S.pbCat = load('gk_pbcat') || '결론'; } catch {}
  document.addEventListener('click', async (ev) => {
    const sb = ev.target.closest?.('[data-pg-sort]');
    if (sb) { const tr = sb.closest('tr.pg-rows'); const k = tr?.dataset.k; if (k && pgCache.has(k)) tr.querySelector('td').innerHTML = grpRowsHTML(pgCache.get(k), sb.dataset.pgSort); return; }
    const b = ev.target.closest?.('[data-pg]'); if (!b) return;
    const tr = b.closest('tr'); const k = `${b.dataset.src}|${b.dataset.pg}`;
    const nx = tr.nextElementSibling; if (nx?.classList.contains('pg-rows')) { nx.remove(); return; }
    const row = document.createElement('tr'); row.className = 'pg-rows'; row.dataset.k = k; row.innerHTML = `<td colspan="6"><div class="loading"><span class="spin"></span>종목 불러오는 중…</div></td>`; tr.after(row);
    try { if (!pgCache.has(k)) { const j = await mpGet(`mp=grows&src=${encodeURIComponent(b.dataset.src)}&g=${encodeURIComponent(b.dataset.pg)}`); pgCache.set(k, j.rows || []); } row.querySelector('td').innerHTML = pgCache.get(k).length ? grpRowsHTML(pgCache.get(k), 'up') : '<p class="muted sm">아직 종목 기록이 없어요</p>'; }
    catch (e) { row.querySelector('td').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  });
  // ───── v221 성적표 보드: 기간·분류를 골라 한 화면에 · 그룹 누르면 종목 목록 창(닫기·뒤로 가기) ─────
  const PB_CATS = [['결론', '한 줄 결론'], ['후보', '매매 후보 조건'], ['등급', '체크리스트'], ['단계', '단계'], ['분류', '분류'], ['손익비', '손익비'], ['기타', '']];
  const PB_H = [5, 20, 60, 120];
  function pbVals(r, h) {
    return { n: r['pn' + h] || r['n' + h] || 0, up: r['up' + h], dn: r['dn' + h], end: r['mr' + h] ?? r['avg' + h], mk: r['ax' + h], hu: r['hu' + h] };
  }
  // v222: 손익비 막대 (GK: 성공/실패 개수가 아니라 총 수익률 vs 총 손실률) — N거래일 안 최고 상승 폭의 합 : 최고 하락 폭의 합
  function pbWin(r, h) {
    const n = r['pn' + h]; if (!n) return '<span class="muted sm">결과 전</span>';
    const rr = r['rr' + h]; if (rr == null) return '<span class="muted sm">—</span>';
    const w = Math.round((rr / (1 + rr)) * 100), l = 100 - w;
    return `<div class="pb-bar" title="오른 폭 합 ${w}% · 빠진 폭 합 ${l}% · 오른 폭이 더 컸던 판정 ${r['ud' + h] ?? '-'}%"><i class="w" style="width:${w}%"></i><i class="l" style="width:${l}%"></i></div><span class="pb-wl"><b class="up">${w}%</b> : <b class="down">${l}%</b><small>손익비 <b class="${rr >= 1 ? 'up' : 'down'}">1 : ${rr}</b></small></span>`;
  }
  function renderBoard(src) {
    const box = $(src === 'bt' ? '#pbBt' : '#pbPerf'); const rows = S.pbData?.[src]; if (!box || !rows) return;
    const h = S.pbH || 20, cat = S.pbCat || '결론';
    const pre = PB_CATS.find((c) => c[0] === cat)?.[1];
    const known = PB_CATS.map((c) => c[1]).filter(Boolean);
    const list = rows.filter((r) => r.g !== '전체' && (pre ? r.g.startsWith(pre + ':') : !known.some((k) => r.g.startsWith(k + ':'))));
    const all = rows.find((r) => r.g === '전체');
    const line = (r, isAll) => { const v = pbVals(r, h); const why = [r.whyW?.[0] ? `<span class="up">↑${esc(WHY_KO[r.whyW[0][0]] || '')}</span>` : '', r.whyL?.[0] ? `<span class="down">↓${esc(WHY_KO[r.whyL[0][0]] || '')}</span>` : ''].filter(Boolean).join(' ');
      return `<button class="pb-row${isAll ? ' all' : ''}" data-pb-open="${esc(r.g)}" data-pb-src="${src}"><span class="pb-name">${esc(isAll ? '전체' : r.g.replace(/^[^:]+:/, ''))}<small>${v.n ? `${v.n}건${v.n < 30 ? ' · 적음' : ''}` : '결과 전'}</small></span><span class="pb-win">${pbWin(r, h)}</span><span class="pb-num"><em>최고</em><b class="${dirCls(v.up)}">${sgn(v.up)}</b></span><span class="pb-num"><em>최저</em><b class="${dirCls(v.dn)}">${sgn(v.dn)}</b></span><span class="pb-num"><em>${h}일째</em><b class="${dirCls(v.end)}">${sgn(v.end)}</b></span><span class="pb-num hide-m"><em>시장 대비</em><b class="${dirCls(v.mk)}">${sgn(v.mk)}</b></span><span class="pb-why hide-m">${why || '<span class="muted">—</span>'}</span><span class="pb-go">›</span></button>`; };
    box.innerHTML = `<div class="pb">
      <div class="pb-ctl"><div class="pb-seg">${PB_H.map((x) => `<button data-pb-h="${x}" class="${x === h ? 'on' : ''}">${x}일</button>`).join('')}</div>
        <div class="pb-seg">${PB_CATS.map(([c]) => `<button data-pb-cat="${c}" class="${c === cat ? 'on' : ''}">${c}</button>`).join('')}</div></div>
      <div class="pb-legend muted sm"><b>막대</b> = 판정 다음 날 시가에 샀다면 ${h}거래일 안에 <b>오른 폭을 모두 더한 것 : 빠진 폭을 모두 더한 것</b> (몇 개가 성공했나가 아니라 얼마나 벌 수 있었나 vs 얼마나 잃을 수 있었나) · <b>손익비 1 : N</b> = 평균 최고 상승 ÷ 평균 최고 하락 · 손절·흔들기 기준 안 씀 · 최고/최저 = 평균 · 줄을 누르면 종목</div>
      <div class="pb-list">${all ? line(all, true) : ''}${list.length ? list.map((r) => line(r)).join('') : '<p class="muted sm">이 분류엔 아직 결과가 없어요</p>'}</div></div>`;
  }
  // 종목 목록 창
  function pbModal(src, g, rows, sort) {
    const h = S.pbH || 20;
    const key = { up: (x) => -(x['u' + h] ?? -999), down: (x) => (x['d' + h] ?? 999), new: (x) => -Date.parse(x.d) }[sort] || ((x) => -(x['u' + h] ?? -999));
    const L = [...rows].sort((a, b) => key(a) - key(b));
    const res = (x) => { const u = x['u' + h], d = x['d' + h]; if (u == null || d == null) return '<span class="muted">진행 중</span>'; const q = d < 0 ? Math.round((u / -d) * 10) / 10 : null; return u > -d ? `<b class="up">오른 폭이 큼</b><small>손익비 1 : ${q ?? '∞'}</small>` : `<b class="down">빠진 폭이 큼</b><small>손익비 1 : ${q ?? 0}</small>`; }; // v222: 손익비 기준
    let m = $('#pbModal'); if (!m) { m = document.createElement('div'); m.id = 'pbModal'; document.body.appendChild(m); }
    m.dataset.src = src; m.dataset.g = g;
    m.innerHTML = `<div class="pbm-back" data-pbm-close></div><div class="pbm" role="dialog" aria-label="종목 목록">
      <div class="pbm-head"><div><b>${esc(g === '전체' ? '전체' : g.replace(/^[^:]+:/, ''))}</b> <small class="muted">${esc(g.includes(':') ? g.split(':')[0] : '')} · ${L.length}건 · ${h}거래일 기준</small></div><button class="pbm-x" data-pbm-close aria-label="닫기">✕</button></div>
      <div class="pbm-sort">${[['up', '최고 높은 순'], ['down', '최저 낮은 순'], ['new', '최근 판정 순']].map(([k, t]) => `<button data-pbm-sort="${k}" class="${(sort || 'up') === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="pbm-list">${L.length ? L.map((x) => `<div class="pbm-row"><span class="pbm-nm"><span class="ca-co" data-mp-go="${esc(x.c)}" data-pbm-close-go><b>${esc(x.n || x.c)}</b></span><small>${esc(x.d)} · ${x.vd ? VDK[x.vd] + ' ' : ''}${esc(x.st || '')}${x.ck ? ' · ' + esc(x.ck) : ''}</small></span>
        <span class="pb-num"><em>최고</em><b class="up">${sgn(x['u' + h])}</b></span><span class="pb-num"><em>최저</em><b class="down">${sgn(x['d' + h])}</b></span><span class="pb-num"><em>${h}일째</em><b class="${dirCls(x['r' + h])}">${sgn(x['r' + h])}</b></span>
        <span class="pbm-res">${res(x)}${x.wy?.length ? `<small class="${x.ft === 'w' ? 'up' : 'down'}">${esc(x.wy.map((k) => WHY_KO[k] || k).slice(0, 2).join(' · '))}</small>` : ''}</span></div>`).join('') : '<p class="muted sm">아직 종목 기록이 없어요</p>'}</div></div>`;
    m.hidden = false; document.body.classList.add('pbm-open');
  }
  // v222: 창을 닫을 때 뒤로 가기(history.back)로 생기는 popstate가 화면 전체를 다시 그려(성적표 다시 불러오기) '계속 로딩'이 생기던 문제 → 창 때문에 생긴 popstate는 화면 이동으로 보지 않음
  function pbClose(fromPop) { const m = $('#pbModal'); if (!m || m.hidden) return; m.hidden = true; document.body.classList.remove('pbm-open'); S.skipRoute = true; setTimeout(() => { S.skipRoute = false; }, 600); if (!fromPop && history.state?.pbm) history.back(); }
  window.addEventListener('popstate', () => pbClose(true));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pbClose(); });
  const pbRows = new Map();
  document.addEventListener('click', async (ev) => {
    const hb = ev.target.closest?.('[data-pb-h]'); if (hb) { S.pbH = +hb.dataset.pbH; save('gk_pbh', S.pbH); renderBoard('perf'); renderBoard('bt'); return; }
    const cb = ev.target.closest?.('[data-pb-cat]'); if (cb) { S.pbCat = cb.dataset.pbCat; save('gk_pbcat', S.pbCat); renderBoard('perf'); renderBoard('bt'); return; }
    if (ev.target.closest?.('[data-pbm-close-go]')) { pbClose(true); return; } // 종목 이름 → 창 닫고 종목 페이지 (data-mp-go가 이어서 처리)
    if (ev.target.closest?.('[data-pbm-close]')) { pbClose(); return; }
    const so = ev.target.closest?.('[data-pbm-sort]'); if (so) { const m = $('#pbModal'); const k = `${m.dataset.src}|${m.dataset.g}`; if (pbRows.has(k)) pbModal(m.dataset.src, m.dataset.g, pbRows.get(k), so.dataset.pbmSort); return; }
    const ob = ev.target.closest?.('[data-pb-open]'); if (!ob) return;
    const src = ob.dataset.pbSrc, g = ob.dataset.pbOpen, k = `${src}|${g}`;
    if (!history.state?.pbm) history.pushState({ ...(history.state || {}), pbm: 1 }, '');
    pbModal(src, g, pbRows.get(k) || [], 'up');
    if (!pbRows.has(k)) { const m = $('#pbModal .pbm-list'); if (m) m.innerHTML = '<div class="loading"><span class="spin"></span>종목 불러오는 중…</div>';
      try { const j = await mpGet(`mp=grows&src=${encodeURIComponent(src)}&g=${encodeURIComponent(g)}`); pbRows.set(k, j.rows || []); } catch (e) { pbRows.set(k, []); }
      const mm = $('#pbModal'); if (mm && !mm.hidden && mm.dataset.g === g) pbModal(src, g, pbRows.get(k), 'up'); }
  });
  // 🧪 과거 재현 백테스트 (성적표 탭 안)
  async function loadBt() {
    const box = $('#btBox'); if (!box) return;
    let j; try { j = await mpGet('mp=bt'); } catch (e) { box.innerHTML = `<p class="muted sm">과거 재현 결과를 못 불러옴: ${esc(e.message)}</p>`; return; }
    const b = $('#btBox'); if (!b) return;
    if (j.none) { b.innerHTML = '<p class="note">🧪 <b>과거 재현(백테스트)</b> — 아직 시작 전 (24시간 3분마다 조금씩 자동 계산, 레이더 정기 분석 중엔 쉼) <button class="btn sm" data-bt-run>지금 시작</button></p>'; return; }
    const ord = ['전체', '한 줄 결론:🟢 매수 검토', '한 줄 결론:🟡 지켜보기', '한 줄 결론:🔴 피하기', '매매 후보 조건:충족', '매매 후보 조건:미충족', '체크리스트:A등급', '체크리스트:B등급', '체크리스트:C등급', '체크리스트:D등급', '분류:상승 가능성', '분류:하락 위험', '분류:분류 없음', '단계:판 깔기', '단계:매집', '단계:띄우기', '단계:털기', '단계:엑시트 후', '단계:관찰', '손익비:3 이상', '손익비:2~3', '손익비:2 미만'];
    const rows = (j.groups || []).filter((r) => ord.includes(r.g)).sort((a, c) => ord.indexOf(a.g) - ord.indexOf(c.g));
    const cell = (r, h) => (r['n' + h] ? `<td><b class="${dirCls(r['avg' + h])}">${r['avg' + h] > 0 ? '+' : ''}${r['avg' + h]}%</b><small>오른 비율 ${r['win' + h]}% · ${r['n' + h]}건${r['n' + h] < 30 ? ' (적음)' : ''}</small></td>` : '<td class="muted">—</td>');
    b.innerHTML = `<h4 style="margin:1rem 0 .3rem">🧪 과거 재현(백테스트) <small class="muted">참고용 · 지난 약 8개월 동안 '그날 지금 규칙이었다면' 판정 → 실제 5·20·60거래일 뒤 결과 · ${j.done ? `완료 (${esc(rel(j.doneAt))})` : `계산 중 ${fmtInt(j.pos)}/${fmtInt(j.of)}종목`} · 판정 ${fmtInt(j.kept)}건</small> <button class="btn sm" data-bt-run>처음부터 다시</button></h4>
      <p class="muted sm">한계: AI 판단·지분·신용·거래원·재무 같은 바깥 자료는 그날 기준으로 재현 못 해서 빠져요 · 시가총액 순위 모름 · 공시는 최근 180일치만 있어 오래된 날짜일수록 공시가 덜 보임 · 대상은 최근 6개월 판 깔기 공시가 있던 종목</p>
      ${rows.length ? '<div id="pbBt"></div>' : '<p class="muted sm">아직 결과 없음</p>'}`;
    if (rows.length) { S.pbData = S.pbData || {}; S.pbData.bt = rows; renderBoard('bt'); }
  }
  document.addEventListener('click', async (ev) => {
    const br = ev.target.closest?.('[data-bt-run]'); if (!br) return;
    br.disabled = true; try { await mpGet('mp=btrun'); } catch {} setTimeout(loadBt, 500);
  });
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest?.('[data-mp-rulechk]'); if (!b) return;
    const m = document.querySelector('[data-mp-rulechk-msg]'); b.disabled = true; if (m) m.textContent = '보내는 중…';
    try { const j = await mpGet('mp=rulechk'); if (m) m.textContent = j.ok ? `텔레그램으로 보냈어요${j.warns ? ` (⚠ ${j.warns}개)` : ''}` : '실패'; } catch (e) { if (m) m.textContent = '실패: ' + e.message; }
    b.disabled = false;
  });
  // 종목 검색 → 그 종목을 정기 분석과 똑같이 바로 분석 (랭킹에 없어도)
  function bindMpSearch() {
    const input = $('#mpQ'), list = $('#mpQList'); if (!input) return;
    let timer = null, seq = 0;
    input.addEventListener('input', () => {
      const q = input.value.trim(); clearTimeout(timer);
      if (!q) { list.hidden = true; return; }
      const my = ++seq;
      timer = setTimeout(async () => {
        let items = [];
        try { items = ((await getJSON(`/api/search?v=2&q=${encodeURIComponent(q)}`, {})).items || []).filter((x) => x.market === 'KR' && /^\d{6}$/.test(x.ticker)); } catch {}
        if (my !== seq) return;
        if (/^\d{6}$/.test(q) && !items.some((x) => x.ticker === q)) items.unshift({ ticker: q, name: q });
        list.innerHTML = items.length ? items.slice(0, 8).map((x) => `<button data-mp-look="${esc(x.ticker)}" data-mp-nm="${esc(x.name)}">${logoHTML('KR', x.ticker, x.name, 'sm')}<b>${esc(x.name)}</b> <small class="muted">${esc(x.ticker)}</small></button>`).join('') : '<p class="muted sm">국내 종목을 찾지 못했어요</p>';
        list.hidden = false;
      }, 250);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const b = list.querySelector('[data-mp-look]'); if (b) b.click(); } else if (e.key === 'Escape') list.hidden = true; });
  }
  function lookStock(code, name, refresh = false) { goRadarStock(code, { look: true, name, refresh }); }

  // ⭐ 내 세력주 (관심 종목 + 매매 기록) — 손절·목표 도달, 단계·분류 변화는 관리자 텔레그램으로 알림
  function planHTML(pl, it) {
    if (!pl) return '';
    return `<div class="pf-plan"><span><em>버팀 손절선</em><b>${fmtInt(pl.stop)}원</b><small>${pl.stopPct}% · ${esc(pl.floorS)} ${fmtInt(pl.floor)}원 아래 3%</small></span>
      <span><em>나눠 사기 (1/3씩)</em><b>${pl.buys.map((b) => fmtInt(b)).join(' → ')}</b><small>평균 약 ${fmtInt(pl.avg)}원${pl.each ? ` · 회당 ${fmtInt(pl.each)}주` : ''}</small></span>
      ${pl.amount ? `<span><em>권장 금액</em><b>${fmtInt(pl.amount)}원</b><small>${fmtInt(pl.shares)}주 · 계좌의 ${pl.acctPct}% · 최대 손실 ${fmtInt(pl.maxLoss)}원${pl.liq != null ? ` · 하루 거래대금의 ${pl.liq}%${pl.liq > 5 ? ' ⚠ 많음(팔기 어려울 수 있음)' : ''}` : ''}</small></span>` : '<span><em>권장 금액</em><b>—</b><small>위에 계좌 금액을 넣으면 계산</small></span>'}
      ${pl.deep ? `<small class="pf-alert">⚠ ${esc(pl.deep)}</small>` : ''}${pl.far ? `<small class="pf-alert">⚠ ${esc(pl.far)}</small>` : ''}
      ${it?.stop && Math.abs(it.stop / pl.stop - 1) > 0.03 ? `<small class="muted">적어 둔 손절 ${fmtInt(it.stop)}원은 버팀 손절선과 달라요 — 흔들기에 걸리기 쉬운 자리인지 확인</small>` : ''}</div>`;
  }
  async function loadAnom(run) {
    const b = $('#anomBody'); if (!b) return;
    if (run) b.innerHTML = '<div class="loading"><span class="spin"></span>사이트 전체 점검 중… (30초쯤)</div>';
    let j; try { j = await getJSON(`/api/admin?key=${encodeURIComponent(S.admin)}&anom=${run ? 'run' : '1'}`, { cache: 'no-store' }); } catch (e) { j = { ok: false, error: e.message }; }
    if (!$('#anomBody')) return;
    if (!j.ok) { b.innerHTML = `<p class="err">${esc(j.error || '불러오지 못했어요')}</p>`; return; }
    if (!j.at) { b.innerHTML = '<p class="muted sm">아직 점검 기록이 없어요. "지금 점검"을 누르거나 3시간 안에 자동으로 돌아요.</p>'; return; }
    const L = j.items || [];
    b.innerHTML = `<p class="muted sm">${esc(fmtDT(new Date(j.at)).full)} 점검 · ${L.length ? `문제 ${L.filter((i) => i.lv !== 'info').length}건 (심각 ${j.nErr || 0})${L.some((i) => i.lv === 'info') ? ` · 참고 ${L.filter((i) => i.lv === 'info').length}건` : ''}` : '✅ 이상한 값 없음'}</p>${L.length ? `<ul class="anom-l">${L.map((i) => `<li class="${i.lv}"><b>${i.lv === 'err' ? '🔴' : i.lv === 'info' ? '⚪' : '🟡'} ${esc(i.area)}</b> ${esc(i.msg)}${i.ex?.length ? `<small>${i.ex.map((x) => esc(x)).join(' · ')}</small>` : ''}</li>`).join('')}</ul>` : ''}`;
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-anom-run]')) loadAnom(true); });
  async function loadMy(op, params) {
    const box = $('#mpBody'); if (!box) return;
    if (!op) box.innerHTML = '<div class="loading"><span class="spin"></span>불러오는 중…</div>';
    const seq = (S.mpSeq = (S.mpSeq || 0) + 1);
    let j, lv = null;
    try {
      j = await mpGet(`mp=${op || 'my'}${params ? '&' + new URLSearchParams(params) : ''}`);
      lv = await mpGet(`mp=live`).catch(() => null);
    } catch (e) { j = { ok: false, error: e.message }; }
    if (!$('#mpBody') || S.mpTab !== 'my' || seq !== S.mpSeq) return;
    if (!j.ok) { box.innerHTML = `<p class="err">${esc(j.error || '불러오지 못했어요')}</p>`; return; }
    const open = j.items.filter((i) => !i.closed), done = j.items.filter((i) => i.closed);
    const DIRB = { up: '📈 상승 가능성', down: '📉 하락 위험' };
    const pf = j.pf || null, cfg = pf?.cfg || {};
    const row = (i) => `<li class="mp-row mp-my ${i.closed ? 'closed' : ''}"><div class="mp-top"><span class="f-rk">${i.closed ? '✔' : '⭐'}</span><span class="ca-co" data-mp-go="${esc(i.code)}" title="작전 레이더 종목 페이지 열기">${logoHTML('KR', i.code, i.name, 'sm')}<span><b>${esc(i.name)}</b><small>${esc(i.code)} · ${esc(rel(i.at))} 추가${i.closed ? ` · ${esc(rel(i.exitAt))} 정리` : ''}</small></span></span>
        <span class="mp-px"${!i.closed ? ` data-lq="${esc(i.code)}" data-entry="${i.entry || ''}"` : ''}>${i.cur != null ? fmtInt(i.cur) + '원' : '—'}<small class="${dirCls(i.pl)}">${i.pl != null ? (i.pl > 0 ? '+' : '') + i.pl + '%' : ''}</small></span>
        <span class="mp-stage ${MP_ST[i.st] || 'watch'}">${esc(i.st || '-')}</span><span class="mp-score"><b class="${dirCls(i.pl)}">${i.pl != null ? (i.pl > 0 ? '+' : '') + i.pl + '%' : '—'}</b><small>${i.closed ? '확정 수익률' : '평가 수익률'}</small></span></div>
      <div class="mp-cost">진입 <b>${i.entry ? fmtInt(i.entry) + '원' : '—'}</b> · 손절 <b>${i.stop ? fmtInt(i.stop) + '원' : '—'}</b> · 목표 <b>${i.target ? fmtInt(i.target) + '원' : '—'}</b>${i.qty ? ` · ${fmtInt(i.qty)}주` : ''}${i.closed ? ` · 정리가 <b>${i.exit ? fmtInt(i.exit) + '원' : '—'}</b>` : ''}</div>
      ${!i.closed ? `<div class="mp-dirl">${i.d && DIRB[i.d] ? `<span class="mp-dirb ${esc(i.d)}">${DIRB[i.d]}</span>` : ''}${i.ckg ? ` <span class="mp-ckg g${esc(i.ckg)}">✅ 체크 ${esc(i.ckg)}</span>` : ''}${i.rr ? ` <small class="muted">손익비 1:${i.rr.v}${i.rr.big ? '+' : ''}</small>` : ''}${i.us != null ? ` <small class="muted">상승 ${i.us}/10 · 하락 ${i.ds}/10</small>` : ''}</div>` : ''}
      ${i.memo ? `<p class="muted sm">📝 ${esc(i.memo)}</p>` : ''}
      ${!i.closed && pf?.plans?.[i.id] ? planHTML(pf.plans[i.id], i) : ''}
      ${!i.closed && pf?.notes?.[i.id]?.length ? `<ul class="pf-notes">${pf.notes[i.id].map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="chips">${!i.closed ? `<button class="btn sm" data-my-look="${esc(i.code)}" data-nm="${esc(i.name)}">분석 보기</button><span class="mp-close"><input type="number" placeholder="정리 가격" data-my-exit="${esc(i.id)}" value="${i.cur || ''}"><button class="btn sm" data-my-close="${esc(i.id)}">매매 정리</button></span>` : ''}<button class="btn sm ghost" data-my-del="${esc(i.id)}">삭제</button></div></li>`;
    const cfgBox = `<div class="pf-cfg"><b>💼 포트폴리오 도우미</b> <label>계좌 금액(원)<input type="number" id="pfAcct" value="${esc(cfg.acct || '')}" placeholder="예: 100000000"></label><label>한 종목 최대 손실(%)<input type="number" step="0.1" id="pfRisk" value="${esc(cfg.riskPct ?? 1.5)}"></label><button class="btn sm primary" data-pf-save>저장</button>
      <small class="muted">버팀 손절선 = 보이는 지지선이 아니라 세력이 밀 수 있는 바닥(CB 리픽싱 하한·3자배정 발행가 등) 아래 3% · 1/3씩 나눠 사기 · 살 금액 = 계좌 × 최대 손실% ÷ (평균 매수가 − 버팀 손절선). 보유 종목에 <b>새 공시</b>가 나오면 바로, 장 마감 뒤엔 <b>하락이 흔들기인지 털기인지</b>·시간 손절·물량 해제·폭탄 신호를 관리자 텔레그램으로 보내요.</small></div>
      ${pf?.warn?.length ? `<div class="pf-warn"><b>⚠ 겹치는 종목</b><ul>${pf.warn.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      ${pf?.total ? `<p class="muted sm">보유 평가 금액 약 ${fmtInt(Math.round(pf.total))}원${cfg.acct ? ` (계좌의 ${Math.round((pf.total / cfg.acct) * 1000) / 10}%)` : ''}</p>` : ''}`;
    box.innerHTML = `${cfgBox}<p class="note">레이더에서 고른 종목의 진입가·손절·목표를 적어 두면 <b>장중 매분</b> 가격을 확인해 손절·목표 도달을 관리자 텔레그램으로 알려주고, 단계·분류가 바뀌어도 ⭐ 표시로 알려줘요. 종목 상세의 '⭐ 내 세력주에 추가' 버튼으로 손익비 가격이 자동으로 채워져요.</p>
      ${j.stats ? `<p class="mp-mystat">정리한 매매 ${j.stats.n}건 · 수익 낸 비율 ${j.stats.win}% · 평균 ${j.stats.avg > 0 ? '+' : ''}${j.stats.avg}%</p>` : ''}
      ${lv ? `<p class="muted sm">오늘 장중 알림 ${lv.n || 0}건 · 감시 종목 ${lv.codes || 0}개${lv.err ? ` · 오류: ${esc(lv.err)}` : ''}${lv.br ? ` · 거래원 기록 ${esc(lv.br.date || '')} ${lv.br.pos || 0}/${lv.br.n || 0}${lv.br.err ? ` (${esc(lv.br.err)})` : ''}` : ''}${lv.thm ? ` · 업종·테마 기록 ${esc(lv.thm)}` : ''}</p>${lv.last?.length ? `<ul class="mp-why">${lv.last.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}` : ''}
      <h5>보유·관심 (${open.length})</h5>${open.length ? `<ol class="mp-list">${open.map(row).join('')}</ol>` : '<p class="muted sm">아직 없어요. 위 검색이나 랭킹에서 종목을 열고 ⭐ 버튼을 누르세요.</p>'}
      ${done.length ? `<h5>정리한 매매 (${done.length})</h5><ol class="mp-list">${done.map(row).join('')}</ol>` : ''}`;
    setTimeout(radarLive, 300);
  }
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-mp-myopen]');
    if (o) { const w = o.closest('[data-mp-myform]'); w.innerHTML = `<div class="mp-myf"><b>⭐ ${esc(w.dataset.nm)}</b> <label>진입가<input type="number" data-k="entry" value="${esc(w.dataset.e)}"></label><label>손절<input type="number" data-k="stop" value="${esc(w.dataset.s)}"></label><label>목표<input type="number" data-k="target" value="${esc(w.dataset.t)}"></label><label>수량<input type="number" data-k="qty"></label><label class="w">메모<input type="text" data-k="memo" maxlength="200"></label><button class="btn sm primary" data-mp-mysave>저장</button></div>`; return; }
    const sv = e.target.closest('[data-mp-mysave]');
    if (sv) { const w = sv.closest('[data-mp-myform]'); const p = { code: w.dataset.mpMyform, name: w.dataset.nm }; w.querySelectorAll('[data-k]').forEach((i) => { if (i.value) p[i.dataset.k] = i.value; }); sv.disabled = true; mpGet(`mp=myadd&${new URLSearchParams(p)}`).then((j) => { w.innerHTML = j.ok ? '<p class="note">⭐ 내 세력주에 추가했어요 (작전 레이더 → ⭐ 내 세력주 탭)</p>' : `<p class="err">${esc(j.error || '저장 실패')}</p>`; }).catch((er) => { w.innerHTML = `<p class="err">${esc(er.message)}</p>`; }); return; }
    const pfs = e.target.closest('[data-pf-save]'); if (pfs) { loadMy('mycfg', { acct: $('#pfAcct')?.value || '', riskPct: $('#pfRisk')?.value || '1.5' }); return; }
    const dl = e.target.closest('[data-my-del]'); if (dl) { loadMy('mydel', { id: dl.dataset.myDel }); return; }
    const cs = e.target.closest('[data-my-close]'); if (cs) { const inp = document.querySelector(`[data-my-exit="${cs.dataset.myClose}"]`); loadMy('myclose', { id: cs.dataset.myClose, exit: inp?.value || '' }); return; }
    const lk = e.target.closest('[data-my-look]'); if (lk) { goRadarStock(lk.dataset.myLook); }
  });
  // 🔔 알림 기록: 관리자 텔레그램으로 보낸 작전 레이더 알림을 사이트에서도 날짜순으로 (텔레그램 하루 한도를 넘은 것도 여기엔 남음)
  async function loadAlerts() {
    const box = $('#mpBody'); if (!box) return;
    const seq = (S.mpSeq = (S.mpSeq || 0) + 1);
    box.innerHTML = '<div class="loading"><span class="spin"></span>불러오는 중…</div>';
    let j; try { j = await mpGet(`mp=alerts`); } catch (e) { j = { ok: false, error: e.message }; }
    if (!$('#mpBody') || S.mpTab !== 'alerts' || seq !== S.mpSeq) return;
    if (!j.ok) { box.innerHTML = `<p class="err">${esc(j.error || '')}</p>`; return; }
    const groups = [];
    for (const a of j.list || []) { const d = fmtDT(new Date(a.at)); const key = `${d.md} ${d.hm}`; const g = groups[groups.length - 1]; if (g && g.key === key) g.items.push(a); else groups.push({ key, items: [a] }); }
    box.innerHTML = `<p class="note">관리자 텔레그램으로 보낸 작전 레이더 알림 기록이에요 (단계·분류 변화, 재매집, 2차 작전 반등, 장중 띄우기 시작, 손절·목표 도달, 거래정지). 공개 채널에는 올리지 않아요. 줄을 누르면 그 종목 페이지가 열려요.</p>
      ${groups.length ? `<div class="al-log">${groups.map((g) => `<div class="al-grp"><b>${esc(g.key)}</b><ul>${g.items.map((a) => `<li class="${a.c ? 'go' : ''}" ${a.c ? `data-al-code="${esc(a.c)}"` : ''}>${esc(a.t)}</li>`).join('')}</ul></div>`).join('')}</div>` : '<p class="muted">아직 알림 기록이 없어요.</p>'}`;
  }
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-al-code]'); if (a) goRadarStock(a.dataset.alCode); });
  function openRankRow(row) { goRadarStock(row.dataset.mpCode); }

  document.addEventListener('click', (e) => {
    const lb = e.target.closest('[data-mp-look]'); if (lb) { const l = $('#mpQList'); if (l) l.hidden = true; lookStock(lb.dataset.mpLook, lb.dataset.mpNm, lb.dataset.mpRefresh === '1'); return; }
    if (e.target.closest('[data-mp-look-close]')) { const b = $('#mpLook'); if (b) b.innerHTML = ''; return; }
    if (!e.target.closest('.mp-search')) { const l = $('#mpQList'); if (l) l.hidden = true; }
    if (e.target.closest('[data-mp-rank-refresh]')) { loadRank(); return; }
    const fgb = e.target.closest('[data-fg]'); if (fgb) { S.fg = fgb.dataset.fg; save('gk_fg', S.fg); applyRkFilter(); return; }
    const fsb = e.target.closest('[data-fs]'); if (fsb) { S.fs = fsb.dataset.fs; save('gk_fs', S.fs); applyRkFilter(); return; }
    const kb = e.target.closest('[data-rk-kind]'); if (kb) { S.rkKind = kb.dataset.rkKind; save('gk_rkkind', S.rkKind); loadRank(); return; }
    const go = e.target.closest('[data-mp-go]'); if (go) { goRadarStock(go.dataset.mpGo); return; } // 레이더 목록에서 이름·로고 → 작전 레이더 종목 페이지 (기업 분석 화면 아님)
    const row = e.target.closest('.mp-rk');
    if (row && !e.target.closest('a, button')) openRankRow(row);
  });
  // 불성실공시 벌점 (최근 1년) — 서버 penaltyOf와 같은 계산
  function penaltyBox(x) {
    const now = Date.now();
    const L = (x.px || []).filter((p) => p.pen && now - Date.parse(p.date + 'T12:00:00+09:00') < 365 * 86400e3).sort((a, b) => (a.date < b.date ? 1 : -1));
    const ev = (x.events || []).filter((e) => e.kind === 'risk' && /불성실공시/.test(e.title) && now - e.ms < 365 * 86400e3);
    if (!L.length && !ev.length) return '';
    const fixed = L.filter((p) => !p.pen.pre);
    const sum = fixed.reduce((a, p) => a + (p.pen.p || 0), 0), cumDoc = fixed.find((p) => p.pen.cum != null)?.pen.cum ?? null;
    const cum = Math.max(sum, cumDoc || 0);
    const kospi = x.mkt === 'P', stop1 = kospi ? 10 : 8;
    const LIM = kospi ? 15 : 10; // 코스닥은 2026-07-01부터 누계 10점이면 실질심사 (이전 15점)
    const pct = Math.min(100, Math.round((cum / LIM) * 100));
    return `<div class="mp-pen"><h5>📛 불성실공시 벌점 <small>최근 1년 · 공시 원문 기준</small></h5>
      ${L.length ? `<div class="mp-penbar"><i style="width:${pct}%" class="${cum >= LIM ? 'over' : cum >= LIM - 5 ? 'warn' : ''}"></i><span>누계 <b>${cum}점</b> / ${LIM}점${cum < LIM ? ` · ${LIM - cum}점 남음` : ' · 기준 초과'}</span></div>
      <ul>${L.map((p) => `<li>${esc(p.date)} ${p.pen.pre ? '<b>지정 예고</b> (벌점 확정 전)' : `부과벌점 <b>${p.pen.p ?? '?'}점</b>${p.pen.p >= stop1 ? ` <span class="err">→ ${stop1}점 이상: 지정일 하루 매매정지</span>` : ''}`}${p.pen.cum != null ? ` · 원문상 누계 ${p.pen.cum}점` : ''} <a class="mp-src" href="/p/${esc(p.ref || '')}" target="_blank">공시</a></li>`).join('')}</ul>`
        : `<p class="muted sm">불성실공시 관련 공시 ${ev.length}건이 있지만 원문에서 점수를 아직 못 읽었어요 (다음 분석 때 다시 확인). ${ev.map((e) => `<a class="mp-src" href="/p/${esc(e.id)}" target="_blank">${esc(e.title)}</a>`).join(' ')}</p>`}
      <p class="muted sm">${kospi ? '코스피: 1회 10점 이상이면 지정일 하루 매매정지 · 최근 1년 누계 15점 이상이면 관리종목 지정 (관리종목 후 1년간 추가 15점이면 상장적격성 실질심사)' : '코스닥: 1회 8점 이상이면 지정일 하루 매매정지 · 최근 1년 누계 10점 이상이면 상장적격성 실질심사 (2026-07-01부터, 이전 15점)'}</p></div>`;
  }
  function mpDetail(x) { const p = mpParts(x); return `${p.myBtn}${p.pexBox}${p.rbBox}${p.ckBox}${p.cycLine}${p.accLine}${p.markBox}${p.wf}${p.dirBox}${p.tgtBox}${p.aiBox}${p.grid}`; }
  function mpParts(x) {
    const a = x.ai && !x.ai.error ? x.ai : null, f = x.f || {};
    const li = (arr) => arr.map((t) => `<li>${hl(t)}</li>`).join('');
    const pxs = (x.px || []).filter((p, i, A) => A.findIndex((q) => q.date === p.date && q.label === p.label && q.p === p.p && q.kind === p.kind) === i).map((p) => `<li>${esc(p.date || '')} ${esc(p.label || '')}${p.p ? ` <b>${fmtInt(p.p)}원</b>` : ''} <small class="muted">(${esc(MP_EV[p.kind] || p.kind)})</small>${p.cbx ? `<div class="mp-buys">${p.cbx.start ? `<span>전환청구 ${esc(p.cbx.start)}${p.cbx.end ? '~' + esc(p.cbx.end) : ''}</span>` : ''}${p.cbx.floor ? `<span>리픽싱 하한 ${fmtInt(p.cbx.floor)}원</span>` : ''}${p.cbx.call ? `<span>콜옵션${p.cbx.callPct ? ' ' + p.cbx.callPct + '%' : ''}</span>` : ''}</div>` : ''}${p.pledge ? `<div class="mp-buys"><span>담보 ${fmtInt(p.pledge.sh)}주 · 대출 ${fmtInt(p.pledge.loan)}원 → 1주당 ${fmtInt(p.pledge.perShare)}원 · 반대매매 추정 ${fmtInt(p.pledge.perShare * 1.4)}원</span></div>` : ''}${p.buys?.length ? `<div class="mp-buys">${p.buys.slice(0, 12).map((b) => `<span>${esc(b.d.slice(5))} ${b.q ? fmtInt(b.q) + '주 ' : ''}@${fmtInt(b.p)}</span>`).join('')}</div>` : ''}</li>`).join('');
    const cl = x.cl;
    const ckItem = (i, red) => `<li class="${i.ok == null ? 'na' : (red ? (i.ok ? 'bad' : 'good') : (i.ok ? 'good' : 'bad'))}"><b>${i.ok == null ? '?' : red ? (i.ok ? '⚠' : '✓') : (i.ok ? '✓' : '✗')}</b> ${i.w != null && !red ? `<span class="ck-w${i.w >= 2 ? ' hi' : i.w >= 1 ? ' md' : ''}" title="중요도${i.wl != null ? ` (성적표로 ×${i.wl})` : ''}">${i.w >= 2 ? '핵심' : i.w >= 1 ? '중요' : '참고'} ${i.w}</span> ` : red && i.bomb ? '<span class="ck-w bomb" title="걸리면 D등급">폭탄</span> ' : ''}${esc(i.t)}${i.src && /^DART|^[A-Z]+-/.test(i.src) ? ` <a class="mp-src" href="/p/${esc(i.src)}" target="_blank">공시</a>` : ''}</li>`;
    const ckBox = cl ? `<div class="mp-ck"><h5>✅ 성공 가능성 체크리스트${x.clOld ? ' <small class="muted">(저장된 자료로 지금 계산 — 지분·감사의견·신용·거래원 등 바깥 자료는 다음 분석 때 채워져 \'?\'로 보일 수 있음)</small>' : ''} <span class="mp-ckg g${esc(cl.grade)}">${esc(cl.grade)}등급</span> <small>${cl.ws != null ? `중요도 점수 <b>${cl.ws}점</b> · ` : ''}성공 조건 ${cl.np}/${cl.nk} 충족 · 위험 신호 ${cl.nr}개${cl.bombs?.length ? ' (폭탄 신호 포함 → D)' : ''}${cl.mktWeak ? ' · 시장 전체 약세(등급 계산 제외)' : ''}${cl.thin ? ' · 자료가 적어 판단 보류' : ''}${cl.learned ? ` · 📊 성적표 ${cl.learned.n}건으로 ${cl.learned.k}개 항목 중요도 조정됨` : ' · 중요도는 기본값 (성적표가 쌓이면 자동 조정)'}${x.ckFilled ? ' · 방금 빈 자료 채움' : ''}</small><br><small class="muted">등급: <b>A</b> 점수 65↑ + 자금 투입·평단 근처 둘 다 ✓ + 위험 0 · <b>B</b> 점수 45↑ + (자금 투입 또는 매집 흔적 ✓) + 작은 위험 1 이하 · <b>C</b> 그 밖 · <b>D</b> 폭탄 신호(철회·납입 연기, 감사의견·자본잠식, 벌점, 담보 반대매매, 내부자 매도 우위) 1개라도 · 점수 = ✓ 항목 중요도 합 ÷ 자료 있는 항목 중요도 합 · 자료 없는 항목(?)은 계산에서 뺌</small></h5>
      <div class="mp-ckgrid"><div><h6>띄울 이유·힘 (✓가 많을수록 좋음)</h6><ul>${[...cl.pos].sort((a, b) => (b.w ?? 0) - (a.w ?? 0)).map((i) => ckItem(i, false)).join('')}</ul></div><div><h6>실패·폭탄 신호 (⚠가 없어야 좋음)</h6><ul>${[...cl.red].sort((a, b) => (b.bomb ? 1 : 0) - (a.bomb ? 1 : 0)).map((i) => ckItem(i, true)).join('')}</ul></div></div>
      ${x.ck?.broker?.last ? `<details class="mp-facts"><summary>최근 거래원 (${esc(x.ck.broker.last.d || '')} · 기록 ${x.ck.broker.n}일)</summary><p class="sm">매수 상위: ${(x.ck.broker.last.buy || []).map((b) => `${esc(b.nm)} ${fmtInt(b.v)}`).join(' · ')}<br>매도 상위: ${(x.ck.broker.last.sell || []).map((b) => `${esc(b.nm)} ${fmtInt(b.v)}`).join(' · ')}</p>${x.ck.broker.list?.length ? `<p class="muted sm">최근 매수 상위 등장 일수: ${x.ck.broker.list.map((b) => `${esc(b.nm)} ${b.days}일`).join(' · ')}</p>` : ''}</details>` : ''}</div>` : '<div class="mp-ck"><h5>✅ 성공 가능성 체크리스트</h5><p class="muted sm">이전 방식으로 분석된 기록이에요 — 다음 분석(또는 지금 다시 분석) 때 채워져요</p></div>';
    const wf = f.wf ? `<div class="mp-wf"><b>🚨 시장경보(투자경고 지정예고) 근사 계산</b> ${f.wf.items.map((w) => `<span>${esc(w.lbl)}: 오늘까지 ${w.now != null ? (w.now > 0 ? '+' : '') + w.now + '%' : '-'} · 내일 종가 ${fmtInt(w.need)}원(${w.pct > 0 ? '+' : ''}${w.pct}%)↑이면 요건</span>`).join('')}<br><small class="muted">거래소 기준(3일 +100% · 5일 +60% · 15일 +100%, 최근 15일 최고가 등)으로 근사 계산 — 정확한 지정 여부는 거래소 공시로 확인${f.wf.hi15 ? ' · 오늘 종가가 최근 15일 최고' : ''}</small></div>` : '';
    const RBK = { deadcat: ['① 기술적 반등(데드캣) 쪽', 'a'], dump: ['② 털기 중 반등(물량 넘기기) 쪽', 'b'], second: ['③ 2차 작전(재매집 뒤 상승) 쪽', 'c'], wave2: ['🔁 눌림 뒤 재상승 (같은 판 2파) — 털기 후 새 작전이 아니라 첫 판이 아직 진행 중', ''], unclear: ['판단 보류 — 근거가 비슷하거나 부족', ''] };
    const rk = x.rbk;
    const rbCol = (k, title, sub) => `<div class="mp-rbc ${rk.type && RBK[rk.type][1] === k ? 'on' : ''}"><h6>${title} <small>${rk.s[k]}점 · ${sub}</small></h6>${rk.why[k].length ? `<ul>${rk.why[k].map((r) => `<li>${esc(r.t)}</li>`).join('')}</ul>` : '<p class="muted sm">해당 근거 없음</p>'}</div>`;
    const rbBox = rk ? `<div class="mp-rb"><h5>🔄 반등 성격 <b class="rb-${esc(rk.type)}">${esc(RBK[rk.type]?.[0] || '')}</b> <small>${esc(rk.rb.topD)} 고점 ${fmtInt(rk.rb.top)}원 → ${esc(rk.rb.lowD)} 바닥 ${fmtInt(rk.rb.low)}원(${rk.rb.fall}%) → 지금 바닥 대비 +${rk.rb.up}% (${rk.rb.days}거래일) · 규칙 계산(AI 아님)</small></h5>
      ${rk.type === 'wave2' && rk.w2 ? `<div class="mp-w2"><ul>${rk.w2.why.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><p>⚠ ${esc(rk.w2.warn)}</p><small class="muted">아래 세 칸은 참고용 점수</small></div>` : ''}
      <div class="mp-rbgrid">${rbCol('a', '① 기술적 반등', '다시 빠지기 쉬움')}${rbCol('b', '② 털기 중 반등', '가장 위험')}${rbCol('c', '③ 2차 작전', '같이 탈 만한 쪽')}</div>
      ${rk.ov?.list?.length ? `<p class="muted sm">남은 전환 가능 물량(추정): ${rk.ov.list.map((v) => `${v.date} ${v.src === 'conv' ? '청구 공시의 미전환 잔액' : 'CB 발행 총액(청구 공시 없음)'} ${fmtInt(v.amt)}원${v.price ? ` ÷ 전환가 ${fmtInt(v.price)}원 ≈ ${fmtInt(v.shares)}주` : ''}`).join(' · ')}${rk.ov.days != null ? ` → 하루 평균 거래량의 ${rk.ov.days}일치` : ''}${rk.ov.bought ? ` · CB 되사기 공시 ${rk.ov.bought}건` : ''}</p>` : ''}</div>` : '';
    const px2 = x.pex;
    const pexBox = px2 ? `<div class="mp-pex"><h5>🔁 털기 후 상승 가능성 <b class="pex-${{ 높음: 'h', 중간: 'm', 낮음: 'l' }[px2.lv]}">${esc(px2.lv)}</b> <small>${esc(px2.post.topD)} 고점 ${fmtInt(px2.post.top)}원 → ${esc(px2.post.lowD)} 바닥 ${fmtInt(px2.post.low)}원(${px2.post.fall}%) · 바닥 뒤 ${px2.post.held}거래일 · 올라갈 근거 ${px2.su}점 vs 못 올라갈 근거 ${px2.sd}점 · 규칙 계산(AI 아님)</small></h5>
      <div class="mp-dir"><div class="mp-dcol up"><h5>올라갈 근거</h5>${px2.up.length ? `<ul>${px2.up.map((r) => `<li>${esc(r.t)} <small class="muted">+${r.w}</small></li>`).join('')}</ul>` : '<p class="muted sm">아직 없음</p>'}</div><div class="mp-dcol down"><h5>못 올라갈 근거</h5>${px2.down.length ? `<ul>${px2.down.map((r) => `<li>${esc(r.t)} <small class="muted">+${r.w}</small></li>`).join('')}</ul>` : '<p class="muted sm">없음</p>'}</div></div></div>` : '';
    const myBtn = `<div class="mp-myadd" data-mp-myform="${esc(x.code)}" data-nm="${esc(x.name)}" data-e="${x.close || ''}" data-s="${x.plan?.stop || x.dir?.rr?.s || ''}" data-t="${x.dir?.rr?.t || ''}"><button class="btn sm" data-mp-myopen>⭐ 내 세력주에 추가 (매매 기록)</button></div>`;
    const cycLine = f.cyc ? `<div class="mp-cyc"><b>🔁 지난 급등·급락</b> ${esc(f.cyc.lowD)} 저점 <b>${fmtInt(f.cyc.low)}원</b> → ${esc(f.cyc.pumpD)} 급등 시작 → ${esc(f.cyc.topD)} 고점 <b>${fmtInt(f.cyc.top)}원</b> (+${f.cyc.rise}%) → 지금 고점 대비 <b class="down">${f.cyc.drop}%</b>${f.cyc.vwapPump ? ` · 급등 구간 평균 체결가 ${fmtInt(f.cyc.vwapPump)}원` : ''}${f.cyc.base2 ? `<br><b>🔁 고점 뒤 바닥</b> ${esc(f.cyc.base2.lowD)} <b>${fmtInt(f.cyc.base2.low)}원</b> — ${f.cyc.base2.held}거래일째 안 깨짐 · 최근 40일 박스 폭 ${f.cyc.base2.box}% (2차 매집 후보 조건)` : ''}<br><small class="muted">${f.acc2 ? '고점에서 120거래일 넘게 지나, 아래 매집 시기·평단은 고점 뒤 구간(2차 매집 후보)으로 계산했어요' : `매집 평단은 급등 시작 전 거래로만 계산해요${f.accBeyond ? ' — 급등 시작이 차트 자료(약 1년 2개월) 맨 앞이라 그 전 매집 구간은 계산할 수 없음' : ''}`}</small></div>` : '';
    const MK = { acc: '매집봉', wick: '윗꼬리 매물 테스트', absorb: '물량 받아먹는 음봉', dry: '거래량 마름', close: '종가 관리 의심', up30: '상한가', dn30: '하한가' };
    const MKD = { acc: '평소 4배↑ 거래량으로 +6%↑ 오른 양봉 (박스권에서)', wick: '거래량 실린 긴 윗꼬리 — 위쪽 매물을 시험', absorb: '거래량 실린 음봉인데 주가는 거의 안 빠짐 — 파는 물량을 받아먹음', dry: '물량을 모은 뒤 거래가 마르는 모습', close: '종가가 일정하게 맞춰지는 모습', up30: '참고용 (점수 없음)', dn30: '참고용 (점수 없음)' };
    const marks = (f.marks || []).slice().reverse();
    const markBox = marks.length ? `<div class="mp-marks"><h5>🕯 매집봉 흔적 <small>일봉 모양으로 찾음 · 그날·전날 공시가 있거나 시장 전체가 ±2.5% 움직인 날, 그 뒤 봉의 저점을 깬 경우는 제외${f.cscore ? ` · 점수 +${f.cscore}` : ''}</small></h5><ul>${marks.map((m) => `<li class="${m.ok ? 'ok' : 'no'}"><b>${m.ok ? '✓' : '✗'} ${esc(m.d)} ${esc(MK[m.k] || m.k)}</b>${m.p ? ` 종가 ${fmtInt(m.p)}원` : ''}${m.vx != null && m.k !== 'dry' ? ` · 거래량 ${m.vx}배` : ''}${m.ch != null ? ` · ${m.ch > 0 ? '+' : ''}${m.ch}%` : ''}<br><small class="muted">${['dry', 'close'].includes(m.k) && m.why ? esc(m.why) : `${esc(MKD[m.k] || '')}${m.why ? ' — ' + esc(m.why) : ''}`}</small></li>`).join('')}</ul></div>` : `<div class="mp-marks"><h5>🕯 매집봉 흔적</h5><p class="muted sm">${Array.isArray(f.marks) ? '최근 약 10개월 일봉에서 조건에 맞는 봉이 없어요' : '이전 방식으로 분석된 기록이에요 — 다음 분석(또는 지금 다시 분석) 때 채워져요'}</p></div>`;
    // 매집 시기·평단은 규칙 계산(일봉·공시 원문)이 기본 · AI 해석은 다를 때만 작게 (예전 AI 문장이 틀린 구간을 말하던 문제)
    const rc = x.dir?.cost;
    const rulePer = f.accStart ? `${f.accStart} ~ ${f.accEnd || ''}` : null;
    const aiPer = a?.acc?.period && a.acc.period !== rulePer ? a.acc.period : null;
    const accLine = `<div class="mp-accbox"><b>🧲 매집 추정 시기</b> ${rulePer ? esc(rulePer) : f.accBeyond ? '자료 범위(약 1년 2개월) 이전 — 계산 불가' : '—'}${f.accStart ? ` <small class="muted">(${f.cyc ? (f.acc2 ? '고점 뒤 2차 매집 후보 구간 · ' : '급등 시작 전 박스 구간 · ') : ''}${f.accDays || 0}거래일${f.accObv != null ? ` · 순매수 강도 ${f.accObv}%` : ''}${f.accLow ? ` · 그 구간 가격 ${fmtInt(f.accLow)}~${fmtInt(f.accHigh)}원` : ''})</small>` : ''}${aiPer ? `<br><small class="muted">AI 해석 기간: ${esc(aiPer)} (규칙 계산과 다름 — 규칙 계산 기준으로 보세요)</small>` : ''}
      <br><b>💰 추정 세력 평단</b> ${rc ? (rc.rep && rc.high !== rc.low ? `약 ${fmtInt(rc.rep)}원 <small class="muted">(범위 ${fmtInt(rc.low)} ~ ${fmtInt(rc.high)}원 · ${esc(rc.repS || '')})</small>` : `${fmtInt(rc.low)}${rc.high !== rc.low ? ' ~ ' + fmtInt(rc.high) : ''}원`) : x.dir?.old ? `<span class="muted">지금 평단 근거 없음 — 지난 판(${esc(x.dir.old.topD)} 고점 전) 평단 약 ${fmtInt(x.dir.old.rep)}원은 참고만</span>` : f.vwapAcc ? `${fmtInt(f.vwapAcc)}원` : '—'} <small class="muted">(${[f.vwapAcc ? `매집 구간 거래량 가중 평균 ${fmtInt(f.vwapAcc)}원` : '', (x.px || []).some((p) => p.p && !['pledge', 'majsell', 'risk', 'insider'].includes(p.kind)) ? '공시 원문 가격(전환가·발행가·인수 단가 등)' : ''].filter(Boolean).join(' + ') || '근거 없음'})</small>${a?.cost && rc && (Math.abs(a.cost.low - rc.low) / rc.low > 0.05 || Math.abs((a.cost.high || a.cost.low) - rc.high) / rc.high > 0.05) ? `<br><small class="muted">AI가 인용한 평단 ${fmtInt(a.cost.low)}${a.cost.high && a.cost.high !== a.cost.low ? ' ~ ' + fmtInt(a.cost.high) : ''}원 (예전 분석일 수 있음)</small>` : ''}</div>`;
    const d = x.dir || {};
    const srcA = (r) => (/^DART-/.test(r.src || '') ? ` <a class="mp-src" href="/p/${esc(r.src)}" target="_blank">공시</a>` : ` <small class="mp-src">${esc(r.src === '계산' ? '자동 계산' : r.src === '일봉' ? '거래 데이터' : r.src || '')}</small>`);
    const reasons = (arr) => (arr || []).map((r) => `<li>${esc(r.t)}${srcA(r)}</li>`).join('');
    const aiLine = (r) => `<li>${hl(r.t)} <small class="mp-ref">근거 ${esc(r.refs.join(','))}</small></li>`;
    const notes = (d.notes || []).length ? `<div class="mp-notes">${d.notes.map((n) => `<p>ℹ️ ${esc(n)}</p>`).join('')}</div>` : '';
    const net = (x.links || []).length ? `<div class="mp-net"><h5>🕸 같은 세력 연결 의심 <small>같은 공시 제출인·인수자 이름이 다른 종목에도 나옴 (동명이인·우연일 수 있음)</small></h5><ul>${x.links.map((l) => `<li><b>${esc(l.who)}</b> → ${l.others.map((o) => `<button class="link" data-open-co="KR|${esc(o.c)}|${esc(o.nm || '')}">${esc(o.nm || o.c)}</button> <small class="muted">${esc(o.d)} ${esc(MP_EV[o.k] || '')}</small>`).join(', ')}</li>`).join('')}</ul></div>` : '';
    const pn = penaltyBox(x);
    const meta = [x.ind ? `업종 ${esc(x.ind)}` : '', x.capPct != null ? `시가총액 순위 하위 ${Math.round(x.capPct * 100)}%` : '', x.warn ? `거래소 ${esc(x.warn.lv)}${x.warn.date ? ' ' + esc(x.warn.date) : ''}` : ''].filter(Boolean).join(' · ');
    const dirBox = (meta ? `<p class="muted sm" style="margin:0 0 .4rem">${meta}</p>` : '') + pn + net + notes + `<div class="mp-dir"><div class="mp-dcol up"><h5>📈 상승 쪽 근거 <small>확인된 사실·자동 계산 · ${d.upS || 0}/10점</small></h5>${d.up?.length ? `<ul>${reasons(d.up)}</ul>` : '<p class="muted sm">해당 없음</p>'}</div><div class="mp-dcol down"><h5>📉 하락 쪽 근거 <small>확인된 사실·자동 계산 · ${d.downS || 0}/10점</small></h5>${d.down?.length ? `<ul>${reasons(d.down)}</ul>` : '<p class="muted sm">해당 없음</p>'}</div></div>`;
    const KN = { cost: ['원가', 'cost'], floor: ['지지', 'floor'], risk: ['위험선', 'risk'], res: ['매물대', 'res'] };
    const lvRow = (l) => `<li class="lv-${KN[l.kind]?.[1] || 'cost'}"><span class="mp-lvp">${fmtInt(l.p)}원</span><span class="mp-lvg">${l.gap == null ? '' : `${l.gap > 0 ? '+' : ''}${l.gap}%`}</span><span class="mp-lvt"><b>${esc(l.s)}</b> <span class="mp-chip">${KN[l.kind]?.[0] || ''}</span>${l.also?.length ? ` <small class="muted">(＝${esc(l.also.join(', '))})</small>` : ''}<br><small class="muted">${esc(l.t)}</small>${l.ref ? ` <a class="mp-src" href="/p/${esc(l.ref)}" target="_blank">공시</a>` : ''}</span></li>`;
    const lvs = d.levels || [];
    const cur = x.close != null ? `<li class="lv-now"><span class="mp-lvp">${fmtInt(x.close)}원</span><span class="mp-lvg">현재가</span><span class="mp-lvt">◀ 지금</span></li>` : '';
    const ladder = lvs.length ? `<ul class="mp-ladder">${lvs.filter((l) => x.close == null || l.p > x.close).map(lvRow).join('')}${cur}${lvs.filter((l) => x.close != null && l.p <= x.close).map(lvRow).join('')}</ul>` : '';
    const rrLine = d.rr ? `<div class="mp-rrbox">⚖️ <b>손익비 1 : ${d.rr.v}${d.rr.big ? '+ (20 넘음 — 목표가 너무 멀어 참고만)' : ''}</b> — 1차 목표 ${fmtInt(d.rr.t)}원(${esc(d.rr.ts)}, +${d.rr.up}%)까지 vs 손절 기준 ${fmtInt(d.rr.s)}원(${esc(d.rr.ss)}, ${d.rr.dn}%)까지${d.rr.min3 ? ' · 아래 폭이 3% 미만이라 3%로 계산' : ''}${d.rr.minD ? `<br><small class="muted">손절 기준은 평소 하루 흔들림 폭${d.rr.rng != null ? ` ${d.rr.rng}%` : ''} × 1.5 = −${d.rr.minD}%보다 아래 지지선 (그 안쪽 지지는 흔들기에 깨지기 쉬워서 뺌)${d.rr.near ? ` · 가까운 지지 ${fmtInt(d.rr.near.s)}원(${esc(d.rr.near.ss)}) 기준이면 1 : ${d.rr.near.v}` : ''}</small>` : ''}${d.rr.be ? `<br><small>⚠ 1차 목표는 세력 평단(본전) 가격 — 세력이 손실 구간이라 여기까지는 올릴 이유가 있지만, 진짜 목표는 그 위${d.rr.t2 ? ` (${fmtInt(d.rr.t2)}원 등)` : ''}</small>` : ''}${d.rr.far ? `<br><small>손절 기준까지 ${d.rr.dn}%로 멀어요 — 단타 손절 −7%로 잡으면 손익비 1 : ${d.rr.far}</small>` : ''}${d.rr.t2 ? `<br><small class="muted">2차 목표 ${fmtInt(d.rr.t2)}원(${esc(d.rr.t2s)})까지 보면 손익비 1 : ${Math.round(((d.rr.t2 - x.close) / Math.max(x.close - d.rr.s, x.close * 0.03)) * 10) / 10}</small>` : ''}</div>` : '';
    const tgtLine = d.tgt?.length ? `<div class="mp-tg">${d.tgt.map((t, k) => (typeof t === 'number' ? `<span>${k + 1}차 <b>${fmtInt(t)}원</b> <small class="muted">이전 방식(평단 배수)</small></span>` : `<span>${k + 1}차 <b>${fmtInt(t.p)}원</b> ${t.s ? esc(t.s) : t.m ? `<small class="muted">평단 ${t.m}배(이전 방식)</small>` : ''}${t.gap != null ? ` (+${t.gap}%)` : ''}</span>`)).join('')}</div>` : lvs.length ? '<p class="muted sm">현재가 위쪽에 근거 있는 가격이 없음 (이미 공시 원가·과거 고점을 모두 넘음)</p>' : '';
    const tgtBox = lvs.length || d.tgt?.length || d.dates?.length ? `<div class="mp-tgt"><div><h5>🎯 참고 목표 가격 <small>공시에 적힌 원가 · 과거 고점(매물대)으로 만든 가격 사다리 · 세력의 실제 목표가는 어떤 공시에도 안 나옴</small></h5>${rrLine}${tgtLine}${ladder || (Array.isArray(d.tgt) && d.tgt[0]?.m ? '<p class="muted sm">이전 방식(배수) 결과 — 다음 분석 때 공시 기준으로 바뀜</p>' : '<p class="muted sm">근거 가격 없음</p>')}</div>
      <div><h5>🗓 물량이 풀릴 수 있는 날 <small>CB는 원문의 전환청구기간을 읽고, 못 읽으면 발행 1년 뒤로 추정</small></h5>${d.dates?.length ? `<ul>${d.dates.map((z) => `<li class="${z.past ? 'muted' : ''}"><b>${esc(z.d)}</b> ${esc(z.t)}${z.real ? ' <span class="mp-chip vol">원문 확인</span>' : ''}${z.past ? ' (지남)' : ''} <a class="mp-src" href="/p/${esc(z.ref)}" target="_blank">공시</a></li>`).join('')}</ul>` : '<p class="muted sm">관련 공시(CB·3자배정·전환청구) 없음</p>'}</div></div>` : '';
    const UK = { summary: '요약', upWhy: '상승 쪽', downWhy: '하락 쪽', counter: '반대 근거', watch: '볼 신호', evidence: '의심 근거' };
    const aiBox = a ? `<div class="mp-ai"><b>🤖 AI 해석</b> <small class="muted">근거 번호가 확인된 문장은 그대로, 확인 안 된 문장은 아래 ⚠ 참고용으로 따로 보여줘요</small>${a.summary ? `<p class="mp-aisum">${hl(a.summary)}</p>` : a.oldSummary ? `<p>${hl(a.oldSummary)} <small class="mp-unv">⚠ 예전 분석 요약 — 지금 계산과 숫자가 다른 부분이 있어요</small></p>` : ''}
      ${a.upWhy?.length || a.downWhy?.length ? `<div class="mp-dir ai-dir"><div class="mp-dcol up"><h5>📈 상승 쪽 해석</h5>${a.upWhy?.length ? `<ul>${a.upWhy.map(aiLine).join('')}</ul>` : '<p class="muted sm">없음</p>'}</div><div class="mp-dcol down"><h5>📉 하락 쪽 해석</h5>${a.downWhy?.length ? `<ul>${a.downWhy.map(aiLine).join('')}</ul>` : '<p class="muted sm">없음</p>'}</div></div>` : ''}
      ${a.evidence?.length ? `<h5>의심 근거 <small class="muted">(이전 방식 분석 · 근거 검증 전 — 다음 분석 때 새 방식으로 바뀜)</small></h5><ul>${li(a.evidence)}</ul>` : ''}${a.counter?.length ? `<h5>반대 근거 (정상일 가능성)</h5><ul>${a.counter.map((c) => (typeof c === 'string' ? `<li>${hl(c)}</li>` : aiLine(c))).join('')}</ul>` : ''}${a.watch?.length ? `<h5>앞으로 볼 신호</h5><ul>${li(a.watch)}</ul>` : ''}
      ${a.unv?.length ? `<h5>⚠ 근거 확인이 안 된 AI 문장 <small class="muted">(참고용 — 사실 목록에서 숫자·근거를 찾지 못했어요. 그대로 믿지 말고 원문 공시로 확인)</small></h5><ul class="mp-unvl">${a.unv.map((u) => `<li class="${u.k === 'upWhy' ? 'ai-u' : u.k === 'downWhy' ? 'ai-d' : ''}"><span class="mp-chip">${esc(UK[u.k] || u.k)}</span> ${hl(u.t)} <small class="muted">· ${esc(u.why)}</small></li>`).join('')}</ul>` : ''}
      ${a.facts?.length ? `<details class="mp-facts"><summary>AI에게 준 사실 목록 (${a.facts.length}개)</summary><ol>${a.facts.map((f) => `<li><b>${esc(f.id)}</b> ${esc(f.t)} <small class="muted">· ${esc(f.src)}</small></li>`).join('')}</ol></details>` : ''}</div>` : '';
    const grid = `<div class="mp-grid"><div><h5>공시에서 찾은 가격</h5>${pxs ? `<ul>${pxs}</ul>` : '<p class="muted sm">없음</p>'}<h5>거래 패턴</h5><ul class="mp-f"><li>매집 구간 평균가 <b>${f.vwapAcc ? fmtInt(f.vwapAcc) + '원' : '—'}</b>${f.accStart ? ` <small class="muted">(${esc(f.accStart)}~)</small>` : ''}</li><li>고거래량일 평균가 <b>${f.vwapHeavy ? fmtInt(f.vwapHeavy) + '원' : '—'}</b></li><li>120일 평균가 <b>${f.vwap120 ? fmtInt(f.vwap120) + '원' : '—'}</b></li><li>60일 저점 대비 <b>${f.fromLow60 ?? '—'}%</b> · 20일 고점 대비 <b>${f.offHigh20 ?? '—'}%</b></li><li>거래량(평소 대비) 5일 <b>${f.volX5 ?? '—'}배</b> · 20일 <b>${f.volX20 ?? '—'}배</b> · 10일 최대 <b>${f.maxVolX10 ?? '—'}배</b></li><li>폭증 전 60일 박스 폭 <b>${f.box60 ?? '—'}%</b>${f.spikeDate ? ` · 첫 폭증일 ${esc(f.spikeDate)}` : ''}</li></ul>
        ${x.log?.length ? `<h5>자동 수정 기록</h5><ul class="mp-logl">${x.log.slice(0, 8).map((l) => `<li><span>${esc(fmtDT(new Date(l.at)).md)} ${esc(fmtDT(new Date(l.at)).hm)}</span> ${esc(l.msg)}</li>`).join('')}</ul>` : ''}
        ${x.hist?.length > 1 ? `<h5>레이더 등장 기록</h5><p class="muted sm">${x.hist.map((h) => `${esc(md(h.d))} ${esc(h.st)}(${h.s})`).join(' · ')}</p>` : ''}</div>
      <div><h5>근거 공시 (최근 180일)</h5><ul class="mp-ev">${(x.events || []).map((e) => `<li><span>${esc(new Date(e.ms + 9 * 3600e3).toISOString().slice(2, 10))}</span><em>${esc(MP_EV[e.kind] || e.kind)}</em><a href="/p/${esc(e.id)}" target="_blank">${esc(e.title)}</a>${e.sum ? `<small>${esc(e.sum)}</small>` : ''}</li>`).join('') || '<li class="muted">없음 (거래 패턴만)</li>'}</ul></div></div>`;
    return { pexBox, myBtn, rbBox, ckBox, cycLine, accLine, markBox, wf, dirBox, tgtBox, aiBox, grid };
  }
  document.addEventListener('click', (e) => {
    let b;
    if ((b = e.target.closest('[data-mp-date]'))) { loadManip(b.dataset.mpDate || null); return; }
    if (e.target.closest('[data-mp-run]')) { if (confirm('오늘 작전 의심 레이더 분석을 지금 시작할까요? (전 종목 · 약 1시간 · AI 15회 사용)')) loadManip(null, true); return; }
    const row = e.target.closest('.mp-row[data-mp-i]');
    if (row && !e.target.closest('a, button')) { const x = S.mp?.doc?.list?.[Number(row.dataset.mpI)]; if (x) goRadarStock(x.code); }
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'mpOld' && e.target.value) loadManip(e.target.value); });
  // 영상 소재 노트
  async function loadVnote(mk, date, make) {
    const box = $('#vnBody'); if (!box) return;
    if (make) box.innerHTML = `<div class="loading"><span class="spin"></span>${make === 'KR' ? '국장' : '미장'} 노트를 AI가 쓰는 중… (30초~1분)</div>`;
    const q = make ? `&make=${make}` : mk ? `&mk=${mk}&date=${date}` : '';
    let j;
    try { j = await getJSON(`/api/admin?key=${encodeURIComponent(S.admin)}&vnote=1${q}`, { cache: 'no-store' }); } catch (e) { j = { ok: false, error: e.message }; }
    if (!$('#vnBody')) return;
    if (!j.ok) { $('#vnBody').innerHTML = `<p class="err">${esc(j.error || '불러오지 못했어요')}</p>`; return; }
    S.vnote = j.note;
    const n = j.note, idx = j.idx || [];
    const tabs = idx.length ? `<div class="chips vn-tabs">${idx.slice(0, 10).map((x) => `<button class="${n && x.mk === n.mk && x.date === n.date ? 'on' : ''}" data-vn="${esc(x.mk)}|${esc(x.date)}">${esc(md(x.date))} ${x.mk === 'KR' ? '국장' : '미장'}</button>`).join('')}</div>` : '';
    if (!n) { $('#vnBody').innerHTML = tabs + '<p class="muted">아직 정리된 분석이 없어요. 장 마감 뒤 자동으로 만들어지고, 아래 버튼으로 바로 만들 수도 있어요.</p>'; return; }
    const cp = (txt) => `<button class="vn-cp" data-vn-copy="${esc(txt)}" title="복사">복사</button>`;
    if (n.v === 2) {
      const ix = (n.ix || []).map((x) => `<span class="vn-ix">${esc(x.label)} <b>${x.price != null ? fmtPx(x.price) : ''}</b> <em class="${dirCls(x.pct)}">${fmtPct(x.pct)}</em></span>`).join('');
      $('#vnBody').innerHTML = `${tabs}<div class="vn-sum"><b>${esc(n.date)} ${n.mk === 'KR' ? '국장' : '미장'}</b> ${esc(n.summary)}</div>${ix ? `<div class="vn-ixs">${ix}</div>` : ''}
        ${n.overview ? `<p class="vn-ov">${esc(n.overview)}</p>` : ''}
        <ol class="vn-topics">${n.sections.map((t) => `<li><div class="vn-t"><b>${esc(t.title)}</b>${t.stocks?.length ? `<em>${esc(t.stocks.join(', '))}</em>` : ''}</div><p>${esc(t.body)}</p>${t.facts?.length ? `<ul>${t.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>
        <div class="vn-cols">${n.themes?.strong?.length || n.themes?.weak?.length ? `<div><h4>테마·업종</h4><ul class="vn-plain">${(n.themes.strong || []).map((x) => `<li><span class="up">▲</span> ${esc(x)}</li>`).join('')}${(n.themes.weak || []).map((x) => `<li><span class="down">▼</span> ${esc(x)}</li>`).join('')}</ul></div>` : ''}
        <div>${n.earnings?.length ? `<h4>실적</h4><ul class="vn-plain">${n.earnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${n.checks?.length ? `<h4>다음 거래일 체크</h4><ul class="vn-plain">${n.checks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div></div>
        <div class="chips" style="margin-top:.5rem"><button class="btn sm primary" data-vn-all>분석 전체 복사</button>${n.edId ? `<a class="btn sm" href="/i/${esc(n.edId)}" target="_blank">그날 주요 이슈 보기</a>` : ''}</div>
        <p class="note">그날 '오늘 주요 이슈'·급등 이유·테마·실적 판정을 바탕으로 AI가 정리했어요. 숫자는 원문으로 한 번 더 확인하세요.</p>`;
      return;
    }
    $('#vnBody').innerHTML = `${tabs}<div class="vn-sum"><b>${esc(n.date)} ${n.mk === 'KR' ? '국장' : '미장'}</b> ${esc(n.summary)}</div>
      ${n.hook ? `<div class="vn-hook"><span>오프닝</span>${esc(n.hook)}${cp(n.hook)}</div>` : ''}
      <ol class="vn-topics">${n.topics.map((t) => `<li><div class="vn-t"><b>${esc(t.title)}</b>${t.tickers?.length ? `<em>${esc(t.tickers.join(', '))}</em>` : ''}</div><p>${esc(t.why)}</p>${t.facts?.length ? `<ul>${t.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}${t.angle ? `<p class="vn-angle">▶ ${esc(t.angle)}</p>` : ''}</li>`).join('')}</ol>
      <div class="vn-cols"><div><h4>제목 후보</h4><ul class="vn-copy">${n.titles.map((x) => `<li><span>${esc(x)}</span>${cp(x)}</li>`).join('')}</ul></div>
      <div><h4>썸네일 문구</h4><ul class="vn-copy">${n.thumbs.map((x) => `<li><span>${esc(x)}</span>${cp(x)}</li>`).join('')}</ul><h4>쇼츠 아이디어</h4><ul class="vn-copy">${n.shorts.map((x) => `<li><span>${esc(x)}</span>${cp(x)}</li>`).join('')}</ul></div></div>
      <div class="chips" style="margin-top:.5rem"><button class="btn sm" data-vn-all>노트 전체 복사</button>${n.edId ? `<a class="btn sm" href="/i/${esc(n.edId)}" target="_blank">그날 주요 이슈 보기</a>` : ''}</div>
      <p class="note">AI가 그날 '오늘 주요 이슈'·급등 이유·실적 판정만 보고 쓴 초안이에요. 숫자는 영상에 쓰기 전에 원문으로 한 번 더 확인하세요.</p>`;
  }
  function vnoteText(n) {
    if (n.v === 2) return [`[${n.date} ${n.mk === 'KR' ? '국장' : '미장'} 분석] ${n.summary}`, (n.ix || []).map((x) => `${x.label} ${x.price ?? ''} (${fmtPct(x.pct)})`).join(' / '), '', n.overview || '', '', ...n.sections.map((t, i) => `${i + 1}. ${t.title}${t.stocks?.length ? ` (${t.stocks.join(', ')})` : ''}\n${t.body}${(t.facts || []).length ? '\n' + t.facts.map((f) => '- ' + f).join('\n') : ''}\n`), (n.themes?.strong?.length || n.themes?.weak?.length) ? `[테마·업종]\n${[...(n.themes.strong || []).map((x) => '▲ ' + x), ...(n.themes.weak || []).map((x) => '▼ ' + x)].join('\n')}\n` : '', n.earnings?.length ? `[실적]\n${n.earnings.map((x) => '- ' + x).join('\n')}\n` : '', n.checks?.length ? `[다음 거래일 체크]\n${n.checks.map((x) => '- ' + x).join('\n')}` : ''].filter((x) => x !== '').join('\n').replace(/\n{3,}/g, '\n\n');
    return [`[${n.date} ${n.mk === 'KR' ? '국장' : '미장'}] ${n.summary}`, n.hook ? `오프닝: ${n.hook}` : '', '', ...n.topics.map((t, i) => `${i + 1}. ${t.title}${t.tickers?.length ? ` (${t.tickers.join(', ')})` : ''}\n- ${t.why}\n${(t.facts || []).map((f) => '· ' + f).join('\n')}${t.angle ? '\n▶ ' + t.angle : ''}`), '', '[제목 후보]', ...n.titles.map((x) => '- ' + x), '', '[썸네일]', ...n.thumbs.map((x) => '- ' + x), '', '[쇼츠]', ...n.shorts.map((x) => '- ' + x)].filter((x) => x !== null).join('\n');
  }
  async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('복사했어요'); } catch { toast('복사하지 못했어요'); } }
  document.addEventListener('click', (e) => {
    let b;
    if ((b = e.target.closest('[data-vn]'))) { const [mk, date] = b.dataset.vn.split('|'); loadVnote(mk, date); return; }
    if ((b = e.target.closest('[data-vn-copy]'))) { copyText(b.dataset.vnCopy); return; }
    if (e.target.closest('[data-vn-all]') && S.vnote) copyText(vnoteText(S.vnote));
  });
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
      if (act === 'chcloseKR' || act === 'chcloseUS') { const mk = act.slice(-2); msg(`${mk === 'KR' ? '국장' : '미장'} 마감 정리 이미지를 만들어 보내는 중… (20초쯤 걸려요)`); const j = await getJSON(`/api/admin?key=${k}&ch=close&mk=${mk}`, { cache: 'no-store' }).catch((e) => ({ ok: false, error: e.message })); msg(j.ok ? '채널에 마감 정리 이미지를 보냈어요. 텔레그램 채널을 확인하세요.' : '보내지 못했어요: ' + (j.error || '')); return; }
      if (act === 'vnKR' || act === 'vnUS') { if (!confirm(`${act === 'vnKR' ? '국장' : '미장'} 영상 소재 노트를 지금 재료로 새로 만들까요? (AI 1회 사용)`)) return; return loadVnote(null, null, act.slice(2)); }
      if (act === 'wkMake' || act === 'wkSend') {
        const send = act === 'wkSend';
        if (send && !confirm('이번 주 주간 정리 카드를 텔레그램 채널에 지금 올릴까요?')) return;
        const m2 = (t) => { if ($('#vnMsg')) $('#vnMsg').textContent = t; };
        m2(send ? '주간 카드를 만들어 채널로 보내는 중… (1분쯤)' : 'AI가 이번 주 핵심 10가지를 고르고 이미지를 만드는 중… (1분쯤)');
        const j = await getJSON(`/api/admin?key=${k}&week=${send ? 'send' : 'make'}`, { cache: 'no-store' }).catch((e) => ({ ok: false, error: e.message }));
        if (!j.ok) return m2('실패: ' + (j.error || ''));
        m2(send ? '채널에 주간 정리 카드를 보냈어요.' : '만들었어요. 아래 이미지를 길게 눌러(우클릭) 저장할 수 있어요. 토요일 자동 게시 때 이 내용이 쓰여요.');
        if ($('#wkPrev') && j.img) $('#wkPrev').innerHTML = `<a href="${esc(j.img)}" target="_blank"><img src="${esc(j.img)}" alt="주간 정리 카드" class="wk-img"></a>`;
        return;
      }
      if (act === 'chtest') { msg('채널로 테스트 메시지를 보내는 중…'); const j = await getJSON(`/api/admin?key=${k}&ch=test`, { cache: 'no-store' }).catch((e) => ({ ok: false, error: e.message })); msg(j.ok ? '채널에 테스트 메시지를 보냈어요. 텔레그램 채널을 확인하세요.' : '보내지 못했어요: ' + (j.error || '')); return; }
      if (act === 'chon' || act === 'choff') { await getJSON(`/api/admin?key=${k}&ch=${act.slice(2)}`, { cache: 'no-store' }); return renderAdmin(); }
      if (act === 'chset') { const q = `minImp=${$('#chImp').value}&perHour=${$('#chPer').value}&kr=${$('#chKr').checked ? 1 : 0}&us=${$('#chUs').checked ? 1 : 0}&issues=${$('#chIss').checked ? 1 : 0}&digest=${$('#chDg').checked ? 1 : 0}&surge=${$('#chSg').checked ? 1 : 0}&close=${$('#chCl').checked ? 1 : 0}&weekly=${$('#chWk').checked ? 1 : 0}`; await getJSON(`/api/admin?key=${k}&ch=set&${q}`, { cache: 'no-store' }); msg('채널 설정을 저장했어요.'); return renderAdmin(); }
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
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(() => syncPush(false)).catch(() => {});
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
    $('#mkSeg').addEventListener('click', (e) => {
      // ★ 관심종목: 누르면 목록이 관심종목 공시·보도자료로 바뀌고, 다시 누르면 전체로
      if (e.target.closest('[data-watch]')) { const y = $('.feed-wrap')?.getBoundingClientRect().top + window.scrollY - 120; setView(S.view === 'watch' ? 'home' : 'watch'); if (y > 0) window.scrollTo({ top: y }); return; }
      const b = e.target.closest('button[data-mk]'); if (!b) return; S.mk = b.dataset.mk; S.limit = 80; renderAll();
    });
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
    // 모바일 트렌딩 슬라이드: 점 표시 + 5초마다 다음 카드 (손으로 넘기는 중엔 멈춤)
    { const tr = $('#trend'), dots = $('#trendDots'); let hold = 0;
      const cur = () => { const w = tr.firstElementChild?.getBoundingClientRect().width || 1; return Math.round(tr.scrollLeft / (w + 10)); };
      const paint = () => { const n = tr.children.length, i = cur(); if (dots.childElementCount !== n) dots.innerHTML = Array.from({ length: n }, (_, k) => `<i data-k="${k}"></i>`).join(''); [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); };
      const go = (i) => { const c = tr.children[i]; if (c) tr.scrollTo({ left: c.offsetLeft - tr.firstElementChild.offsetLeft, behavior: 'smooth' }); };
      tr.addEventListener('scroll', () => requestAnimationFrame(paint), { passive: true });
      ['touchstart', 'pointerdown'].forEach((ev) => tr.addEventListener(ev, () => { hold = Date.now(); }, { passive: true }));
      dots.addEventListener('click', (e) => { const d = e.target.closest('[data-k]'); if (d) { hold = Date.now(); go(Number(d.dataset.k)); } });
      new MutationObserver(paint).observe(tr, { childList: true });
      setInterval(() => { if (!matchMedia('(max-width: 720px)').matches || document.hidden || S.view !== 'home' || Date.now() - hold < 8000 || tr.children.length < 2) return; const i = cur(); go(i + 1 >= tr.children.length ? 0 : i + 1); }, 5000); }
    bindSearch($('#search'), $('#suggest'), { feed: true });
    bindSearch($('#search2'), $('#suggest2'), { feed: true });
    bindSearch($('#coSearch'), $('#coSuggest'), { feed: false });
    $('#btnBell').addEventListener('click', (e) => { e.stopPropagation(); const p = $('#bellPanel'); p.hidden = !p.hidden; if (!p.hidden) { renderBell(); $('#bellDot').hidden = true; } });
    $('#btnUser').addEventListener('click', openSettings);
    $('#flowTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.flowTab = b.dataset.tab; save('gk_flowtab', S.flowTab); renderFlows(); });
    $('#flowSub').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; S[b.parentElement.dataset.sub] = b.dataset.v; renderFlows(); });

    document.addEventListener('change', (e) => { const el = e.target.closest('[data-set]'); if (el) setSetting(el.dataset.set, el.checked, el); });
    document.addEventListener('click', (e) => { const mn = e.target.closest('[data-mn]'); if (mn) { e.preventDefault(); document.getElementById('mn' + mn.dataset.mn)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } if (e.target.closest('[data-to-top]')) window.scrollTo({ top: 0, behavior: 'smooth' }); if (e.target.closest('.ab-foot [data-go="home"], .mn-go')) setTimeout(() => window.scrollTo({ top: 0 }), 0); });
    // 하단 사이트 메뉴: 새로 고침 없이 화면만 바꿈
    document.addEventListener('click', (e) => { const a = e.target.closest('.f-menu a'); if (!a || e.ctrlKey || e.metaKey) return; const v = PATH_SEC[a.getAttribute('href').slice(1)]; if (!v) return; e.preventDefault(); setView(v); window.scrollTo({ top: 0 }); });
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
      if (co) { const [m, tk, n] = co.dataset.openCo.split('|'); if (co.closest('.suggest')) addHist({ k: 'co', m, t: tk, n }); if (co.closest('#suggest')) $('#search').value = ''; if (co.closest('#suggest2')) $('#search2').value = ''; $('#suggest').hidden = true; $('#suggest2').hidden = true; $('#coSuggest').hidden = true; openCompany(m, tk, n, { corpCode: co.dataset.corp || undefined, exchange: co.dataset.ex || undefined }); return; }
      const thr = t.closest('[data-th-no], [data-th-us]');
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
    window.addEventListener('popstate', () => { const pm = $('#pbModal'); if (S.skipRoute || (pm && !pm.hidden)) { S.skipRoute = false; return; } route(); }); // 종목 목록 창 닫기(뒤로 가기)는 화면 이동 아님
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
  bindHalts();
  bindReact();
  bindTdir();
  bindCact(); bindEwk(); bindGuru();
  syncNavMore();
  { // 공유 링크 (?top=digest&mk=US)로 들어오면 AI 핵심 공시를 바로 보여줌
    const qp = new URLSearchParams(location.search);
    if (qp.get('top') === 'digest') { S.top = 'digest'; const m = qp.get('mk'); if (['ALL', 'KR', 'US'].includes(m)) { S.digestMk = m; save('gk_dmk', m); $$('#digestSeg button').forEach((b) => b.classList.toggle('on', b.dataset.dmk === m)); } history.replaceState(null, '', '/' + location.hash); }
  }
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
  every(15000, pollPopular); // 실시간 상승·하락·인기: 15초마다
  every(180000, pollEarnv); // 실적 발표 판정 (컨센서스 대비)
  // ── 새 버전 자동 적용: 2분마다 배포 버전을 확인해서 바뀌었으면 스스로 새로 고침 ──
  //  (입력 중이거나 상세 글을 읽는 중이면 기다렸다가, 화면을 잠시 안 볼 때·목록으로 돌아올 때 적용)
  { const myV = (document.querySelector('script[src*="app.js?v="]')?.src.match(/v=(\d+)/) || [])[1];
    let newV = null, lastAct = Date.now();
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true }));
    const busy = () => { const a = document.activeElement; return (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.value) || S.view === 'item' || !$('#modal')?.hidden; };
    const apply = () => { if (!newV || busy()) return; try { sessionStorage.setItem('gk_scroll', String(scrollY)); } catch {} location.reload(); };
    const check = async () => {
      if (!myV) return;
      try { const j = await getJSON('/api/ver?t=' + Date.now()); if (j.v && j.v !== myV) newV = j.v; } catch {}
      if (newV && (document.hidden || Date.now() - lastAct > 60e3)) apply(); // 안 보고 있거나 1분 넘게 손을 안 댔으면 바로
      else if (newV && !check.toasted) { check.toasted = true; toast('새 버전이 나왔어요 · 잠시 후 자동으로 적용돼요'); }
    };
    setInterval(check, 120e3); setTimeout(check, 20e3);
    document.addEventListener('visibilitychange', () => { if (document.hidden && newV) apply(); });
    addEventListener('hashchange', () => { if (newV) setTimeout(apply, 300); });
    try { const y = Number(sessionStorage.getItem('gk_scroll')); if (y) { sessionStorage.removeItem('gk_scroll'); setTimeout(() => scrollTo({ top: y }), 800); } } catch {} }
  every(60000, () => { if (S.view === 'themes') loadThemes(true); });
  // 그 밖에 켜 두기만 해도 자동으로 바뀌어야 하는 화면들
  setInterval(() => { if (S.view === 'tdir' && !document.hidden) loadTdir(); }, 60000); // 테마·섹터 관련주
  setInterval(() => { if (S.view === 'popular' && !document.hidden) renderPopularPage(); }, 15000); // 인기 종목 페이지
  setInterval(() => { // 기업 분석: 현재가
    const c = S.coCur;
    if (S.view !== 'company' || !c || document.hidden || !$('#coPx')) return;
    S.quotes.delete(wkey(c.m, c.t));
    fetchQuotes([wkey(c.m, c.t)]).then(() => { const q = quoteOf(c.m, c.t); if (S.coCur === c && q && $('#coPx')) $('#coPx').innerHTML = `<b>${pxStr({ ...q, market: c.m })}</b><span class="${dirCls(q.livePct ?? q.pct)} mono">${(q.livePct ?? q.pct) > 0 ? '▲' : (q.livePct ?? q.pct) < 0 ? '▼' : ''} ${fmtPct(q.livePct ?? q.pct)}</span>`; });
  }, 60000);
  every(5 * 60000, () => { if (S.view === 'sched') loadSched(true); });
  every(45000, () => loadEcon(false));
  setInterval(refreshChips, 15000); // 공시·뉴스의 '발표후 등락'도 15초마다
  every(15 * 60000, () => { if (S.top === 'digest') loadDigest(); });
  every(5 * 60000, () => { if (S.top === 'issue' && S.view in FEED_VIEWS && !document.hidden) loadIssues(true); });
  every(120000, pollViews);
  setInterval(() => { if (S.view === 'flows' && !document.hidden) pollFlows(); }, 180000);
  setInterval(() => { if (S.view in FEED_VIEWS && !document.hidden && !S.sel) renderFeed(); }, 60000);
})();
