# GK의 공시레이더 (gk-stock.com) — 작업 규칙

이 폴더에서 일할 때 항상 먼저 읽고 따를 것. 새 규칙이 생기면 여기에 한 줄 추가.

## 사람
- 운영자 GK: 유튜브 'GK의 미국 주식' 운영, **코딩을 전혀 모름**. 답은 **한국어로, 짧고 쉬운 말로**.
- 결과는 "무엇이 바뀌었는지 + 무엇을 올리면 되는지"만 알려 줄 것. 기술 용어·내부 파일 경로 설명은 최소화.

## 구조
- Cloudflare Workers(`src/worker.mjs`, 크론 매분·3분) + D1 저장소 + 정적 화면(`public/`).
- 화면 원본은 `web/` (app.js · styles.css · index.html) → `sh web/build.sh` 로 `public/`에 빌드.
- 서울 중계 서버: `relay/` (Vercel Pro, icn1) — DART·네이버·KRX·Gemini 등을 대신 호출, 바깥 감시(watchdog) 크론.
- AI: Gemini (`src/lib/ai.mjs`). 텔레그램 채널 자동 게시(`src/lib/tgchannel.mjs`, 모든 글은 카드 이미지 + 캡션).

## 전달 방식 (매번)
1. `web/` 를 바꿨으면 `web/index.html` 의 `?v=N` 을 **반드시 +1** 하고 `sh web/build.sh`.
2. 테스트: `PORT=8799 node test/server.mjs` + Playwright(`/home/claude/.npm-global/lib/node_modules/playwright/index.mjs`)로 **PC(1300px)·모바일(390px)** 화면 확인, `npm test`, `npx wrangler deploy --dry-run`.
3. 바뀐 파일만 **폴더 구조 그대로 ZIP** (`src/`, `public/`, `web/`, `relay/`), **100개 이하**. 아직 안 올렸을 수 있는 이전 변경도 함께 넣어 누적본으로.
4. GK는 GitHub 웹에서 압축을 풀어 올림 → "이 파일 하나만 올리면 됨 · 네 폴더 · 파일 N개"로 안내. 올리면 열린 화면도 2분 안에 자동 새로고침(`/api/ver`).

## 절대 규칙
- **API 키·비밀번호를 요구하거나 받지 않는다.** 키는 GK가 Cloudflare/Vercel 변수에 직접 넣는다 ("저한테 보내지 마세요"). 결제도 GK가 직접.
- **취소한 기능은 다시 넣지 않는다:** PC 탭 검색(v110 제거) · AI '틀렸어요' 오류 신고 버튼과 `/api/report` · 더보기의 '배당락 일정'·'유·무상증자 일정' 개별 메뉴(분할 캘린더 탭으로 통합).
- 화면 갱신 주기를 바꾸면 **화면에 보이는 안내 문구도 같이** 고친다 (예: '15초마다 업데이트').
- 실제 데이터(네이버·DART 등)는 테스트 환경에서 안 열린다 → "가짜 데이터로만 확인했다"고 솔직히 말할 것.

## 화면 원칙
- 미국 종목은 **한국어 이름**을 같이 보여준다 (네이버 nameKo / `usKoNames`).
- 종목 이름·칩에는 **기업 로고**(`logoHTML`)를 붙인다.
- 국장·미장 **휴장일은 따로** 판단 (`src/lib/schedule.mjs` 달력 + 시세로 임시휴장 감지). 주말엔 '마지막 거래일 기준' 표시.
- 지원하지 않는 시장의 버튼은 **아예 숨긴다** (예: 유·무상증자 탭은 국장만).
- 메뉴는 `/popular`, `/themes`, `/splits`, `/about` 같은 진짜 주소를 쓴다 (검색 노출). 종목은 `/s/KR/005930`.

## AI 정확도
- 주가가 떨어졌다고 실적이 나빴다고 쓰지 않는다. 실적 평가는 `src/lib/earnv.mjs` 컨센서스 판정(상회·부합·하회)을 따른다.
- 공모·증자는 무조건 악재가 아니다 (할증 발행·전략적 투자자는 중립~긍정).

## 기능 메모 (v138)
- 가격·키워드 푸시: `src/lib/push.mjs` (push_al·push_kw 표, `alertWatch` 매분). 기기 설정은 localStorage `gk_alerts`·`gk_kw`.
- 컨센서스 TOP: `earn/hist`(3주) → `/api/earnv?week=0|1`, 화면 `/consensus`.
- 투자 대가(13F): `src/lib/guru.mjs` (17명, 3분마다 한 명, OpenFIGI로 CUSIP→티커), 화면 `/gurus`, `/gurus/buffett`.
- 대차잔고: `src/lib/loan.mjs` (KIS HHPST074500C0, 하루 2번), 수급 탭 '국내 대차잔고'.
- 당일 분석(관리자, 예전 영상 소재 노트 · 분석 정리 형식 v2): `src/lib/vnote.mjs` · 주간 정리 카드(토 8:30): `src/lib/weekcard.mjs`, `/og/week/YYYYMMDD.png`.
- 더보기 메뉴는 항상 '서비스 소개'가 맨 끝.
- 작전 의심 레이더(관리자): `src/lib/manip.mjs` — 장 마감 뒤 단계별(시세→공시→일봉→원문 가격→AI), 결과 `mp/day/날짜` **영구 보관(삭제 금지)**, 전 종목(ETF·ETN·거래정지만 제외). 외부 공개 금지. 종목 카드 `mp/prof/코드`(자동 수정 기록 포함)·랭킹 `mp/rank`, 장중 새 공시는 `manipIncr`가 자동 재판단. 관리자 화면 탭: 방문 통계 · 당일 분석 · 작전 레이더. **AI 거짓말 방지**: `factsOf`(사실 번호 목록)만 주고 문장마다 [F번호] 인용 강제 → `verifyLine`이 근거 없는 문장·목록에 없는 숫자 자동 삭제, 평단은 인용된 사실의 가격으로만 계산. 상승/하락 분류(`direction`)·참고 목표가(평단×1.5/2/3)·물량 해제일은 규칙 계산(AI 아님). 보강(`src/lib/manipx.mjs`): 성적표 `mp/perf/날짜`(5·20·60거래일 실제 수익률, 탭 '📊 성적표'), 같은 세력 연결 `mp/party`, 거래소 시장경보 `mp/warn`(KIND, 실패 시 오류만 표시), 관리자 텔레그램 알림(단계·분류 변화·전환청구, 하루 40줄). CB 원문 전환청구기간·리픽싱 하한·콜옵션, 담보 1주당 대출액 파싱. 대형주 ×0.6, 소형주 +1, 일상 수주 업종 공급계약 제외. 불성실공시 벌점 `penaltyOf`(원문 부과·누계벌점, 최근 1년 누계, 1회 코스피 10점·코스닥 8점↑ 하루 정지, 누계 15점 기준).
- 텔레그램: 같은 글 6시간 중복 금지(`claim`), 회사당 6시간 1건, 10분 4건, 다시 켜면 이전 공시는 안 올림(`tgch/resume`).

## 앞으로 할 일 (메모)
- 플레이스토어 앱: PWABuilder(TWA), 패키지 `com.gkstock.radar`, Cloudflare 변수 `ANDROID_CERT_SHA256`. 개발자 계정은 GK가 나중에 개인/조직 결정.
