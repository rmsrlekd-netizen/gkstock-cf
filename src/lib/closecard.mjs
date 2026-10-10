// 장 마감 정리 카드 — 국장·미장 마감 뒤 한 장짜리 이미지로 만들어 텔레그램 채널에 올림
//  국장: 한국시간 평일 16:08 이후 (16시 '장 마감 후' 주요 이슈 회차가 나오면 바로, 늦어도 16:40)
//  미장: 뉴욕시간 평일 16:10 이후 (16시 회차가 나오면 바로, 늦어도 16:45)
//  휴장일은 건너뜀 · 이미지 주소: /og/close/kr-20261010.png (공유용)
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout } from './util.mjs';
import { isTradingDay } from './schedule.mjs';

const TZ = { KR: 'Asia/Seoul', US: 'America/New_York' };
const WIN = { KR: [16 * 60 + 8, 16 * 60 + 40, 17 * 60 + 30], US: [16 * 60 + 10, 16 * 60 + 45, 18 * 60] }; // [시작, 회차 안 기다리는 시각, 마지막]
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const sp = (v) => (v == null || !Number.isFinite(Number(v)) ? '' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
const pc = (v) => (v > 0 ? '#ff6b7a' : v < 0 ? '#5aa5ff' : '#c3c7e6');

function local(mk, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ[mk], year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, m: Number(p.hour) * 60 + Number(p.minute) };
}
const WD = { Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토', Sun: '일' };

/** 카드에 들어갈 내용 모으기 */
export async function closeData(mk, date) {
  const ymd = date.replace(/-/g, '');
  const idx = (await getJSON(`issues/idx/${mk}`)) || [];
  const edId = (await getJSON(`issues/ed/${mk.toLowerCase()}-${ymd}-16`)) ? `${mk.toLowerCase()}-${ymd}-16` : idx.find((x) => x.date === date)?.id;
  const ed = edId ? await getJSON(`issues/ed/${edId}`) : null;
  const [mkt, pop, themes, wm] = await Promise.all(['market/v1', 'popular/v2', 'themes/v1', 'why/map'].map((k) => getJSON(k).catch(() => null)));
  const ind = mkt?.body?.indices || [];
  const pick = mk === 'KR' ? ['코스피', '코스닥', '원/달러'] : ['S&P 500', '나스닥', '다우', '반도체(SOX)'];
  const ix = pick.map((l) => ind.find((x) => x.label === l && !x.error)).filter(Boolean).map((x) => ({ label: x.label, price: x.price, pct: x.pct }));
  const why = (m, t) => { const w = wm?.[`${m}|${String(t).toUpperCase()}`]; return w?.r && !/^뚜렷한/.test(w.r) ? w.r : null; };
  let up, down;
  if (mk === 'KR') { up = pop?.krUp || []; down = pop?.krDown || []; }
  else { // 미국은 시간외가 아니라 정규장 등락 기준
    try { const { naverUsMovers } = await import('./naver.mjs'); [up, down] = await Promise.all([naverUsMovers('up', 25), naverUsMovers('down', 15)]); } catch { up = pop?.usUp || []; down = pop?.usDown || []; }
    up = up.filter((x) => (x.price || 0) >= 1); down = down.filter((x) => (x.price || 0) >= 1);
  }
  const mv = (x) => ({ name: mk === 'KR' ? x.name || x.ticker : x.ticker, sub: mk === 'KR' ? '' : x.name || '', pct: x.pct, why: x.reason && !/^뚜렷한/.test(x.reason) ? x.reason : why(mk, x.ticker) });
  let th = [], thDown = [];
  if (mk === 'KR') { th = (themes?.kr?.themes || []).slice(0, 4).map((g) => ({ name: g.name, pct: g.rate })); thDown = (themes?.kr?.worstThemes || []).slice(0, 2).map((g) => ({ name: g.name, pct: g.rate })); }
  else { const g = themes?.us?.groups || []; th = g.slice(0, 4).map((x) => ({ name: x.name, pct: x.rate })); thDown = g.slice(-2).reverse().map((x) => ({ name: x.name, pct: x.rate })); }
  return {
    mk, date, edId: ed?.id || null, headline: ed?.headline || '', keywords: ed?.keywords || [],
    issues: (ed?.issues || []).slice(0, 4).map((x) => ({ tag: x.tag, title: x.title, tone: x.tone })),
    ix, up: up.slice(0, 5).map(mv), down: down.slice(0, 3).map(mv), th, thDown,
  };
}

/** 1080×1350 카드 HTML (satori용: 자식이 여럿인 div는 모두 display:flex) */
export function closeHtml(d) {
  const kr = d.mk === 'KR';
  const dt = new Date(d.date + 'T12:00:00Z');
  const wd = WD[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()]];
  const md = `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일 (${wd})`;
  const accent = kr ? '#ff5a6a' : '#3e7bff';
  const box = 'display:flex;flex-direction:column;padding:18px 22px;border-radius:20px;background:rgba(255,255,255,.055);border:1px solid rgba(139,108,255,.3)';
  const fmtPx = (x) => (x.price == null ? '' : Number(x.price).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const toneC = (t) => (t === '호재' ? '#34d399' : t === '악재' ? '#fb7185' : '#a5b4fc');
  const row = (x, i, big) => `<div style="display:flex;flex-direction:column;margin-top:${i ? 12 : 4}px"><div style="display:flex;align-items:center"><div style="display:flex;font-size:${big ? 27 : 25}px;font-weight:700;color:#fff">${esc(cut(x.name, kr ? 11 : 7))}</div>${x.sub ? `<div style="display:flex;margin-left:8px;font-size:17px;color:#8b90b8">${esc(cut(x.sub, 16))}</div>` : ''}<div style="display:flex;margin-left:auto;font-size:${big ? 27 : 25}px;font-weight:700;color:${pc(x.pct)}">${esc(sp(x.pct))}</div></div>${x.why ? `<div style="display:flex;font-size:18px;color:#a3a8cc;margin-top:2px">${esc(cut(x.why, 30))}</div>` : ''}</div>`;
  const html = `<div style="display:flex;flex-direction:column;width:1080px;height:1350px;padding:46px 50px 40px;background:linear-gradient(160deg,#1a1650 0%,#0b0d24 50%,#080a1c 100%);color:#eef0ff;font-family:'Noto Sans KR'">
    <div style="display:flex;width:100%;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center">
        <div style="display:flex;padding:8px 22px;border-radius:999px;background:${accent};color:#fff;font-size:28px;font-weight:700">${kr ? '국장' : '미장'} 마감</div>
        <div style="display:flex;margin-left:16px;font-size:28px;font-weight:700;color:#c3c7e6">${esc(md)}</div>
      </div>
      <div style="display:flex;font-size:26px;font-weight:700;color:#c4b5fd">GK의 공시레이더</div>
    </div>
    <div style="display:flex;margin-top:18px;font-size:62px;font-weight:700;color:#fff">오늘의 장 마감 정리</div>
    ${d.headline ? `<div style="display:flex;margin-top:6px;font-size:29px;line-height:1.35;color:#f5d97a">${esc(cut(d.headline, 44))}</div>` : ''}
    <div style="display:flex;width:100%;margin-top:22px">
      ${d.ix.map((x, i) => `<div style="display:flex;flex-direction:column;flex:1;margin-left:${i ? 14 : 0}px;padding:16px 20px;border-radius:18px;background:rgba(255,255,255,.07)"><div style="display:flex;font-size:21px;color:#a3a8cc">${esc(x.label)}</div><div style="display:flex;font-size:30px;font-weight:700;color:#fff;margin-top:2px">${esc(fmtPx(x))}</div><div style="display:flex;font-size:26px;font-weight:700;color:${pc(x.pct)}">${esc(sp(x.pct))}</div></div>`).join('')}
    </div>
    ${d.issues.length ? `<div style="${box};margin-top:20px">
      <div style="display:flex;font-size:25px;font-weight:700;color:#c4b5fd">핵심 이슈</div>
      ${d.issues.map((x, i) => `<div style="display:flex;align-items:center;margin-top:12px"><div style="display:flex;width:40px;height:40px;border-radius:11px;background:#f5c542;color:#1b1300;font-size:23px;font-weight:700;align-items:center;justify-content:center">${i + 1}</div><div style="display:flex;margin-left:12px;padding:3px 12px;border-radius:999px;border:2px solid ${toneC(x.tone)};color:${toneC(x.tone)};font-size:18px;font-weight:700">${esc(cut(x.tag, 7))}</div><div style="display:flex;margin-left:12px;font-size:27px;font-weight:700;color:#fff">${esc(cut(x.title, 24))}</div></div>`).join('')}
    </div>` : ''}
    <div style="display:flex;width:100%;margin-top:18px">
      <div style="${box};flex:1;margin-right:16px">
        <div style="display:flex;font-size:25px;font-weight:700;color:#ff8a96">급등 TOP ${d.up.length}</div>
        ${d.up.map((x, i) => row(x, i, true)).join('')}
      </div>
      <div style="display:flex;flex-direction:column;flex:1">
        <div style="${box}">
          <div style="display:flex;font-size:25px;font-weight:700;color:#7db8ff">급락 TOP ${d.down.length}</div>
          ${d.down.map((x, i) => row(x, i, false)).join('')}
        </div>
        <div style="${box};margin-top:16px">
          <div style="display:flex;font-size:25px;font-weight:700;color:#c4b5fd">${kr ? '강세 테마' : '강세 테마·섹터'}</div>
          <div style="display:flex;flex-wrap:wrap;margin-top:6px">${d.th.map((x) => `<div style="display:flex;margin:6px 8px 0 0;padding:6px 12px;border-radius:12px;background:rgba(255,107,122,.14);font-size:20px;font-weight:700"><div style="display:flex;color:#fff">${esc(cut(x.name, 9))}</div><div style="display:flex;margin-left:6px;color:${pc(x.pct)}">${esc(sp(x.pct))}</div></div>`).join('')}</div>
          ${d.thDown.length ? `<div style="display:flex;flex-wrap:wrap;margin-top:4px">${d.thDown.map((x) => `<div style="display:flex;margin:6px 8px 0 0;padding:6px 12px;border-radius:12px;background:rgba(90,165,255,.14);font-size:20px;font-weight:700"><div style="display:flex;color:#fff">${esc(cut(x.name, 9))}</div><div style="display:flex;margin-left:6px;color:${pc(x.pct)}">${esc(sp(x.pct))}</div></div>`).join('')}</div>` : ''}
        </div>
      </div>
    </div>
    <div style="display:flex;width:100%;margin-top:auto;padding-top:16px;border-top:1px solid rgba(140,150,255,.22);justify-content:space-between;align-items:center;font-size:22px;color:#8b90b8">
      <div style="display:flex">${esc((d.keywords || []).map((k) => '#' + k).join('  ') || '실시간 공시 · AI 분석 · 급등 이유')}</div>
      <div style="display:flex;color:#f5c542;font-weight:700">gk-stock.com</div>
    </div>
  </div>`;
  const allText = [...new Set(`${html.replace(/<[^>]+>/g, '')}국장미장마감오늘의장정리핵심이슈급등급락TOP강세테마섹터GK의공시레이더gk-stock.com0123456789+-.,%#…·()월일화수목금토`.replace(/\s+/g, ''))].join('') + ' ';
  return { html: html.replace(/>\s+</g, '><').trim(), allText };
}

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** PNG 만들기 (저장까지) */
export async function closePng(ctx, mk, date, data = null) {
  const { ImageResponse, GoogleFont, cache } = await import('@cf-wasm/og/workerd');
  const { t } = await import('@cf-wasm/og/html-to-react');
  cache.setExecutionContext(ctx || { waitUntil() {} });
  const d = data || (await closeData(mk, date));
  const { html, allText } = closeHtml(d);
  const res = await ImageResponse.async(t(html), {
    width: 1080, height: 1350,
    fonts: [new GoogleFont('Noto Sans KR', { weight: 400, text: allText }), new GoogleFont('Noto Sans KR', { weight: 700, text: allText })],
  });
  if (!res.ok) throw new Error('카드 이미지 ' + res.status);
  const png = new Uint8Array(await res.arrayBuffer());
  await setJSON(`close/png/${mk.toLowerCase()}-${date.replace(/-/g, '')}`, { b: b64(png), at: Date.now() }).catch(() => {});
  return { png, d };
}

/** /og/close/kr-20261010.png */
export async function renderClosePng(ctx, id) {
  const m = String(id).match(/^(kr|us)-(\d{4})(\d{2})(\d{2})$/);
  if (!m) return new Response('not found', { status: 404 });
  const saved = await getJSON(`close/png/${id}`);
  let png = saved?.b ? unb64(saved.b) : null;
  if (!png) { try { png = (await closePng(ctx, m[1].toUpperCase(), `${m[2]}-${m[3]}-${m[4]}`)).png; } catch { return new Response('not found', { status: 404 }); } }
  return new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.byteLength), 'cache-control': 'public, max-age=3600', 'x-gk-edge-ttl': '86400' } });
}

