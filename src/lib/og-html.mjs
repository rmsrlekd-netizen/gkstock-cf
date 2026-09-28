// 공유 카드 HTML (순수 함수 — 테스트에서도 사용)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function ogHtml(it, ai, px) {
  const kr = it.src === 'DART' || it.market === 'KR';
  const kind = it.src === 'PR' ? '보도자료' : it.src === 'NEWS' ? '뉴스' : `공시${it.form ? ' · ' + it.form : ''}`;
  const co = cut(it.name || it.company || '', 28);
  const tk = it.ticker && it.ticker !== co ? it.ticker : '';
  const title = cut(ai?.headline || it.ko?.title || it.summary?.title || it.titleKo || it.pr?.headline || it.title || it.titleClean || it.formKo || '', 64);
  const lines = (ai?.summary?.length ? ai.summary : [it.desc || it.pr?.deck || it.summary?.sub || '']).filter(Boolean).slice(0, 3).map((x) => cut(x, 48));
  const verdict = ai?.verdict;
  const vColor = verdict === '긍정' ? '#34d399' : verdict === '부정' ? '#fb7185' : '#a5b4fc';
  const when = String(it.time || it.seenAt || it.date || '').slice(0, 10).replace(/-/g, '.');
  const html = `<div style="display:flex;flex-direction:column;width:1200px;height:630px;padding:54px 64px;background:linear-gradient(135deg,#1a1650 0%,#0b0d24 55%,#080a1c 100%);color:#eef0ff;font-family:'Noto Sans KR'">
    <div style="display:flex;width:100%;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center">
        <div style="display:flex;padding:8px 18px;border-radius:999px;background:${kr ? '#ff5a6a' : '#3e7bff'};color:#fff;font-size:24px;font-weight:700">${kr ? '한국' : '미국'}</div>
        <div style="display:flex;margin-left:14px;padding:8px 18px;border-radius:999px;background:rgba(255,255,255,.1);font-size:24px;font-weight:700">${esc(kind)}</div>
        ${verdict ? `<div style="display:flex;margin-left:14px;padding:8px 18px;border-radius:999px;border:2px solid ${vColor};color:${vColor};font-size:24px;font-weight:700">AI 판단 ${esc(verdict)}</div>` : ''}
      </div>
      <div style="display:flex;font-size:26px;font-weight:700;color:#c4b5fd">GK의 공시레이더</div>
    </div>
    <div style="display:flex;align-items:baseline;margin-top:34px">
      <div style="display:flex;font-size:40px;font-weight:700;color:#fff">${esc(co)}</div>
      ${tk ? `<div style="display:flex;margin-left:18px;font-size:34px;font-weight:700;color:#60a5fa">${esc(tk)}</div>` : ''}
      ${when ? `<div style="display:flex;margin-left:18px;font-size:24px;color:#8b90b8">${esc(when)}</div>` : ''}
    </div>
    <div style="display:flex;width:100%;margin-top:16px;font-size:46px;font-weight:700;line-height:1.3;color:#fff;word-break:keep-all">${esc(title)}</div>
    <div style="display:flex;flex-direction:column;margin-top:18px">
      ${lines.map((l) => `<div style="display:flex;align-items:flex-start;margin-top:10px;font-size:27px;line-height:1.4;color:#c3c7e6"><div style="display:flex;width:10px;height:10px;border-radius:5px;background:#f5c542;margin:16px 16px 0 0"></div><div style="display:flex;flex:1;word-break:keep-all">${esc(l)}</div></div>`).join('')}
    </div>
    <div style="display:flex;width:100%;margin-top:auto;padding-top:18px;border-top:1px solid rgba(140,150,255,.22);justify-content:space-between;align-items:center;font-size:24px;color:#8b90b8">
      <div style="display:flex">AI 애널리스트 분석 · 긍정/부정 요인 · 원문 번역</div>
      <div style="display:flex;color:#f5c542;font-weight:700">gk-stock.com${px?.p ? '' : ''}</div>
    </div>
  </div>`;
  const allText = [...new Set(`${html.replace(/<[^>]+>/g, '')}한국미국공시보도자료뉴스AI판단긍정부정중립GK의공시레이더gk-stock.com…·`.replace(/\s+/g, ''))].join('') + ' ';
  return { html: html.replace(/>\s+</g, '><').trim(), allText };
}

