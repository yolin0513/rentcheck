#!/usr/bin/env bash
# 推送閘門（共用慣例 §2.5）：推送一律用這支，不要直接下 git push。照 MealMate／JLPT 的閘門移植。
#   bash scripts/pushgate.sh
# 回傳值（每一關失敗都讓後面停下）：
#   0 推上去了，而且遠端 main＝開跑時鎖定的 commit＝本機 main
#   1 自查沒過（有命中、對照組沒命中、範圍裡沒有 commit…）、讀不到遠端、或 HEAD 不在 main 上——沒有推
#   2 推送失敗——不做後面的比對
#   3 推送回報成功，但遠端 main 不等於鎖定的 commit
#   4 閘門、自查或驗法改過之後還沒跑過驗法（登記對不上或沒有登記）——沒有推
#   5 推上去的是鎖定的 commit，但推送期間本機 main 多了 commit（那些沒有被推、也沒有被自查）
#   6 執行環境裡有 GIT_ 開頭的變數（白名單以外）——在任何 git 呼叫之前就停
# 不接管線：每一步的輸出寫到 .logs/，回傳值直接拿那一步的。
# 驗法：bash scripts/pushgate-verify.sh（本機假遠端分別製造每一關的失敗）；全部符合時登記三支檔案的雜湊，本檔推送前比對。
set -u

# 入口：git 自己認得的環境變數（GIT_DIR、GIT_WORK_TREE……）設了，整個閘門會對著別的 repo 或設定跑完全套檢查然後說通過。
# 前綴寫法、不分大小寫，只放行只影響互動介面的三個。
GIT_ENV_ALLOW=" GIT_EDITOR GIT_SEQUENCE_EDITOR GIT_PAGER "
for v in $(compgen -e); do
  u="${v^^}"
  case "$u" in GIT_*) case "$GIT_ENV_ALLOW" in *" $u "*) ;; *) echo "【擋下：執行環境】$v 有設定：git 自己認得 GIT_ 開頭的變數；先 unset $v 再推"; exit 6;; esac;; esac
done
cd "$(git rev-parse --show-toplevel)" || exit 1
REMOTE=origin
mkdir -p .logs
LOG=".logs/pushgate.out"

# 鎖定這一次要推的 commit：之後的登記比對、自查、推送、核對都只看它（自查之後才多出來的 commit 不會被一起推出去）
BR="$(git symbolic-ref --short -q HEAD)"
if [ "$BR" != main ]; then echo "【擋下】HEAD 不在 main 上（${BR:-detached}），不推送"; exit 1; fi
PIN="$(git rev-parse HEAD)" || exit 1

# 第零關：驗法登記——改過閘門、自查或驗法，沒重跑驗法就推不出去。比的是鎖定的 commit 裡的版本（推出去的就是它）。
REG=".logs/pushgate-verified.txt"
cur=""
for f in scripts/pushgate.sh scripts/selfcheck.mjs scripts/pushgate-verify.sh; do
  h="$(git rev-parse "$PIN:$f" 2>/dev/null)"
  if [ -z "$h" ]; then echo "【擋下：驗法登記】讀不到 $f 的雜湊（還沒 commit？），不推送"; exit 4; fi
  cur="${cur}${f} ${h}"$'\n'
done
if [ ! -f "$REG" ]; then echo "【擋下：驗法登記】沒有登記檔（$REG），先跑 bash scripts/pushgate-verify.sh"; exit 4; fi
if [ "$(cat "$REG")" != "$(printf '%s' "$cur")" ]; then
  echo "【擋下：驗法登記】閘門、自查或驗法跟上次驗法通過時不一樣，先 commit 再跑 bash scripts/pushgate-verify.sh"; exit 4
fi

# 第一關：自查。範圍照「遠端的實際狀態」算，不看本機的追蹤分支（追蹤分支可能跑在遠端前面）。
if ! git ls-remote "$REMOTE" > "$LOG" 2>&1; then cat "$LOG"; echo "【擋下：自查】讀不到遠端，自查的範圍不確定，不推送"; exit 1; fi
RMAIN="$(awk '$2=="refs/heads/main"{print $1}' "$LOG")"
if [ -z "$RMAIN" ]; then
  RANGE="$PIN"   # 遠端還沒有 main（第一次推送）：從第一個 commit 查起
  echo "遠端還沒有 main：自查範圍＝全部 commit"
else
  if ! git fetch -q "$REMOTE" main > "$LOG" 2>&1; then cat "$LOG"; echo "【擋下：自查】取不到遠端的 main，不推送"; exit 1; fi
  RANGE="$RMAIN..$PIN"
fi
node scripts/selfcheck.mjs "$RANGE" > "$LOG" 2>&1
rc=$?
cat "$LOG"
if [ "$rc" -ne 0 ]; then echo "【擋下：自查】回傳 $rc，不推送"; exit 1; fi

# 第二關：推送（推的是鎖定的 commit，不是「推送那一刻的 main」）
git push -q "$REMOTE" "$PIN:refs/heads/main" > "$LOG" 2>&1
rc=$?
cat "$LOG"
if [ "$rc" -ne 0 ]; then echo "【擋下：推送失敗】回傳 $rc，不做後面的確認"; exit 2; fi

# 第三關：直接問遠端，main 要等於鎖定的 commit
LS="$(git ls-remote "$REMOTE" refs/heads/main 2>"$LOG")"
REMOTE_SHA="${LS%%[[:space:]]*}"
if [ "$REMOTE_SHA" != "$PIN" ]; then echo "【擋下：遠端對不上】遠端 main=${REMOTE_SHA:-（讀不到）}，鎖定的 commit=$PIN"; exit 3; fi
git update-ref "refs/remotes/$REMOTE/main" "$PIN"
if [ "$(git rev-parse main)" != "$PIN" ]; then echo "【注意】推上去的是 ${PIN:0:7}，但推送期間本機 main 多了 commit（沒有被推、也沒有被自查）"; exit 5; fi
echo "【已推送】遠端 main＝本機 main（${PIN:0:7}）"
exit 0
