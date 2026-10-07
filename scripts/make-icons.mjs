// 產生主畫面圖示：node scripts/make-icons.mjs <A|B|C>
// 設計在 scripts/icon-designs.mjs（三個候選，Yolin 挑一個）。
// 產出：icons/icon-180.png（iPhone 主畫面）、icon-192.png、icon-512.png、icon-maskable-512.png（圖形縮到 80% 安全區內）。
// 換了圖示就要升版號（sw.js 與 js/version.js），使用者才拿得到新的。

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { DESIGNS } from './icon-designs.mjs';

const key = (process.argv[2] || '').toUpperCase();
if (!DESIGNS[key]) { console.error(`用法：node scripts/make-icons.mjs <${Object.keys(DESIGNS).join('|')}>`); process.exit(2); }
const d = DESIGNS[key];

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
const out = [[180, 1], [192, 1], [512, 1], [512, 0.8, 'icon-maskable-512.png']];
for (const [size, scale, name] of out) {
  const b64 = await page.evaluate((src, bg, size, scale) => {
    const draw = eval(src);
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, size, size);
    // maskable：整張縮到 80% 置中，外圍用同一個底色補滿
    const inner = Math.round(size * scale), off = (size - inner) / 2;
    const t = document.createElement('canvas'); t.width = t.height = inner;
    draw(t.getContext('2d'), inner);
    g.drawImage(t, off, off);
    return c.toDataURL('image/png').split(',')[1];
  }, d.draw, d.bg, size, scale);
  const file = name || `icon-${size}.png`;
  fs.writeFileSync(fileURLToPath(new URL(`../icons/${file}`, import.meta.url)), Buffer.from(b64, 'base64'));
  console.log(`icons/${file}`);
}
await browser.close();
console.log(`圖示：${key} ${d.name}`);
