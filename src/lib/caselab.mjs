// v233 🔬 연구실: ① 공시의 속뜻(세력 시각·기관 시각) ② 대세상승(+100%↑) 해부 ③ 적발 사례 정답지 채점
//  모두 '그날까지 나온 공시·일봉'만 씀 (미래 자료 안 씀). 결과는 관리자 화면 전용 — 공개 화면에 '작전주' 표시 금지.
import { getJSON, setJSON } from './store.mjs';

const DAY = 864e5;
const r1 = (x) => Math.round(x * 10) / 10;
const ymd = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

// ───── ① 공시의 속뜻 ─────
//  같은 CB·3자배정이라도 '왜 했나'에 따라 뜻이 다름. 세력은 싸게 물량을 받고(지분·전환가), 재료를 깔고(테마·계약), 띄운 뒤 판다(전환·매도).
//  기관은 희석·지배구조·자금 압박을 먼저 봄. 아래 규칙은 그 생각 순서를 그대로 옮긴 것.
export const MV = {
  mnaFund: { side: '세력', w: 3, ko: '무자본 M&A 구조', t: '경영권 인수(최대주주 변경·투자조합 지분)와 3자배정·CB가 가까이 붙어 있음 — 회사 돈으로 회사를 사는 구조일 수 있어요. 인수자는 지분을 싸게 확보했으니 주가를 띄워 되팔아야 이익이 나요.' },
  cbRefix: { side: '세력', w: 2, ko: '전환가 낮추기', t: 'CB 뒤 전환가 조정(하향) — 주가가 낮을수록 CB를 가진 쪽이 받을 주식이 늘어나요. 띄우기 전에 주가를 눌러두는 동기가 생겨요.' },
  cbMany: { side: '기관', w: 2, ko: 'CB 남발', t: '1년에 CB·BW 3번 이상 — 실제 사업 자금보다 물량 확보·돌려막기일 가능성. 기관은 희석(주식 수 증가) 때문에 피하는 구조예요.' },
  r3Many: { side: '세력', w: 2, ko: '3자배정 쪼개기', t: '3자배정 유상증자를 여러 번 — 특정인에게 싼 지분을 몰아주거나, 금액을 나눠 증권신고서를 피하는 방식일 수 있어요.' },
  themeFund: { side: '세력', w: 2, ko: '테마 갈아타기 + 자금조달', t: '사업목적 추가·상호 변경과 자금조달이 붙어 있음 — 새 테마(2차전지·AI·바이오 등) 재료를 만들고 그 이야기로 돈을 모으는 흐름이에요.' },
  goodNews: { side: '세력', w: 2, ko: '조달 뒤 호재 몰림', t: '자금조달(납입·CB) 뒤 90일 안에 공급계약·투자 공시가 2건 이상 — 띄우기 재료를 차례로 내놓는 전형적인 순서예요.' },
  paidUp: { side: '세력', w: 2, ko: '납입 뒤 급등', t: '돈이 들어온(납입 완료) 뒤 60일 안에 +50% 넘게 오름 — 싼 값에 받은 물량이 생긴 뒤 띄우기가 시작된 모양이에요.' },
  convPump: { side: '세력', w: 3, ko: '띄운 뒤 전환', t: '주가가 60일 저점보다 30%↑ 오른 상태에서 전환청구 — 전환한 주식을 시장에 팔려는(엑시트) 신호일 가능성이 커요.' },
  cbBuy: { side: '세력', w: 1, ko: 'CB 되사기', t: '회사가 CB를 만기 전에 되삼 — 대주주 콜옵션이나 재매각(리세일)으로 같은 물량을 다시 쓸 수 있어요.' },
  ceoChurn: { side: '기관', w: 1, ko: '대표 잦은 교체', t: '1년에 대표가 2번 이상 바뀜 — 지배구조가 불안하다는 신호예요.' },
  pledge: { side: '기관', w: 1, ko: '대주주 주식 담보', t: '대주주 주식을 담보로 돈을 빌림 — 자금 압박, 주가가 빠지면 반대매매로 물량이 쏟아질 수 있어요.' },
  majSell: { side: '기관', w: 1, ko: '대주주 지분 감소', t: '최대주주 등 지분이 줄었다는 공시 — 대주주가 파는 중일 수 있어요.' },
  dilute: { side: '기관', w: 2, ko: '희석 과다', t: '1년에 CB·유상증자가 4번 이상 — 주식 수가 계속 늘어 기존 주주 몫이 줄어요.' },
  inquiry: { side: '기관', w: 1, ko: '거래소 조회공시', t: '현저한 시황변동 조회공시 — 거래소가 이상 급등을 이미 확인한 상태예요.' },
  risk: { side: '기관', w: 2, ko: '감사·횡령·관리 위험', t: '감사의견·횡령·배임·관리종목 같은 위험 공시 — 기관은 여기서 바로 손을 떼요.' },
};
export const MV_KO = Object.fromEntries(Object.entries(MV).map(([k, v]) => [k, v.ko]));