// "오늘 주요 이슈" 회차 공유 카드
export function issueOgHtml(ed) {
  const kr = ed.mk === 'KR';
  const d = new Date(ed.date + 'T12:00:00Z');
  const md = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  const accent = kr ? '#ff5a6a' : '#3e7bff';
  const list = (ed.issues || []).slice(0, 6);
  const ix = (ed.idx || []).slice(0, 3);
  const pc = (v) => (v > 0 ? '#ff6b7a' : v < 0 ? '#5aa5ff' : '#c3c7e6');
  const html = `<div style="display:flex;flex-direction:column;width:1200px;height:630px;padding:38px 56px 34px;background:linear-gradient(135deg,#1a1650 0%,#0b0d24 55%,#080a1c 100%);color:#eef0ff;font-family:'Noto Sans KR'">
    <div style="display:flex;width:100%;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center">
        <div style="display:flex;padding:8px 20px;border-radius:999px;background:${accent};color:#fff;font-size:26px;font-weight:700">${kr ? '국장' : '미장'} · ${esc(ed.slot)}</div>
        <div style="display:flex;margin-left:16px;font-size:28px;font-weight:700;color:#c3c7e6">${esc(md)}</div>
      </div>
      <div style="display:flex;font-size:26px;font-weight:700;color:#c4b5fd">GK의 공시레이더</div>
    </div>
    <div style="display:flex;align-items:baseline;margin-top:12px">
      <div style="display:flex;font-size:54px;font-weight:700;color:#fff">오늘 주요 이슈</div>
      <div style="display:flex;margin-left:14px;font-size:54px;font-weight:700;color:#f5c542">${list.length ? (ed.issues || []).length : ''}</div>
      <div style="display:flex;margin-left:auto;align-items:center">${ix.map((x) => `<div style="display:flex;flex-direction:column;align-items:flex-end;margin-left:26px"><div style="display:flex;font-size:20px;color:#8b90b8">${esc(x.label)}</div><div style="display:flex;font-size:26px;font-weight:700;color:${pc(x.pct)}">${x.pct > 0 ? '+' : ''}${Number(x.pct || 0).toFixed(2)}%</div></div>`).join('')}</div>
    </div>
    <div style="display:flex;margin-top:8px;font-size:27px;color:#c3c7e6">${esc(cut(ed.headline, 46))}</div>
    <div style="display:flex;flex-wrap:wrap;width:100%;margin-top:18px">
      ${list.map((x, i) => `<div style="display:flex;align-items:center;width:524px;margin:0 ${i % 2 ? 0 : 32}px 12px 0;padding:10px 16px;border-radius:16px;background:rgba(255,255,255,.06);border:1px solid rgba(139,108,255,.35)"><div style="display:flex;width:44px;height:44px;border-radius:12px;background:#f5c542;color:#1b1300;font-size:26px;font-weight:700;align-items:center;justify-content:center">${i + 1}</div><div style="display:flex;flex-direction:column;margin-left:14px;flex:1"><div style="display:flex;font-size:19px;color:#a5b4fc">${esc(x.tag)}</div><div style="display:flex;font-size:24px;font-weight:700;color:#fff">${esc(cut(x.title, 22))}</div></div></div>`).join('')}
    </div>
    <div style="display:flex;width:100%;margin-top:auto;justify-content:space-between;align-items:center;font-size:22px;color:#8b90b8">
      <div style="display:flex">${esc((ed.keywords || []).map((k) => '#' + k).join('  '))}</div>
      <div style="display:flex;color:#f5c542;font-weight:700">gk-stock.com</div>
    </div>
  </div>`;
  const allText = [...new Set(`${html.replace(/<[^>]+>/g, '')}국장미장오늘주요이슈GK의공시레이더gk-stock.com0123456789+-.%#…·`.replace(/\s+/g, ''))].join('') + ' ';
  return { html: html.replace(/>\s+</g, '><').trim(), allText };
}
