// 웹 푸시 알림 — 사이트·앱을 닫아 둬도 관심종목 새 공시가 나오면 휴대폰·PC로 알림
//  · 설정 없이 동작: 서버 열쇠(VAPID)는 처음 쓸 때 스스로 만들어 저장소에만 보관 (밖으로 나가지 않음)
//  · 구독 정보: D1 push_sub(기기별) + push_tk(관심종목 → 기기)
//  · 암호화: 웹 푸시 표준(RFC 8291 aes128gcm) — 별도 라이브러리 없이 WebCrypto로
//  · 아이폰은 '홈 화면에 추가'한 앱에서만 받을 수 있음 (iOS 16.4+)
import { getJSON, setJSON, sqlDB } from './store.mjs';
import { fetchWithTimeout } from './util.mjs';

const enc = new TextEncoder();
const b64u = (u8) => { let s = ''; for (const b of new Uint8Array(u8)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const hex = (u8) => [...new Uint8Array(u8)].map((b) => b.toString(16).padStart(2, '0')).join('');

// ───── 서버 열쇠 (VAPID) ─────
let vapidMem = null;
export async function vapid() {
  if (vapidMem) return vapidMem;
  let v = await getJSON('push/vapid');
  if (!v?.pub || !v?.jwk) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), at: Date.now() };
    await setJSON('push/vapid', v);
  }
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  vapidMem = { pub: v.pub, key };
  return vapidMem;
}
const jwtMem = new Map();
async function vapidAuth(endpoint) {
  const aud = new URL(endpoint).origin;
  const c = jwtMem.get(aud);
  if (c && c.exp - Date.now() > 3600e3) return c.h;
  const v = await vapid();
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp, sub: 'https://gk-stock.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc.encode(`${head}.${body}`));
  const h = `vapid t=${head}.${body}.${b64u(sig)}, k=${v.pub}`;
  jwtMem.set(aud, { h, exp: exp * 1000 });
  return h;
}

// ───── 내용 암호화 (RFC 8291) ─────
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
export async function encryptPayload(p256dh, auth, text) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(secret, shared, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

/** 한 기기로 보내기 → 'ok' | 'gone'(구독 끝남 → 지움) | 'err' */
export async function sendPush(sub, msg) {
  try {
    const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(msg));
    const r = await fetchWithTimeout(sub.ep, { method: 'POST', headers: { Authorization: await vapidAuth(sub.ep), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '21600', Urgency: 'high' }, body }, 9000);
    if (r.status === 404 || r.status === 410) return 'gone';
    if (r.status === 403 && /BadJwtToken|VapidPkHashMismatch/i.test(await r.text().catch(() => ''))) return 'gone';
    return r.ok ? 'ok' : 'err';
  } catch { return 'err'; }
}

// ───── 구독 저장 ─────
const mem = { sub: new Map(), tk: new Map(), al: new Map(), kw: new Map() }; // 로컬 테스트용
let ready = null;
async function db() {
  const d = await sqlDB();
  if (!d) return null;
  if (!ready) ready = d.batch([
    d.prepare('CREATE TABLE IF NOT EXISTS push_sub (id TEXT PRIMARY KEY, ep TEXT, p256dh TEXT, auth TEXT, big INTEGER, n INTEGER, at INTEGER, fails INTEGER)'),
    d.prepare('CREATE TABLE IF NOT EXISTS push_tk (t TEXT, id TEXT, PRIMARY KEY (t, id))'),
    d.prepare('CREATE TABLE IF NOT EXISTS push_al (sid TEXT, aid TEXT, k TEXT, ty TEXT, v REAL, nm TEXT, fired INTEGER DEFAULT 0, firedAt INTEGER, PRIMARY KEY (sid, aid))'),
    d.prepare('CREATE TABLE IF NOT EXISTS push_kw (sid TEXT, kw TEXT, w INTEGER, PRIMARY KEY (sid, kw))'),
  ]).catch((e) => { ready = null; throw e; });
  await ready;
  return d;
}
const subId = async (ep) => hex(await crypto.subtle.digest('SHA-256', enc.encode(ep))).slice(0, 24);
const okKey = (k) => /^(KR:\d{6}|US:[A-Z][A-Z0-9.\-]{0,9})$/.test(k);

