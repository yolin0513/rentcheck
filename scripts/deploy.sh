#!/usr/bin/env bash
# 部署到 Cloudflare（Workers 靜態資產；Cloudflare 已把 Pages 併進 Workers）。
#   bash scripts/deploy.sh
# 每一關失敗就停，各自的回傳值：
#   1 測試沒過    2 打包失敗    3 部署前個資掃描有命中（或掃描器壞了）
#   4 上傳失敗    5 上傳回報成功，但線上的版本號不等於本機
#   0 上線了，而且線上版本＝本機版本
# 會決定成敗的指令一律不接管線（管線會吞掉前面的失敗）；輸出導到 .logs/ 再讀。
# 這是對外發布：跑之前要有 Yolin（或 Dispatch 轉達）的同意。

set -u
cd "$(dirname "$0")/.."
mkdir -p .logs
LOG=.logs/deploy-$(date +%Y%m%d-%H%M%S)

node scripts/staticcheck.mjs > "$LOG-test.log" 2>&1 || { echo "✘ 靜態檢查沒過（$LOG-test.log）"; exit 1; }
node scripts/unittest.mjs >> "$LOG-test.log" 2>&1 || { echo "✘ 單元測試沒過（$LOG-test.log）"; exit 1; }
node scripts/e2e.mjs >> "$LOG-test.log" 2>&1 || { echo "✘ 端對端測試沒過（$LOG-test.log）"; exit 1; }
echo "✔ 測試全過"

node scripts/pack.mjs > "$LOG-pack.log" 2>&1 || { echo "✘ 打包失敗（$LOG-pack.log）"; exit 2; }
cat "$LOG-pack.log"

node scripts/predeploy-scan.mjs > "$LOG-scan.log" 2>&1 || { cat "$LOG-scan.log"; echo "✘ 部署前掃描沒過，不上傳"; exit 3; }
echo "✔ 部署前掃描乾淨"

npx --no-install wrangler deploy > "$LOG-wrangler.log" 2>&1 || { echo "✘ 上傳失敗（$LOG-wrangler.log）"; exit 4; }
URL=$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' "$LOG-wrangler.log" | head -1)
[ -n "$URL" ] || { echo "✘ 上傳回報成功，但找不到網址（$LOG-wrangler.log）"; exit 5; }

# 上傳後核對：線上的 js/version.js 要等於本機
LOCAL=$(cat js/version.js)
for i in 1 2 3 4 5 6; do
  REMOTE=$(curl -fsS -H 'cache-control: no-cache' "$URL/js/version.js?t=$(date +%s)" 2>/dev/null) && [ "$REMOTE" = "$LOCAL" ] && break
  sleep 5
done
[ "$REMOTE" = "$LOCAL" ] || { echo "✘ 線上版本與本機不同（$URL）"; exit 5; }
echo "✔ 上線：$URL（版本 $(grep -oE "'[0-9.]+'" js/version.js)）"
exit 0
