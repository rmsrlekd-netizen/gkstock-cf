// AI 문장 숫자 검사 (v216): AI가 쓴 숫자가 원문(·배경 자료)에 실제로 있는지 대조해서, 근거 없는 숫자가 든 문장은 뺌
//  · 단위를 바꿔 쓴 숫자도 인정 (289,305,451달러 ↔ 2.89억 달러 ↔ $289.3M) — 앞자리 3자리가 같으면 같은 숫자로 봄
//  · 31 이하 정수(개수·날짜·분기)와 연도(1990~2100)는 검사하지 않음 (틀려도 피해가 작고 원문 표기가 제각각)
const UNIT = [[/^조/, 1e12], [/^억/, 1e8], [/^천만/, 1e7], [/^백만/, 1e6], [/^만/, 1e4], [/^천/, 1e3], [/^\s?[Bb](illion)?\b/, 1e9], [/^\s?[Mm](illion)?\b/, 1e6], [/^\s?[Kk]\b/, 1e3]];
const numsIn = (t) => {
  const out = [];
  const re = /\d[\d,]*(?:\.\d+)?/g; let m;
  while ((m = re.exec(t))) {
    const raw = m[0].replace(/,/g, ''); let v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 8);
    for (const [u, k] of UNIT) if (u.test(after)) { v *= k; break; }
    out.push({ v, raw, s: m[0] });
  }
  return out;
};
const sig3 = (v) => { if (!v) return '0'; const e = Math.floor(Math.log10(Math.abs(v))); return String(Math.round(Math.abs(v) / 10 ** (e - 2))); }; // 앞 3자리
const sig2 = (v) => { if (!v) return '0'; const e = Math.floor(Math.log10(Math.abs(v))); return String(Math.round(Math.abs(v) / 10 ** (e - 1))); };
export function makeChecker(source) {
  const src = String(source || '');
  const raws = new Set(), vals = [];
  const s3 = new Set(), s2 = new Set();
  for (const n of numsIn(src)) { raws.add(n.raw); raws.add(String(Number(n.raw))); vals.push(n.v, Number(n.raw)); s3.add(sig3(n.v)); s2.add(sig2(n.v)); s3.add(sig3(Number(n.raw))); s2.add(sig2(Number(n.raw))); }
  const okNum = (n) => {
    const iv = Number(n.raw);
    if (Number.isInteger(iv) && iv <= 31 && n.v === iv) return true; // 단위(억·조·M 등)가 붙은 숫자는 작아도 검사
    if (Number.isInteger(iv) && iv >= 1990 && iv <= 2100) return true;
    if (raws.has(n.raw) || raws.has(String(iv))) return true;
    // 반올림해 쓴 숫자(2.89억·8.27백만)는 앞 2~3자리로 비교
    const digits = n.raw.replace('.', '').replace(/^0+/, '').length;
    if (digits <= 1) return vals.some((sv) => sv && Math.abs(n.v / sv - 1) < 0.06); // 한 자리 숫자(5억 등)는 값 자체가 맞아야
    return digits <= 2 ? s2.has(sig2(n.v)) || s2.has(sig2(iv)) : s3.has(sig3(n.v)) || s3.has(sig3(iv)) || s2.has(sig2(n.v));
  };
  const bad = (t) => numsIn(String(t || '')).filter((n) => !okNum(n)).map((n) => n.s);
  return { bad };
}
/** 분석 결과(a)에서 근거 없는 숫자가 든 문장 제거 → { a, dropped: [문장…] } */
export function scrubAnalysis(a, source) {
  const { bad } = makeChecker(source);
  const dropped = [];
  const keep = (t) => { const b = bad(t); if (b.length) { dropped.push(`${String(t).slice(0, 80)} (확인 안 된 숫자: ${b.slice(0, 3).join(', ')})`); return false; } return true; };
  const arr = (x) => (Array.isArray(x) ? x.filter(keep) : x);
  const out = { ...a };
  if (out.headline && !keep(out.headline)) out.headline = null;
  out.summary = arr(out.summary);
  out.positive = arr(out.positive);
  out.negative = arr(out.negative);
  out.watch = arr(out.watch);
  if (Array.isArray(out.points)) out.points = out.points.filter((p) => keep(`${p.t} ${p.d}`));
  if (out.analyst) out.analyst = String(out.analyst).split(/(?<=[.!?。다요])\s+/).filter(keep).join(' ');
  if (out.impact) { if (out.impact.short && !keep(out.impact.short)) out.impact = { ...out.impact, short: '' }; if (out.impact.mid && !keep(out.impact.mid)) out.impact = { ...out.impact, mid: '' }; }
  return { a: out, dropped };
}
