#!/usr/bin/env bash
# 閘門驗法的突變驗證：把閘門改壞一處，驗法裡「專門驗這一處」的那一種情境必須報不符。
# 改壞的是暫存 clone 裡的閘門，不碰本 repo。用法：bash scripts/pushgate-mutants.sh（約 1 分鐘）
set -u
SRC="$(git rev-parse --show-toplevel)" || exit 1
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
BAD=0
# <名稱> <要改壞的原文> <改成> <驗法裡必須報不符的那一種>
mutate() {
  rm -rf "$T/m"; git clone -q "$SRC" "$T/m" || exit 1
  ( cd "$T/m" && git config user.name probe && git config user.email probe@users.noreply.github.com
    node -e "const fs=require('fs');const f='scripts/pushgate.sh';const s=fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n');const [a,b]=[process.argv[1],process.argv[2]];if(!s.includes(a))process.exit(9);fs.writeFileSync(f,s.replace(a,b))" "$2" "$3" || { echo "情境未成立：找不到要改壞的原文"; exit 9; }
    git add scripts/pushgate.sh && git commit -q -m "mutant" && bash scripts/pushgate-verify.sh > "$T/out" 2>&1 )
  local rc=$?
  if [ "$rc" = 9 ]; then echo "FAIL $1：情境未成立（找不到要改壞的原文）"; BAD=1; return; fi
  if grep -q "^$4.*不符合" "$T/out"; then echo "PASS $1 → 驗法第「$4」種報不符"; else echo "FAIL $1 → 驗法第「$4」種沒報不符"; BAD=1; fi
}
# 只把範圍改成追蹤分支、但留著 fetch，不算改壞：fetch 會先把追蹤分支拉回遠端的實際狀態（2026-10-07 第一版突變就是這樣，驗法沒報不符是對的）。
# 要拿掉的是「取遠端實際狀態」那一整步：不 fetch、直接用本機的追蹤分支。
mutate "不取遠端實際狀態（不 fetch、用本機追蹤分支）" 'if ! git fetch -q "$REMOTE" main > "$LOG" 2>&1; then cat "$LOG"; echo "【擋下：自查】取不到遠端的 main，不推送"; exit 1; fi
  RANGE="$RMAIN..$PIN"' 'RANGE="refs/remotes/origin/main..$PIN"' "8 "
mutate "自查沒過照樣往下推" 'if [ "$rc" -ne 0 ]; then echo "【擋下：自查】回傳 $rc，不推送"; exit 1; fi' 'true' "3 "
mutate "推完不核對遠端" 'if [ "$REMOTE_SHA" != "$PIN" ]; then' 'if false; then' "7 "
echo
[ "$BAD" -eq 0 ] && echo "3 條突變全部被驗法抓到" || echo "有突變沒被抓到"
exit "$BAD"
