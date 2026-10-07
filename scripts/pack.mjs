// 產生 dist/：只放 App 本身要的檔案（照 sw.js 的預快取清單＋sw.js），給「直接上傳」型的託管用。
// 不含 scripts、docs、node_modules，也不含任何使用者資料（使用者資料只在手機的 IndexedDB 裡）。
// 用法：node scripts/pack.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const files = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]).concat(['sw.js']);

fs.rmSync(DIST, { recursive: true, force: true });
let bytes = 0;
for (const f of files) {
  const src = path.join(ROOT, f);
  const dst = path.join(DIST, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  bytes += fs.statSync(src).size;
}
console.log(`dist/：${files.length} 個檔、${(bytes / 1024).toFixed(0)} KB`);
