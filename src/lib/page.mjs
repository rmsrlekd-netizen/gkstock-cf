// 공시·보도자료별 고유 주소 페이지 (/p/ID) — 검색엔진·링크 공유용으로 제목·요약을 미리 넣어 보냄
//  화면 자체는 기존 앱이 그대로 그림 (주소만 다름)
import { getJSON } from './store.mjs';
import { findFiling, snapshotItem } from './filing-doc.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORIGIN = 'https://gk-stock.com';

function titleOf(it, ai) {
  return ai?.headline || it.ko?.title || it.summary?.title || it.titleKo || it.pr?.headline || it.title || it.titleClean || it.formKo || it.form || it.id;
}

export async function renderItemPage(env, req, id) {
  const base = await env.ASSETS.fetch(new Request(new URL('/', req.url)));
  let html = await base.text();
  const it = await findFiling(id);
  if (!it) {
    html = html.replace('<meta name="robots" content="index, follow, max-image-preview:large" />', '<meta name="robots" content="noindex" />');
    return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  }
  snapshotItem(it).catch(() => {});
  const ai = await getJSON(`ai3/${id}`);
  const co = it.name || it.company || it.ticker || '';
  const mk = it.src === 'DART' || it.market === 'KR' ? '한국' : '미국';
  const kind = it.src === 'PR' ? '보도자료' : it.src === 'NEWS' ? '뉴스' : `공시${it.form ? ' ' + it.form : ''}`;
  const t = titleOf(it, ai);
  const fullTitle = `${co ? co + (it.ticker && it.ticker !== co ? ` (${it.ticker})` : '') + ' ' : ''}${kind}: ${t} | GK의 공시레이더`.slice(0, 140);
  const sum = ai?.summary?.length ? ai.summary.join(' ') : (it.desc || it.pr?.deck || it.summary?.sub || t);
  const desc = `${mk} ${co} ${kind} — ${sum}`.replace(/\s+/g, ' ').slice(0, 155);
  const url = `${ORIGIN}/p/${id}`;
  const when = it.time || it.seenAt || (it.date ? `${it.date}T09:00:00+09:00` : null);
  const ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: t.slice(0, 110), description: desc, datePublished: when, mainEntityOfPage: url, inLanguage: 'ko', author: { '@type': 'Organization', name: 'GK의 공시레이더' }, publisher: { '@type': 'Organization', name: 'GK의 미국 주식', logo: { '@type': 'ImageObject', url: `${ORIGIN}/img/gk-logo.png` } }, about: co || undefined };
  const body = `<article class="ssr" id="ssr"><p>${esc(mk)} · ${esc(kind)}${co ? ' · ' + esc(co) : ''}${when ? ' · ' + esc(String(when).slice(0, 16).replace('T', ' ')) : ''}</p><h1>${esc(t)}</h1>${ai?.summary?.length ? `<h2>AI 핵심 요약</h2><ul>${ai.summary.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p>${esc(sum)}</p>`}${ai?.positive?.length ? `<h2>긍정적 요인</h2><ul>${ai.positive.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${ai?.negative?.length ? `<h2>부정적 요인</h2><ul>${ai.negative.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${ai?.analyst ? `<h2>애널리스트 코멘트</h2><p>${esc(ai.analyst)}</p>` : ''}<p>${it.ticker ? `<a href="/s/${it.src === 'DART' || it.market === 'KR' ? 'KR' : 'US'}/${encodeURIComponent(it.ticker)}">${esc(co || it.ticker)} 다른 공시·급등 이유 보기</a> · ` : ''}<a href="/">GK의 공시레이더 — 미국·한국 실시간 공시</a></p></article>`;
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(fullTitle)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(desc)}" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`)
    .replace(/<meta property="og:type" content="[^"]*" \/>/, '<meta property="og:type" content="article" />')
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(fullTitle.replace(' | GK의 공시레이더', ''))}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(desc)}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(t.slice(0, 70))}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(desc)}" />`)
    // 공유 미리보기 이미지: 로고 대신 이 공시 카드 (제목·AI 요약)
    .replace(/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${ORIGIN}/og/${id}.png${ai ? '?v=a' : ''}" />\n  <meta property="og:image:width" content="1200" />\n  <meta property="og:image:height" content="630" />`)
    .replace(/<meta name="twitter:card" content="[^"]*" \/>/, '<meta name="twitter:card" content="summary_large_image" />')
    .replace(/<meta name="twitter:image" content="[^"]*" \/>/, `<meta name="twitter:image" content="${ORIGIN}/og/${id}.png${ai ? '?v=a' : ''}" />`)
    .replace('</head>', `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n</head>`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, body);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120', 'x-gk-edge-ttl': '300' } });
}

