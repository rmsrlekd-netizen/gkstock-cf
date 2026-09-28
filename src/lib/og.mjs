// 공시별 공유 미리보기 이미지 (/og/공시ID.png, 1200×630)
// 카카오톡·SNS에 링크를 공유하면 GK 로고 대신 이 공시의 제목·AI 요약이 담긴 카드가 보임
import { ImageResponse, GoogleFont, cache } from '@cf-wasm/og/workerd';
import { t } from '@cf-wasm/og/html-to-react';
import { getJSON, setJSON } from './store.mjs';
import { findFiling } from './filing-doc.mjs';
import { ogHtml } from './og-html.mjs';

export async function renderOgImage(ctx, id) {
  cache.setExecutionContext(ctx);
  const it = await findFiling(id);
  if (!it) return new Response('not found', { status: 404 });
  const ai = await getJSON(`ai3/${id}`);
  const px = (await getJSON('px0/map'))?.[id];
  const { html, allText } = ogHtml(it, ai, px);
  const res = await ImageResponse.async(t(html), {
    width: 1200, height: 630,
    fonts: [new GoogleFont('Noto Sans KR', { weight: 400, text: allText }), new GoogleFont('Noto Sans KR', { weight: 700, text: allText })],
  });
  const h = new Headers(res.headers);
  h.set('cache-control', 'public, max-age=86400');
  h.set('x-gk-edge-ttl', ai ? '604800' : '1800'); // AI 분석이 붙기 전 이미지는 30분만 보관
  // 카카오톡이 이미지를 확실히 받도록 완성된 파일(길이 포함)로 보냄
  const png = await res.arrayBuffer();
  h.set('content-length', String(png.byteLength));
  return new Response(png, { status: res.status, headers: h });
}

// "오늘 주요 이슈" 회차 공유 이미지 (/og/i/회차ID.png)
//  카카오톡 미리보기가 이미지를 확실히 받도록: 회차를 만들 때 미리 그려 저장해 두고, 길이(Content-Length)가 있는 완성된 파일로 보냄
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function issueOgPng(ctx, id, ed) {
  cache.setExecutionContext(ctx || { waitUntil() {} });
  ed = ed || (await getJSON(`issues/ed/${id}`));
  if (!ed) return null;
  const { issueOgHtml } = await import('./og-html.mjs');
  const { html, allText } = issueOgHtml(ed);
  const res = await ImageResponse.async(t(html), {
    width: 1200, height: 630,
    fonts: [new GoogleFont('Noto Sans KR', { weight: 400, text: allText }), new GoogleFont('Noto Sans KR', { weight: 700, text: allText })],
  });
  if (!res.ok) throw new Error('og ' + res.status);
  const png = new Uint8Array(await res.arrayBuffer());
  await setJSON(`issues/og/${id}`, { b: b64(png) }).catch(() => {});
  return png;
}
export async function renderIssueOg(ctx, id) {
  const saved = await getJSON(`issues/og/${id}`);
  const png = saved?.b ? unb64(saved.b) : await issueOgPng(ctx, id);
  if (!png) return new Response('not found', { status: 404 });
  return new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.byteLength), 'cache-control': 'public, max-age=86400', 'x-gk-edge-ttl': '604800' } });
}
