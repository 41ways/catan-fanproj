#!/bin/sh
# 자산 URL의 ?v= 를 파일 내용 해시로 갱신한다.
# 배포 전에 반드시 실행할 것 — 안 그러면 브라우저가 새 파일과 옛 파일을 섞어 받는다.
# public/rules.js · ai.js · ck.js · ck-ai.js 는 루트 원본을 가리키는 링크라, 해시도 원본 내용으로 잡힌다.
cd "$(dirname "$0")/public" || exit 1
python3 - <<'PY'
import re, hashlib
p = 'index.html'; s = open(p).read()
for f in ['style.css', 'rules.js', 'ai.js', 'ck.js', 'ck-ai.js', 'app.js']:
    v = hashlib.sha256(open(f, 'rb').read()).hexdigest()[:8]
    s = re.sub(r'(["\'])' + re.escape(f) + r'(\?v=[0-9a-f]+)?\1',
               lambda m, f=f, v=v: m.group(1) + f + '?v=' + v + m.group(1), s)
open(p, 'w').write(s)
print('버전 갱신 완료')
PY
