// 產生主畫面圖示（180／192／512 px PNG）：藍底白字「租」。
// 用 puppeteer 的 canvas 畫，不需要任何圖片工具。改了設計才需要重跑：node scripts/make-icons.mjs

import fs from 'node:fs';
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
for (const size of [180, 192, 512]) {
  const b64 = await page.evaluate((s) => {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    g.fillStyle = '#0b4f9c';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffffff';
    g.font = `bold ${Math.round(s * 0.62)}px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('租', s / 2, s * 0.53);
    return c.toDataURL('image/png').split(',')[1];
  }, size);
  fs.writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), Buffer.from(b64, 'base64'));
  console.log(`icons/icon-${size}.png`);
}
await browser.close();