const closeAt = (B, ms) => { if (!B?.length) return null; const d = ymd(ms); let lo = 0, hi = B.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (B[m].d <= d) { a = m; lo = m + 1; } else hi = m - 1; } return a; };

/** evs: [{ms, kind, title}] (그날까지) · B: 일봉(선택, 가격 조건용) · Tms: 기준 시각 */
export function motiveOf(evs, { B = null, Tms = Date.now() } = {}) {
  const E = (evs || []).filter((e) => e.ms <= Tms && e.ms > Tms - 365 * DAY);
  const of = (k, days = 365) => E.filter((e) => e.kind === k && e.ms > Tms - days * DAY);
  const near = (a, b, days) => a.some((x) => b.some((y) => Math.abs(x.ms - y.ms) <= days * DAY));
  const fund = E.filter((e) => e.kind === 'cb' || e.kind === 'rights3');
  const out = new Set();
  if (near([...of('mna'), ...of('fund5')], fund, 120)) out.add('mnaFund');
  if (of('cb').some((c) => of('refix').some((r) => r.ms > c.ms))) out.add('cbRefix');
  if (of('cb').length >= 3) out.add('cbMany');
  if (of('rights3').length >= 2) out.add('r3Many');
  if (near([...of('rename'), ...of('purpose')], fund, 180)) out.add('themeFund');
  { const fz = [...fund, ...of('paid')].sort((a, b) => b.ms - a.ms)[0]; if (fz && E.filter((e) => (e.kind === 'contract' || e.kind === 'invest') && e.ms > fz.ms && e.ms <= fz.ms + 90 * DAY).length >= 2) out.add('goodNews'); }
  if (B?.length) {
    for (const p of of('paid')) { const i = closeAt(B, p.ms); if (i < 0) continue; let hi = 0; const j = closeAt(B, Math.min(Tms, p.ms + 60 * DAY)); for (let k = i + 1; k <= j; k++) hi = Math.max(hi, B[k].h); if (hi >= B[i].c * 1.5) { out.add('paidUp'); break; } }
    for (const c of of('conv', 180)) { const i = closeAt(B, c.ms); if (i < 20) continue; let lo = 1e18; for (let k = Math.max(0, i - 60); k <= i; k++) lo = Math.min(lo, B[k].l || B[k].c); if (B[i].c >= lo * 1.3) { out.add('convPump'); break; } }
  }
  if (of('cbbuy').length) out.add('cbBuy');
  if (of('ceo').length >= 2) out.add('ceoChurn');
  if (of('pledge', 180).length) out.add('pledge');
  if (of('majsell', 180).length) out.add('majSell');
  if (E.filter((e) => ['cb', 'rights3', 'rights'].includes(e.kind)).length >= 4) out.add('dilute');
  if (of('inquiry', 90).length) out.add('inquiry');
  if (of('risk', 180).length) out.add('risk');
  return [...out];
}
export const motiveList = (keys) => (keys || []).map((k) => ({ k, ...MV[k] })).filter((x) => x.ko).sort((a, b) => (a.side === b.side ? b.w - a.w : a.side === '세력' ? -1 : 1));

