// 靜態檢查（秒級，不開瀏覽器）：
// 1. App 裡不得有依賴瀏覽器識別字串／iOS 版本號的邏輯。
//    Safari 26 起回報的 iOS 版本被 Apple 固定成 18.x，任何「看版本號」的判斷式都會錯。
// 2. sw.js 的預快取清單 = 實際的 App 檔案；sw.js 與 js/version.js 的版本號一致。
// 每一類都先跑對照組（餵一個一定該命中的樣本），對照組沒命中就判紅——檢查器本身壞了也會被發現。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fail++; };

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

// ---- 1. 不看瀏覽器識別字串、不看 iOS 版本 ----
const FORBIDDEN = [/userAgent/, /navigator\.platform/, /appVersion/, /iPhone OS/, /Version\//, /\bOS \d+_\d+/];
const hits = (text) => FORBIDDEN.filter((re) => re.test(text)).map(String);
ok('對照組：檢查器抓得到 navigator.userAgent', hits('if (navigator.userAgent.includes("iPhone OS 18_6")) {}').length >= 2);
ok('對照組：乾淨的程式不命中', hits('if (matchMedia("(display-mode: standalone)").matches) {}').length === 0);
const appFiles = [path.join(ROOT, 'index.html'), path.join(ROOT, 'sw.js'), ...walk(path.join(ROOT, 'js'))];
const bad = appFiles.flatMap((f) => {
  // 註解裡提到這些字（解釋為什麼不用）不算；只檢查去掉註解後的程式
  const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');
  return hits(code).map((h) => `${path.relative(ROOT, f)}: ${h}`);
});
ok('App 程式沒有依賴瀏覽器識別字串或 iOS 版本號', bad.length === 0, bad.join('; '));

// ---- 2. Service Worker 預快取清單與版本 ----
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const listed = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean));
const actual = new Set([
  'index.html', 'manifest.webmanifest',
  ...walk(path.join(ROOT, 'css')), ...walk(path.join(ROOT, 'js')), ...walk(path.join(ROOT, 'icons')),
].map((f) => (path.isAbsolute(f) ? path.relative(ROOT, f) : f).split(path.sep).join('/')));
const missing = [...actual].filter((f) => !listed.has(f));
const extra = [...listed].filter((f) => !actual.has(f));
ok('sw.js 預快取清單涵蓋所有 App 檔案', missing.length === 0, missing.join(', '));
ok('sw.js 預快取清單沒有不存在的檔案', extra.length === 0, extra.join(', '));
const swVer = (sw.match(/const VERSION = 'rentcheck-v([^']+)'/) || [])[1];
const jsVer = (fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8').match(/VERSION = '([^']+)'/) || [])[1];
ok('sw.js 與 js/version.js 版本一致', !!swVer && swVer === jsVer, `${swVer} / ${jsVer}`);

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
