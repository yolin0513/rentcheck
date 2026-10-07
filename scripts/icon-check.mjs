// 量「勾在小尺寸還看不看得見」：把圖示畫在實際的裝置像素大小（iPhone 12 是 3 倍：60 點＝180px、29 點＝87px），
// 套上模糊（模擬視力不好；模糊的量用「點」算，小圖示受的影響就比較大，跟真實的眼睛一樣），
// 再量「勾的位置」與「旁邊的黃色」之間的對比。
// 勾的位置：同一張圖畫兩次（有勾／沒勾），兩張不一樣的像素就是勾。
// 及格線（事先定，不看結果改）：29 點、輕度模糊（1.5 點）下，對比 ≥ 3：1（WCAG 對「非文字圖形」的最低要求）。
// 重度模糊（3 點）只報數字，不設及格線。
// 用法：node scripts/icon-check.mjs [設計代號…]（預設 C C0）

import puppeteer from 'puppeteer';
import { DESIGNS } from './icon-designs.mjs';

const keys = process.argv.slice(2).length ? process.argv.slice(2) : ['C', 'C0'];
const SIZES = [[60, '60 點（主畫面）'], [40, '40 點（資料夾）'], [29, '29 點（設定／搜尋）']];
const BLURS = [[0, '不模糊'], [1.5, '輕度模糊'], [3, '重度模糊']];
const DPR = 3;
const PASS = 3;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
let fail = 0;
for (const k of keys) {
  const d = DESIGNS[k];
  if (!d) { console.log(`沒有設計 ${k}`); fail++; continue; }
  console.log(`\n${k}　${d.name}`);
  for (const [pt, label] of SIZES) {
    const row = [];
    for (const [bpt] of BLURS) {
      const r = await page.evaluate((src, px, blurPx) => {
        const draw = eval(src);
        const mk = (noCheck, blur) => {
          const c = document.createElement('canvas'); c.width = c.height = px;
          const src2 = document.createElement('canvas'); src2.width = src2.height = px;
          draw(src2.getContext('2d'), px, { noCheck });
          const g = c.getContext('2d');
          g.filter = blur ? `blur(${blur}px)` : 'none';
          g.drawImage(src2, 0, 0);
          return g.getImageData(0, 0, px, px).data;
        };
        const sharpWith = mk(false, 0), sharpWithout = mk(true, 0), blurred = mk(false, blurPx), blurredWithout = mk(true, blurPx);
        const lum = (a, i) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(a[i]) + 0.7152 * f(a[i + 1]) + 0.0722 * f(a[i + 2]); };
        let ck = 0, ckN = 0, bg = 0, bgN = 0;
        for (let i = 0; i < sharpWith.length; i += 4) {
          const isCheck = Math.abs(sharpWith[i] - sharpWithout[i]) + Math.abs(sharpWith[i + 1] - sharpWithout[i + 1]) + Math.abs(sharpWith[i + 2] - sharpWithout[i + 2]) > 60;
          if (isCheck) { ck += lum(blurred, i); ckN++; bg += lum(blurredWithout, i); bgN++; }
        }
        // 勾的像素：模糊後的亮度 vs. 同一位置「沒有勾」時（也就是黃色）的亮度
        const a = ck / ckN, b = bg / bgN;
        const [hi, lo] = a > b ? [a, b] : [b, a];
        return { ratio: (hi + 0.05) / (lo + 0.05), checkPx: ckN, strokePt: null };
      }, d.draw, pt * DPR, bpt * DPR);
      row.push(r);
    }
    const strokePt = (pt * (k === 'C0' ? 0.06 : k === 'C' ? 0.13 : 0)).toFixed(1);
    const cells = row.map((r, i) => `${BLURS[i][1]} ${r.ratio.toFixed(1)}：1`).join('｜');
    const judged = pt === 29 ? (row[1].ratio >= PASS ? '　→ 及格（輕度模糊 ≥ 3：1）' : '　→ 不及格') : '';
    if (pt === 29 && row[1].ratio < PASS && !d.compareOnly) fail++;
    console.log(`  ${label}：勾的線寬約 ${strokePt} 點、勾佔 ${row[0].checkPx} 個像素｜${cells}${judged}`);
  }
}
await browser.close();
console.log(fail ? `\n有 ${fail} 項不及格` : '\n29 點、輕度模糊下，勾都看得見（及格線事先定為 3：1）');
process.exit(fail ? 1 : 0);