// ───── ② 대세상승 해부 ─────
//  바닥(앞뒤 20·5일 중 가장 낮은 종가)에서 120거래일 안에 2배↑ 간 구간 = 대세상승. 그 바닥 시점에 '보였던 것'을 기록하고,
//  같은 종목의 평범한 날(20거래일마다, 대세상승 직전 30일 제외)과 비교 → 어떤 흔적이 대세상승 앞에 몇 배 더 자주 있었나
const EVK = ['cb', 'rights3', 'rights', 'mna', 'fund5', 'refix', 'conv', 'paid', 'rename', 'purpose', 'contract', 'invest', 'inquiry', 'pledge', 'majsell', 'ceo', 'cbbuy', 'tsell', 'bonus', 'capred'];
export const EVK_KO = { cb: 'CB·BW 발행', rights3: '3자배정 증자', rights: '유상증자', mna: '경영권 변경', fund5: '투자조합 5%↑', refix: '전환가 조정', conv: '전환청구', paid: '납입 완료', rename: '상호 변경', purpose: '사업목적 추가', contract: '공급계약', invest: '투자 결정', inquiry: '조회공시', pledge: '주식 담보', majsell: '대주주 지분 감소', ceo: '대표 변경', cbbuy: 'CB 되사기', tsell: '자사주 처분', bonus: '무상증자', capred: '감자' };
function featAt(B, i, evs) {
  const Tms = Date.parse(B[i].d + 'T15:40:00+09:00');
  const E = evs.filter((e) => e.ms <= Tms && e.ms > Tms - 180 * DAY);
  const k = new Set();
  for (const e of E) if (EVK.includes(e.kind)) k.add('ev:' + e.kind);
  for (const m of motiveOf(evs, { B, Tms })) k.add('mv:' + m);
  let hi = 0; for (let j = Math.max(0, i - 250); j <= i; j++) hi = Math.max(hi, B[j].h); const dd = (B[i].c / hi - 1) * 100;
  k.add('ch:dd' + (dd <= -70 ? '70' : dd <= -50 ? '50' : dd <= -30 ? '30' : '0'));
  let v20 = 0, v120 = 0; for (let j = Math.max(0, i - 19); j <= i; j++) v20 += B[j].v; for (let j = Math.max(0, i - 119); j <= i; j++) v120 += B[j].v; v20 /= Math.min(20, i + 1); v120 /= Math.min(120, i + 1);
  if (v120 && v20 / v120 <= 0.5) k.add('ch:dry'); // 거래량 마름 (매집 막바지·관심 없음)
  let h60 = 0, l60 = 1e18; for (let j = Math.max(0, i - 59); j <= i; j++) { h60 = Math.max(h60, B[j].h); l60 = Math.min(l60, B[j].l || B[j].c); } if (l60 > 0 && h60 / l60 <= 1.35) k.add('ch:box'); // 60일 박스(폭 35% 안)
  const cap = B[i].c * (B[i].sh || 0); void cap;
  return [...k];
}
export const FEAT_KO = (k) => { const [a, b] = k.split(':'); if (a === 'ev') return '180일 안 공시: ' + (EVK_KO[b] || b); if (a === 'mv') return '속뜻: ' + (MV_KO[b] || b); return { dd70: '1년 고점 대비 −70%↓', dd50: '1년 고점 대비 −50~70%', dd30: '1년 고점 대비 −30~50%', dd0: '1년 고점 대비 −30% 안', dry: '거래량 마름(20일 ≤ 120일 평균의 절반)', box: '60일 박스(폭 35% 안)' }[b] || k; };

