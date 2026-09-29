# 화면 코드 원본 폴더 (web/)

- `web/` = 사람이 읽는 **원본** (주석 포함). 화면을 고칠 때는 **여기를 고칩니다.**
- `public/app.js`, `public/styles.css`, `public/index.html` = 사이트에 올라가는 **압축본**. 직접 고치지 마세요 (다음 압축 때 덮어써짐).
- 압축 방법: `sh web/build.sh` (esbuild 필요: `npm i -g esbuild`) → `public/`에 압축본 생성
- 화면 버전: `web/index.html`의 `app.js?v=숫자`, `styles.css?v=숫자`를 올린 뒤 압축
- 서버 코드(`src/`)는 방문자에게 보이지 않으므로 압축하지 않습니다.
