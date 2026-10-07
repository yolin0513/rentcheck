// 給 Yolin 挑圖示用的一張比較圖（手機上看得清楚的直式排版）：.logs/icons/圖示候選.png
// 每個候選：大圖、名字與想法、實際主畫面大小放在其他 App 中間（清楚／模糊）。
// 先跑 node scripts/icon-preview.mjs 產生 home-X.png。

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { DESIGNS, contrast } from './icon-designs.mjs';

const dir = fileURLToPath(new URL('../.logs/icons/', import.meta.url));
const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(dir + f).toString('base64');
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
const big = {};
for (const [k, d] of Object.entries(DESIGNS)) {
  big[k] = await page.evaluate((src) => { const draw = eval(src); const c = document.createElement('canvas'); c.width = c.height = 360; draw(c.getContext('2d'), 360); return c.toDataURL('image/png'); }, d.draw);
}
const blocks = Object.entries(DESIGNS).map(([k, d]) => `
  <section>
    <div class="top"><img class="big" src="${big[k]}"><div><h2>${k}　${d.name}</h2><p>${d.idea}</p><p class="m">圖形與底色對比 ${contrast(d.fg, d.bg).toFixed(1)}：1</p></div></div>
    <p class="m">實際大小放在主畫面（左：清楚；右：模糊，模擬視力不好）</p>
    <img class="home" src="${b64(`home-${k}.png`)}">
  </section>`).join('');
await page.setViewport({ width: 840, height: 400, deviceScaleFactor: 2 });
await page.setContent(`<html><body style="margin:0;padding:24px;font:20px/1.45 'Microsoft JhengHei',sans-serif;background:#fff;color:#111">
  <style>h1{font-size:30px;margin:0 0 6px}h2{font-size:26px;margin:0 0 6px}section{border-top:2px solid #ddd;padding:18px 0}
  .top{display:flex;gap:20px;align-items:center}.big{width:180px;height:180px;border-radius:40px;flex:none}.m{color:#555;font-size:17px}
  .home{width:100%;border-radius:12px}</style>
  <h1>收租 App 圖示：三選一</h1><p class="m">三個都不用中文字、都是一個粗圖形加純色底。請挑一個（回覆 A、B 或 C）。</p>
  ${blocks}</body></html>`);
const h = await page.evaluate(() => document.documentElement.scrollHeight);
await page.setViewport({ width: 840, height: h, deviceScaleFactor: 2 });
await page.screenshot({ path: dir + '圖示候選.png', fullPage: true });
await browser.close();
console.log('.logs/icons/圖示候選.png');
