#!/usr/bin/env bash
# 推送閘門的驗法（共用慣例 §2.5）：用實際推送的那一支 scripts/pushgate.sh，分別製造每一關的失敗。照 MealMate 的驗法移植。
# 完全不碰 GitHub：暫存目錄裡建 bare repo 當假遠端；工作區是本 repo「目前 commit」的快照（單一 commit，不帶歷史），
# 驗的是閘門的邏輯，不是 repo 的內容。
# 用法：bash scripts/pushgate-verify.sh。全部符合回傳 0，並把三支閘門檔案「已 commit 版本」的雜湊登記進 .logs/pushgate-verified.txt；
# 任何一種不符合回傳 1、並刪掉登記。
set -u
ALLOW=" GIT_EDITOR GIT_SEQUENCE_EDITOR GIT_PAGER "
for v in $(compgen -e); do
  u="${v^^}"
  case "$u" in GIT_*) case "$ALLOW" in *" $u "*) ;; *) echo "閘門驗法：執行環境裡有 $v，先 unset 再跑"; exit 1;; esac;; esac
done
SRC="$(git rev-parse --show-toplevel)" || exit 1
GATE_FILES="scripts/pushgate.sh scripts/selfcheck.mjs scripts/pushgate-verify.sh"
for f in $GATE_FILES; do
  if ! git -C "$SRC" diff --quiet HEAD -- "$f"; then echo "閘門驗法：$f 有沒 commit 的改動，先 commit 再驗（登記的是已 commit 的版本）"; exit 1; fi
done
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

git init -q --bare "$T/remote.git"
mkdir -p "$T/work"
git -C "$SRC" archive HEAD | tar -x -C "$T/work" || exit 1
cd "$T/work" || exit 1
git init -q -b main
git config user.name probe
git config user.email probe@users.noreply.github.com
git add -A
git commit -q -m "快照" || exit 1
git remote add origin "$T/remote.git"
SNAP="$(git rev-parse HEAD)"

register_work() { local out="" f; for f in $GATE_FILES; do out="${out}${f} $(git rev-parse "HEAD:$f")"$'\n'; done; mkdir -p .logs; printf '%s' "$out" > .logs/pushgate-verified.txt; }
remote_main() { git --git-dir="$T/remote.git" rev-parse -q --verify refs/heads/main 2>/dev/null || echo none; }
probe_commit() { mkdir -p docs; printf '%s\n' "$2" > "docs/$1.md"; git add "docs/$1.md"; git commit -q -m "probe $1"; }
fake_mail() { printf '%s@%s' tester example-mail.test; }
BASE=""
# 每一種情境開頭都把假遠端、本機、追蹤分支、hook、登記還原成同一個起點，彼此獨立
fresh() {
  rm -f "$T/remote.git/hooks/pre-receive" "$T/remote.git/hooks/post-receive"
  git checkout -q main 2>/dev/null
  if [ "$1" = empty ]; then
    git --git-dir="$T/remote.git" update-ref -d refs/heads/main 2>/dev/null
    git update-ref -d refs/remotes/origin/main 2>/dev/null
    git reset -q --hard "$SNAP"
  else
    git --git-dir="$T/remote.git" update-ref refs/heads/main "$BASE"
    git update-ref refs/remotes/origin/main "$BASE"
    git reset -q --hard "$BASE"
  fi
  git clean -qfd -e .logs
  register_work
}
FAIL=0; N=0
check() { # <名稱> <預期回傳值> <預期遠端：same|pin|none> <輸出必須有的字> <輸出不能有的字>
  local name="$1" want="$2" wantRemote="$3" must="$4" mustNot="$5" after; after="$(remote_main)"
  local remoteOk=no
  case "$wantRemote" in
    same) [ "$after" = "$BEFORE" ] && remoteOk=yes ;;
    pin) [ "$after" = "$PINNED" ] && remoteOk=yes ;;
    none) [ "$after" = none ] && remoteOk=yes ;;
  esac
  local outOk=yes
  grep -q -- "$must" "$T/out" || outOk=no
  if [ -n "$mustNot" ] && grep -q -- "$mustNot" "$T/out"; then outOk=no; fi
  N=$((N + 1))
  local verdict=符合
  if [ "$RC" != "$want" ] || [ "$remoteOk" != yes ] || [ "$outOk" != yes ]; then verdict=不符合; FAIL=1; fi
  printf '%-34s｜回傳 %s（預期 %s）｜遠端 %s（預期 %s）｜%s\n' "$name" "$RC" "$want" "${after:0:7}" "$wantRemote" "$verdict"
  if [ "$verdict" = 不符合 ]; then sed 's/^/    /' "$T/out" | head -15; fi
}
run_gate() { BEFORE="$(remote_main)"; PINNED="$(git rev-parse HEAD)"; bash scripts/pushgate.sh > "$T/out" 2>&1; RC=$?; }

# 1 第一次推送（遠端是空的），歷史裡有一個命中的 commit、後面接乾淨的 commit → 擋
fresh empty
probe_commit a "contact: $(fake_mail)"
probe_commit b "乾淨"
run_gate; check "1 第一次推送：歷史裡有命中" 1 none "來源：新增行" "已推送"

