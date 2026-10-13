// 주간 정리 카드 — 토요일 아침, '이번 주 미장·국장 핵심 10가지'를 한 장 이미지로 만들어 텔레그램 채널에 올림
//  · 재료: 이번 주(월~금) 날마다 마지막 '오늘 주요 이슈' 회차 + 지수 주간 등락(야후 일봉) + 실적 컨센서스 상회 TOP
//  · AI가 10개를 골라 짧게 정리 · 이미지 주소 /og/week/20261010.png (그 주 금요일 날짜)
//  · 쇼츠·썸네일 소재로도 쓰라고 관리자 화면에 미리보기 링크
import { getJSON, setJSON } from './store.mjs';
import { fetchWithTimeout, BROWSER_UA } from './util.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const sp = (v) => (v == null || !Number.isFinite(Number(v)) ? '' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
const pc = (v) => (v > 0 ? '#ff6b7a' : v < 0 ? '#5aa5ff' : '#c3c7e6');
const IX = [['코스피', '^KS11'], ['코스닥', '^KQ11'], ['S&P 500', '^GSPC'], ['나스닥', '^IXIC']];

/** 한국 시간 기준 '그 주' 월요일~금요일 날짜 (토·일에 부르면 방금 끝난 주) */
export function weekOf(ms = Date.now()) {
  const k = new Date(ms + 9 * 3600e3);
  const back = (k.getUTCDay() + 6) % 7; // 월=0
  const mon = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - back);
  const days = [0, 1, 2, 3, 4].map((i) => new Date(mon + i * 86400e3).toISOString().slice(0, 10));
  return { mon: days[0], fri: days[4], days };
}

async function weekPct(sym, mon) {
  const opt = { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } };
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1mo`;
  let r = await fetchWithTimeout('https://query1.finance.yahoo.com' + path, opt, 7000).catch(() => null);
  if (!r?.ok) r = await fetchWithTimeout('https://query2.finance.yahoo.com' + path, opt, 7000).catch(() => null);
  if (!r?.ok) return null;
  const res = (await r.json())?.chart?.result?.[0];
  const off = (res?.meta?.gmtoffset || 0) * 1000;
  const rows = (res?.timestamp || []).map((t, i) => ({ d: new Date(t * 1000 + off).toISOString().slice(0, 10), c: res.indicators?.quote?.[0]?.close?.[i] })).filter((x) => x.c != null);
  const before = rows.filter((x) => x.d < mon).pop(), last = rows.filter((x) => x.d >= mon).pop();
  if (!before || !last) return null;
  return { price: last.c, pct: ((last.c - before.c) / before.c) * 100 };
}

/** 카드 재료 모으기 + AI 정리 */
export async function weekData(ms = Date.now()) {
  const w = weekOf(ms);
  const eds = [];
  for (const mk of ['KR', 'US']) {
    const idx = (await getJSON(`issues/idx/${mk}`)) || [];
    for (const day of w.days) {
      const e = idx.find((x) => x.date === day); // 그날 가장 늦은 회차(목록이 최신순)
      if (!e) continue;
      const ed = await getJSON(`issues/ed/${e.id}`).catch(() => null);
      if (ed?.issues?.length) eds.push({ mk, day, headline: ed.headline, issues: ed.issues.map((x) => ({ tag: x.tag, title: x.title, sub: x.sub, tone: x.tone, s: (x.stocks || []).map((s) => `${s.name}${s.pct != null ? ' ' + sp(s.pct) : ''}`).join(', ') })) });
    }
  }
  const ix = (await Promise.all(IX.map(async ([label, sym]) => { const v = await weekPct(sym, w.mon).catch(() => null); return v ? { label, ...v } : null; }))).filter(Boolean);
  let earn = [];
  try { const { earnWeek } = await import('./earnv.mjs'); const e = await earnWeek(ms < Date.now() - 3 * 86400e3 ? 1 : 0); earn = [...(e.US?.beat || []).slice(0, 3).map((x) => ({ n: x.ko || x.t, pct: x.pct, mk: 'US' })), ...(e.KR?.beat || []).slice(0, 2).map((x) => ({ n: x.n, pct: x.pct, mk: 'KR' }))]; } catch {}
  if (!eds.length) throw new Error('이번 주 주요 이슈 기록이 없습니다');
  const { askAI, parseJSON } = await import('./ai.mjs');
  const prompt = `당신은 한국 개인투자자를 위한 주식 유튜브 채널 'GK의 미국 주식'의 주간 정리 작가입니다.