/** 한 종목의 대세상승 구간들 + 비교용 평범한 날 */
export function bigRuns(B, evs, { min = 2.0, win = 120 } = {}) {
  const runs = [], base = [];
  if (!B || B.length < 200) return { runs, base };
  const n = B.length; let i = 60;
  const starts = [];
  while (i < n - 21) {
    let isLow = true; for (let j = i - 20; j <= Math.min(n - 1, i + 5); j++) if (B[j].c < B[i].c) { isLow = false; break; }
    if (!isLow) { i++; continue; }
    let hi = 0, hk = i; for (let j = i + 1; j < Math.min(n, i + win); j++) if (B[j].h > hi) { hi = B[j].h; hk = j; }
    if (hi >= B[i].c * min) {
      let lo = hi; for (let j = hk; j < Math.min(n, hk + 60); j++) lo = Math.min(lo, B[j].l || B[j].c);
      const T0 = Date.parse(B[i].d + 'T15:40:00+09:00'), TP = Date.parse(B[hk].d + 'T15:40:00+09:00');
      const pre = evs.filter((e) => e.ms <= T0 && e.ms > T0 - 180 * DAY && EVK.includes(e.kind)).sort((a, b) => a.ms - b.ms).slice(-8).map((e) => [ymd(e.ms), e.kind, String(e.title || '').slice(0, 50)]);
      const dur = evs.filter((e) => e.ms > T0 && e.ms <= TP && EVK.includes(e.kind)).sort((a, b) => a.ms - b.ms).slice(0, 8).map((e) => [ymd(e.ms), e.kind, String(e.title || '').slice(0, 50)]);
      const after = evs.filter((e) => e.ms > TP && e.ms <= TP + 60 * DAY && ['conv', 'majsell', 'tsell', 'cb', 'rights3'].includes(e.kind)).map((e) => [ymd(e.ms), e.kind]).slice(0, 5);
      runs.push({ d0: B[i].d, p0: B[i].c, dP: B[hk].d, pP: hi, g: Math.round((hi / B[i].c - 1) * 100), days: hk - i, post: Math.round((lo / hi - 1) * 100), k: featAt(B, i, evs), pre, dur, after, i });
      starts.push(i); i = hk + 1; continue;
    }
    i++;
  }
  for (let j = 250; j < n - win; j += 20) { if (starts.some((s) => j > s - 30 && j <= s + 5)) continue; base.push(featAt(B, j, evs)); }
  return { runs: runs.map(({ i: _, ...r }) => r), base };
}
/** 대세상승 vs 평범한 날: 흔적별 '몇 배 더 자주'(lift) + 2개 조합 */
export function bigStudy(R, Bs) {
  const nR = R.length, nB = Bs.length;
  if (nR < 15 || nB < 100) return { nR, nB, need: true };
  const cnt = (arr) => { const c = {}; for (const ks of arr) for (const k of ks) c[k] = (c[k] || 0) + 1; return c; };
  const cR = cnt(R.map((r) => r.k)), cB = cnt(Bs);
  const one = Object.keys({ ...cR, ...cB }).map((k) => { const a = cR[k] || 0, b = cB[k] || 0; return { k, ko: FEAT_KO(k), nR: a, pR: Math.round((a / nR) * 100), pB: Math.round((b / nB) * 100), lift: b ? r1(a / nR / (b / nB)) : null }; }).filter((x) => x.nR >= 5 && x.lift != null).sort((a, b) => b.lift - a.lift);
  const top = one.filter((x) => x.lift >= 1.2).slice(0, 12).map((x) => x.k);
  const pairs = [];
  for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++) { const A = top[a], Bk = top[b]; const r = R.filter((x) => x.k.includes(A) && x.k.includes(Bk)).length, s = Bs.filter((x) => x.includes(A) && x.includes(Bk)).length; if (r >= 5 && s) pairs.push({ k: [A, Bk], ko: FEAT_KO(A) + ' + ' + FEAT_KO(Bk), nR: r, pR: Math.round((r / nR) * 100), pB: r1((s / nB) * 100), lift: r1(r / nR / (s / nB)) }); }
  pairs.sort((a, b) => b.lift - a.lift);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  // 왜 올랐나 — 대세상승 직전 180일 공시 순서의 대표 흐름(가장 흔한 '처음 두 종류')
  const seq = {}; for (const r of R) { const ks = [...new Set(r.pre.map((p) => p[1]))].slice(0, 2); if (ks.length) { const s = ks.map((x) => EVK_KO[x] || x).join(' → '); seq[s] = (seq[s] || 0) + 1; } }
  return { nR, nB, gain: med(R.map((r) => r.g)), days: med(R.map((r) => r.days)), post: med(R.map((r) => r.post)), one: one.slice(0, 25), low: one.filter((x) => x.lift <= 0.7).slice(-8).reverse(), pairs: pairs.slice(0, 10), seq: Object.entries(seq).sort((a, b) => b[1] - a[1]).slice(0, 8), ex: [...R].sort((a, b) => b.g - a.g).slice(0, 12) };
}