/** 가격 알림·키워드 알림 정리 (기기에서 보낸 목록 → 검사된 목록) */
const AL_TY = ['ge', 'le', 'up', 'dn'];
function cleanAlerts(list) {
  return (Array.isArray(list) ? list : []).map((a) => ({ aid: String(a?.id || '').replace(/[^\w-]/g, '').slice(0, 24), k: String(a?.k || '').toUpperCase(), ty: String(a?.ty || ''), v: Number(a?.v), nm: String(a?.nm || '').slice(0, 40) }))
    .filter((a) => a.aid && okKey(a.k) && AL_TY.includes(a.ty) && Number.isFinite(a.v) && a.v > 0).slice(0, 30);
}
function cleanKw(list) {
  return [...new Set((Array.isArray(list) ? list : []).map((k) => String(k || '').replace(/\s+/g, ' ').trim().slice(0, 20)).filter((k) => k.length >= 2))].slice(0, 10);
}

/** 구독 등록·갱신: { ep, p256dh, auth, w: ['KR:005930','US:NVDA'], big, al: [{id,k,ty,v,nm}], kw: ['자사주'], kww: 1(관심종목만) } */
export async function saveSub(b) {
  if (!/^https:\/\//.test(b?.ep || '') || !b.p256dh || !b.auth) throw new Error('구독 정보가 올바르지 않습니다');
  const id = await subId(b.ep);
  const w = [...new Set((b.w || []).map((k) => String(k).toUpperCase()).filter(okKey))].slice(0, 200);
  const big = b.big ? 1 : 0;
  const al = cleanAlerts(b.al), kw = cleanKw(b.kw), kww = b.kww ? 1 : 0;
  const d = await db();
  if (!d) {
    mem.sub.set(id, { id, ep: b.ep, p256dh: b.p256dh, auth: b.auth, big, n: w.length });
    for (const [t, s] of mem.tk) s.delete(id); for (const t of w) (mem.tk.get(t) || mem.tk.set(t, new Set()).get(t)).add(id);
    const prev = mem.al.get(id) || [];
    mem.al.set(id, al.map((a) => ({ ...a, sid: id, fired: prev.find((p) => p.aid === a.aid)?.fired || 0, firedAt: prev.find((p) => p.aid === a.aid)?.firedAt || null })));
    mem.kw.set(id, kw.map((k) => ({ sid: id, kw: k, w: kww })));
    return { id, n: w.length, al: al.length, kw: kw.length };
  }
  await d.batch([
    d.prepare('INSERT INTO push_sub (id, ep, p256dh, auth, big, n, at, fails) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET ep = excluded.ep, p256dh = excluded.p256dh, auth = excluded.auth, big = excluded.big, n = excluded.n, at = excluded.at, fails = 0').bind(id, b.ep, b.p256dh, b.auth, big, w.length, Date.now()),
    d.prepare('DELETE FROM push_tk WHERE id = ?').bind(id),
    ...w.map((t) => d.prepare('INSERT OR IGNORE INTO push_tk (t, id) VALUES (?, ?)').bind(t, id)),
    // 가격 알림: 목록에서 빠진 것만 지우고, 새 것만 넣음 (이미 울린 알림이 다시 울리지 않게 기록 유지)
    al.length ? d.prepare(`DELETE FROM push_al WHERE sid = ? AND aid NOT IN (${al.map(() => '?').join(',')})`).bind(id, ...al.map((a) => a.aid)) : d.prepare('DELETE FROM push_al WHERE sid = ?').bind(id),
    ...al.map((a) => d.prepare('INSERT OR IGNORE INTO push_al (sid, aid, k, ty, v, nm, fired) VALUES (?, ?, ?, ?, ?, ?, 0)').bind(id, a.aid, a.k, a.ty, a.v, a.nm)),
    d.prepare('DELETE FROM push_kw WHERE sid = ?').bind(id),
    ...kw.map((k) => d.prepare('INSERT OR IGNORE INTO push_kw (sid, kw, w) VALUES (?, ?, ?)').bind(id, k, kww)),
  ]);
  return { id, n: w.length, al: al.length, kw: kw.length };
}
/** 이 기기의 가격 알림 중 이미 울린 것 → [{ aid, at }] */
export async function alertStatus(ep) {
  const id = await subId(ep);
  const d = await db();
  if (!d) return (mem.al.get(id) || []).filter((a) => a.fired).map((a) => ({ aid: a.aid, at: a.firedAt }));
  const r = await d.prepare('SELECT aid, firedAt FROM push_al WHERE sid = ? AND fired = 1').bind(id).all();
  return (r.results || []).map((x) => ({ aid: x.aid, at: x.firedAt }));
}
export async function removeSub(ep) {
  await removeById(await db(), await subId(ep));
}
async function removeById(d, id) {
  if (!d) { mem.sub.delete(id); mem.al.delete(id); mem.kw.delete(id); for (const s of mem.tk.values()) s.delete(id); return; }
  await d.batch([d.prepare('DELETE FROM push_sub WHERE id = ?').bind(id), d.prepare('DELETE FROM push_tk WHERE id = ?').bind(id), d.prepare('DELETE FROM push_al WHERE sid = ?').bind(id), d.prepare('DELETE FROM push_kw WHERE sid = ?').bind(id)]);
}
export async function pushStats() {
  const d = await db();
  if (!d) return { subs: mem.sub.size, big: [...mem.sub.values()].filter((x) => x.big).length, al: [...mem.al.values()].flat().length, kw: [...mem.kw.values()].flat().length };
  const r = await d.prepare('SELECT COUNT(*) AS subs, SUM(big) AS big FROM push_sub').first();
  const a = await d.prepare('SELECT COUNT(*) AS n, SUM(fired) AS f FROM push_al').first().catch(() => null);
  const k = await d.prepare('SELECT COUNT(DISTINCT sid) AS n FROM push_kw').first().catch(() => null);
  return { subs: r?.subs || 0, big: r?.big || 0, al: a?.n || 0, alFired: a?.f || 0, kw: k?.n || 0 };
}

// ───── 새 공시 → 알림 (크론, 매분) ─────
const titleOf = (x) => x.ko?.title || x.summary?.title || x.titleKo || x.pr?.headline || x.title || x.titleClean || x.formKo || x.form || '';
function itemMs(x) {
  if (x.src === 'DART' && x.timeMin && x.timeMin !== 'na') return Date.parse(x.timeMin.replace(' ', 'T') + ':00+09:00') + 59e3;
  return Date.parse(x.time || x.seenAt || '') || 0;
}
export async function pushWatch() {
  const now = Date.now();
  const st = (await getJSON('push/state')) || { seen: [], first: now };
  const seen = new Set(st.seen || []);
  const [sec, dart, news] = await Promise.all(['sec/feed', 'dart/feed', 'news/feed'].map((k) => getJSON(k).catch(() => null)));
  const fresh = [...(sec?.items || []), ...(dart?.items || []), ...(news?.items || [])]
    .filter((x) => x.id && x.ticker && !x.dupOf && x.src !== 'NEWS' && !seen.has(x.id))
    .map((x) => ({ x, ms: itemMs(x) }))
    .filter(({ ms }) => ms && now - ms < 30 * 60e3 && ms > (st.first || now) - 5 * 60e3)
    .sort((a, b) => a.ms - b.ms);
  if (!fresh.length) return { n: 0 };
  // 내부자 거래 신고(Form 4 등)는 너무 많아서 관심종목 알림에서 뺌
  const skip = (x) => /^(4|144|3|5|13F)/i.test(x.form || '') || (x.src === 'DART' && x.category === 'insider');
  const d = await db();
  const keyOf = (x) => `${x.src === 'DART' || x.market === 'KR' ? 'KR' : 'US'}:${String(x.ticker).toUpperCase()}`;
  const items = fresh.filter(({ x }) => !skip(x));
  const keys = [...new Set(items.map(({ x }) => keyOf(x)))];
  // 관심종목 → 구독 기기
  const subsOf = new Map();
  if (keys.length) {
    if (!d) { for (const k of keys) subsOf.set(k, [...(mem.tk.get(k) || [])]); }
    else for (let i = 0; i < keys.length; i += 50) {
      const part = keys.slice(i, i + 50);
      const r = await d.prepare(`SELECT t, id FROM push_tk WHERE t IN (${part.map(() => '?').join(',')})`).bind(...part).all();
      for (const x of r.results || []) (subsOf.get(x.t) || subsOf.set(x.t, []).get(x.t)).push(x.id);
    }
  }
  // 매우 중요한 공시 (AI 중요도 5) — '중요 공시 알림'을 켠 기기에, 하루 최대 8건
  const day = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  if (st.day !== day) { st.day = day; st.bigN = 0; }
  const bigs = items.filter(({ x }) => (x.impact ?? 0) >= 5).slice(0, Math.max(0, 8 - (st.bigN || 0)));
  // 보낼 목록: 기기 → 메시지들
  const out = new Map();
  const msgOf = (x) => {
    const mk = keyOf(x).slice(0, 2);
    const nm = mk === 'KR' ? x.name || x.ticker : `${x.ticker}${x.name ? ' ' + x.name : x.company ? ' ' + x.company : ''}`;
    const kind = x.src === 'DART' ? '공시' : x.src === 'SEC' ? `SEC ${x.form || '공시'}` : '보도자료';
    return { title: `${mk === 'KR' ? '🇰🇷' : '🇺🇸'} ${nm} · ${kind}`, body: String(titleOf(x)).slice(0, 140), url: `/p/${encodeURIComponent(x.id)}`, tag: x.id };
  };
  for (const { x } of items) for (const id of subsOf.get(keyOf(x)) || []) { const a = out.get(id) || out.set(id, []).get(id); if (!a.some((m) => m.tag === x.id)) a.push({ ...msgOf(x), w: 1 }); }
  if (bigs.length) {
    const ids = d ? ((await d.prepare('SELECT id FROM push_sub WHERE big = 1').all()).results || []).map((r) => r.id) : [...mem.sub.values()].filter((s) => s.big).map((s) => s.id);
    for (const { x } of bigs) for (const id of ids) { const a = out.get(id) || out.set(id, []).get(id); if (!a.some((m) => m.tag === x.id)) a.push({ ...msgOf(x), title: '⚡ 중요 공시 · ' + msgOf(x).title }); }
    st.bigN = (st.bigN || 0) + bigs.length;
  }
  // 키워드 알림 — 제목에 기기가 등록한 단어가 들어 있으면 (기기당 하루 최대 15건)
  try {
    const kwRows = d ? ((await d.prepare('SELECT sid, kw, w FROM push_kw LIMIT 5000').all()).results || []) : [...mem.kw.values()].flat();
    if (kwRows.length && items.length) {
      st.kwN = st.kwDay === day ? st.kwN || {} : {}; st.kwDay = day;
      for (const { x } of items) {
        const text = `${titleOf(x)} ${x.titleClean || ''} ${x.title || ''} ${x.reportName || ''}`.toLowerCase();
        const k = keyOf(x);
        for (const r of kwRows) {
          if (!text.includes(String(r.kw).toLowerCase())) continue;
          if (r.w && !(subsOf.get(k) || []).includes(r.sid)) continue; // '관심종목만'
          if ((st.kwN[r.sid] || 0) >= 15) continue;
          const a = out.get(r.sid) || out.set(r.sid, []).get(r.sid);
          if (a.some((m) => m.tag === x.id)) continue;
          a.push({ ...msgOf(x), title: `🔔 '${r.kw}' · ` + msgOf(x).title });
          st.kwN[r.sid] = (st.kwN[r.sid] || 0) + 1;
        }
      }
    }
  } catch (e) { st.kwErr = String(e.message || e).slice(0, 120); }
  for (const { x } of fresh) seen.add(x.id);
  st.seen = [...seen].slice(-1500);
  let sent = 0, gone = 0, fail = 0;
  if (out.size) {
    const ids = [...out.keys()];
    const subs = new Map();
    if (!d) for (const id of ids) { const s = mem.sub.get(id); if (s) subs.set(id, s); }
    else for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      const r = await d.prepare(`SELECT id, ep, p256dh, auth FROM push_sub WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
      for (const s of r.results || []) subs.set(s.id, s);
    }
    const jobs = [];
    for (const [id, msgs] of out) {
      const s = subs.get(id); if (!s) continue;
      // 한 번에 여러 건이면 3건까지 따로, 나머지는 묶어서
      const list = msgs.length > 3 ? [...msgs.slice(0, 2), { title: `관심종목 새 소식 ${msgs.length - 2}건 더`, body: msgs.slice(2, 6).map((m) => m.title.replace(/^\S+\s/, '')).join(' · '), url: '/#watch', tag: 'more-' + now }] : msgs;
      jobs.push((async () => {
        for (const m of list) {
          const r = await sendPush(s, { title: m.title, body: m.body, url: m.url, tag: m.tag });
          if (r === 'gone') { gone++; await removeById(d, id).catch(() => {}); return; }
          if (r === 'ok') sent++; else fail++;
        }
      })());
      if (jobs.length >= 25) { await Promise.all(jobs.splice(0)); }
    }
    await Promise.all(jobs);
  }
  st.last = { at: now, sent, gone, fail, items: fresh.length };
  if (sent) st.lastSent = { at: now, n: sent };
  if (fail) st.lastFail = { at: now, n: fail };
  await setJSON('push/state', st).catch(() => {});
  return { n: sent, gone, fail };
}

// ───── 가격 알림 (크론, 매분) ─────
//  ge: 가격 이상 / le: 가격 이하 / up: 오늘 +v% 이상 / dn: 오늘 -v% 이하 — 한 번 울리면 끝(기기에서 다시 켤 수 있음)
function sessionOpen(mk, now = new Date()) {
  const tz = mk === 'KR' ? 'Asia/Seoul' : 'America/New_York';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  if (['Sat', 'Sun'].includes(p.weekday)) return false;
  const m = Number(p.hour) * 60 + Number(p.minute);
  return mk === 'KR' ? m >= 8 * 60 && m <= 20 * 60 : m >= 4 * 60 && m <= 20 * 60; // 국장 정규·시간외(넥스트레이드 포함) / 미장 프리~애프터
}
const fmtV = (k, v) => (k.startsWith('KR:') ? Math.round(v).toLocaleString('ko-KR') + '원' : '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
export async function alertWatch(now = new Date()) {
  const open = { KR: sessionOpen('KR', now), US: sessionOpen('US', now) };
  if (!open.KR && !open.US) return null;
  const d = await db();
  let rows = d ? ((await d.prepare('SELECT sid, aid, k, ty, v, nm FROM push_al WHERE fired = 0 LIMIT 800').all()).results || []) : [...mem.al.values()].flat().filter((a) => !a.fired);
  rows = rows.filter((r) => open[r.k.slice(0, 2)]);
  if (!rows.length) return { n: 0 };
  const keys = [...new Set(rows.map((r) => r.k))].slice(0, 200);
  const { getQuotes } = await import('../functions/quote.mjs');
  const q = {};
  for (let i = 0; i < keys.length; i += 40) Object.assign(q, await getQuotes(keys.slice(i, i + 40)).catch(() => ({})));
  const hits = [];
  for (const r of rows) {
    const x = q[r.k];
    if (!x) continue;
    const px = x.live ?? x.price, pct = x.livePct ?? x.pct;
    if (px == null) continue;
    const ok = r.ty === 'ge' ? px >= r.v : r.ty === 'le' ? px <= r.v : r.ty === 'up' ? pct != null && pct >= r.v : pct != null && pct <= -r.v;
    if (ok) hits.push({ r, px, pct });
  }
  if (!hits.length) return { n: 0, checked: rows.length };
  const ids = [...new Set(hits.map((h) => h.r.sid))];
  const subs = new Map();
  if (!d) for (const id of ids) { const s = mem.sub.get(id); if (s) subs.set(id, s); }
  else for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const r = await d.prepare(`SELECT id, ep, p256dh, auth FROM push_sub WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const s of r.results || []) subs.set(s.id, s);
  }
  let sent = 0;
  const at = Date.now();
  for (const { r, px, pct } of hits.slice(0, 200)) {
    // 먼저 '울림'으로 표시 (같은 알림이 두 번 가지 않게)
    if (d) await d.prepare('UPDATE push_al SET fired = 1, firedAt = ? WHERE sid = ? AND aid = ?').bind(at, r.sid, r.aid).run().catch(() => {});
    else { r.fired = 1; r.firedAt = at; }
    const s = subs.get(r.sid); if (!s) continue;
    const mk = r.k.slice(0, 2), t = r.k.slice(3);
    const cond = r.ty === 'ge' ? `${fmtV(r.k, r.v)} 이상 도달` : r.ty === 'le' ? `${fmtV(r.k, r.v)} 이하 도달` : r.ty === 'up' ? `오늘 +${r.v}% 이상 상승` : `오늘 -${r.v}% 이하 하락`;
    const res = await sendPush(s, { title: `🎯 ${mk === 'KR' ? '🇰🇷' : '🇺🇸'} ${r.nm || t} · ${cond}`, body: `현재 ${fmtV(r.k, px)}${pct != null ? ` (${pct > 0 ? '+' : ''}${Number(pct).toFixed(2)}%)` : ''} · 설정한 가격 알림이 울렸어요`, url: `/s/${mk}/${encodeURIComponent(t)}`, tag: 'al-' + r.aid });
    if (res === 'ok') sent++;
    if (res === 'gone') await removeById(d, r.sid).catch(() => {});
  }
  const st = (await getJSON('push/alst')) || {};
  st.last = { at, hits: hits.length, sent };
  await setJSON('push/alst', st).catch(() => {});
  return { n: sent, hits: hits.length };
}