# 2 第一次推送、乾淨 → 推上去，遠端＝鎖定的 commit
fresh empty
run_gate; check "2 第一次推送：乾淨" 0 pin "已推送" "擋下"
BASE="$(remote_main)"

# 3 之後的推送：新增行有命中 → 擋
fresh base
probe_commit c "contact: $(fake_mail)"
run_gate; check "3 新增行有命中" 1 same "來源：新增行" "已推送"

# 4 commit 訊息有命中 → 擋
fresh base
mkdir -p docs; echo ok > docs/m.md; git add docs/m.md; git commit -q -m "寄給 $(fake_mail)"
run_gate; check "4 commit 訊息有命中" 1 same "來源：commit 訊息" "已推送"

# 5 自查的對照組弄壞（email 的對照樣本換成不是 email 的字）→ 擋（檢查器壞了也要停）
fresh base
node -e "const fs=require('fs');const f='scripts/selfcheck.mjs';const s=fs.readFileSync(f,'utf8');const a=\"const fakeMail = ['someone', 'example-mail.test'].join('@');\";if(!s.includes(a))process.exit(9);fs.writeFileSync(f,s.replace(a,\"const fakeMail = 'not-an-email';\"))" || { echo "5 找不到要弄壞的那一行（驗法過期）"; FAIL=1; }
git add scripts/selfcheck.mjs; git commit -q -m "弄壞對照組"
register_work
run_gate; check "5 自查的對照組壞掉" 1 same "對照組命中=false" "已推送"

# 6 推送被拒（pre-receive 回 1）→ 回 2
fresh base
probe_commit d "乾淨"
printf '#!/bin/sh\nexit 1\n' > "$T/remote.git/hooks/pre-receive"; chmod +x "$T/remote.git/hooks/pre-receive"
run_gate; check "6 推送被拒" 2 same "推送失敗" "已推送"

# 7 推送回報成功、遠端卻沒更新（post-receive 把 main 退回去）→ 回 3
fresh base
probe_commit e "乾淨"
printf '#!/bin/sh\ngit update-ref refs/heads/main %s\n' "$BASE" > "$T/remote.git/hooks/post-receive"; chmod +x "$T/remote.git/hooks/post-receive"
run_gate; check "7 推了但遠端沒更新" 3 same "遠端對不上" "已推送"

# 8 本機的追蹤分支跑在遠端前面：一個命中的 commit「看起來已經推過」，其實遠端沒有；再疊一個乾淨的 → 一樣要擋
fresh base
probe_commit f "contact: $(fake_mail)"
git update-ref refs/remotes/origin/main HEAD
probe_commit g "乾淨"
run_gate; check "8 追蹤分支跑在遠端前面" 1 same "來源：新增行" "已推送"

# 9 環境裡有 GIT_DIR → 回 6，沒碰 git
fresh base
probe_commit h "乾淨"
BEFORE="$(remote_main)"; PINNED="$(git rev-parse HEAD)"; GIT_DIR="$T/remote.git" bash scripts/pushgate.sh > "$T/out" 2>&1; RC=$?
check "9 環境裡有 GIT_DIR" 6 same "執行環境" "已推送"

# 10 閘門改過、沒重跑驗法 → 回 4
fresh base
printf '\n# 改了一行\n' >> scripts/pushgate.sh; git add scripts/pushgate.sh; git commit -q -m "改閘門"
run_gate; check "10 閘門改過沒重跑驗法" 4 same "驗法登記" "已推送"

# 11 沒有登記檔 → 回 4
fresh base
probe_commit i "乾淨"
rm -f .logs/pushgate-verified.txt
run_gate; check "11 沒有登記檔" 4 same "沒有登記檔" "已推送"

# 12 HEAD 不在 main 上 → 回 1
fresh base
probe_commit j "乾淨"
git checkout -q --detach
run_gate; check "12 HEAD 不在 main 上" 1 same "不在 main" "已推送"
git checkout -q main

# 13 讀不到遠端 → 回 1
fresh base
probe_commit k "乾淨"
git remote set-url origin "$T/no-such-remote.git"
run_gate; check "13 讀不到遠端" 1 same "讀不到遠端" "已推送"
git remote set-url origin "$T/remote.git"

# 14 之後的推送、乾淨 → 推上去
fresh base
probe_commit l "乾淨"
run_gate; check "14 之後的推送：乾淨" 0 pin "已推送" "擋下"

echo "共 $N 種"
if [ "$FAIL" -ne 0 ]; then rm -f "$SRC/.logs/pushgate-verified.txt"; echo "閘門驗法：有不符合，登記已刪除"; exit 1; fi
out=""
for f in $GATE_FILES; do out="${out}${f} $(git -C "$SRC" rev-parse "HEAD:$f")"$'\n'; done
mkdir -p "$SRC/.logs"; printf '%s' "$out" > "$SRC/.logs/pushgate-verified.txt"
echo "閘門驗法：全部符合，已登記（$SRC/.logs/pushgate-verified.txt）"
exit 0