/** /sitemap-pages.xml (public/sitemap.xml 색인이 가리킴) — 첫 화면 + 최근 공시·보도자료 페이지 */
export async function sitemap() {
  const { sitemapRows } = await import('./archive.mjs');
  let rows = await sitemapRows(5000).catch(() => []);
  if (!rows.length) {
    const [sec, dart, news] = await Promise.all([getJSON('sec/feed'), getJSON('dart/feed'), getJSON('news/feed')]);
    rows = [...(sec?.items || []), ...(dart?.items || []), ...(news?.items || []).filter((x) => x.src === 'PR')].filter((x) => x.ticker).map((x) => ({ id: x.id, ms: Date.parse(x.time || x.seenAt || '') || 0 }));
  }
  const urls = [`<url><loc>${ORIGIN}/</loc><changefreq>always</changefreq><priority>1.0</priority></url>`,
    ...Object.keys(SECTIONS).map((k) => `<url><loc>${ORIGIN}/${k}</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>`),
    ...rows.map((x) => `<url><loc>${ORIGIN}/p/${x.id}</loc>${x.ms ? `<lastmod>${new Date(x.ms).toISOString()}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.6</priority></url>`)];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=1800', 'x-gk-edge-ttl': '1800' } });
}

/** "오늘 주요 이슈" 회차 공유 주소 (/i/kr-20260928-2) — 카톡·SNS 미리보기용 제목·이미지를 넣어 보냄 */
export async function renderIssuePage(env, req, id) {
  const base = await env.ASSETS.fetch(new Request(new URL('/', req.url)));
  let html = await base.text();
  const ed = await getJSON(`issues/ed/${id}`);
  if (!ed) {
    html = html.replace('<meta name="robots" content="index, follow, max-image-preview:large" />', '<meta name="robots" content="noindex" />');
    return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  }
  const d = new Date(ed.date + 'T12:00:00Z');
  const t = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${ed.mk === 'KR' ? '국장' : '미장'} ${ed.slot} 주요 이슈 ${ed.issues.length}`;
  const desc = `${ed.headline} — ${ed.issues.slice(0, 4).map((x) => x.title).join(' · ')}`.slice(0, 155);
  const url = `${ORIGIN}/i/${id}`;
  const img = `${ORIGIN}/og/i/${id}.png`;
  const body = `<article class="ssr" id="ssr"><h1>${esc(t)}</h1><p>${esc(ed.headline)}</p><ol>${ed.issues.map((x) => `<li><h2>[${esc(x.tag)}] ${esc(x.title)}</h2><p>${esc(x.sub)}</p><ul>${x.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></li>`).join('')}</ol><p><a href="/">GK의 공시레이더</a></p></article>`;
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(t)} | GK의 공시레이더</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(desc)}" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`)
    .replace(/<meta property="og:type" content="[^"]*" \/>/, '<meta property="og:type" content="article" />')
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(t)}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(desc)}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(t)}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(desc)}" />`)
    .replace(/<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${img}" />\n  <meta property="og:image:width" content="1200" />\n  <meta property="og:image:height" content="630" />`)
    .replace(/<meta name="twitter:card" content="[^"]*" \/>/, '<meta name="twitter:card" content="summary_large_image" />')
    .replace(/<meta name="twitter:image" content="[^"]*" \/>/, `<meta name="twitter:image" content="${img}" />`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, body);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120', 'x-gk-edge-ttl': '600' } });
}

/** 종목별 공개 페이지 (/s/KR/005930, /s/US/NVDA) — "○○ 공시", "○○ 급등 이유" 검색에 걸리도록 최근 공시·AI 요약을 미리 넣어 보냄
 *  화면은 앱이 그 종목의 기업 분석 화면으로 그림 */