아래는 이번 주(${w.mon}~${w.fri}) 날마다의 국장(KR)·미장(US) 주요 이슈 기록입니다. 이번 주 전체에서 가장 중요했던 이슈 10개를 고르세요.
규칙: 기록에 있는 사실만 쓸 것. 숫자(등락률·실적)는 기록 그대로. 같은 사건은 하나로 합칠 것. 미장·국장을 골고루(각 최소 3개). 주가 하락만 보고 실적이 나빴다고 단정하지 말 것.
출력은 JSON 하나만:
{"headline":"이번 주 시장을 한 줄로(32자 이내)","items":[{"mk":"KR|US","tag":"분류 2~5자","title":"핵심 한 줄(26자 이내)","tone":"호재|악재|중립"}],"keywords":["키워드 4개"]}
기록: ${JSON.stringify(eds).slice(0, 24000)}`;
  const j = parseJSON(await askAI(prompt, { maxTokens: 2500, timeout: 60000, tag: '주간 정리 카드' }));
  const items = (Array.isArray(j.items) ? j.items : []).filter((x) => x?.title).slice(0, 10).map((x) => ({ mk: x.mk === 'KR' ? 'KR' : 'US', tag: cut(x.tag, 6), title: cut(x.title, 30), tone: ['호재', '악재', '중립'].includes(x.tone) ? x.tone : '중립' }));
  if (items.length < 6) throw new Error('AI 정리 부족');
  return { ...w, headline: cut(j.headline, 36), keywords: (Array.isArray(j.keywords) ? j.keywords : []).map((k) => cut(k, 10)).slice(0, 4), items, ix, earn, at: Date.now() };
}

export function weekHtml(d) {
  const md = (s) => { const [, m, dd] = s.split('-'); return `${Number(m)}/${Number(dd)}`; };
  const toneC = (t) => (t === '호재' ? '#34d399' : t === '악재' ? '#fb7185' : '#a5b4fc');
  const html = `<div style="display:flex;flex-direction:column;width:1080px;height:1350px;padding:46px 50px 40px;background:linear-gradient(160deg,#241a5c 0%,#0b0d24 52%,#080a1c 100%);color:#eef0ff;font-family:'Noto Sans KR'">
    <div style="display:flex;width:100%;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center">
        <div style="display:flex;padding:8px 22px;border-radius:999px;background:#8b6cff;color:#fff;font-size:28px;font-weight:700">주간 정리</div>
        <div style="display:flex;margin-left:16px;font-size:28px;font-weight:700;color:#c3c7e6">${esc(md(d.mon))} ~ ${esc(md(d.fri))}</div>
      </div>
      <div style="display:flex;font-size:26px;font-weight:700;color:#c4b5fd">GK의 공시레이더</div>
    </div>
    <div style="display:flex;margin-top:16px;font-size:58px;font-weight:700;color:#fff">이번 주 핵심 ${d.items.length}가지</div>
    ${d.headline ? `<div style="display:flex;margin-top:4px;font-size:30px;color:#f5d97a">${esc(d.headline)}</div>` : ''}
    ${d.ix.length ? `<div style="display:flex;width:100%;margin-top:20px">${d.ix.map((x, i) => `<div style="display:flex;flex-direction:column;flex:1;margin-left:${i ? 12 : 0}px;padding:14px 18px;border-radius:18px;background:rgba(255,255,255,.07)"><div style="display:flex;font-size:21px;color:#a3a8cc">${esc(x.label)} 주간</div><div style="display:flex;font-size:32px;font-weight:700;color:${pc(x.pct)}">${esc(sp(x.pct))}</div></div>`).join('')}</div>` : ''}
    <div style="display:flex;flex-direction:column;margin-top:20px;padding:14px 22px;border-radius:20px;background:rgba(255,255,255,.05);border:1px solid rgba(139,108,255,.3)">
      ${d.items.map((x, i) => `<div style="display:flex;align-items:center;padding:${i ? 15 : 6}px 0 6px;${i ? 'border-top:1px solid rgba(255,255,255,.06);' : ''}"><div style="display:flex;width:42px;height:42px;border-radius:12px;background:${i < 3 ? '#f5c542' : 'rgba(255,255,255,.12)'};color:${i < 3 ? '#1b1300' : '#fff'};font-size:23px;font-weight:700;align-items:center;justify-content:center">${i + 1}</div><div style="display:flex;margin-left:12px;padding:3px 10px;border-radius:8px;background:${x.mk === 'KR' ? 'rgba(255,90,106,.2)' : 'rgba(62,123,255,.25)'};color:${x.mk === 'KR' ? '#ff8a96' : '#8ab4ff'};font-size:18px;font-weight:700">${x.mk === 'KR' ? '국장' : '미장'}</div><div style="display:flex;margin-left:8px;padding:3px 10px;border-radius:999px;border:2px solid ${toneC(x.tone)};color:${toneC(x.tone)};font-size:17px;font-weight:700">${esc(x.tag)}</div><div style="display:flex;margin-left:12px;font-size:29px;font-weight:700;color:#fff">${esc(x.title)}</div></div>`).join('')}
    </div>
    ${d.earn.length ? `<div style="display:flex;align-items:center;flex-wrap:wrap;margin-top:16px"><div style="display:flex;font-size:23px;font-weight:700;color:#34d399;margin-right:10px">실적 서프라이즈</div>${d.earn.map((x) => `<div style="display:flex;margin:4px 8px 4px 0;padding:6px 12px;border-radius:12px;background:rgba(52,211,153,.13);font-size:20px;font-weight:700"><div style="display:flex;color:#fff">${esc(cut(x.n, 9))}</div><div style="display:flex;margin-left:6px;color:#34d399">${esc(x.pct != null ? sp(x.pct) : '상회')}</div></div>`).join('')}</div>` : ''}
    <div style="display:flex;width:100%;margin-top:auto;padding-top:16px;border-top:1px solid rgba(140,150,255,.22);justify-content:space-between;align-items:center;font-size:22px;color:#8b90b8">
      <div style="display:flex">${esc((d.keywords || []).map((k) => '#' + k).join('  ') || '실시간 공시 · AI 분석')}</div>
      <div style="display:flex;color:#f5c542;font-weight:700">gk-stock.com</div>
    </div>
  </div>`;
  const allText = [...new Set(`${html.replace(/<[^>]+>/g, '')}주간정리이번주핵심가지국장미장코스피코스닥나스닥실적서프라이즈상회GK의공시레이더gk-stock.com0123456789+-.,%#…·~/()`.replace(/\s+/g, ''))].join('') + ' ';
  return { html: html.replace(/>\s+</g, '><').trim(), allText };
}

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function weekPng(ctx, d) {
  const { ImageResponse, GoogleFont, cache } = await import('@cf-wasm/og/workerd');
  const { t } = await import('@cf-wasm/og/html-to-react');
  cache.setExecutionContext(ctx || { waitUntil() {} });
  const { html, allText } = weekHtml(d);
  const res = await ImageResponse.async(t(html), { width: 1080, height: 1350, fonts: [new GoogleFont('Noto Sans KR', { weight: 400, text: allText }), new GoogleFont('Noto Sans KR', { weight: 700, text: allText })] });
  if (!res.ok) throw new Error('카드 이미지 ' + res.status);
  const png = new Uint8Array(await res.arrayBuffer());
  await setJSON(`week/png/${d.fri.replace(/-/g, '')}`, { b: b64(png), at: Date.now() }).catch(() => {});
  return png;
}

