#!/bin/sh
# 사람이 읽는 원본(web/) → 사이트에 올라가는 압축본(public/)
# 사용: sh web/build.sh   (esbuild 필요: npm i -g esbuild)
set -e
cd "$(dirname "$0")/.."
esbuild web/app.js --minify --target=es2020 --legal-comments=none --outfile=public/app.js --log-level=warning
esbuild web/styles.css --minify --loader:.css=css --legal-comments=none --outfile=public/styles.css --log-level=warning
# HTML은 설명 주석만 지움 (구조·검색엔진용 내용은 그대로)
node -e "const fs=require('fs');let h=fs.readFileSync('web/index.html','utf8');h=h.replace(/<!--[\s\S]*?-->/g,'').replace(/\n\s*\n+/g,'\n');fs.writeFileSync('public/index.html',h)"
