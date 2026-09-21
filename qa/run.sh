#!/bin/sh
# 화면을 실제로 돌려서 확인한다.
#   sh qa/run.sh play  [base|ck] [판수] — 한 판을 끝까지 돌리며 오류를 모은다
#   sh qa/run.sh pace  [base|ck] — 안내가 몇 초씩 떠 있었는지 재서 너무 빠른 곳을 찾는다
# 미리 서버를 띄워 두어야 한다:  PORT=8896 node server.js   (혼자 하기만 쓰므로 판은 브라우저에서 돈다)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=${PORT:-8896}   # 8899 는 다른 도구와 자주 겹친다
MODE=$2
case "$1" in
  play)
    N=${3:-1}; i=0
    while [ $i -lt $N ]; do
      # 확장(ck)은 한 판이 200턴을 넘기도 해서 예산을 넉넉히 준다
      "$CHROME" --headless --disable-gpu --hide-scrollbars --window-size=390,844 \
        --virtual-time-budget=4200000 --dump-dom "http://localhost:$PORT/?scene=qa&mode=${MODE:-base}" 2>/dev/null \
      | python3 -c "
import sys,re,json
m=re.search(r'<pre id=\"qaout\"[^>]*>(.*?)</pre>', sys.stdin.read(), re.S)
o=json.loads(m.group(1))
ok = o['done'] and not o['errs']
print(('OK  ' if ok else 'NG  ')+o['mode']+' turn='+str(o['turn'])+' vps='+str(o.get('vps')))
# 안 끝난 것과 시간 예산이 먼저 떨어진 것은 원인이 다르다 — 구분해서 알려 준다
if not ok and not o['errs'] and not o['done']:
    print('    ! 판이 끝나기 전에 가상시간 예산이 떨어졌습니다 (판이 길었을 뿐일 수 있음 — 다시 돌려 보세요)')
[print('    ! '+e) for e in o['errs'][:6]]
"
      i=$((i+1))
    done ;;
  pace)
    "$CHROME" --headless --disable-gpu --hide-scrollbars --window-size=390,844 \
      --virtual-time-budget=1800000 --dump-dom "http://localhost:$PORT/?scene=timing&mode=${MODE:-base}" 2>/dev/null \
    | python3 -c "
import sys,re,json
m=re.search(r'<pre id=\"qaout\"[^>]*>(.*?)</pre>', sys.stdin.read(), re.S)
json.dump(json.loads(m.group(1)), open('/tmp/catan-pace.json','w'), ensure_ascii=False)
"
    python3 qa/pace.py /tmp/catan-pace.json "${MODE:-base}" ;;
  *) echo "쓰는 법: sh qa/run.sh play|pace [base|ck] [판수]" ;;
esac