/** 만들기(저장) — 이미 만든 주는 다시 쓰고, fresh면 새로 */
export async function buildWeek(ctx, { fresh = false, ms = Date.now() } = {}) {
  const w = weekOf(ms);
  let d = fresh ? null : await getJSON(`week/d/${w.fri.replace(/-/g, '')}`);
  if (!d) { d = await weekData(ms); await setJSON(`week/d/${w.fri.replace(/-/g, '')}`, d); }
  const png = await weekPng(ctx, d);
  return { d, png };
}

/** /og/week/20261010.png */
export async function renderWeekPng(ctx, ymd) {
  const saved = await getJSON(`week/png/${ymd}`);
  if (saved?.b) { const png = unb64(saved.b); return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'x-gk-edge-ttl': '3600' } }); }
  const d = await getJSON(`week/d/${ymd}`);
  if (!d) return new Response('not found', { status: 404 });
  const png = await weekPng(ctx, d);
  return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'x-gk-edge-ttl': '3600' } });
}

/** 텔레그램 채널로 보내기 */
export async function sendWeek(ctx, { force = false, fresh = false } = {}) {
  const chat = process.env.TELEGRAM_CHANNEL_ID;
  if (!chat || !process.env.TELEGRAM_BOT_TOKEN) throw new Error('텔레그램 채널이 설정되지 않았습니다');
  const { d, png } = await buildWeek(ctx, { fresh });
  const { sendCard } = await import('./tgchannel.mjs');
  const md = (s) => { const [, m, dd] = s.split('-'); return `${Number(m)}/${Number(dd)}`; };
  const cap = `🗓 <b>주간 정리 · ${md(d.mon)}~${md(d.fri)}</b>\n${esc(d.headline || '')}\n\n${d.items.slice(0, 5).map((x, i) => `${i + 1}. ${x.mk === 'KR' ? '🇰🇷' : '🇺🇸'} ${esc(x.title)}`).join('\n')}\n…외 ${Math.max(0, d.items.length - 5)}개는 이미지에서\n\n<a href="https://gk-stock.com/">GK의 공시레이더 →</a>`;
  await sendCard(chat, cap, async () => png, { preview: false });
  await setJSON(`week/sent/${d.fri}`, { at: Date.now(), force });
  return { ok: true, fri: d.fri, img: `/og/week/${d.fri.replace(/-/g, '')}.png` };
}

