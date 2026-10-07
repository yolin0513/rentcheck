// 靜態檢查（秒級，不開瀏覽器）：
// 1. App 裡不得有依賴瀏覽器識別字串／iOS 版本號的邏輯。
//    Safari 26 起回報的 iOS 版本被 Apple 固定成 18.x，任何「看版本號」的判斷式都會錯。
// 2. 畫面文字不得出現「晚輩」「家人」：設定是中性的「設定」，備份不指定對象（Yolin 2026-10-07）。
// 3. sw.js 的預快取清單 = 實際的 App 檔案；sw.js 與 js/version.js 的版本號一致。
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

// ---- 2. 畫面文字不指定對象 ----
const WORDS = [/晚輩/, /家人/];
const wordHits = (code) => WORDS.filter((re) => re.test(code)).map(String);
ok('對照組：檢查器抓得到畫面文字裡的「晚輩」', wordHits("h('button', null, '晚輩設定')").length === 1);
const badWords = appFiles.flatMap((f) => {
  const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');
  return wordHits(code).map((h) => `${path.relative(ROOT, f)}: ${h}`);
});
ok('畫面文字沒有「晚輩」「家人」', badWords.length === 0, badWords.join('; '));

// ---- 2b. 畫面程式不直接呼叫原生的 append／prepend／replaceChildren／innerHTML ----
// 2026-10-07 實機出現「null」「nullnull」：原生方法會把 null 轉成文字。一律用 ui.js 的 add()／fill()（會略過 null）。
const NATIVE = /\.(append|prepend|replaceChildren)\(|\.innerHTML\s*=/;
ok('對照組：檢查器抓得到 page.append(…)', NATIVE.test("page.append(h('p'), null);") && NATIVE.test("el.innerHTML = '<b>x</b>';"));
ok('對照組：add(page, …) 不命中', !NATIVE.test("add(page, h('p'), null);"));
const nativeHits = appFiles.filter((f) => !f.endsWith(path.join('js', 'ui.js'))).flatMap((f) => {
  const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, '');
  return code.split('\n').map((l, i) => (NATIVE.test(l) ? `${path.relative(ROOT, f)}:${i + 1}` : null)).filter(Boolean);
});
ok('畫面程式沒有直接呼叫原生 append／prepend／replaceChildren／innerHTML（ui.js 以外）', nativeHits.length === 0, nativeHits.join(', '));

// ---- 2c. 文字與底色的對比 ≥ 7：1（WCAG AAA）——變好看不能變難讀 ----
const css = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
const vars = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const lum = (hex) => {
  const c = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
ok('對照組：對比檢查抓得到 #777777 對白底（約 4.5：1）', ratio('#777777', '#ffffff') < 7);
const PAIRS = [
  ['fg', 'bg'], ['fg', 'surface'], ['muted', 'surface'], ['muted', 'bg'], ['brand-ink', 'surface'], ['brand-fg', 'brand'],
  ['paid-fg', 'paid-bg'], ['note-fg', 'note-bg'], ['due-fg', 'due-bg'], ['not-fg', 'not-bg'],
  ['fg', 'paid-bg'], ['fg', 'note-bg'], ['fg', 'due-bg'], ['fg', 'not-bg'],
  ['bad', 'bad-bg'], ['bad', 'surface'], ['ok', 'surface'], ['warn-fg', 'warn-bg'],
];
const low = PAIRS.filter(([a, b]) => !vars[a] || !vars[b] || ratio(vars[a], vars[b]) < 7).map(([a, b]) => `${a}/${b}${vars[a] && vars[b] ? ' ' + ratio(vars[a], vars[b]).toFixed(1) : '（變數不存在）'}`);
const minPair = PAIRS.filter(([a, b]) => vars[a] && vars[b]).map(([a, b]) => ratio(vars[a], vars[b])).sort((x, y) => x - y)[0];
ok(`文字與底色的對比都 ≥ 7：1（${PAIRS.length} 組，最低 ${minPair ? minPair.toFixed(1) : '—'}：1）`, low.length === 0, low.join('; '));
// 白字放在深色底上的兩處（設定頁首、預覽警告條）
ok('白字對設定頁首、預覽警告條 ≥ 7：1', ratio('#ffffff', vars.edit) >= 7 && ratio('#ffffff', vars.bad) >= 7, `${ratio('#ffffff', vars.edit).toFixed(1)} / ${ratio('#ffffff', vars.bad).toFixed(1)}`);

// ---- 3. Service Worker 預快取清單與版本 ----
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
