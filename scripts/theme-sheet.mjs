// 三套外觀的比較圖（給 Yolin 挑）：.logs/themes/外觀三選一.png，以及每個畫面的單張截圖、打勾動畫的逐格圖。
// 用法：node scripts/theme-sheet.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from './serve.mjs';

const OUT = fileURLToPath(new URL('../.logs/themes/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const THEMES = [['warm', 'A　暖陽'], ['sky', 'B　晴空'], ['forest', 'C　森林']];
const server = createServer();
await new Promise((r) => server.listen(5202, '127.0.0.1', r));
const browser = await puppeteer.launch({ headless: true });
const p = await browser.newPage();
// iPhone 12 的整個螢幕（主畫面 App 延伸到狀態列後面），狀態列 47、底部橫條 34
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
const SAFE = () => p.evaluate(() => { document.documentElement.style.setProperty('--safe-top', '47px'); document.documentElement.style.setProperty('--safe-bottom', '34px'); });
await p.goto('http://127.0.0.1:5202/');
await p.evaluate(() => sessionStorage.setItem('rentcheck-preview', '1'));
await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('rentcheck'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await p.reload({ waitUntil: 'networkidle0' });
const ids = await p.evaluate(async () => {
  const st = await import('/js/store.js');
  const floors = ['2樓之1', '2樓之2', '3樓之1', '3樓之2', '4樓', '5樓', '6樓', '7樓', '8樓', '10樓'];
  const names = ['王先生', '李小姐', '陳太太', '林先生', '黃同學', '吳小姐', '張先生', '劉阿姨', '蔡先生', '鄭小姐'];
  for (let i = 0; i < 10; i++) await st.addTenant({ address: `中山路60號${floors[i]}`, label: '', labelAuto: true, name: names[i], rent: 6000 + i * 500, dueDay: i % 2 ? 5 : 20, startMonth: '2026-01', phone: i === 1 ? '0900-000-111' : '' });
  const ts = await st.tenants();
  const ym = (await import('/js/months.js')).ymOf();
  for (const i of [2, 5, 8]) await st.markPaid(ts[i], ym, { amount: ts[i].rent });
  await st.setNote(ts[0], ym, '說月底給');
  return { ids: ts.map((t) => t.id), ym };
});
// 截圖時把頁面的進場動畫跳到結尾（截到的是動畫結束後的樣子）
// 正式從主畫面打開時沒有「預覽模式」紅條；截圖時拿掉，免得誤導審美判斷
const settle = async () => { await SAFE(); await p.evaluate(() => { document.querySelectorAll('.preview-banner').forEach((x) => x.remove()); document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }); }); await new Promise((r) => setTimeout(r, 120)); };
const go = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await new Promise((r) => setTimeout(r, 500)); await settle(); };
for (const [th] of THEMES) {
  await p.evaluate(async (th) => { const st = await import('/js/store.js'); await st.setMeta('theme', th); }, th);
  await p.reload({ waitUntil: 'networkidle0' });
  await go('#/'); await p.screenshot({ path: `${OUT}${th}-1-grid.png` });
  // 給自己看的：實際大小（1 倍）＋輕度模糊
  { const sm = await browser.newPage(); await sm.setViewport({ width: 390, height: 763, deviceScaleFactor: 1, isMobile: true }); await sm.goto('http://127.0.0.1:5202/#/', { waitUntil: 'networkidle0' }); await sm.evaluate(() => sessionStorage.setItem('rentcheck-preview', '1')); await sm.reload({ waitUntil: 'networkidle0' }); await new Promise((r) => setTimeout(r, 500)); await sm.evaluate(() => { document.querySelectorAll('.preview-banner').forEach((x) => x.remove()); document.getAnimations().forEach((a) => a.finish()); document.documentElement.style.filter = 'blur(1.5px)'; }); await sm.screenshot({ path: `${OUT}${th}-blur.png` }); await sm.close(); }
  await go(`#/t/${ids.ids[1]}/${ids.ym}`); await p.screenshot({ path: `${OUT}${th}-2-tenant.png` });
  await go(`#/t/${ids.ids[2]}/${ids.ym}`); await p.screenshot({ path: `${OUT}${th}-2b-paid.png` });
  await go('#/');
  // 打勾動畫：在收租表上叫出來，停在結尾那一格
  await p.evaluate(async () => { const ui = await import('/js/ui.js'); ui.celebrate('收到了！', '2樓之2　李小姐　6,500 元'); });
  await new Promise((r) => setTimeout(r, 60));
  await p.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 400; }));
  await p.screenshot({ path: `${OUT}${th}-3-celebrate.png` });
  await p.evaluate(() => document.querySelectorAll('[data-celebrate]').forEach((x) => x.remove()));
  await p.evaluate(async () => (await import('/js/app.js')).enterEdit());
  await new Promise((r) => setTimeout(r, 600)); await settle();
  await p.evaluate(() => [...document.querySelectorAll('h2')].find((x) => x.textContent === '外觀').scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: `${OUT}${th}-4-settings.png` });
  await p.evaluate(async () => (await import('/js/app.js')).exitEdit());
}
// 打勾動畫逐格（暖陽）：0／60／120／180／240／280ms
await p.evaluate(async () => { const st = await import('/js/store.js'); await st.setMeta('theme', 'warm'); });
await p.reload({ waitUntil: 'networkidle0' }); await go('#/');
const frames = [];
for (const t of [0, 60, 120, 180, 240, 280]) {
  await p.evaluate(async (t) => {
    document.querySelectorAll('[data-celebrate]').forEach((x) => x.remove());
    const ui = await import('/js/ui.js'); ui.celebrate('收到了！', '2樓之2　李小姐　6,500 元');
    document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; });
  }, t);
  const card = await p.$('.cel-card');
  const f = `${OUT}frame-${t}.png`;
  await card.screenshot({ path: f });
  frames.push([t, f]);
}
await p.evaluate(() => document.querySelectorAll('[data-celebrate]').forEach((x) => x.remove()));

