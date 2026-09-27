// 공시별 공유 미리보기 이미지 (/og/공시ID.png, 1200×630)
// 카카오톡·SNS에 링크를 공유하면 GK 로고 대신 이 공시의 제목·AI 요약이 담긴 카드가 보임
import { ImageResponse, GoogleFont, cache } from '@cf-wasm/og/workerd';
import { t } from '@cf-wasm/og/html-to-react';
import { getJSON } from './store.mjs';
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
  return new Response(res.body, { status: res.status, headers: h });
}