/** 텔레그램 채널에 사진으로 올리기 */
async function sendPhoto(chat, png, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const fd = new FormData();
  fd.append('chat_id', chat);
  fd.append('caption', caption);
  fd.append('parse_mode', 'HTML');
  fd.append('photo', new Blob([png], { type: 'image/png' }), 'close.png');
  const r = await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd }, 20000);
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`텔레그램 ${j.error_code || r.status}: ${j.description || ''}`);
  return j;
}

/** 한 시장 마감 카드 만들고 보내기 (force: 시간·중복 확인 없이 — 관리자 시험 발송) */
export async function sendClose(mk, { ctx = null, force = false, date = null } = {}) {
  const chat = process.env.TELEGRAM_CHANNEL_ID;
  if (!chat || !process.env.TELEGRAM_BOT_TOKEN) throw new Error('텔레그램 채널이 설정되지 않았습니다');
  date = date || local(mk).date;
  const { png, d } = await closePng(ctx, mk, date);
  const dt = new Date(date + 'T12:00:00Z');
  const ymd = date.replace(/-/g, '');
  const link = d.edId ? `https://gk-stock.com/i/${d.edId}` : 'https://gk-stock.com/';
  const cap = `📊 <b>${mk === 'KR' ? '국장' : '미장'} 마감 정리</b> · ${dt.getUTCMonth() + 1}/${dt.getUTCDate()}\n${esc(d.headline || '')}\n\n${d.up.slice(0, 3).map((x) => `🔺 ${esc(x.name)} ${esc(sp(x.pct))}${x.why ? ` — ${esc(cut(x.why, 40))}` : ''}`).join('\n')}\n\n<a href="${link}">오늘 주요 이슈 자세히 →</a>`;
  await sendPhoto(chat, png, cap.slice(0, 1000));
  await setJSON(`close/sent/${mk}/${date}`, { at: Date.now(), force, img: `/og/close/${mk.toLowerCase()}-${ymd}.png` });
  return { ok: true, mk, date, edId: d.edId };
}

