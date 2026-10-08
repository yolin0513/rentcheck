// 端對端測試（puppeteer，無頭 Chromium）：照長輩與晚輩實際會走的路走一遍。
// 時間固定在 2026-10-07 10:00（台北），讓「該收了／還沒到」的判斷不隨測試日期改變。
// 分享畫面用替身（headless 沒有 iPhone 的分享畫面）：記下被分享的檔案，或模擬使用者按取消。
//
// 用法：node scripts/e2e.mjs

import puppeteer from 'puppeteer';
import { createServer } from './serve.mjs';

const PORT = 5191;
const BASE = `http://127.0.0.1:${PORT}/`;
let fail = 0;
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fail++; };

const server = createServer();
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.emulateTimezone('Asia/Taipei');
await page.evaluateOnNewDocument(() => {
  // 固定「現在」＝ 2026-10-07 10:00 台北（時間照常往前走）
  const FIXED = Date.UTC(2026, 9, 7, 2, 0, 0);
  const Real = Date;
  const t0 = Real.now();
  class FakeDate extends Real {
    constructor(...a) { if (a.length) super(...a); else super(FIXED + (Real.now() - t0)); }
    static now() { return FIXED + (Real.now() - t0); }
  }
  globalThis.Date = FakeDate;
  // 分享畫面替身
  window.__shared = [];
  // 畫面上出現 null／undefined／NaN 的文字，任何時候都記下來（2026-10-07 實機出現「nullnull」，76 項測試沒抓到）。
  // 不用單字邊界：「nullnull」用 \bnull\b 抓不到。
  window.__garbage = [];
  // 返回類的按鈕（文字是「回收租表／回上一頁／回設定」）只能是返回樣式，不能是主按鈕
  window.__backPrimary = [];
  const checkBack = (root) => {
    if (root.nodeType !== 1) return;
    root.querySelectorAll('.btn').forEach((b) => {
      if (/回(收租表|上一頁|設定)/.test(b.textContent) && !b.classList.contains('back')) window.__backPrimary.push(`${location.hash || '#/'}｜${b.textContent.trim()}｜${b.className}`);
    });
  };
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(checkBack); }).observe(document, { subtree: true, childList: true });
  const GARBAGE = /null|undefined|NaN/;
  const scan = (n) => {
    const t = n.nodeType === 3 ? n.textContent : (n.nodeType === 1 ? n.textContent : '');
    if (t && GARBAGE.test(t)) window.__garbage.push(`${t.match(GARBAGE)[0]}｜${location.hash || '#/'}｜${t.trim().slice(0, 30)}`);
  };
  new MutationObserver((ms) => { for (const m of ms) { m.addedNodes.forEach(scan); if (m.type === 'characterData') scan(m.target); } })
    .observe(document, { subtree: true, childList: true, characterData: true });
  // 畫面上出現任何「可以當 emoji 的字元」（✔ ◀ ▶ 📞 📷…）就記下來：iPhone 用 emoji 字型畫它們，顏色固定、不跟著主題
  // （2026-10-08 實機：森林主題深綠按鈕上的 ✔ 是深灰黑色）。應該全部換成 ui.js 的 SVG 圖示
  window.__emoji = [];
  const EMOJI = /\p{Extended_Pictographic}/u;
  const scanEmoji = (n) => {
    const t = n.nodeType === 3 || n.nodeType === 1 ? n.textContent : '';
    if (t && EMOJI.test(t)) window.__emoji.push(`${t.match(EMOJI)[0]}｜${location.hash || '#/'}｜${t.trim().slice(0, 30)}`);
  };
  new MutationObserver((ms) => { for (const m of ms) { m.addedNodes.forEach(scanEmoji); if (m.type === 'characterData') scanEmoji(m.target); } })
    .observe(document, { subtree: true, childList: true, characterData: true });
  try { window.__shareMode = sessionStorage.getItem('__shareMode') || 'ok'; } catch { window.__shareMode = 'ok'; } // about:blank 讀不到 sessionStorage
  navigator.canShare = () => true;
  navigator.share = async ({ files }) => {
    if (window.__shareMode === 'cancel') { const e = new Error('cancel'); e.name = 'AbortError'; throw e; }
    const f = files[0];
    window.__shared.push({ name: f.name, size: f.size, text: await f.text() });
  };
});

// 每畫一次就檢查畫面文字：不出現「晚輩」「家人」（Yolin 2026-10-07）
const seenWords = new Set();
const rendered = async () => {
  const t = await page.evaluate(() => (document.body ? document.body.innerText : ''));
  for (const w of ['晚輩', '家人']) if (t.includes(w)) seenWords.add(`${w}（${await page.evaluate(() => location.hash)}）`);
  return page.evaluate(() => Number(document.body.dataset.rendered || 0));
};
const _renderedOld = () => page.evaluate(() => Number(document.body.dataset.rendered || 0));
async function nav(action) {
  const n = await rendered();
  await action();
  await page.waitForFunction((n) => Number(document.body.dataset.rendered || 0) > n, { timeout: 15000 }, n);
}
/** 重新載入：新頁面的計數從 0 開始，等它畫完第一次 */
async function reload() {
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => Number(document.body.dataset.rendered || 0) > 0, { timeout: 15000 });
}
const clickText = async (sel, text) => {
  const handles = await page.$$(sel);
  for (const h of handles) {
    const t = await h.evaluate((e) => e.textContent.trim());
    if (t.includes(text)) { await h.click(); return true; }
  }
  throw new Error(`找不到「${text}」（${sel}）`);
};
const text = (sel) => page.$eval(sel, (e) => e.textContent);
const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const tiles = () => page.$$eval('.tile', (els) => els.map((e) => ({ label: e.querySelector('.tile-label').textContent, status: e.dataset.status, line: e.querySelector('.tile-status').textContent })));
const settingsVal = (k) => page.evaluate((k) => new Promise((res) => {
  const r = indexedDB.open('rentcheck');
  r.onsuccess = () => { const q = r.result.transaction('meta').objectStore('meta').get(k); q.onsuccess = () => { res(q.result ? q.result.v : undefined); r.result.close(); }; };
}), k);
// 「幾天前」一律用頁面裡的時鐘（固定在 2026-10-07）：用 Node 的真實時鐘，真實日期過了一天，「31 天前」就只剩 30 天（2026-10-08 踩到）
const pageNow = () => page.evaluate(() => Date.now());
const HOLD = 1200;   // 設定要按住 1 秒：測試按 1.2 秒
async function hold(ms) {
  const sc = await page.evaluate(() => visualViewport.scale);
  if (Math.abs(sc - 1) > 0.001) throw new Error(`畫面被縮放了（${sc}），滑鼠座標會偏——測試環境問題，先 reload()`);
  const btn = await page.$('.hold');
  await btn.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, ms));
  await page.mouse.up();
}

