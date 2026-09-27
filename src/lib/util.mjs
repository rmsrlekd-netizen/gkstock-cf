// 공통 유틸 — 모든 서버 함수에서 사용

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** JSON 응답 + 엣지 캐시 시간 표시 (worker.mjs 가 x-gk-edge-ttl 을 보고 Cloudflare 캐시에 저장) */
export function json(data, { cdnSeconds = 20, swr = 60, status = 200 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
      'x-gk-edge-ttl': String(status === 200 ? cdnSeconds : Math.min(cdnSeconds, 15)),
      'access-control-allow-origin': '*',
    },
  });
}

// Cloudflare 서버 접속을 막는 사이트(DART·KRX·네이버·GlobeNewswire)와 Gemini(지역 제한): KR_RELAY_URL(중계 서버, 서울)을 거쳐 요청
const KR_HOSTS = /(^|\.)(fss\.or\.kr|krx\.co\.kr|naver\.com|globenewswire\.com)$/i;
export async function fetchWithTimeout(url, opts = {}, ms = 9000) {
  const ctrl = new AbortController();
  let u = String(url);
  const h = new Headers(opts.headers || {});
  if (!h.has('user-agent')) h.set('user-agent', BROWSER_UA);
  if (!h.has('accept-language')) h.set('accept-language', 'ko-KR,ko;q=0.9,en;q=0.8');
  const env = globalThis.process?.env || {};
  if (env.KR_RELAY_URL) {
    let host = '';
    try { host = new URL(u).hostname; } catch {}
    if (opts.relay || KR_HOSTS.test(host)) {
      h.set('x-relay-token', env.KR_RELAY_TOKEN || '');
      u = env.KR_RELAY_URL.replace(/\/+$/, '') + '?u=' + encodeURIComponent(u);
      ms += 4000;
    }
  }
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const { relay, ...rest } = opts;
    return await fetch(u, { ...rest, headers: h, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,%\s+]/g, '');
  if (s === '' || s === 'NA' || s === 'N/A' || s === '--') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function decodeEntities(s = '') {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** KST 기준 yyyymmdd */
export function kstYmd(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** KST 기준 YYYY-MM-DD / YYYY.MM.DD */
export function kstDate(offsetDays = 0, sep = '-') {
  const d = new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
  return d.replace(/-/g, sep);
}

/** 초 단위 ISO(+09:00) 문자열 */
export function kstISO(ms = Date.now()) {
  const d = new Date(ms + 9 * 3600e3).toISOString().slice(0, 19);
  return d + '+09:00';
}

/** 앞부분 maxBytes까지만 읽기 (큰 문서 대비) */
export async function fetchTextCapped(url, opts = {}, ms = 8000, maxBytes = 600000, encoding = 'utf-8') {
  const r = await fetchWithTimeout(url, opts, ms);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const reader = r.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  try { reader.cancel(); } catch {}
  const buf = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  const ct = r.headers.get('content-type') || '';
  const enc = /euc-kr|ms949|ks_c/i.test(ct) ? 'euc-kr' : encoding;
  return decodeText(buf, enc);
}

/** 문자 인코딩 변환 (EUC-KR 미지원 환경이면 UTF-8로) */
export function decodeText(buf, enc = 'utf-8') {
  try { return new TextDecoder(enc).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}