// ───── ③ 적발 사례 정답지 ─────
//  언론·검찰·증선위가 종목명을 밝힌 사건만 (2026-10 조사). from~to = 띄우기(또는 조작) 기간. 레이더가 그때 이 종목을 '언제·어느 단계로' 봤는지 채점.
export const CASES = [
  { n: '영풍제지', c: '006740', m: 'P', from: '2022-10', to: '2023-10', type: '무자본 M&A(대양금속 인수) 뒤 계좌 110여 개 통정·고가매수', st: '판결' },
  { n: '삼천리', c: '004690', m: 'P', from: '2019-05', to: '2023-04', type: '라덕연 일당 CFD·통정매매 장기 시세조종', st: '판결' },
  { n: '서울가스', c: '017390', m: 'P', from: '2019-05', to: '2023-04', type: '라덕연 일당 CFD·통정매매', st: '판결' },
  { n: '대성홀딩스', c: '016710', m: 'P', from: '2019-05', to: '2023-04', type: '라덕연 일당 CFD·통정매매', st: '판결' },
  { n: '선광', c: '003100', m: 'P', from: '2019-05', to: '2023-04', type: '라덕연 일당 CFD·통정매매', st: '판결' },
  { n: '세방', c: '004360', m: 'P', from: '2019-05', to: '2023-04', type: '라덕연 일당 CFD·통정매매', st: '판결' },
  { n: '다우데이타', c: '032190', m: 'Q', from: '2019-05', to: '2023-04', type: '라덕연 일당 CFD·통정매매', st: '판결' },
  { n: '하림지주', c: '003380', m: 'Q', from: '2019-05', to: '2023-04', type: '라덕연 일당 CFD·통정매매', st: '판결' },
  { n: '다올투자증권', c: '030210', m: 'P', from: '2019-05', to: '2023-04', type: '라덕연 일당 CFD·통정매매', st: '판결' },
  { n: '동일산업', c: '004890', m: 'P', from: '2020-01', to: '2023-06', type: '주식카페 운영자 통정매매(6월 하한가 사태)', st: '기소' },
  { n: '동일금속', c: '109860', m: 'Q', from: '2020-01', to: '2023-06', type: '주식카페 운영자 통정매매(6월 하한가 사태)', st: '기소' },
  { n: '만호제강', c: '001080', m: 'P', from: '2020-01', to: '2023-06', type: '주식카페 운영자 통정매매(6월 하한가 사태)', st: '기소' },
  { n: '대한방직', c: '001070', m: 'P', from: '2020-01', to: '2023-06', type: '주식카페 운영자 통정매매(6월 하한가 사태)', st: '기소' },
  { n: '삼부토건', c: '001470', m: 'P', from: '2023-05', to: '2023-07', type: '우크라 재건 테마 MOU 과장 홍보 뒤 고가 매도', st: '기소' },
  { n: '웰바이오텍', c: '010600', m: 'P', from: '2022-09', to: '2023-07', type: '우크라 재건·리튬 허위 보도자료 + CB 헐값 매각', st: '기소' },
  { n: 'SM엔터테인먼트', c: '041510', m: 'Q', from: '2023-02', to: '2023-02', type: '경영권 분쟁 중 장내 대량매수(1심 무죄)', st: '판결' },
  { n: '에디슨EV', c: '136510', m: 'Q', from: '2021-05', to: '2022-03', type: '쌍용차 인수 테마 허위사실·투자조합', st: '판결' },
  { n: 'DI동일', c: '001530', m: 'P', from: '2024-01', to: '2025-09', type: '가장·통정·고가매수 + 자사주신탁 악용', st: '고발' },
  { n: '중앙첨단소재', c: '051980', m: 'Q', from: '2022-11', to: '2023-11', type: '허위 신사업 + 시세조종 주문', st: '판결' },
  { n: '알에프세미', c: '096610', m: 'Q', from: '2023-04', to: '2023-07', type: '사채 이용 무자본 M&A + 2차전지 허위 공시·CB 홍보', st: '기소' },
  { n: '자이글', c: '234920', m: 'Q', from: '2022-12', to: '2023-04', type: '2차전지 신사업·현물출자 허위 보도자료', st: '고발' },
  { n: '아이엠', c: '101390', m: 'Q', from: '2023-06', to: '2023-06', type: '해외 광물 MOU 허위 테마', st: '고발' },
];
export const CASE_CODES = CASES.map((x) => x.c);
const RADAR_TYPE = (t) => /M&A|CB|3자|현물출자|투자조합|허위 공시/.test(t); // 레이더가 원래 잡으려던 유형(공시 흔적이 남는 작전)

