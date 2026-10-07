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
async function hold(ms) {
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
    await page.$eval('input[name="dueDay"]', (e, v) => { e.value = v; }, String(i % 2 ? 5 : 20)); // 一半 5 號、一半 20 號
    await nav(() => page.click('[data-act="save-tenant"]'));
  }
  const listText = await text('.tenant-list');
  ok('設定頁：10 戶依門牌自然排序', ['2樓之1', '2樓之2', '3樓之1', '3樓之2', '4樓之1', '4樓之2', '5樓', '6樓', '7樓', '10樓'].every((l, i, a) => i === 0 || listText.indexOf(a[i - 1]) < listText.indexOf(l)));
  ok('格子名稱自動去掉共同的「中山路12號」（包含第一戶）', !listText.includes('中山路12號'));

  await nav(() => page.click('[data-act="exit"]'));
  let t = await tiles();
  ok('收租表：10 格', t.length === 10, String(t.length));
  ok('收租表：位置照門牌排', t.map((x) => x.label).join(',') === '2樓之1,2樓之2,3樓之1,3樓之2,4樓之1,4樓之2,5樓,6樓,7樓,10樓', t.map((x) => x.label).join(','));
  ok('剛設定完：還不會出現「匯出備份」提醒', (await page.$('.remind')) === null);
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

  // ---- 4. 按住 3 秒才進得去設定 ----
  await hold(400);
  await new Promise((r) => setTimeout(r, 300));
  ok('只按一下：不會進設定', (await page.evaluate(() => location.hash)) !== '#/settings');
  ok('只按一下：提示「要按住 3 秒」', (await page.$eval('body', (b) => b.textContent)).includes('要按住 3 秒'));
  await nav(() => hold(3300));
  ok('按住 3 秒：進入設定', (await page.evaluate(() => location.hash)) === '#/settings');
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

  // ---- 5. 確認收款、改回、記原因 ----
  const tileOf = (label) => page.$$eval('.tile', (els, l) => els.findIndex((e) => e.querySelector('.tile-label').textContent === l), label);
  const openTile = async (label) => { const i = await tileOf(label); await nav(async () => (await page.$$('.tile'))[i].click()); };
  await openTile('2樓之2');
  // 2樓之2 是第 6 戶（index 5）：月租 6000+5×500＝8,500、5 號繳
  ok('點格子：顯示金額與繳款日', (await text('#app')).includes('8,500 元') && (await text('#app')).includes('每月 5 號繳'));
  await nav(() => clickText('a', '收到了'));
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
  t = await tiles();
  ok('確定收到：那一格變「已收」', t[1].status === 'paid' && t[1].line.includes('已收'), JSON.stringify(t[1]));
  ok('確定收到：還沒傳出的變更 +1', (await settingsVal('changeSeq')) > 0);
  const pay = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('rentcheck'); r.onsuccess = () => { const q = r.result.transaction('payments').objectStore('payments').getAll(); q.onsuccess = () => { res(q.result); r.result.close(); }; }; }));
  ok('收款紀錄帶著照片、照片已壓縮到長邊 1024', pay.length === 1 && pay[0].photoIds.length === 1);
  const ph = await page.evaluate((id) => new Promise((res) => { const r = indexedDB.open('rentcheck'); r.onsuccess = () => { const q = r.result.transaction('photos').objectStore('photos').get(id); q.onsuccess = () => { res({ w: q.result.w, h: q.result.h, type: q.result.type, bytes: q.result.bytes }); r.result.close(); }; }; }), pay[0].photoIds[0]);
  ok('照片是 JPEG、1024×768', ph.type === 'image/jpeg' && ph.w === 1024 && ph.h === 768, JSON.stringify(ph));

  await openTile('2樓之2');
  ok('已收的頁面：第二顆才是「改回沒收到」', (await page.$$eval('.tenant-page .btn', (b) => b.map((x) => x.textContent)))[1].includes('改回'));
  await nav(() => clickText('button', '改回'));
  t = await tiles();
  ok('改回沒收到：那一格回到「該收了」', t[1].status === 'due', JSON.stringify(t[1]));

  await openTile('2樓之1');
  await nav(() => clickText('a', '記個原因'));
  await nav(() => clickText('button', '說晚點給'));
  t = await tiles();
  ok('記原因：那一格變黃、顯示原因前三個字', t[0].status === 'note' && t[0].line === '！ 說晚點', JSON.stringify(t[0]));

  // ---- 6. 版面：字放大、畫面變窄都不壞 ----
  const fitCases = [
    // [寬, 高, 字級, 設計草案 §3.3 表說一屏放得下嗎]
    [390, 763, 'normal', true], [390, 763, 'large', true], [390, 763, 'xlarge', true], [390, 763, 'xxlarge', true],
    [320, 626, 'normal', true], [320, 626, 'large', true], [320, 626, 'xlarge', true],
    [320, 548, 'large', true],
  ];
  for (const [w, hgt, font, expectFit] of fitCases) {
    await page.setViewport({ width: w, height: hgt, deviceScaleFactor: 2, isMobile: true });
    await page.evaluate((f) => { document.documentElement.dataset.font = f; }, font);
    await new Promise((r) => setTimeout(r, 50));
    const m = await page.evaluate(() => {
      const ts = [...document.querySelectorAll('.tile')];
      const last = ts[ts.length - 1].getBoundingClientRect();
      const labelsOk = ts.every((e) => { const l = e.querySelector('.tile-label'); return l.scrollWidth <= l.clientWidth + 1; });
      const statusOk = ts.every((e) => { const s = e.querySelector('.tile-status'); return s.scrollWidth <= s.clientWidth + 1; });
      return { bottom: Math.round(last.bottom + scrollY), h: innerHeight, labelsOk, statusOk, hs: document.documentElement.scrollWidth <= innerWidth + 1 };
    });
    // 預覽模式的紅色橫條只出現在瀏覽器分頁，主畫面 App 沒有；扣掉它的高度再比
    const banner = await page.evaluate(() => { const b = document.querySelector('.preview-banner'); return b ? b.getBoundingClientRect().height : 0; });
    const fits = m.bottom - banner <= m.h;
    if (expectFit) ok(`${w}×${hgt}・${font}：10 格一屏放得下`, fits, `最後一格底 ${m.bottom - banner} / 可用 ${m.h}`);
    ok(`${w}×${hgt}・${font}：沒有橫向捲動、格子裡的字沒被裁`, m.hs && m.labelsOk && m.statusOk);
  }
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

  // ---- 7. 收齊 → 問一次要不要匯出 → 分享畫面 ----
  for (const label of ['2樓之1', '2樓之2', '3樓之1', '3樓之2', '4樓之1', '4樓之2', '5樓', '6樓', '7樓', '10樓']) {
    await openTile(label);
    await nav(() => clickText('a', '收到了'));
    await nav(() => page.click('[data-act="confirm"]'));
  }
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
  ok('匯出成功：明確寫「備份已匯出」、檔名、存在 App 以外', okMsg.kind === 'shared' && okMsg.text.includes('✔ 備份已匯出') && okMsg.text.includes('收租紀錄_') && okMsg.text.includes('App 以外'), okMsg.text.slice(0, 60));
  const shared = await page.evaluate(() => window.__shared[0]);
  ok('分享出去的是 .html 備份檔', shared.name.endsWith('.html') && shared.text.includes('rentcheck-backup'), shared.name);
  ok('備份檔帶著收據照片', /"photos":\[\{"id":"ph-/.test(shared.text));
  ok('分享成功：已匯出的位置＝當時的變更序號', (await settingsVal('backedUpSeq')) === seqBefore);
  ok('分享成功：記下上次匯出時間', !!(await settingsVal('lastBackupAt')));

  // 取消分享 → 不算傳出
  await page.evaluate(() => sessionStorage.setItem('__shareMode', 'cancel'));
  await nav(() => page.evaluate(() => { location.hash = '#/'; }));
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
  await nav(() => hold(3300));
  const safety = await text('.settings .card');
  ok('設定頁：寫出「如果現在被清掉，會損失 1 筆變更」', safety.includes('會損失') && safety.includes('1 筆變更'), safety.slice(0, 160).replace(/\s+/g, ' '));
  ok('設定頁：顯示持久儲存的狀態', safety.includes('持久儲存'));
  await page.waitForFunction(() => document.querySelector('.fit') && document.querySelector('.fit').dataset.fits, { timeout: 10000 });
  ok('設定頁：字級預覽量得出「一屏放得下」', (await page.$eval('.fit', (e) => e.dataset.fits)) === 'true');
  await setMetaV('lastBackupAt', new Date(Date.now() - 29 * 86400000).toISOString());

  // ---- 9. 提醒：超過 30 天沒傳、而且有新紀錄 ----
  await nav(() => page.click('[data-act="exit"]'));
  ok('29 天前才匯出過：沒有提醒', (await page.$('.remind')) === null);
  await setMetaV('lastBackupAt', new Date(Date.now() - 31 * 86400000).toISOString());
  await reload();
  ok('超過 30 天沒匯出、之後有新紀錄：格子上方出現溫和的提醒', (await page.$('.remind')) !== null && !/遺失|危險|刪除/.test(await text('.remind')));
  const remindH = await page.$eval('.remind', (e) => e.getBoundingClientRect().height);
  ok('提醒條不超過兩行（不把房間格擠出去太多）', remindH <= 2 * 22 * 1.3 + 20, `${remindH}px`);
  await nav(() => page.click('.remind'));
  await nav(() => clickText('button', '這週先不要'));
  ok('「這週先不要」：回到收租表、提醒消失', (await page.$('.remind')) === null && (await page.$$('.tile')).length === 10);

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
  await nav(() => clickText('a', '回到收租表'));
  t = await tiles();
  ok('找回後：10 格全部是「已收」（和備份當時一樣）', t.length === 10 && t.every((x) => x.status === 'paid'), t.map((x) => x.status).join(','));
  ok('找回後：「上次匯出」＝備份的時間、沒有未匯出的變更', (await settingsVal('changeSeq')) === 0 && !!(await settingsVal('lastBackupAt')));

  // ---- 11. 手機上已有資料時找回：一定要先存一份目前的 ----
  await nav(() => hold(3300));
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
