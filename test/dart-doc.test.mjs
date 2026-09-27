import fs from 'fs';
import { summarizeDart, textToLines, cleanTitle } from '../src/lib/dart-doc.mjs';
const cases = [
  ['supply', '단일판매ㆍ공급계약체결'], ['earn', '연결재무제표기준영업(잠정)실적(공정공시)'], ['piic', '주요사항보고서(유상증자결정)'],
  ['cb', '[기재정정]주요사항보고서(전환사채권발행결정)'], ['tsaq', '주요사항보고서(자기주식취득결정)'], ['tsdp', '주요사항보고서(자기주식처분결정)'],
  ['sokak', '주식소각결정'], ['div', '현금ㆍ현물배당결정'], ['tabub', '타법인주식및출자증권취득결정(종속회사의주요경영사항)'],
  ['tuja', '투자판단관련주요경영사항'], ['corr', '[기재정정]단일판매ㆍ공급계약체결'], ['mx', '최대주주변경'], ['johoe', '조회공시요구(풍문또는보도)에대한답변(미확정)'],
];
let fail = 0;
for (const [f, nm] of cases) {
  const r = summarizeDart(nm, textToLines(fs.readFileSync(new URL(`./dart/${f}.txt`, import.meta.url), 'utf8')));
  console.log(f.padEnd(6), '|', r?.title, '\n       |', r?.sub);
  if (!r) fail++;
}
for (const t of ['주요사항보고서(유상증자결정)', '[기재정정]단일판매ㆍ공급계약체결', '연결재무제표기준영업(잠정)실적(공정공시)', '타법인주식및출자증권취득결정(종속회사의주요경영사항)', '임원ㆍ주요주주특정증권등소유상황보고서']) console.log('clean:', cleanTitle(t));
if (fail) { console.error('FAIL', fail); process.exit(1); } else console.log('PASS');
