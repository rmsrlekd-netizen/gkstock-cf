// 국내 상장사 이름 ↔ 종목코드 목록 (DART 고유번호 파일, 7일마다 갱신)
// 뉴스·보도자료 제목에서 회사명을 찾아 종목을 연결하는 데 사용
import { fetchWithTimeout } from './util.mjs';
import { getJSON, setJSON } from './store.mjs';

async function unzipFirst(buf) {
  const b = new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip EOCD 없음');
  const cdOff = dv.getUint32(eocd + 16, true);
  if (dv.getUint32(cdOff, true) !== 0x02014b50) throw new Error('zip 중앙 디렉터리 오류');
  const method = dv.getUint16(cdOff + 10, true);
  const compSize = dv.getUint32(cdOff + 20, true);
  const localOff = dv.getUint32(cdOff + 42, true);
  const nameLen = dv.getUint16(localOff + 26, true), extraLen = dv.getUint16(localOff + 28, true);
  const start = localOff + 30 + nameLen + extraLen;
  const data = b.subarray(start, start + compSize);
  if (method === 0) return new TextDecoder('utf-8').decode(data);
  const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(s).text();
}

let mem = null;

/** [{n: 이름, c: 종목코드, k: 고유번호}] (이름이 긴 순) */
export async function getKrNames({ allowFetch = true } = {}) {
  if (mem && Date.now() - mem.at < 6 * 3600e3) return mem.list;
  const saved = await getJSON('kr/names');
  if (saved && Date.now() - saved.at < 7 * 86400e3) { mem = saved; return saved.list; }
  const key = process.env.DART_API_KEY;
  if (!allowFetch || !key) return saved?.list || [];
  try {
    const r = await fetchWithTimeout(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(key)}`, {}, 15000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const xml = await unzipFirst(await r.arrayBuffer());
    const list = [];
    for (const m of xml.matchAll(/<list>[\s\S]*?<corp_code>(\d{8})<\/corp_code>[\s\S]*?<corp_name>([^<]+)<\/corp_name>[\s\S]*?<stock_code>\s*([0-9A-Z]{6})\s*<\/stock_code>[\s\S]*?<\/list>/g)) {
      list.push({ n: m[2].trim(), c: m[3], k: m[1] });
    }
    if (list.length < 1000) throw new Error('상장사 목록이 너무 적음 ' + list.length);
    list.sort((a, b) => b.n.length - a.n.length);
    mem = { at: Date.now(), list };
    await setJSON('kr/names', mem).catch(() => {});
    return list;
  } catch (e) {
    console.warn('krnames', e.message);
    return saved?.list || [];
  }
}

// 흔한 단어와 겹쳐 오탐이 많은 짧은 이름은 제외
const STOP = new Set(['대상', '한솔', '동양', '대원', '삼일', '신성', '서울', '한국', '대한', '우리', '미래', '에스엠', '성우', '태양', '대성', '진도', '국보', '광명', '세원', '화신', '신원', '보성', '동방', '대교', '한일', '일신', '영풍', '유니온', '코리아', '제이스', '레이', '포스', '케이티', '엔케이', '태광', '대림', '한창', '삼보', '동원']);

/** 제목에서 국내 상장사 찾기 */
export function matchKr(title, list) {
  const t = String(title || '');
  for (const x of list) {
    if (x.n.length < 2 || STOP.has(x.n)) continue;
    if (x.n.length === 2 && !/[A-Z]/.test(x.n)) {
      // 두 글자 한글 이름은 앞뒤가 한글이 아닌 경우만 (예: "[특징주] 셀리드," )
      const i = t.indexOf(x.n);
      if (i < 0) continue;
      const prev = t[i - 1] || ' ', next = t[i + 2] || ' ';
      if (/[가-힣]/.test(prev)) continue;
      if (/[가-힣]/.test(next) && !/[은는이가을를의도와과]/.test(next)) continue;
      return x;
    }
    if (t.includes(x.n)) return x;
  }
  return null;
}

// 한국어 기사에 자주 나오는 미국 종목 이름
export const US_KO = [
  ['엔비디아', 'NVDA'], ['테슬라', 'TSLA'], ['애플', 'AAPL'], ['마이크로소프트', 'MSFT'], ['아마존', 'AMZN'], ['알파벳', 'GOOGL'], ['구글', 'GOOGL'],
  ['메타', 'META'], ['브로드컴', 'AVGO'], ['팔란티어', 'PLTR'], ['넷플릭스', 'NFLX'], ['마이크론', 'MU'], ['인텔', 'INTC'], ['퀄컴', 'QCOM'],
  ['TSMC', 'TSM'], ['코인베이스', 'COIN'], ['쿠팡', 'CPNG'], ['오라클', 'ORCL'], ['세일즈포스', 'CRM'], ['어도비', 'ADBE'], ['버크셔', 'BRK.B'],
  ['제이피모간', 'JPM'], ['JP모건', 'JPM'], ['골드만삭스', 'GS'], ['일라이릴리', 'LLY'], ['노보노디스크', 'NVO'], ['화이자', 'PFE'], ['모더나', 'MRNA'],
  ['보잉', 'BA'], ['디즈니', 'DIS'], ['나이키', 'NKE'], ['스타벅스', 'SBUX'], ['월마트', 'WMT'], ['코스트코', 'COST'], ['ASML', 'ASML'], ['ARM', 'ARM'],
  ['아이온큐', 'IONQ'], ['리게티', 'RGTI'], ['로켓랩', 'RKLB'], ['슈퍼마이크로', 'SMCI'], ['마이크로스트래티지', 'MSTR'], ['스트래티지', 'MSTR'], ['로빈후드', 'HOOD'],
  ['유나이티드헬스', 'UNH'], ['엑슨모빌', 'XOM'], ['셰브론', 'CVX'], ['비자', 'V'], ['마스터카드', 'MA'], ['페이팔', 'PYPL'], ['우버', 'UBER'], ['에어비앤비', 'ABNB'],
  ['스노우플레이크', 'SNOW'], ['크라우드스트라이크', 'CRWD'], ['팔로알토', 'PANW'], ['델', 'DELL'], ['HP', 'HPQ'], ['IBM', 'IBM'], ['시스코', 'CSCO'], ['리비안', 'RIVN'], ['루시드', 'LCID'],
];
export function matchUsKo(title) {
  const t = String(title || '');
  for (const [n, tk] of US_KO) {
    const i = t.indexOf(n);
    if (i < 0) continue;
    const prev = t[i - 1] || ' ', next = t[i + n.length] || ' ';
    if (/[가-힣A-Za-z]/.test(prev)) continue;
    if (/[가-힣]/.test(next) && !/[은는이가을를의도와과,·]/.test(next)) continue;
    if (/[A-Za-z]/.test(next)) continue;
    return { n, tk };
  }
  return null;
}