try {
  // iPhone 12 主畫面 App 的可用大小（390×844 扣掉狀態列與底部橫條）
  await page.setViewport({ width: 390, height: 763, deviceScaleFactor: 2, isMobile: true, hasTouch: false });
  await page.goto(BASE, { waitUntil: 'networkidle0' });

  // ---- 1. 不是從主畫面打開 → 只有安裝說明 ----
  ok('瀏覽器分頁：顯示「加到主畫面」說明', (await text('#app')).includes('加到主畫面'));
  ok('瀏覽器分頁：沒有收租表', (await page.$$('.tile')).length === 0);
  await nav(() => clickText('button', '先在瀏覽器裡看看'));
  ok('預覽模式有紅色警告', (await text('.preview-banner')).includes('可能被 iPhone 清掉'));

  // ---- 2. 空的 App：兩條路都給 ----
  const empty = await text('#app');
  ok('空的 App：說明「紀錄不見了請打電話給家人」', empty.includes('紀錄卻不見了') && empty.includes('從備份找回'));
  await nav(() => clickText('button', '第一次使用'));
  ok('第一次使用直接進設定（還沒有資料，不用按住）', (await page.evaluate(() => location.hash)) === '#/settings');
  ok('設定的頁首寫著「設定中」', (await text('.edit-top')).includes('設定中'));

  // ---- 3. 新增 10 戶（故意打亂順序） ----
  const floors = ['3樓之2', '10樓', '2樓之1', '5樓', '3樓之1', '2樓之2', '4樓之1', '6樓', '4樓之2', '7樓'];
  for (const [i, f] of floors.entries()) {
    await nav(() => page.click('[data-act="add-tenant"]'));
    await page.type('input[name="address"]', `中山路12號${f}`);
    await page.type('input[name="name"]', `測試戶${i + 1}`);
    await page.type('input[name="rent"]', String(6000 + i * 500));
    if (i === 0) await page.type('input[name="phone"]', '0900-000-111');   // 合成的號碼（只有第一戶有電話）
    await page.$eval('input[name="dueDay"]', (e, v) => { e.value = v; }, String(i % 2 ? 5 : 20)); // 一半 5 號、一半 20 號
    await nav(() => page.click('[data-act="save-tenant"]'));
  }
  const listText = await text('.tenant-list');
  ok('設定頁：10 戶依門牌自然排序', ['2樓之1', '2樓之2', '3樓之1', '3樓之2', '4樓之1', '4樓之2', '5樓', '6樓', '7樓', '10樓'].every((l, i, a) => i === 0 || listText.indexOf(a[i - 1]) < listText.indexOf(l)));
  // ---- 3b. 設定頁的租客清單（2026-10-08 Yolin：一整串文字流，斷在「王／先生」「5／號」中間、每戶斷點不同） ----
  const tlMeasure = () => page.evaluate(() => {
    const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
    const items = [...document.querySelectorAll('.tenant-list .tl-item')];
    const R = (el) => el.getBoundingClientRect();
    const broken = items.flatMap((li) => ['.tl-name', '.tl-rent', '.tl-due'].map((s) => li.querySelector(s)).filter((e) => !e || lines(e) > 1).map((e) => (e ? e.textContent : '少了一欄')));
    const uniq = (f) => new Set(items.map(f).map((x) => Math.round(x))).size;
    return { n: items.length, broken, heights: uniq((li) => R(li).height), nameL: uniq((li) => R(li.querySelector('.tl-name')).left), rentR: uniq((li) => R(li.querySelector('.tl-rent')).right), dueR: uniq((li) => R(li.querySelector('.tl-due')).right), hs: document.documentElement.scrollWidth <= innerWidth + 1 };
  });
  const tlWide = await tlMeasure();
  ok('設定頁的租客清單（iPhone 12・大字）：稱呼｜月租｜繳款日 每一欄上下對齊、每戶一樣高、沒有一項被拆成兩行',
    tlWide.n === 10 && tlWide.broken.length === 0 && tlWide.heights === 1 && tlWide.nameL === 1 && tlWide.rentR === 1 && tlWide.dueR === 1 && tlWide.hs, JSON.stringify(tlWide));
  // ↑↓ 平常收起來（放在地址旁邊會把長地址擠成兩行）；按「調整順序」才出現，而且真的能換順序（之前沒有任何測試按過 ↑↓）
  ok('租客清單：平常不顯示 ↑↓', (await page.$$('.tl-ord')).length === 0);
  // 點那一戶的稱呼（不是地址）也要打開那一戶的設定：整列都可以點
  const hitOk = await page.evaluate(() => { const li = document.querySelectorAll('.tl-item')[1]; const r = li.querySelector('.tl-rent').getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && el.closest('a') === li.querySelector('.tl-addr'); });
  ok('租客清單：整列都可以點（點月租那裡也會打開那一戶）', hitOk);
  const firstAddr = () => page.$eval('.tl-item .tl-addr', (e) => e.textContent);
  const a0 = await firstAddr();
  await nav(() => page.click('[data-act="reorder"]'));
  ok('按「調整順序」：每一戶出現 ↑↓', (await page.$$('.tl-ord')).length === 10);
  await nav(() => page.click('.tl-item [aria-label="往後"]'));
  const a1 = await firstAddr();
  await nav(() => page.$$eval('.tl-item', (els) => els[1].querySelector('[aria-label="往前"]').click()));
  ok('↓ 把第一戶往後移一格、↑ 再移回來', a1 !== a0 && (await firstAddr()) === a0, `${a0} → ${a1} → ${await firstAddr()}`);
  await nav(() => page.click('[data-act="reorder"]'));
  ok('按「順序排好了」：↑↓ 收起來', (await page.$$('.tl-ord')).length === 0);
  await page.setViewport({ width: 320, height: 626, deviceScaleFactor: 2, isMobile: true });
  for (const font of ['normal', 'xxlarge']) {
    await page.evaluate((f) => { document.documentElement.dataset.font = f; }, font);
    await new Promise((r) => setTimeout(r, 100));
    const tl = await tlMeasure();
    ok(`設定頁的租客清單（320 寬・${font}）：每一項都沒被拆成兩行、每戶一樣高、沒有橫向捲動`, tl.broken.length === 0 && tl.heights === 1 && tl.hs, JSON.stringify(tl));
  }
  await page.evaluate(() => { document.documentElement.dataset.font = 'large'; });
  await page.setViewport({ width: 390, height: 763, deviceScaleFactor: 2, isMobile: true });
  { const cdp = await page.createCDPSession(); await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await cdp.detach(); }

  await nav(() => page.click('[data-act="exit"]'));
  let t = await tiles();
  ok('收租表：10 格', t.length === 10, String(t.length));
  ok('格子名稱自動去掉共同的「中山路12號」（包含第一戶）', t.every((x) => !x.label.includes('中山路12號')), t.map((x) => x.label).join(','));
  ok('收租表：位置照門牌排', t.map((x) => x.label).join(',') === '2樓之1,2樓之2,3樓之1,3樓之2,4樓之1,4樓之2,5樓,6樓,7樓,10樓', t.map((x) => x.label).join(','));
  ok('剛設定完：還不會出現「匯出備份」提醒', (await page.$('.remind')) === null);
  ok('還沒匯出過：「匯出備份」按鈕的第二行寫「還沒匯出過」', (await page.evaluate(() => { const e = document.querySelector('[data-act="foot-backup"] [data-last-backup]'); return e ? e.textContent : null; })) === '還沒匯出過');
  const setMetaV = (k, v) => page.evaluate((k, v) => new Promise((res) => {
    const r = indexedDB.open('rentcheck');
    r.onsuccess = () => { const t = r.result.transaction('meta', 'readwrite'); t.objectStore('meta').put({ k, v }); t.oncomplete = () => { r.result.close(); res(); }; };
  }), k, v);
  const firstAt = await settingsVal('firstChangeAt');
  await setMetaV('firstChangeAt', new Date(Date.UTC(2026, 8, 29)).toISOString()); // 8 天前
  await reload();
  ok('從沒匯出過、第一筆資料滿 7 天：出現「還沒有匯出過備份」提醒', (await page.$('.remind')) !== null && (await text('.remind')).includes('還沒有匯出過'));
  await setMetaV('firstChangeAt', firstAt);
  await reload();
  ok('10/7：5 號繳的「該收了」、20 號繳的「還沒到」', t.filter((x) => x.status === 'due').length === 5 && t.filter((x) => x.status === 'notyet').length === 5);

  // ---- 4. 按住 1 秒才進得去設定（2026-10-08 Yolin：從 3 秒縮短，按鈕上只寫「設定」） ----
  // 長按會被 iPhone 當成選取文字、叫出書寫工具（2026-10-08 實機）。Chromium 沒有那個行為，只能查「選取有沒有被關掉」：
  // 要按住的元件（和它裡面的每一個字）、每一格房間格都不能被選取（-webkit- 前綴有沒有寫由 staticcheck 查）
  const sel = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-longpress], [data-longpress] *, .tile, .tile *')];
    return { n: document.querySelectorAll('[data-longpress]').length, bad: els.filter((e) => getComputedStyle(e).userSelect !== 'none').map((e) => e.className || e.tagName).slice(0, 5) };
  });
  ok('要按住的「設定」與房間格：文字不能被選取（長按不會變成選字）', sel.n === 1 && sel.bad.length === 0, JSON.stringify(sel));
  ok('設定按鈕只寫「設定」（不寫「按住幾秒」）', (await text('.footbar .hold')).trim() === '設定', await text('.footbar .hold'));
  await hold(400);
  await new Promise((r) => setTimeout(r, 300));
  ok('只按一下：不會進設定', (await page.evaluate(() => location.hash)) !== '#/settings');
  ok('只按一下：提示「按住不放」', (await page.$eval('body', (b) => b.textContent)).includes('按住不放'));
  await hold(700);
  await new Promise((r) => setTimeout(r, 300));
  ok('按住 0.7 秒：還不會進設定（比單擊長很多才算）', (await page.evaluate(() => location.hash)) !== '#/settings');
  // 不用 nav()：進不去的話不會有新畫面，nav() 只會逾時、整個流程中斷（看不出是哪一條紅）
  await hold(HOLD);
  const entered = await page.waitForFunction(() => location.hash === '#/settings' && document.querySelector('.settings'), { timeout: 3000 }).then(() => true, () => false);
  ok('按住 1 秒：進入設定', entered);
  if (!entered) throw new Error('按住 1 秒進不了設定，後面的步驟都走不下去');
  const secs = await page.$$eval('.settings .card h2', (hs) => hs.map((x) => x.textContent));
  ok('設定頁：「租客」在最上面', secs[0] === '租客', secs.join('、'));
  // 切到背景 → 自動離開
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => { delete document.visibilityState; });
  // 不用 nav() 等畫面：沒離開的話這裡不會有新的畫面，等下去只會逾時；改成最多等 3 秒，再判斷結果
  const left = await page.waitForFunction(() => location.hash === '#/' && document.querySelectorAll('.tile').length === 10, { timeout: 3000 }).then(() => true, () => false);
  ok('App 切到背景：自動離開設定', left);
  if (!left) await nav(() => page.evaluate(() => { location.hash = '#/'; }));
  ok('離開設定後直接打 #/settings 也進不去', await (async () => { await nav(() => page.evaluate(() => { location.hash = '#/settings'; })); return (await page.evaluate(() => location.hash)) === '#/'; })());

  const tileOf = (label) => page.$$eval('.tile', (els, l) => els.findIndex((e) => e.querySelector('.tile-label').textContent === l), label);
  const openTile = async (label) => { const i = await tileOf(label); await page.evaluate((i) => document.querySelectorAll('.tile')[i].scrollIntoView({ block: 'center' }), i); await nav(async () => (await page.$$('.tile'))[i].click()); };   // 先捲到中間：最下面那一條會蓋住底部的格子

  // ---- 4b. 上月／下月／回到本月（2026-10-08 Yolin 實機：「回到本月」按了沒反應；之前沒有任何測試走過這條路） ----
  const thisMonth = await text('.mname');
  await nav(() => clickText('.navbtn', '上月'));
  const prevMonth = await text('.mname');
  ok('按「上月」：換到上一個月，出現「回到本月」', prevMonth !== thisMonth && (await page.$('[data-act="this-month"]')) !== null, `${thisMonth}→${prevMonth}`);
  await nav(() => page.click('[data-act="this-month"]'));
  ok('按「回到本月」：真的回到這個月（月份、已收幾戶都是本月的）', (await text('.mname')) === thisMonth && (await page.$('.summary.other')) === null && (await page.$$('.tile')).length === 10, await text('.mname'));
  await nav(() => clickText('.navbtn', '下月'));
  await nav(() => clickText('.navbtn', '下月'));
  await nav(() => page.click('[data-act="this-month"]'));
  ok('往後翻兩個月再按「回到本月」：也回到這個月', (await text('.mname')) === thisMonth, await text('.mname'));
  await nav(() => clickText('.navbtn', '下月'));
  const nextMonth = await text('.mname');
  await openTile('2樓之1');
  await nav(() => clickText('a', '回收租表'));
  ok('在別的月份點進一戶再回來：停在那個月（不是跳回本月）', (await text('.mname')) === nextMonth && nextMonth !== thisMonth, await text('.mname'));
  await nav(() => page.click('[data-act="this-month"]'));

  // ---- 5. 確認收款、改回、記原因 ----
  await openTile('2樓之2');
  // 2樓之2 是第 6 戶（index 5）：月租 6000+5×500＝8,500、5 號繳
  const tb = await page.evaluate(() => { const b = document.querySelector('.topbar'); const k = b && b.querySelector('.backbtn'); const r = b && b.getBoundingClientRect(); return b ? { back: k ? k.textContent : '', title: b.querySelector('.topbar-title').textContent, top: r.top, h: r.height, backH: k ? k.getBoundingClientRect().height : 0 } : null; });
  ok('詳情頁：最上面有標題列，返回鍵寫著「回收租表」（不只是箭頭）', !!tb && tb.back.includes('回收租表') && tb.title.length > 0, JSON.stringify(tb));
  ok('詳情頁：標題列夠高、返回鍵至少 48 點高', !!tb && tb.h >= 56 && tb.backH >= 48);
  ok('點格子：顯示金額與繳款日', (await text('.amount')).replace(/\s/g, '') === '8,500元' && (await text('#app')).includes('每月 5 號'));
  const tick = await page.evaluate(() => {
    const b = document.querySelector('.tenant-page .btn.primary'); const ic = b && b.querySelector('svg.ic');
    if (!ic) return null;
    const tn = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); const r = document.createRange(); r.selectNodeContents(tn);
    const tr = r.getBoundingClientRect(), ir = ic.getBoundingClientRect();
    return { btn: getComputedStyle(b).color, icon: getComputedStyle(ic).color, stroke: getComputedStyle(ic.querySelector('path')).stroke, dy: Math.round(((ir.top + ir.bottom) / 2 - (tr.top + tr.bottom) / 2) * 10) / 10, fs: parseFloat(getComputedStyle(b).fontSize) };
  });
  ok('「收到了」前面的勾：是圖示（不是 emoji 字元），顏色和字一樣', !!tick && tick.icon === tick.btn && tick.stroke === tick.btn, JSON.stringify(tick));
  ok('「收到了」前面的勾：和字對齊（中心高低差 ≤ 字高的 15%）', !!tick && Math.abs(tick.dy) <= tick.fs * 0.15, JSON.stringify(tick));
  await nav(() => clickText('a', '收到了'));
  ok('確認頁：標題列「確定收到」＋「回上一頁」', (await page.$eval('.topbar', (b) => b.textContent)).includes('回上一頁') && (await page.$eval('.topbar-title', (b) => b.textContent)) === '確定收到');
  ok('確認頁：大字寫出名字與金額', (await text('#app')).includes('確定收到') && (await text('#app')).includes('8,500 元？'));
  // 拍一張收據（用合成的 JPEG）
  const jpgPath = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
    const g = c.getContext('2d'); g.fillStyle = '#eee'; g.fillRect(0, 0, 1600, 1200); g.fillStyle = '#000'; g.font = '80px sans-serif'; g.fillText('測試收據', 100, 200);
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const arr = [...new Uint8Array(await b.arrayBuffer())];
    return arr;
  });
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const jpg = path.join(os.tmpdir(), 'rentcheck-test-receipt.jpg');
  fs.writeFileSync(jpg, Buffer.from(jpgPath));
  const fileIn = await page.$('input[type=file]');
  await fileIn.uploadFile(jpg);
  await page.waitForSelector('.thumbs img.thumb', { timeout: 10000 });
  ok('拍收據：出現縮圖', (await page.$$('.thumbs img.thumb')).length === 1);
  await nav(() => page.click('[data-act="confirm"]'));
  // 第一次按「確定收到」就檢查：打勾動畫不能擋住底下的操作（擋住的話，下一次點格子會被吃掉、流程卡住）
  const pe1 = await page.evaluate(() => { const c = document.querySelector('[data-celebrate]'); return c ? getComputedStyle(c).pointerEvents : 'none'; });
  ok('打勾動畫不擋操作（第一次確定收到）', pe1 === 'none', pe1);
  if (pe1 !== 'none') await page.waitForFunction(() => !document.querySelector('[data-celebrate]'), { timeout: 3000 });
  t = await tiles();
  ok('確定收到：那一格變「已收」', t[1].status === 'paid' && t[1].line.includes('已收'), JSON.stringify(t[1]));
  ok('確定收到：還沒傳出的變更 +1', (await settingsVal('changeSeq')) > 0);
  const pay = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('rentcheck'); r.onsuccess = () => { const q = r.result.transaction('payments').objectStore('payments').getAll(); q.onsuccess = () => { res(q.result); r.result.close(); }; }; }));
  ok('收款紀錄帶著照片、照片已壓縮到長邊 1024', pay.length === 1 && pay[0].photoIds.length === 1);
  const ph = await page.evaluate((id) => new Promise((res) => { const r = indexedDB.open('rentcheck'); r.onsuccess = () => { const q = r.result.transaction('photos').objectStore('photos').get(id); q.onsuccess = () => { res({ w: q.result.w, h: q.result.h, type: q.result.type, bytes: q.result.bytes }); r.result.close(); }; }; }), pay[0].photoIds[0]);
  ok('照片是 JPEG、1024×768', ph.type === 'image/jpeg' && ph.w === 1024 && ph.h === 768, JSON.stringify(ph));

  await openTile('2樓之2');
  const paidBtns = await page.$$eval('.tenant-page .btn', (b) => b.map((x) => ({ text: x.textContent, cls: x.className })));
  ok('已收的頁面：沒有主按鈕，「改回沒收到」是次要樣式', paidBtns[0].text.includes('改回') && paidBtns[0].cls.includes('secondary') && !paidBtns.some((x) => !/secondary|back/.test(x.cls)), JSON.stringify(paidBtns));
  ok('已收的頁面：返回在最下面、是返回樣式（不是主按鈕）', paidBtns.at(-1).cls.includes('back') && paidBtns.at(-1).text.includes('回收租表'));
  await nav(() => clickText('button', '改回'));
  t = await tiles();
  ok('改回沒收到：那一格回到「該收了」', t[1].status === 'due', JSON.stringify(t[1]));

  await openTile('2樓之1');
  await nav(() => clickText('a', '記個原因'));
  await nav(() => clickText('button', '說晚點給'));
  t = await tiles();
  ok('記原因：那一格變黃、整句顯示「說晚點給」（不是半句）', t[0].status === 'note' && t[0].line === '！ 說晚點給', JSON.stringify(t[0]));
  await openTile('3樓之1');
  await nav(() => clickText('a', '記個原因'));
  await page.type('textarea', '下個月十號跟下下個月一起給');
  await nav(() => clickText('button', '存起來'));
  t = await tiles();
  ok('長的原因：格子上不顯示半句，顯示「看原因」', t[2].line === '！ 看原因', JSON.stringify(t[2]));
  await openTile('3樓之1');
  ok('長的原因：點進去看得到完整的原因', (await text('.note-box')).includes('下個月十號跟下下個月一起給'));
  await nav(() => clickText('a', '回收租表'));

  // ---- 6. 版面：字放大、畫面變窄都不壞 ----
  // 加了稱呼之後每格三行：照實量每一種寬高×字級，列成表（INFO）；斷言的是「放不下就捲、不縮字、不裁字」
  // 真機的整個螢幕大小（主畫面 App 的內容延伸到狀態列後面），加上狀態列／底部橫條的高度（--safe-top／--safe-bottom 模擬 env()）
  const SIZES = [[390, 844, 47, 34, 'iPhone 12'], [320, 693, 39, 28, 'iPhone 12 開縮放'], [320, 568, 20, 0, 'SE 開縮放']];
  const ROOT_PX = { normal: 18, large: 22, xlarge: 26, xxlarge: 30 };
  const notesById = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('rentcheck'); r.onsuccess = () => { const q = r.result.transaction('payments').objectStore('payments').getAll(); q.onsuccess = () => { res(Object.fromEntries(q.result.map((x) => [x.tenantId, x.note || '']))); r.result.close(); }; }; }));
  for (const [w, hgt, st, sb, dev] of SIZES) {
    const row = [];
    for (const font of ['normal', 'large', 'xlarge', 'xxlarge']) {
      await page.setViewport({ width: w, height: hgt, deviceScaleFactor: 2, isMobile: true });
      await page.evaluate((f, st, sb) => {
        document.querySelector('.preview-banner')?.remove();   // 主畫面 App 沒有這條
        document.documentElement.dataset.font = f;
        document.documentElement.style.setProperty('--safe-top', `${st}px`);
        document.documentElement.style.setProperty('--safe-bottom', `${sb}px`);
        window.scrollTo(0, 0);
      }, font, st, sb);
      await new Promise((r) => setTimeout(r, 150));   // 等底部那一條的高度回報（ResizeObserver）
      const m = await page.evaluate((st, notes) => {
        const ts = [...document.querySelectorAll('.tile')];
        const bar = document.querySelector('[data-footbar]').getBoundingClientRect();
        const title = document.querySelector('.mname').getBoundingClientRect();
        const last = ts[ts.length - 1].getBoundingClientRect();
        // 字被裁＝橫向溢出框外，或框會裁切（overflow 不是 visible）而內容比框大；另外每一行字都不能超出格子本身。
        // （中文字形本身會比行高多 1～2 點，overflow 是 visible 時不會被切掉——那不算。）
        const clipped = ts.some((e) => {
          const tr = e.getBoundingClientRect();
          return [...e.children].some((c) => {
            const cs = getComputedStyle(c), r = c.getBoundingClientRect();
            const cuts = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.textOverflow !== 'clip';
            return c.scrollWidth > c.clientWidth + 1 || (cuts && c.scrollHeight > c.clientHeight + 1) || r.right > tr.right + 1 || r.bottom > tr.bottom + 1;
          });
        });
        const fontPx = parseFloat(getComputedStyle(ts[0].querySelector('.tile-label')).fontSize);
        const nameShown = ts.every((e) => e.querySelector('.tile-name'));
        // 有原因的格子：顯示的要嘛是整句原因、要嘛是「沒收（看原因）」——不能是半句
        const badNotes = ts.filter((e) => e.dataset.status === 'note').map((e) => [notes[e.dataset.tenant], e.querySelector('.tile-status').textContent])
          .filter(([n, shown]) => shown !== `！ ${n}` && shown !== '！ 看原因');
        const res = { titleGap: Math.round(title.top - st), barBottom: Math.round(bar.bottom), barH: Math.round(bar.height), lastBottom: Math.round(last.bottom), h: innerHeight, clipped, fontPx, nameShown, badNotes, hs: document.documentElement.scrollWidth <= innerWidth + 1 };
        window.scrollTo(0, document.documentElement.scrollHeight);
        return res;
      }, st, notesById);
      await new Promise((r) => setTimeout(r, 50));
      const end = await page.evaluate(() => { const ts = [...document.querySelectorAll('.tile')]; return { last: ts[ts.length - 1].getBoundingClientRect().bottom, barTop: document.querySelector('[data-footbar]').getBoundingClientRect().top, barBottom: document.querySelector('[data-footbar]').getBoundingClientRect().bottom }; });
      const fits = m.lastBottom <= m.h - m.barH;
      row.push(`${font} ${m.lastBottom}／${m.h - m.barH}${fits ? '✔' : '✘'}`);
      ok(`${dev}・${font}：格子裡有稱呼、沒有橫向捲動、字沒被裁、原因沒有半句`, m.nameShown && m.hs && !m.clipped && m.badNotes.length === 0, JSON.stringify(m.badNotes));
      ok(`${dev}・${font}：放不下也不縮字（格子字級＝${ROOT_PX[font]}px）`, Math.abs(m.fontPx - ROOT_PX[font]) < 0.5, `${m.fontPx}px`);
      ok(`${dev}・${font}：頁首的月份離狀態列至少 10 點（不黏在一起）`, m.titleGap >= 10, `${m.titleGap}`);
      ok(`${dev}・${font}：「匯出備份／設定」固定在最下面，捲動之後也在`, m.barBottom === m.h && Math.round(end.barBottom) === m.h);
      ok(`${dev}・${font}：捲到底時最後一列完整看得到（在底部那一條上面）`, end.last <= end.barTop + 1, `最後一格底 ${Math.round(end.last)}／底部那一條頂 ${Math.round(end.barTop)}`);
    }
    results.push(`INFO 一屏量測 ${dev}（${w}×${hgt}，狀態列 ${st}、底部橫條 ${sb}）：最後一格的底／可用（扣掉底部那一條）${row.join('｜')}`);
  }
  await page.evaluate(() => { document.documentElement.style.removeProperty('--safe-top'); document.documentElement.style.removeProperty('--safe-bottom'); window.scrollTo(0, 0); });
  await page.setViewport({ width: 320, height: 626, deviceScaleFactor: 2, isMobile: true });
  for (const font of ['normal', 'large', 'xlarge', 'xxlarge']) {
    await page.evaluate((f) => { document.documentElement.dataset.font = f; }, font);
    await openTile('2樓之2');
    const pageOk = await noHScroll();
    await nav(() => clickText('a', '收到了'));
    ok(`320 寬・${font}：點進去的頁面與確認頁沒有橫向捲動`, pageOk && (await noHScroll()));
    await nav(() => page.evaluate(() => { location.hash = '#/'; }));
  }
  await page.evaluate(() => { document.documentElement.dataset.font = 'large'; });
  await page.setViewport({ width: 390, height: 763, deviceScaleFactor: 2, isMobile: true });
  // Chromium 的行動模擬在切換視窗大小後會留下頁面縮放（重新載入也清不掉）；直接把縮放設回 1
  { const cdp = await page.createCDPSession(); await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await cdp.detach(); }

  // ---- 6a. 詳情頁排版（2026-10-08 Yolin：地址被斷成「…永和路60／號1樓」、間距不一致；電話膠囊變兩行、號碼貼邊、超出對齊線）。兩種寬度＋每一種字級 ----
  for (const [vw, vh] of [[390, 763], [320, 626]]) {
  await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 2, isMobile: true });
  for (const font of ['normal', 'large', 'xlarge', 'xxlarge']) {
    await page.evaluate((f) => { document.documentElement.dataset.font = f; }, font);
    await openTile('3樓之2');
    const L = await page.evaluate(() => {
      const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
      // 地址的每一段（「中山路」「12號」「3樓之2」）都在同一行：數字和單位沒被拆開（一段本身比整行還寬時例外）
      const parts = [...document.querySelectorAll('.detail .addr-part')];
      const split = parts.filter((p) => lines(p) > 1 && p.getBoundingClientRect().width < p.parentElement.getBoundingClientRect().width - 1).map((p) => p.textContent);
      // 三層之間的間距一樣
      const kids = [...document.querySelector('.detail').children].filter((k) => k.getBoundingClientRect().height > 0);
      const gaps = kids.slice(1).map((k, i) => Math.round(k.getBoundingClientRect().top - kids[i].getBoundingClientRect().bottom));
      // 資料欄的內容都對齊同一條線
      const lefts = new Set([...document.querySelectorAll('.info dd')].map((d) => Math.round(d.getBoundingClientRect().left)));
      // 電話那一列和其他列同一個節奏：號碼一行、不超出右欄、不是膠囊（沒有框和底色）、和「繳租日」那一列一樣高
      const a = document.querySelector('a.phone'); const dd = a.closest('dd'); const cs = getComputedStyle(a);
      const ddOf = (k) => [...document.querySelectorAll('.info dt')].find((x) => x.textContent === k).nextElementSibling;
      const phone = { lines: lines(a.querySelector('.num')), inCol: a.getBoundingClientRect().right <= dd.getBoundingClientRect().right + 0.5 && dd.getBoundingClientRect().right <= document.querySelector('.detail').getBoundingClientRect().right,
        pill: cs.borderTopStyle !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)', dh: Math.round(dd.getBoundingClientRect().height - ddOf('繳租日').getBoundingClientRect().height), tapH: Math.round(a.getBoundingClientRect().height) };
      return { parts: parts.length, split, gaps, lefts: lefts.size, phone, hs: document.documentElement.scrollWidth <= innerWidth + 1 };
    });
    ok(`${vw} 寬・${font}：詳情頁的地址沒有把數字和單位拆開、資料對齊同一條線、三層間距一樣、沒有橫向捲動`,
      L.parts >= 3 && L.split.length === 0 && L.lefts === 1 && L.gaps.length >= 2 && Math.max(...L.gaps) - Math.min(...L.gaps) <= 1 && L.hs, JSON.stringify(L));
    ok(`${vw} 寬・${font}：電話那一列和其他列同一個節奏（號碼一行、在右欄裡、不是膠囊、和繳租日那列一樣高）`,
      L.phone.lines === 1 && L.phone.inCol && !L.phone.pill && Math.abs(L.phone.dh) <= 2, JSON.stringify(L.phone));
    ok(`${vw} 寬・${font}：電話號碼可點的範圍至少 44 點高`, L.phone.tapH >= 44, `${L.phone.tapH}`);
    await nav(() => clickText('a', '回收租表'));
  }
  }
  // 上面四種字級剛好不一定會斷在「12號」中間：把地址欄從很窄掃到很寬（每 2 點一次），任何寬度都不能把一段拆開
  await page.evaluate(() => { document.documentElement.dataset.font = 'large'; });
  await openTile('3樓之2');
  const sweep = await page.evaluate(() => {
    const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
    const info = document.querySelector('.info'); const bad = [];
    for (let w = 30; w <= 260; w += 2) {
      info.style.gridTemplateColumns = `max-content ${w}px`;
      for (const p of document.querySelectorAll('.info .addr-part')) if (lines(p) > 1 && p.getBoundingClientRect().width < w - 1) bad.push(`${w}px:${p.textContent}`);
      const num = document.querySelector('.info a.phone .num'); if (num && lines(num) > 1) bad.push(`${w}px:電話 ${num.textContent}`);
    }
    info.style.gridTemplateColumns = '';
    return bad;
  });
  ok('任何寬度：詳情頁的地址沒有把數字和單位拆開、電話號碼不從中間斷開（資料欄 30～260 點，每 2 點量一次）', sweep.length === 0, sweep.slice(0, 5).join('、'));
  await nav(() => clickText('a', '回收租表'));
  await page.setViewport({ width: 390, height: 763, deviceScaleFactor: 2, isMobile: true });
  { const cdp = await page.createCDPSession(); await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await cdp.detach(); }

  // ---- 6b. 電話（第一個新增的租客「3樓之2」有填電話） ----
  await openTile('3樓之2');
  const tel = await page.evaluate(() => { const a = document.querySelector('a.phone'); return a ? { href: a.getAttribute('href'), text: a.textContent } : null; });
  ok('有填電話的租客：詳情頁有電話，按了直接撥（tel:）', !!tel && tel.href === 'tel:0900000111' && tel.text.includes('0900-000-111'), JSON.stringify(tel));
  ok('詳情頁：顯示完整地址', (await page.$$eval('.info dd', (d) => d.map((x) => x.textContent))).includes('中山路12號3樓之2'));
  // 最容易斷開的情況：最窄（320）＋最大字（超大）。號碼要在同一行，整顆電話鍵要在卡片裡面
  await page.setViewport({ width: 320, height: 626, deviceScaleFactor: 2, isMobile: true });
  await page.evaluate(() => { document.documentElement.dataset.font = 'xxlarge'; });
  await new Promise((r) => setTimeout(r, 100));
  const telBox = await page.evaluate(() => { const n = document.querySelector('a.phone .num'); const a = n.closest('a.phone'); const c = n.closest('.card'); const r = document.createRange(); r.selectNodeContents(n); return { lines: new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size, inCard: a.getBoundingClientRect().right <= c.getBoundingClientRect().right + 0.5 }; });
  ok('320 寬＋超大字：電話鍵在卡片裡面（不凸出去）', telBox.inCard, JSON.stringify(telBox));
  const telLines = telBox.lines;
  await page.evaluate(() => { document.documentElement.dataset.font = 'large'; });
  await page.setViewport({ width: 390, height: 763, deviceScaleFactor: 2, isMobile: true });
  { const cdp = await page.createCDPSession(); await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await cdp.detach(); }
  ok('電話號碼不從中間斷開（整個號碼在同一行）', telLines === 1, String(telLines));
  await nav(() => clickText('a', '回收租表'));
  await openTile('2樓之2');
  ok('沒填電話的租客：不顯示電話那一列', (await page.$('a.phone')) === null && !(await page.$$eval('.info dt', (d) => d.map((x) => x.textContent))).includes('電話'));
  const unpaidBtns = await page.$$eval('.tenant-page .btn', (b) => b.map((x) => ({ text: x.textContent, cls: x.className })));
  ok('該收的頁面：主按鈕是「收到了」、返回在最下面而且是返回樣式', unpaidBtns[0].text.includes('收到了') && !/secondary|back/.test(unpaidBtns[0].cls) && unpaidBtns.at(-1).cls.includes('back') && unpaidBtns.at(-1).text.includes('回收租表'), JSON.stringify(unpaidBtns));
  await nav(() => clickText('a', '回收租表'));

  // ---- 7. 收齊 → 問一次要不要匯出 → 分享畫面 ----
  for (const label of ['2樓之1', '2樓之2', '3樓之1', '3樓之2', '4樓之1', '4樓之2', '5樓', '6樓', '7樓', '10樓']) {
    await openTile(label);
    await nav(() => clickText('a', '收到了'));
    await nav(() => page.click('[data-act="confirm"]'));
  }
  const cel = await page.evaluate(() => { const c = document.querySelector('[data-celebrate]'); return c ? { pe: getComputedStyle(c).pointerEvents, text: c.textContent } : null; });
  ok('確定收到：出現打勾動畫，寫著「收到了」和剛按的那一戶的門牌、金額', !!cel && cel.text.includes('收到了') && cel.text.includes('10樓') && cel.text.includes('6,500'), JSON.stringify(cel));
  ok('連續按好幾戶時，打勾動畫不會疊好幾層', (await page.$$('[data-celebrate]')).length === 1);
  ok('打勾動畫不擋操作（pointer-events: none）', !!cel && cel.pe === 'none');
  await page.waitForFunction(() => !document.querySelector('[data-celebrate]'), { timeout: 3000 });
  ok('打勾動畫自己消失（不用按）', true);
  ok('最後一戶收齊：問「要不要匯出一份備份」', (await page.evaluate(() => location.hash)).startsWith('#/done/') && (await text('#app')).includes('收齊了'));
  ok('收齊提示：不指定對象', !/晚輩|家人|LINE/.test(await text('#app')));
  await nav(() => clickText('a', '匯出備份'));
  ok('匯出頁：不指定對象與管道', !/晚輩|家人|LINE|Keep/.test(await text('#app')));
  await page.waitForFunction(() => !document.querySelector('[data-act="share"]').disabled, { timeout: 15000 });
  const seqBefore = await settingsVal('changeSeq');
  await page.click('[data-act="share"]');
  await page.waitForFunction(() => window.__shared.length === 1, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.result') && document.querySelector('.result').dataset.result, { timeout: 5000 });
  const okMsg = await page.$eval('.result', (e) => ({ kind: e.dataset.result, text: e.textContent }));
  ok('匯出成功：明確寫「備份已匯出」、檔名、存在 App 以外', okMsg.kind === 'shared' && okMsg.text.includes('備份已匯出') && okMsg.text.includes('收租紀錄_') && okMsg.text.includes('App 以外'), okMsg.text.slice(0, 60));
  const shared = await page.evaluate(() => window.__shared[0]);
  ok('分享出去的是 .html 備份檔', shared.name.endsWith('.html') && shared.text.includes('rentcheck-backup'), shared.name);
  ok('備份檔帶著收據照片', /"photos":\[\{"id":"ph-/.test(shared.text));
  ok('分享成功：已匯出的位置＝當時的變更序號', (await settingsVal('backedUpSeq')) === seqBefore);
  ok('分享成功：記下上次匯出時間', !!(await settingsVal('lastBackupAt')));
  await nav(() => page.evaluate(() => { location.hash = '#/'; }));
  const fb = await page.evaluate(() => { const b = document.querySelector('[data-act="foot-backup"]'); const sub = b && b.querySelector('[data-last-backup]'); return { sub: sub ? sub.textContent : null, inBtn: !!sub, para: !!document.querySelector('.last-backup') }; });
  ok('匯出之後：「匯出備份」按鈕的第二行寫「上次 10/7」（不再另外占一行）', fb.inBtn && fb.sub === '上次 10/7' && !fb.para, JSON.stringify(fb));

  // 取消分享 → 不算傳出
  await page.evaluate(() => sessionStorage.setItem('__shareMode', 'cancel'));
  await openTile('10樓');
  await nav(() => clickText('button', '改回'));
  await nav(() => page.evaluate(() => { location.hash = '#/backup'; }));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('[data-act="share"]') && !document.querySelector('[data-act="share"]').disabled, { timeout: 15000 });
  const bu = await settingsVal('backedUpSeq');
  await page.click('[data-act="share"]');
  await page.waitForFunction(() => document.querySelector('.result') && document.querySelector('.result').dataset.result, { timeout: 5000 });
  const cMsg = await page.$eval('.result', (e) => ({ kind: e.dataset.result, text: e.textContent }));
  ok('取消：明確寫「沒有匯出」，和成功分得出來', cMsg.kind === 'cancelled' && cMsg.text.includes('✘ 沒有匯出') && !cMsg.text.includes('已匯出'), cMsg.text.slice(0, 40));
  ok('取消：匯出按鈕還在，可以再按一次', !(await page.$eval('[data-act="share"]', (b) => b.hidden || b.disabled)));
  ok('對照組：按了取消 → 不算匯出', (await settingsVal('backedUpSeq')) === bu);
  await page.evaluate(() => sessionStorage.setItem('__shareMode', 'ok'));

  // ---- 8. 設定頁：「如果現在被清掉，會損失多少」 ----
  await nav(() => page.evaluate(() => { location.hash = '#/'; }));
  await nav(() => hold(HOLD));
  const safety = await text('[data-section="safety"]');
  ok('設定頁：寫出「如果現在被清掉，會損失 1 筆變更」', safety.includes('會損失') && safety.includes('1 筆變更'), safety.slice(0, 160).replace(/\s+/g, ' '));
  const persistedNow = await page.evaluate(() => navigator.storage.persisted());
  ok('設定頁：iPhone 沒答應保留資料時才顯示（沒問題就不顯示）', persistedNow ? !safety.includes('保留資料') : safety.includes('還沒答應保留'), String(persistedNow));
  ok('設定頁：資料安全不顯示技術細節（已用空間、請求時間）', !/已用空間|上次請求|MB/.test(safety), safety.replace(/\s+/g, ' ').slice(0, 120));
  const logInfo = await page.evaluate(() => { const sec = document.querySelector('[data-section="log"]'); const d = sec.querySelector('details'); return { shown: [...sec.querySelectorAll(':scope > ul > li')].length, more: d ? d.querySelectorAll('li').length : 0, open: d ? d.open : false }; });
  ok('異動紀錄：只列最近 3 筆，更早的收起來（預設不展開）', logInfo.shown === 3 && logInfo.more > 0 && !logInfo.open, JSON.stringify(logInfo));
  await page.waitForFunction(() => document.querySelector('.fit') && document.querySelector('.fit').dataset.fits, { timeout: 10000 });
  // 預覽說實話：設定頁說「放得下／放不下」，要和收租表實際量到的一致（不寫死一定放得下——加了底部那一條之後，這個視窗大小就放不下）
  const claimed = await page.$eval('.fit', (e) => e.dataset.fits);
  await nav(() => page.click('[data-act="exit"]'));
  await new Promise((r) => setTimeout(r, 150));
  const actual = await page.evaluate(() => { window.scrollTo(0, 0); const ts = [...document.querySelectorAll('.tile')]; const banner = document.querySelector('.preview-banner'); const bh = banner ? banner.getBoundingClientRect().height : 0; return String(ts[ts.length - 1].getBoundingClientRect().bottom - bh <= innerHeight - document.querySelector('[data-footbar]').offsetHeight); });
  ok('設定頁的「一屏放不放得下」和收租表實際量到的一致', claimed === actual, `設定頁說 ${claimed}／實際 ${actual}`);
  await nav(() => hold(HOLD));
  await setMetaV('lastBackupAt', new Date((await pageNow()) - 29 * 86400000).toISOString());

  // ---- 9. 提醒：超過 30 天沒傳、而且有新紀錄 ----
  await nav(() => page.click('[data-act="exit"]'));
  ok('29 天前才匯出過：沒有提醒', (await page.$('.remind')) === null);
  await setMetaV('lastBackupAt', new Date((await pageNow()) - 31 * 86400000).toISOString());
  await reload();
  ok('超過 30 天沒匯出、之後有新紀錄：格子上方出現溫和的提醒', (await page.$('.remind')) !== null && !/遺失|危險|刪除/.test(await text('.remind')));
  const remindH = await page.$eval('.remind', (e) => e.getBoundingClientRect().height);
  ok('提醒條不超過兩行（不把房間格擠出去太多）', remindH <= 2 * 22 * 1.3 + 20, `${remindH}px`);
  await nav(() => page.click('.remind'));
  await nav(() => clickText('button', '這週先不要'));
  ok('「這週先不要」：回到收租表、提醒消失', (await page.$('.remind')) === null && (await page.$$('.tile')).length === 10);

  // ---- 9b. 外觀與動畫 ----
  await nav(() => hold(HOLD));
  for (const th of ['sky', 'forest', 'warm']) {
    await nav(() => page.click(`[data-theme="${th}"]`));
    ok(`切換外觀「${th}」：套用到整個 App，而且記住`, (await page.evaluate(() => document.documentElement.dataset.theme)) === th && (await settingsVal('theme')) === th);
  }
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await nav(() => page.click('[data-act="exit"]'));
  const rm = await page.evaluate(() => ({ page: getComputedStyle(document.querySelector('.page')).animationName, tile: getComputedStyle(document.querySelector('.tile')).transitionDuration }));
  ok('iPhone 開了「減少動態效果」：頁面不淡入、格子按下去不縮', rm.page === 'none' && /^0s/.test(rm.tile), JSON.stringify(rm));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await reload();
  const on = await page.evaluate(() => getComputedStyle(document.querySelector('.page')).animationName);
  ok('對照組：沒開「減少動態效果」時有動畫', on === 'page-in', on);
  await nav(() => hold(HOLD));
  await nav(() => page.click('[data-motion="off"]'));
  await nav(() => page.click('[data-act="exit"]'));
  const off = await page.evaluate(() => ({ attr: document.documentElement.dataset.motion, page: getComputedStyle(document.querySelector('.page')).animationName }));
  ok('設定裡關掉動畫：整個 App 都不動', off.attr === 'off' && off.page === 'none', JSON.stringify(off));
  await nav(() => hold(HOLD));
  await nav(() => page.click('[data-motion="auto"]'));
  await nav(() => page.click('[data-act="exit"]'));

  // ---- 10. 資料被清掉 → 用備份找回 ----
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('rentcheck'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
  await page.reload({ waitUntil: 'networkidle0' });
  ok('資料被清掉：首頁顯示「從備份找回」', (await text('#app')).includes('從備份找回'));
  await nav(() => clickText('a', '從備份找回'));
  const bpath = path.join(os.tmpdir(), 'rentcheck-test-backup.html');
  fs.writeFileSync(bpath, shared.text);
  await (await page.$('input[type=file]')).uploadFile(bpath);
  await page.waitForFunction(() => document.body.textContent.includes('備份檔完整'), { timeout: 15000 });
  ok('選了備份檔：顯示「完整」與內容摘要', (await text('#app')).includes('10 位租客'));
  ok('還沒輸入「找回」：按鈕不能按', await page.$eval('[data-act="restore"]', (b) => b.disabled));
  await page.type('input[placeholder*="找回"]', '找回');
  await page.click('[data-act="restore"]');
  await page.waitForFunction(() => document.body.textContent.includes('找回完成'), { timeout: 15000 });
  ok('找回後：內容與備份完全相同', (await text('#app')).includes('完全相同'));
  await nav(() => clickText('a', '回收租表'));
  t = await tiles();
  ok('找回後：10 格全部是「已收」（和備份當時一樣）', t.length === 10 && t.every((x) => x.status === 'paid'), t.map((x) => x.status).join(','));
  ok('找回後：「上次匯出」＝備份的時間、沒有未匯出的變更', (await settingsVal('changeSeq')) === 0 && !!(await settingsVal('lastBackupAt')));

  // ---- 11. 手機上已有資料時找回：一定要先存一份目前的 ----
  await nav(() => hold(HOLD));
  await nav(() => clickText('a', '從備份找回'));
  await (await page.$('input[type=file]')).uploadFile(bpath);
  await page.waitForFunction(() => document.body.textContent.includes('備份檔完整'), { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('[data-act="save-current"]') && !document.querySelector('[data-act="save-current"]').disabled, { timeout: 15000 });
  await page.type('input[placeholder*="找回"]', '找回');
  ok('已有資料：沒先匯出一份目前的，就算輸入「找回」也不能按', await page.$eval('[data-act="restore"]', (b) => b.disabled));
  const n0 = await page.evaluate(() => window.__shared.length);
  await page.click('[data-act="save-current"]');
  await page.waitForFunction((n) => window.__shared.length > n, { timeout: 15000 }, n0);
  await page.waitForFunction(() => !document.querySelector('[data-act="restore"]').disabled, { timeout: 5000 });
  ok('已有資料：匯出一份之後才能按', true);

  ok('走過的每個畫面都沒有「晚輩」「家人」', seenWords.size === 0, [...seenWords].join('、'));
  const backAsPrimary = await page.evaluate(() => window.__backPrimary || []);
  ok('走過的每一頁：「回收租表／回上一頁／回設定」都不是主按鈕', backAsPrimary.length === 0, [...new Set(backAsPrimary)].join('；'));
  const emoji = await page.evaluate(() => window.__emoji);
  ok('走過的每個畫面都沒有 emoji 字元（圖示都是跟著文字顏色的 SVG）', emoji.length === 0, [...new Set(emoji)].slice(0, 5).join('；'));
  const garbage = await page.evaluate(() => window.__garbage);
  ok('走過的每個畫面都沒有出現 null／undefined／NaN（含畫完後才補上的內容）', garbage.length === 0, [...new Set(garbage)].slice(0, 5).join('；'));
  ok('全程沒有 JavaScript 錯誤', errors.length === 0, errors.join(' | '));
} catch (e) {
  ok('測試流程中斷', false, e.stack || String(e));
} finally {
  await browser.close();
  server.close();
}
console.log(results.join('\n'));
console.log(fail ? `\n${fail} 項失敗` : `\n全部通過（${results.length} 項）`);
process.exit(fail ? 1 : 0);