/** 레이더 채점: 띄우기 기간 앞 6개월~끝 사이에 처음 잡은 날·단계·판정, 그때 샀다면 고점까지 · 놓쳤으면 이유 */
export function gradeCase(C, rec) {
  if (!rec?.pts?.length) return { ...C, none: true, why: '아직 계산 전 (과거 재현이 이 종목을 지나가면 채워져요)' };
  const s0 = C.from + '-01', e0 = C.to + '-31';
  const dataFrom = rec.pts[0]?.d || '0000'; // 일봉·판정이 시작되는 날 (사건이 그보다 오래 이어졌으면 거기서부터 채점)
  const w0 = [ymd(Date.parse(s0) - 180 * DAY), dataFrom].sort()[1], w1 = ymd(Date.parse(e0) + 31 * DAY);
  const P = rec.pts.filter((p) => p.d >= w0 && p.d <= w1);
  if (!P.length) return { ...C, none: true, radar: RADAR_TYPE(C.type), why: rec.pts[0] && rec.pts[0].d > w1 ? '일봉 자료가 이 기간까지 거슬러 가지 않음' : `이 기간 일봉·판정 자료 없음 (자료 ${rec.pts[0]?.d || '?'}~)` };
  const pk = P.filter((p) => p.d >= [s0, dataFrom].sort()[1]).reduce((a, p) => (!a || p.c > a.c ? p : a), null) || P[P.length - 1];
  const lo = P.filter((p) => p.d <= pk.d).reduce((a, p) => (!a || p.c < a.c ? p : a), null);
  const first = P.find((p) => p.s >= 4 && p.d <= pk.d);
  const radar = RADAR_TYPE(C.type), evOk = (rec.evFrom || '9999') <= ymd(Date.parse(w0) + 90 * DAY);
  if (!first) return { ...C, caught: false, radar: RADAR_TYPE(C.type), pk, lo, maxS: Math.max(...P.map((p) => p.s || 0)), why: !radar ? '공시 흔적이 거의 없는 유형(통정매매·장기 시세조종) — 레이더는 공시 흔적(CB·3자배정·M&A)으로 찾기 때문에 구조적으로 못 잡음' : !evOk ? `그 기간 공시 자료가 아직 없음 (보관 ${rec.evFrom || '없음'}~) — 공시 채우기 뒤 다시 채점` : '판 깔기 공시는 있었지만 점수가 기준(4점) 아래' };
  const lead = Math.round((Date.parse(pk.d) - Date.parse(first.d)) / DAY);
  return { ...C, caught: true, radar: RADAR_TYPE(C.type), first, pk, lo, lead, gain: Math.round((pk.c / first.c - 1) * 100), early: first.d < s0, motives: first.mv || [] };
}
export async function caseReport() {
  const out = [];
  for (const C of CASES) { const rec = await getJSON(`mp/case/${C.c}`).catch(() => null); out.push(gradeCase(C, rec)); }
  const done = out.filter((x) => x.caught != null), caught = done.filter((x) => x.caught);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const rt = done.filter((x) => x.radar), rtC = rt.filter((x) => x.caught);
  const vdAt = {}; for (const x of caught) { const v = x.first?.vd || '-'; vdAt[v] = (vdAt[v] || 0) + 1; }
  const stAt = {}; for (const x of caught) { const v = x.first?.st || '-'; stAt[v] = (stAt[v] || 0) + 1; }
  return { list: out, n: CASES.length, done: done.length, caught: caught.length, radarType: rt.length, radarCaught: rtC.length, lead: med(caught.map((x) => x.lead)), gain: med(caught.map((x) => x.gain)), vdAt, stAt };
}
export async function bigReport() {
  const { partsLoad } = await import('./btstore.mjs');
  const [R, Bs] = await Promise.all([partsLoad('mp/bt/big'), partsLoad('mp/bt/bigb')]);
  const runs = R?.list || [], base = Bs?.list || [];
  return { ...bigStudy(runs, base), v: R?.v || null };
}
export async function labSummary() {
  const [cases, big] = await Promise.all([caseReport(), bigReport()]);
  return { cases, big, mv: Object.fromEntries(Object.entries(MV).map(([k, v]) => [k, { ko: v.ko, side: v.side, t: v.t }])) };
}
export async function saveCase(code, rec) { await setJSON(`mp/case/${code}`, { ...rec, at: Date.now() }).catch(() => {}); }
