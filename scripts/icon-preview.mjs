// 圖示候選的驗證圖：把每個候選畫成實際會看到的樣子，回答「縮到實際顯示尺寸還認不認得出來」。
// 產出（.logs/icons/，不進版控）：
//   sizes.png  每個候選在各種尺寸與「視力模擬」下的樣子
//   home-X.png 放進 iPhone 12 主畫面（60×60 點、四欄）的實際比例，旁邊是各種顏色的其他 App
// 用法：node scripts/icon-preview.mjs

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { DESIGNS, contrast } from './icon-designs.mjs';

const OUT = new URL('../.logs/icons/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

// 先把每個候選畫成 180px（iPhone 主畫面 60 點 × 3 倍）的 PNG
await page.setContent('<html><body></body></html>');
const png = {};
for (const [k, d] of Object.entries(DESIGNS)) {
  png[k] = await page.evaluate((src) => {
    const draw = eval(src);
    const c = document.createElement('canvas'); c.width = c.height = 180;
    draw(c.getContext('2d'), 180);
    return c.toDataURL('image/png');
  }, d.draw);
}

// ---- sizes.png ----
const cell = (src, px, filter = '') => `<div class="c"><img src="${src}" style="width:${px}px;height:${px}px;border-radius:${px * 0.225}px;filter:${filter}"></div>`;
const rows = Object.entries(DESIGNS).map(([k, d]) => `
  <div class="row"><div class="lab"><b>${k}　${d.name}</b><br>對比 ${contrast(d.fg, d.bg).toFixed(1)}：1</div>
  ${cell(png[k], 60)}${cell(png[k], 40)}${cell(png[k], 29)}${cell(png[k], 60, 'grayscale(1)')}${cell(png[k], 60, 'blur(1.5px)')}${cell(png[k], 60, 'blur(3px)')}</div>`).join('');
await page.setViewport({ width: 760, height: 120 + 90 * 3, deviceScaleFactor: 3 });
await page.setContent(`<html><body style="margin:0;padding:16px;font:14px/1.3 sans-serif;background:#f0f0f0">
  <style>.row{display:flex;align-items:center;gap:22px;height:90px}.lab{width:150px}.c{width:70px;display:flex;justify-content:center}.h{display:flex;gap:22px;margin-left:172px;color:#555;font-size:12px}.h div{width:70px;text-align:center}</style>
  <div class="h"><div>60 點<br>主畫面</div><div>40 點<br>資料夾</div><div>29 點<br>設定／搜尋</div><div>60 點<br>黑白</div><div>60 點<br>輕度模糊</div><div>60 點<br>重度模糊</div></div>
  ${rows}</body></html>`);
await page.screenshot({ path: fileURLToPath(new URL('sizes.png', OUT)) });

// ---- home-X.png：放進主畫面 ----
// 其他 App 用「純色底＋簡單白色圖形」代替（不畫任何真實品牌的圖示），顏色刻意包含綠、黃、藍——最容易混淆的顏色
const others = [['#34C759', '●'], ['#0A84FF', '■'], ['#FFFFFF', '▲', '#888'], ['#FF9500', '●'], ['#8E8E93', '■'], ['#FF3B30', '▲'],
  ['#06C755', '■'], ['#5856D6', '●'], ['#FFCC00', '▲', '#333'], ['#1C1C1E', '■'], ['#30B0C7', '●'], ['#AF52DE', '▲'],
  ['#FF2D55', '■'], ['#0A84FF', '●'], ['#A2845E', '▲'], ['#34C759', '■'], ['#FFFFFF', '●', '#0A84FF'], ['#5AC8FA', '▲'], ['#FF9500', '■']];
for (const k of Object.keys(DESIGNS)) {
  const tiles = others.slice();
  tiles.splice(9, 0, ['OURS']);
  const html = tiles.map((t) => t[0] === 'OURS'
    ? `<div class="app"><img src="${png[k]}" class="ic"><span>收租</span></div>`
    : `<div class="app"><div class="ic" style="background:${t[0]};color:${t[2] || '#fff'}">${t[1]}</div><span>App</span></div>`).join('');
  await page.setViewport({ width: 390 * 2 + 40, height: 520, deviceScaleFactor: 3 });
  await page.setContent(`<html><body style="margin:0;display:flex;gap:40px;background:#fff">
    <style>.home{width:390px;height:520px;background:linear-gradient(#3a6ea5,#c86b85);display:grid;grid-template-columns:repeat(4,60px);justify-content:space-around;align-content:start;row-gap:22px;padding-top:40px;box-sizing:border-box}
    .app{display:flex;flex-direction:column;align-items:center;gap:4px;font:11px -apple-system,sans-serif;color:#fff}
    .ic{width:60px;height:60px;border-radius:13.5px;display:flex;align-items:center;justify-content:center;font-size:26px}</style>
    <div class="home">${html}</div><div class="home" style="filter:blur(2px)">${html}</div></body></html>`);
  await page.screenshot({ path: fileURLToPath(new URL(`home-${k}.png`, OUT)) });
}
await browser.close();
for (const [k, d] of Object.entries(DESIGNS)) console.log(`${k} ${d.name}：對比 ${contrast(d.fg, d.bg).toFixed(1)}：1`);
console.log('輸出在 .logs/icons/');