// 合成比較圖
const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const ROWS = [['1-grid', '收租表（最下面固定「匯出備份／設定」）'], ['2-tenant', '點進一戶（該收；有電話）'], ['2b-paid', '點進一戶（已收）'], ['3-celebrate', '按下「確定收到」那一刻'], ['4-settings', '設定裡的「外觀」']];
const sheet = await browser.newPage();
await sheet.setViewport({ width: 1240, height: 800, deviceScaleFactor: 1 });
await sheet.setContent(`<html><body style="margin:0;padding:24px;background:#fff;font:20px/1.4 'Microsoft JhengHei',sans-serif;color:#111">
  <style>h1{font-size:32px;margin:0 0 4px}.row{display:grid;grid-template-columns:160px repeat(3,1fr);gap:16px;align-items:start;margin:18px 0}
  .lab{font-weight:800;padding-top:8px}.cell img{width:100%;border-radius:18px;box-shadow:0 2px 10px rgba(0,0,0,.15)}.th{font-size:26px;font-weight:900;text-align:center}
  .frames{display:flex;gap:10px;align-items:flex-end}.frames div{text-align:center;font-size:16px;color:#555}.frames img{height:150px;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.15)}</style>
  <h1>收租 App 外觀：三選一（v0.6.0）</h1><p style="color:#555;margin:0 0 8px">iPhone 12 的實際畫面大小（含狀態列與底部橫條）。操作完全一樣，只換配色與質感。請挑一個（回覆 A、B 或 C）。三套的文字對比都 ≥ 7：1；動畫每段 ≤ 0.3 秒，iPhone 開「減少動態效果」或設定裡關掉就不動。</p>
  <div class="row"><div></div>${THEMES.map(([, n]) => `<div class="th">${n}</div>`).join('')}</div>
  ${ROWS.map(([k, label]) => `<div class="row"><div class="lab">${label}</div>${THEMES.map(([th]) => `<div class="cell"><img src="${b64(`${OUT}${th}-${k}.png`)}"></div>`).join('')}</div>`).join('')}
  <h2 style="margin-top:28px">打勾動畫（暖陽，逐格；全長約 0.3 秒）</h2>
  <div class="frames">${frames.map(([t, f]) => `<div><img src="${b64(f)}"><br>${t} 毫秒</div>`).join('')}</div>
</body></html>`);
const hgt = await sheet.evaluate(() => document.documentElement.scrollHeight);
await sheet.setViewport({ width: 1240, height: hgt, deviceScaleFactor: 1 });
await sheet.screenshot({ path: `${OUT}外觀三選一.png`, fullPage: true });
await browser.close();
server.close();
console.log('輸出在 .logs/themes/外觀三選一.png');