export async function renderStockPage(env, req, mk, t) {
  mk = mk.toUpperCase(); t = t.toUpperCase();
  const base = await env.ASSETS.fetch(new Request(new URL('/', req.url)));
  let html = await base.text();
  const notFound = () => new Response(html.replace('<meta name="robots" content="index, follow, max-image-preview:large" />', '<meta name="robots" content="noindex" />'), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  if (!(mk === 'KR' ? /^\d{6}$/ : /^[A-Z][A-Z0-9.\-]{0,9}$/).test(t)) return notFound();
  const { queryArchive } = await import('./archive.mjs');
  const items = await queryArchive({ market: mk, ticker: t, limit: 30 }).catch(() => []);
  if (!items.length) return notFound();
  const { getManyJSON } = await import('./store.mjs');
  const ais = await getManyJSON(items.slice(0, 12).map((x) => `ai3/${x.id}`)).catch(() => ({}));
  const wm = (await getJSON('why/map').catch(() => null)) || {};
  const w = wm[`${mk}|${t}`];
  const why = w?.r && !/^뚜렷한/.test(w.r) && Date.now() - (w.at || 0) < 3 * 86400e3 ? w.r : null;
  const name = items.find((x) => x.name)?.name || items.find((x) => x.company)?.company || t;
  const label = mk === 'KR' ? `${name}(${t})` : `${t}${name && name !== t ? ` ${name}` : ''}`;
  const mkName = mk === 'KR' ? '한국' : '미국';
  const fullTitle = `${label} 공시·주가 급등 이유 실시간 | GK의 공시레이더`.slice(0, 120);
  const latest = items[0];
  const tOf = (x, ai) => ai?.headline || x.ko?.title || x.summary?.title || x.titleKo || x.pr?.headline || x.title || x.titleClean || x.formKo || x.form || x.id;
  const desc = `${mkName} ${label} 최신 공시·보도자료 ${items.length}건과 AI 요약.${why ? ` 오늘 움직임 이유: ${why}.` : ''} 최근: ${tOf(latest, ais[`ai3/${latest.id}`])}`.replace(/\s+/g, ' ').slice(0, 155);
  const url = `${ORIGIN}/s/${mk}/${encodeURIComponent(t)}`;
  const when = (x) => String(x.src === 'DART' && x.date ? x.date : x.time || x.seenAt || x.date || '').slice(0, 10);
  const kindOf = (x) => (x.src === 'PR' ? '보도자료' : x.src === 'DART' ? '공시' : `SEC ${x.form || '공시'}`);
  const li = items.map((x) => { const ai = ais[`ai3/${x.id}`]; return `<li><a href="/p/${esc(x.id)}">${esc(tOf(x, ai))}</a> <small>${esc(when(x))} · ${esc(kindOf(x))}${ai?.verdict ? ' · AI ' + esc(ai.verdict) : ''}</small>${ai?.summary?.[0] ? `<p>${esc(ai.summary[0])}</p>` : ''}</li>`; }).join('');
  const ld = { '@context': 'https://schema.org', '@type': 'WebPage', name: fullTitle, description: desc, url, inLanguage: 'ko', about: { '@type': 'Corporation', name, tickerSymbol: t }, mainEntity: { '@type': 'ItemList', itemListElement: items.slice(0, 10).map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: `${ORIGIN}/p/${x.id}`, name: String(tOf(x, ais[`ai3/${x.id}`])).slice(0, 110) })) } };
  const body = `<article class="ssr" id="ssr"><p>${esc(mkName)} 주식 · ${esc(label)}</p><h1>${esc(label)} 실시간 공시·보도자료와 주가 움직임 이유</h1>${why ? `<h2>오늘 움직임 이유 (AI 추정)</h2><p>${esc(why)}</p>` : ''}<h2>최근 공시·보도자료</h2><ol>${li}</ol><p><a href="/#company/${mk}/${encodeURIComponent(t)}">${esc(label)} 기업 분석 보기</a> · <a href="/">GK의 공시레이더 — 미국·한국 실시간 공시</a></p></article>`;
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(fullTitle)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(desc)}" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(fullTitle.replace(' | GK의 공시레이더', ''))}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(desc)}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${esc(fullTitle.replace(' | GK의 공시레이더', ''))}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${esc(desc)}" />`)
    .replace('</head>', `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n</head>`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, body);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-gk-edge-ttl': '900' } });
}

/** /sitemap-stocks.xml — 최근 30일 공시가 있는 종목 페이지 */
export async function stockSitemap() {
  const { sitemapTickers } = await import('./archive.mjs');
  const rows = await sitemapTickers().catch(() => []);
  const urls = rows.map((r) => `<url><loc>${ORIGIN}/s/${r.m}/${encodeURIComponent(r.t)}</loc>${r.ms ? `<lastmod>${new Date(r.ms).toISOString()}</lastmod>` : ''}<changefreq>daily</changefreq><priority>0.7</priority></url>`);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-gk-edge-ttl': '3600' } });
}

// ───── 메뉴별 고유 주소 (/themes, /popular …) — 검색 결과의 '사이트링크'(하위 메뉴)와 메뉴별 검색 노출용 ─────
//  화면은 앱이 그 메뉴로 그대로 그림. 검색엔진에는 메뉴별 제목·설명·최신 내용 일부를 미리 넣어 보냄
export const SECTIONS = {
  popular: { view: 'popular', t: '실시간 인기·급등·급락 종목 TOP 10 (국내·미국)', d: '네이버 증권 기준 국내·미국 실시간 인기 검색 종목과 상승률·하락률 상위 종목, 오늘 움직임 이유를 15초마다 갱신합니다.' },
  themes: { view: 'themes', t: '당일 테마 — 오늘의 주도 테마·섹터', d: '오늘 가장 강한 테마와 약한 테마, 테마별 대장주와 등락률을 국장·미장으로 나눠 실시간으로 보여줍니다.' },
  sectors: { view: 'tdir', t: '테마·섹터 관련주 사전 (국내·미국)', d: '네이버 증권 테마·업종 전체와 미국 S&P 500·나스닥100 섹터별 관련주를 한눈에 정리했습니다.' },
  schedule: { view: 'sched', t: '오늘 증시 일정 — 실적 발표·경제지표·IPO', d: '국장·미장 오늘과 이번 주 주요 일정: 실적 발표, 미국 경제지표, 공모주 상장, 휴장일을 정리합니다.' },
  earnings: { view: 'earnings', t: '미국 실적 발표 캘린더 — 예상 EPS·매출', d: '미국 상장사 실적 발표 일정과 시장 예상 EPS·매출, 발표 시간(장전·장후)을 날짜별로 보여줍니다.' },
  econ: { view: 'econ', t: '미국 경제지표 발표 일정과 AI 해석', d: 'CPI·고용·FOMC 등 미국 주요 경제지표 발표 일정과 예상치·실제치, 발표 직후 AI 해석을 제공합니다.' },
  halts: { view: 'halt', t: 'VI 발동·서킷브레이커·거래정지 실시간 현황', d: '국장 VI(변동성 완화장치) 발동·해제와 미국 거래정지·재개 내역을 1분마다 기록합니다.' },
  reaction: { view: 'react', t: '공시 유형별 발표 후 주가 반응 통계', d: '유상증자·자사주·공급계약·실적 등 공시 유형별로 발표 후 1일·5일 주가가 어떻게 움직였는지 통계로 보여줍니다.' },
  flows: { view: 'flows', t: '외국인·기관 수급 상위 종목', d: '국내 주식 외국인·기관 순매수·순매도 상위 종목을 장중 잠정치로 보여줍니다.' },
  market: { view: 'market', t: '시장 지표 — 지수·환율·금리·선물', d: '코스피·코스닥, S&P 500·나스닥, 원/달러, 미 국채 금리, 나스닥100 선물, 야간선물을 한 화면에서 확인합니다.' },
};
export async function renderSectionPage(env, req, slug) {
  const sec = SECTIONS[slug];
  const base = await env.ASSETS.fetch(new Request(new URL('/', req.url)));
  let html = await base.text();
  if (!sec) return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
  const url = `${ORIGIN}/${slug}`;
  const title = `${sec.t} | GK의 공시레이더`;
  // 최신 내용 일부 (검색엔진이 '살아 있는 페이지'로 보도록)
  let live = '';
  try {
    if (slug === 'popular') {
      const p = await getJSON('popular/v2');
      const li = (a, mk) => (a || []).slice(0, 10).map((x) => `<li>${esc(mk === 'KR' ? x.name || x.ticker : x.ticker)} ${x.pct != null ? esc((x.pct > 0 ? '+' : '') + Number(x.pct).toFixed(2) + '%') : ''}${x.reason ? ' — ' + esc(x.reason) : ''}</li>`).join('');
      live = `<h2>국내 상승률 상위</h2><ol>${li(p?.krUp, 'KR')}</ol><h2>미국 상승률 상위</h2><ol>${li(p?.usUp, 'US')}</ol><h2>국내 인기 검색</h2><ol>${li(p?.kr, 'KR')}</ol>`;
    } else if (slug === 'themes') {
      const t = await getJSON('themes/v1');
      live = `<h2>국장 강세 테마</h2><ol>${(t?.kr?.themes || []).slice(0, 10).map((g) => `<li>${esc(g.name)} ${esc((g.rate > 0 ? '+' : '') + Number(g.rate || 0).toFixed(2) + '%')} — ${(g.leaders || []).slice(0, 3).map((s) => esc(s.name)).join(', ')}</li>`).join('')}</ol>`;
    }
  } catch {}
  const body = `<article class="ssr" id="ssr"><h1>${esc(sec.t)}</h1><p>${esc(sec.d)}</p>${live}<nav><ul>${Object.entries(SECTIONS).map(([k, v]) => `<li><a href="/${k}">${esc(v.t.split(' — ')[0])}</a></li>`).join('')}</ul></nav><p><a href="/">GK의 공시레이더 — 미국·한국 실시간 공시</a></p></article>`;
  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(sec.d)}" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(sec.t)}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(sec.d)}" />`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, body);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-gk-edge-ttl': '600' } });
}