/** 크론(매분): 토요일 한국 시간 8:30~12:00 사이 한 번 */
export async function weekWatch(ctx) {
  if (!process.env.TELEGRAM_CHANNEL_ID || !process.env.TELEGRAM_BOT_TOKEN) return null;
  const k = new Date(Date.now() + 9 * 3600e3);
  const m = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (k.getUTCDay() !== 6 || m < 8 * 60 + 30 || m > 12 * 60) return null;
  const { DEFAULT_CFG } = await import('./tgchannel.mjs');
  const cfg = { ...DEFAULT_CFG, ...((await getJSON('tgch/cfg')) || {}) };
  if (!cfg.on || cfg.weekly === false) return null;
  const w = weekOf();
  if (await getJSON(`week/sent/${w.fri}`)) return null;
  const tk = `week/try/${w.fri}`;
  const t = (await getJSON(tk)) || { n: 0, at: 0 };
  if (t.n >= 3 || Date.now() - t.at < 15 * 60e3) return null;
  const { claim } = await import('./tgchannel.mjs');
  if (!(await claim(`week/c/${w.fri}`, 3 * 86400e3))) return null; // 주 1회만 (중간에 끊겨도 다시 안 보냄)
  await setJSON(tk, { n: t.n + 1, at: Date.now() });
  try { return await sendWeek(ctx, { fresh: true }); } catch (e) { if (!/abort|timeout/i.test(e.message)) await (await import('./tgchannel.mjs')).unclaim(`week/c/${w.fri}`); await setJSON(tk, { n: t.n + 1, at: Date.now(), err: String(e.message).slice(0, 200) }).catch(() => {}); return { error: e.message }; }
}
