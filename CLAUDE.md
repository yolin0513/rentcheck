# 收租紀錄（RentCheck）— 給 Claude 的專案指示

**開工前先讀 [`docs/STATUS.md`](docs/STATUS.md)**：開頭的「目前進行中／交接」寫著上一輪做到哪、下一步是什麼；「等 Yolin 回覆」是正在等他決定的事。
**STATUS.md 是唯一的真相來源**——Session 的記憶檔不會跟著專案走，新的決定、規則、踩坑請直接寫進 STATUS.md。
設計的來龍去脈在上一層的 `../收租App_設計草案_2026-10-07_v2.md`（v2.3）；地基實測頁與步驟表在 `../RentProbe/`（降級保留）。

## 常設規則（必須遵守）

1. **產出一律繁體中文**（回覆、文件、commit 訊息）；思考過程不限語言。程式碼、檔名、專有名詞維持原樣。
2. **嚴禁互動式提示框**（AskUserQuestion 之類）：Yolin 常從遠端操作，點不到。要他決定的事，用純文字列選項與代價。
3. **對外發布一律先問**：建 GitHub repo、push、部署到任何網址，都要 Yolin（或 Dispatch 轉達）明確說好。
   - 線上網址：https://yolin0513.github.io/rentcheck/（repo `yolin0513/rentcheck`，public）。
   - 推送一律用 `bash scripts/pushgate.sh`（共用慣例 §2.5），不要直接 `git push`。改過閘門、`selfcheck.mjs` 或驗法，要先 commit 再跑 `bash scripts/pushgate-verify.sh` 重新登記，否則閘門回 4、不推。
4. **跨專案唯讀**：`../JLPT_App`、`../StockDiary`、`../MealMate`、`../TripQuest` 只能讀。
5. **個資不進 repo**：租客姓名、門牌、金額都是個資。測試一律用合成資料（「測試戶01」「中山路12號」這類）；Yolin 家裡的真實資料只存在長輩的手機裡。
6. **App 裡不得有任何依賴 iOS 版本號或瀏覽器識別字串的邏輯**。Safari 26 起回報的 iOS 版本被固定成 18.x，看版本號一定會判斷錯。一律用功能偵測。`scripts/staticcheck.mjs` 會擋。
7. **本機儲存是快取、備份是正本**：任何會改資料的功能，都要經過 `js/store.js` 的 `mutate()`（記異動紀錄、增加 changeSeq），「還沒傳出的變更」才算得準。
8. **測試紀律**：新斷言要證明「改壞會紅」——加進 `scripts/mutate.mjs`。修 bug 回報三件事：根因、為什麼既有測試沒抓到、補了哪些斷言。
9. **不主動截圖**：用 puppeteer 讀 DOM 驗證；Yolin 要求時才截圖。

## 常用指令

```bash
npm run dev          # http://127.0.0.1:5190/（只有本機連得到）
npm test             # 靜態檢查 → 純函式測試 → 端對端（約 30 秒）
npm run mutate       # 突變驗證（約 3 分鐘）
npm run pack         # 產生 dist/（只含 App 檔案，給直接上傳型的託管）
npm run icons -- A   # 產生主畫面圖示（A／B／C，見 scripts/icon-designs.mjs）
bash scripts/pushgate.sh          # 推送一律用這支（自查 → 推送 → 核對遠端）
node scripts/pages-verify.mjs     # 推送後一定要跑：等 GitHub Pages 建好，線上檔案要和本機逐字相同
bash scripts/pushgate-verify.sh   # 改過閘門、自查或驗法之後要重跑（本機假遠端 14 種情境），全部符合才登記
bash scripts/pushgate-mutants.sh  # 閘門的突變驗證（3 條）
```

**改了任何 App 檔案（css／js／index.html／manifest／icons）**：同時改 `sw.js` 與 `js/version.js` 的版本號，`npm test` 會比對。
puppeteer 裝不起來時：`PUPPETEER_SKIP_DOWNLOAD=1 npm install`（瀏覽器本體在 `~/.cache/puppeteer`，與其他 App 共用）。

## 共用慣例

四個 App 共用的工作慣例在 `docs/CONVENTIONS.md`（副本，主檔在統籌工作區，不要在這裡改）。
開工前把它跟 `docs/STATUS.md` 一起讀完，第一則回覆的第一行寫回執：`已讀共用慣例 vN（日期）`。
本檔與 `docs/STATUS.md` 優先於共用慣例；衝突時照較嚴的做，並在回報裡指出來。
