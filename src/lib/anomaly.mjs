// 🧪 자동 이상치 점검 — "값이 말이 되는지"를 사이트 전체에서 훑어봄 (고장 감시는 '멈췄는지', 이건 '틀렸는지')
//  · 3시간마다 실행(3분 크론에서 시간 확인) · 결과 anom/last · 새 문제가 생기면 관리자 텔레그램(6시간에 한 번까지)
//  · 서버 안에서 저장된 자료를 직접 읽어서 보므로, 관리자 전용인 작전 레이더 자료도 함께 점검함
import { getJSON, setJSON } from './store.mjs';

const H = 3600e3, DAY = 24 * H;
const kst = (ms = Date.now()) => { const d = new Date(ms + 9 * H); return { date: d.toISOString().slice(0, 10), m: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: d.getUTCDay() }; };
const r1 = (v) => Math.round(v * 10) / 10;

export async function runAnomaly({ force = false, now = Date.now() } = {}) {
  const last = await getJSON('anom/last').catch(() => null);
  if (!force && last && now - (last.at || 0) < 3 * H) return null;
  const items = [];
  const add = (lv, area, msg, ex = []) => items.push({ lv, area, msg, ex: ex.slice(0, 6) });
  const z = kst(now);
  const tryRun = async (name, fn) => { try { await fn(); } catch (e) { add('warn', '점검 자체', `${name} 점검 중 오류: ${String(e.message || e).slice(0, 80)}`); } };

  // ① 실적 판정 — 예상 대비 ±150% 넘는 판정 (단위 오류·일회성 의심)
  await tryRun('실적', async () => {
    const vmap = (await getJSON('earn/vmap')) || {};
    const bad = Object.entries(vmap).filter(([, v]) => { const m = String(v.line || '').match(/\(([+-]?\d+(?:\.\d+)?)%\)/); return m && Math.abs(Number(m[1])) > 150 && !/일회성|환산/.test(v.line || ''); });
    if (bad.length) add('warn', '실적 판정', `예상 대비 ±150% 넘는 판정 ${bad.length}건 — 단위(ADR·통화) 오류인지 확인`, bad.map(([, v]) => `${v.n || v.t}: ${String(v.line).slice(0, 70)}`));
  });

  // ② 인기·상승·하락 종목 — 국장은 하루 ±30%를 못 넘음, 가격 0·빈 목록
  await tryRun('인기 종목', async () => {
    const p = await getJSON('popular/v2');
    if (!p) return add('warn', '인기 종목', '인기 종목 자료 없음');
    for (const [k, lab] of [['kr', '국내 인기'], ['us', '미국 인기'], ['krUp', '국내 상승'], ['krDown', '국내 하락']]) {
      const L = p[k] || [];
      if (!L.length && ['kr', 'us'].includes(k)) add('warn', '인기 종목', `${lab} 목록이 비어 있음`);
      const zero = L.filter((x) => x.price === 0 || (x.price != null && x.price < 0));
      if (zero.length) add('warn', '인기 종목', `${lab} 가격 0 ${zero.length}개`, zero.map((x) => x.name || x.ticker));
      if (k.startsWith('kr')) { const over = L.filter((x) => Math.abs(x.pct ?? 0) > 30.5); if (over.length) add('info', '인기 종목', `${lab}에 하루 ±30% 넘는 국장 종목 ${over.length}개 (신규 상장·재상장·병합 뒤 첫날이면 정상)`, over.map((x) => `${x.name} ${x.pct}%`)); }
    }
  });

  // ③ 시장 지표 — 지수 가격 없음·하루 ±15% 넘는 변동
  await tryRun('시장 지표', async () => {
    const m = (await getJSON('market/v1'))?.body;
    if (!m) return add('warn', '시장 지표', '시장 지표 자료 없음');
    const err = (m.indices || []).filter((x) => x.error || !(x.price > 0));
    if (err.length) add('warn', '시장 지표', `가격을 못 받은 지수 ${err.length}개`, err.map((x) => x.label));
    const big = (m.indices || []).filter((x) => Math.abs(x.pct ?? 0) > 15 && !/VIX|변동성/.test(x.label || ''));
    if (big.length) add('warn', '시장 지표', `하루 ±15% 넘는 지수 ${big.length}개 — 단위·전일가 오류인지 확인`, big.map((x) => `${x.label} ${x.pct}%`));
  });

  // ④ 오늘 주요 이슈 — 종목 등락률이 말이 안 되는 경우·이슈 개수 부족
  await tryRun('주요 이슈', async () => {
    for (const mk of ['KR', 'US']) {
      const id = ((await getJSON(`issues/idx/${mk}`)) || [])[0];
      const ed = id ? await getJSON(`issues/ed/${typeof id === 'string' ? id : id.id}`) : null;
      if (!ed) continue;
      const iss = ed.issues || [];
      if (iss.length && iss.length < 5) add('warn', '주요 이슈', `${mk} 최신 회차 이슈가 ${iss.length}개뿐`);
      const odd = iss.flatMap((x) => (x.stocks || []).filter((s) => s.pct != null && Math.abs(s.pct) > (mk === 'KR' ? 30.5 : 300)).map((s) => `${s.name} ${s.pct}%`));
      if (odd.length) add('warn', '주요 이슈', `${mk} 이슈 종목 등락률 이상 ${odd.length}개`, odd);
    }
  });

  // ⑤ 공시 목록 — 미래 시각·중복
  await tryRun('공시 목록', async () => {
    for (const [k, lab] of [['sec/feed', '미국 공시'], ['dart/feed', '한국 공시'], ['news/feed', '보도자료']]) {
      const f = await getJSON(k);
      const L = f?.items || [];
      const fut = L.filter((x) => { const t = Date.parse(x.time || x.seenAt || ''); return t && t - now > 15 * 60e3; });
      if (fut.length) add('warn', '공시 목록', `${lab}에 미래 시각 항목 ${fut.length}개 (시간대 오류)`, fut.map((x) => `${x.name || x.ticker || ''} ${x.time}`));
      const ids = new Map(); for (const x of L) ids.set(x.id, (ids.get(x.id) || 0) + 1);
      const dup = [...ids].filter(([, n]) => n > 1);
      if (dup.length) add('warn', '공시 목록', `${lab}에 같은 항목 중복 ${dup.length}개`, dup.map(([id]) => id));
    }
  });

  // ⑥ AI — 오래 멈춤
  await tryRun('AI', async () => {
    const [ok, pause] = await Promise.all([getJSON('ai/lastOk'), getJSON('ai/pause')]);
    if (pause?.until > now) add('err', 'AI', `AI 일시 정지 중: ${pause.reason || ''}`);
    if (ok?.at && now - ok.at > 8 * H && z.wd >= 1 && z.wd <= 5) add('warn', 'AI', `공시 AI 분석이 ${r1((now - ok.at) / H)}시간째 성공 기록 없음`);
  });

  // ⑦ 작전 레이더 (관리자 전용 자료도 서버에서 직접 점검)
  await tryRun('작전 레이더', async () => {
    const st = (await getJSON('mp/state')) || {};
    if (st.err) add('warn', '작전 레이더', `정기 분석 오류: ${String(st.err).slice(0, 100)}`);
    if (st.date === z.date && st.phase !== 'done' && z.m > 22 * 60) add('err', '작전 레이더', `오늘 정기 분석이 22시가 넘도록 안 끝남 (단계 '${st.phase}')`);
    if ((st.tryN || 0) >= 3) add('warn', '작전 레이더', `'${st.phase}' 단계가 ${st.tryN}번째 진전 없이 반복 중`);
    const rank = (await getJSON('mp/rank')) || {};
    const rows = Object.entries(rank).map(([code, r]) => ({ code, ...r })).filter((r) => now - (r.up || 0) < 45 * DAY);
    const today = z.date;
    const chk = (cond, lv, msg, f = (r) => `${r.n || r.code}`) => { const L = rows.filter(cond); if (L.length) add(lv, '작전 레이더', `${msg} ${L.length}개`, L.map(f)); };
    chk((r) => r.c == null || r.c <= 0, 'warn', '현재가가 없는 랭킹 종목');
    chk((r) => r.cr != null && r.cr <= 0, 'warn', '추정 평단이 0 이하인 종목');
    chk((r) => r.gap != null && (r.gap > 500 || r.gap < -95), 'warn', '현재가와 평단 차이가 +500%↑ 또는 −95%↓ (평단 계산 오류 의심)', (r) => `${r.n} ${r.gap}%`);
    chk((r) => r.rr && r.rr.v > 20, 'info', '예전 방식으로 저장된 손익비 1:20 초과 줄 (화면엔 1:20+로 표시, 다음 분석 때 갱신)', (r) => `${r.n} 1:${r.rr.v}`);
    chk((r) => r.rr && r.rr.s && r.c && r.rr.s >= r.c, 'err', '손절가가 현재가보다 높음', (r) => `${r.n} 손절 ${r.rr.s} / 현재 ${r.c}`);
    chk((r) => r.rr && r.rr.t && r.c && r.rr.t <= r.c, 'err', '1차 목표가 현재가보다 낮음', (r) => `${r.n} 목표 ${r.rr.t} / 현재 ${r.c}`);
    chk((r) => r.d === 'up' && ['띄우기', '털기', '엑시트 후'].includes(r.st), 'warn', "띄우기·털기 단계인데 '상승 가능성'으로 분류", (r) => `${r.n} ${r.st}`);
    chk((r) => r.d === 'up' && r.ckg === 'D', 'info', "'상승 가능성'인데 D등급인 예전 줄 (이제 폭탄 신호면 상승 분류를 보류 — 열거나 다음 분석 때 갱신)", (r) => r.n);
    // 같은 이름 다른 코드 (종목명 오류)
    const byName = new Map(); for (const r of rows) if (r.n) byName.set(r.n, [...(byName.get(r.n) || []), r.code]);
    const dupN = [...byName].filter(([, c]) => c.length > 1);
    if (dupN.length) add('warn', '작전 레이더', `이름이 같은데 코드가 다른 종목 ${dupN.length}개`, dupN.map(([n, c]) => `${n}: ${c.join(',')}`));
    // 최신 전 종목 시세와 랭킹 현재가 비교 (같은 날 자료끼리 15% 넘게 다르면 이상)
    const idx = (await getJSON('mp/idx')) || [];
    const snap = idx[0] ? (await getJSON(`mp/snap/${idx[0]}`))?.rows : null;
    if (snap) {
      const day0 = Date.parse(idx[0] + 'T15:30:00+09:00');
      const off = rows.filter((r) => snap[r.code]?.[2] > 0 && r.c > 0 && (r.up || 0) > day0 && Math.abs(r.c / snap[r.code][2] - 1) > 0.15);
      if (off.length) add('warn', '작전 레이더', `랭킹 현재가가 같은 날 전 종목 시세와 15% 넘게 다름 ${off.length}개`, off.map((r) => `${r.n} ${r.c} vs ${snap[r.code][2]}`));
    }
    // 날짜 기록·성적표
    if (idx.length && idx[idx.length - 1] < new Date(now - 10 * DAY + 9 * H).toISOString().slice(0, 10)) {
      const perf = await getJSON(`mp/perf/${idx[idx.length - 1]}`);
      if (!perf) add('warn', '작전 레이더', `10일 지난 분석 기록(${idx[idx.length - 1]})의 성적표가 아직 없음 — 성적표 수집 확인`);
    }
    // 한국투자증권 경보 확인
    const w = await getJSON('mp/warn');
    if (w?.scan && w.scan.date === today && w.scan.pos < (w.scan.q || []).length && z.m > 12 * 60) add('warn', '작전 레이더', `오늘 시장경보 확인이 12시가 넘도록 ${w.scan.pos}/${w.scan.q.length}에서 멈춤`);
    if (w?.err) add('warn', '작전 레이더', `시장경보 확인 오류: ${w.err}`);
  });

  // ⑧ 기존 고장 감시에서 계속 실패 중인 항목
  await tryRun('고장 감시', async () => {
    const mon = await getJSON('monitor/state');
    const bad = Object.values(mon?.checks || {}).filter((c) => !c.ok && (c.fails || 0) >= 2);
    if (bad.length) add('err', '고장 감시', `계속 실패 중인 수집·기능 ${bad.length}개`, bad.map((c) => `${c.name}: ${String(c.detail || c.msg || '').slice(0, 60)}`));
  });

  const out = { at: now, items, n: items.length, nErr: items.filter((i) => i.lv === 'err').length };
  await setJSON('anom/last', out).catch(() => {});
  // 새 문제(지난번에 없던 내용)가 있으면 관리자 텔레그램 (6시간에 한 번까지, 같은 내용 반복 안 함)
  const key = (i) => `${i.area}|${i.msg.replace(/\d+/g, '#')}`;
  const prevKeys = new Set((last?.sentKeys || []));
  const fresh = items.filter((i) => i.lv !== 'info' && !prevKeys.has(key(i))); // 참고(info)는 화면에만
  out.sentKeys = last?.sentKeys || [];
  if (fresh.length && (force || now - (last?.sentAt || 0) > 6 * H) && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const { telegram } = await import('./monitor.mjs');
      const lines = fresh.slice(0, 15).map((i) => `${i.lv === 'err' ? '🔴' : '🟡'} [${i.area}] ${i.msg}${i.ex.length ? `\n   예: ${i.ex.slice(0, 3).join(' / ')}` : ''}`);
      const ok = await telegram(`🧪 자동 이상치 점검 — 새로 찾은 문제 ${fresh.length}건\n\n${lines.join('\n')}${fresh.length > 15 ? `\n…외 ${fresh.length - 15}건` : ''}\n\n자세히: gk-stock.com/#admin`);
      if (ok) { out.sentAt = now; out.sentKeys = items.map(key); }
    } catch {}
  } else if (!fresh.length) out.sentKeys = items.map(key);
  out.sentAt = out.sentAt || last?.sentAt || 0;
  await setJSON('anom/last', out).catch(() => {});
  return { n: out.n, err: out.nErr, fresh: fresh.length };
}