/** 크론(매분) */
export async function closeWatch(now = new Date(), ctx = null) {
  if (!process.env.TELEGRAM_CHANNEL_ID || !process.env.TELEGRAM_BOT_TOKEN) return null;
  const { DEFAULT_CFG } = await import('./tgchannel.mjs');
  const cfg = { ...DEFAULT_CFG, ...((await getJSON('tgch/cfg')) || {}) };
  if (!cfg.on || cfg.close === false) return null;
  const out = {};
  for (const mk of ['KR', 'US']) {
    if (mk === 'KR' ? !cfg.kr : !cfg.us) continue;
    const z = local(mk, now);
    const [from, wait, last] = WIN[mk];
    if (z.m < from || z.m > last) continue;
    if (!isTradingDay(mk, z.date) || (await getJSON(`issues/hol/${mk}/${z.date}`))?.on) continue;
    if (await getJSON(`close/sent/${mk}/${z.date}`)) continue;
    const tk = `close/try/${mk}/${z.date}`;
    const t = (await getJSON(tk)) || { n: 0, at: 0 };
    if (t.n >= 3 || Date.now() - t.at < 5 * 60e3) continue;
    // 16시 '장 마감 후' 이슈 회차가 나올 때까지 잠깐 기다림 (늦으면 그날 마지막 회차로)
    const has16 = await getJSON(`issues/ed/${mk.toLowerCase()}-${z.date.replace(/-/g, '')}-16`);
    if (!has16 && z.m < wait) continue;
    await setJSON(tk, { n: t.n + 1, at: Date.now() });
    try { out[mk] = await sendClose(mk, { ctx, date: z.date }); }
    catch (e) { out[mk] = 'error: ' + e.message; await setJSON(tk, { n: t.n + 1, at: Date.now(), err: String(e.message).slice(0, 200) }).catch(() => {}); }
  }
  return out;
}
