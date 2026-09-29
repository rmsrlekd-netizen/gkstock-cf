// DART 보고서명 → [카테고리, 중요도]
// 카테고리: earnings 실적 / current 수시·계약 / offering 증자·희석 / insider 내부자 / inst 기관·5%지분 / periodic 정기 / other
export function classifyDart(nm) {
  const n = String(nm || '').replace(/\s/g, '');
  if (/영업\(잠정\)실적|잠정실적|매출액또는손익구조/.test(n)) return ['earnings', /정정/.test(n) ? 3 : 5];
  if (/정정/.test(n)) return ['other', 1];
  if (/거래정지|상장폐지|관리종목|불성실공시|감사의견|횡령|배임|회생|부도|영업정지/.test(n)) return ['current', 5];
  // 경영권 이동(최대주주 변경을 수반하는 주식 양수도, 공개매수)은 주가 영향이 매우 커서 5점
  if (/최대주주변경을수반|경영권|공개매수/.test(n)) return ['current', 5];
  // 바이오: 임상·품목허가·FDA·기술수출 소식은 '투자판단 관련 주요경영사항' 등으로 나옴 → 4점
  if (/임상|품목허가|허가승인|FDA|EMA|신약|기술수출|기술이전|라이선스아웃|판매승인|시판허가|IND승인|NDA|BLA/i.test(n)) return ['current', 4];
  // 증자 결정 뒤에 따라 나오는 서류(증권신고서·투자설명서·발행실적·일괄신고 추가서류)는 같은 건의 후속이라 2점 (채널·중요 필터에서 제외)
  if (/증권신고서|투자설명서|증권발행실적|발행실적보고서|일괄신고추가서류|일괄신고서|소액공모/.test(n)) return ['offering', 2];
  if (/유상증자|전환사채|신주인수권부사채|교환사채|감자/.test(n)) return ['offering', 4];
  if (/임원ㆍ주요주주|임원·주요주주|특정증권등소유상황/.test(n)) return ['insider', 3];
  if (/대량보유|주식등의대량보유/.test(n)) return ['inst', 3];
  if (/단일판매|공급계약|기술이전|기술도입|라이선스/.test(n)) return ['current', 4];
  if (/무상증자|자기주식|자사주|주식소각|현금ㆍ현물배당|현금·현물배당|배당/.test(n)) return ['current', 4];
  if (/합병|분할|영업양수|영업양도|타법인주식|최대주주변경|주식교환|주식이전|자산양수도|양수도계약|인수/.test(n)) return ['current', 4];
  if (/투자판단관련주요경영사항|기타주요경영사항|수주/.test(n)) return ['current', 3];
  if (/사업보고서|반기보고서|분기보고서/.test(n)) return ['periodic', 3];
  if (/기업설명회|IR/.test(n)) return ['current', 2];
  if (/주요사항보고서/.test(n)) return ['current', 4];
  return ['other', 2];
}
