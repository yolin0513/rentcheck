// 上線核對：推送成功 ≠ 實際生效。等 GitHub Pages 建好，從線上抓 js/version.js、sw.js、index.html，和本機逐字比對。
// 用法：node scripts/pages-verify.mjs [網址]（預設 https://yolin0513.github.io/rentcheck/）；最多等 10 分鐘。
// 回傳 0＝線上＝本機；1＝逾時或內容不同。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const BASE = (process.argv[2] || 'https://yolin0513.github.io/rentcheck/').replace(/\/?$/, '/');
const FILES = ['js/version.js', 'sw.js', 'index.html', 'manifest.webmanifest'];
const norm = (s) => s.replace(/\r\n/g, '\n');
const local = Object.fromEntries(FILES.map((f) => [f, norm(fs.readFileSync(path.join(ROOT, f), 'utf8'))]));
const deadline = Date.now() + 10 * 60 * 1000;
let last = '';
while (Date.now() < deadline) {
  const got = {};
  for (const f of FILES) {
    try {
      const r = await fetch(BASE + f + '?t=' + Date.now(), { headers: { 'cache-control': 'no-cache' } });
      got[f] = r.ok ? norm(await r.text()) : `HTTP ${r.status}`;
    } catch (e) { got[f] = '連不上：' + e.message; }
  }
  const diff = FILES.filter((f) => got[f] !== local[f]);
  if (!diff.length) {
    console.log(`✔ 線上＝本機：${FILES.join('、')} 逐字相同（${BASE}）`);
    console.log(`  線上版本：${(got['js/version.js'].match(/VERSION = '([^']+)'/) || [])[1]}`);
    process.exit(0);
  }
  const now = diff.map((f) => `${f}：${got[f].startsWith('HTTP') || got[f].startsWith('連不上') ? got[f] : '內容不同'}`).join('；');
  if (now !== last) { console.log(`… 還不一樣：${now}`); last = now; }
  await new Promise((r) => setTimeout(r, 15000));
}
console.log('✘ 等了 10 分鐘，線上還是和本機不同');
process.exit(1);