/** /rss.xml — 최신 '오늘 주요 이슈' 회차 + 중요 공시 (네이버 서치어드바이저 RSS 제출용) */
export async function rssFeed() {
  const xe = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const [ik, iu, sec, dart, news] = await Promise.all(['issues/idx/KR', 'issues/idx/US', 'sec/feed', 'dart/feed', 'news/feed'].map((k) => getJSON(k).catch(() => null)));
  const items = [];
  for (const [mk, idx] of [['KR', ik], ['US', iu]]) for (const x of (idx || []).slice(0, 15)) {
    const d = new Date(x.date + 'T12:00:00Z');
    items.push({ title: `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${mk === 'KR' ? '국장' : '미장'} ${x.slot || ''} 주요 이슈`, link: `${ORIGIN}/i/${x.id}`, desc: x.headline || '', ms: x.at || Date.parse(x.date) });
  }
  const tOf = (x) => x.ko?.title || x.summary?.title || x.titleKo || x.pr?.headline || x.title || x.titleClean || x.formKo || x.form || '';
  for (const x of [...(sec?.items || []), ...(dart?.items || []), ...(news?.items || []).filter((z) => z.src === 'PR')]) {
    if (!x.ticker || (x.impact ?? 0) < 4) continue;
    const co = x.src === 'DART' ? x.name || x.ticker : `${x.ticker}${x.name ? ' ' + x.name : ''}`;
    items.push({ title: `${co} — ${tOf(x)}`.slice(0, 150), link: `${ORIGIN}/p/${x.id}`, desc: x.summary?.sub || x.desc || x.pr?.deck || '', ms: Date.parse(x.time || x.seenAt || '') || 0 });
  }
  items.sort((a, b) => b.ms - a.ms);
  const rows = items.slice(0, 60).map((x) => `<item><title>${xe(x.title)}</title><link>${xe(x.link)}</link><guid isPermaLink="true">${xe(x.link)}</guid>${x.ms ? `<pubDate>${new Date(x.ms).toUTCString()}</pubDate>` : ''}<description>${xe(String(x.desc).slice(0, 300))}</description></item>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>GK의 공시레이더</title><link>${ORIGIN}/</link><description>미국·한국 실시간 공시, 보도자료, 오늘 주요 이슈와 AI 분석</description><language>ko</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n${rows}\n</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=600', 'x-gk-edge-ttl': '600' } });
}
