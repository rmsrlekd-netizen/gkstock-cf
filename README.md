# GK 공시레이더 — Cloudflare 버전

미국 SEC · 한국 DART 실시간 공시와 한·미 기업 보도자료·뉴스를 한 화면에 모으고, 항목마다 AI 5줄 요약·긍정/부정 요인을 보여주는 사이트입니다.
화면과 기능은 Netlify 버전과 같고, 서버 부분만 Cloudflare Workers에서 돌아가도록 바꿨습니다.

## 구조

```
gkstock-cf/
├─ wrangler.toml          Cloudflare 설정 (워커 이름, 화면 폴더, 저장소, 수집 주기)
├─ package.json
├─ public/                화면 (index.html, app.js, styles.css, img/)
├─ src/
│   ├─ worker.mjs         진입점: /api/* 연결 + 2~3분마다 수집(한가한 시간 10분) + 캐시
│   ├─ functions/         API와 수집기 (sec-watch, dart-watch, news-watch)
│   └─ lib/               공통 코드 (store.mjs = D1 저장소)
└─ test/                  로컬 테스트 (배포와 무관)
```

## 요금제 (중요)

무료 요금제는 요청 1번당 CPU 10ms, 외부 요청 50개까지만 허용됩니다. 이 사이트의 수집기는 한 번에 외부 사이트를 수십 번 호출하므로 무료 요금제에서는 수집이 끊길 수 있습니다.
안정적으로 쓰려면 **Workers Paid(월 5달러)** 를 권장합니다. D1 저장소는 무료 한도로 충분합니다.

## 배포 (GitHub 연결)

1. GitHub 저장소에 이 폴더 안의 파일 전체 업로드 (node_modules 제외)
2. Cloudflare → Workers & Pages → Create → Import a repository → 저장소 선택
3. Project name: `gkstock-cf` (wrangler.toml 의 name 과 같아야 경고가 안 뜸), Build command 비움, Deploy command `npx wrangler deploy`
4. 배포 후 주소: `https://gkstock-cf.<계정이름>.workers.dev`. D1 데이터베이스는 첫 배포 때 자동 생성됩니다.
5. 이후 GitHub에 올릴 때마다 자동 재배포됩니다.

## 환경 변수 (Workers & Pages → gkstock-cf → Settings → Variables and Secrets, Type: Secret)

| 이름 | 용도 | 필수 |
|---|---|---|
| `DART_API_KEY` | DART OpenAPI 인증키 | 필수 |
| `GEMINI_API_KEY` | AI 분석 (Google AI Studio 무료 키, AIza…) | 권장 |
| `SEC_USER_AGENT` | `GKStock 본인이메일@example.com` | 권장 |
| `ANTHROPIC_API_KEY` | Gemini 대신 Claude 사용 시 | 선택 |
| `FINNHUB_API_KEY` | 미국 지표·뉴스 보강 | 선택 |
| `KIS_APP_KEY`, `KIS_APP_SECRET` | 한국투자증권 — 국내 수급, 코스닥, 야간선물 | 선택 |
| `KOSPI_FUT_CODE` | 코스피200 선물 코드 강제 지정 | 선택 |

## 점검

- `/api/health` → 환경 변수·수집기 상태, `/api/health?ai=1` → AI 키 시험
- 오류 로그: Workers & Pages → gkstock-cf → Logs
- `*.workers.dev` 주소에서는 Cloudflare 캐시가 동작하지 않습니다(기능엔 문제 없음). 방문자가 많아지면 본인 도메인 연결을 권장합니다.

## 로컬 테스트

```bash
npm install
npx wrangler dev          # 키는 .dev.vars 파일에 DART_API_KEY=... 형식
node test/server.mjs      # 가짜 데이터로 화면 확인 → http://localhost:8787
```

## (필요할 때만) DART 중계 서버

DART(금융감독원)가 Cloudflare 서버 접속을 막으면 `/api/health`의 `dartWatcher.errors`에 `Too many redirects … error1.html` 또는 `HTTP 520`이 나옵니다. 이때는 `relay/` 폴더를 Netlify에 작은 사이트로 올려 중계합니다.

1. Netlify → Add new site → Import from GitHub → 이 저장소 선택 → **Base directory: `relay`**
2. Netlify 환경 변수 `RELAY_TOKEN` = 아무 긴 비밀 문자열 (예: 무작위 32자)
3. Cloudflare → gkstock-cf → Settings → Variables and Secrets 에 추가
   - `KR_RELAY_URL` = `https://(netlify 주소)/relay`
   - `KR_RELAY_TOKEN` = 2번과 같은 문자열
