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

// ---- 2c. 每一套主題：文字與底色的對比 ≥ 7：1（WCAG AAA）——好看不能換掉看得清楚 ----
const css = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
const lum = (hex) => {
  const c = hex.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// 半透明白（例如頁首返回鍵的 12% 白底）疊在某個顏色上之後的顏色
const blendWhite = (hex, alpha) => '#' + hex.slice(1).match(/../g).map((x) => Math.round(parseInt(x, 16) * (1 - alpha) + 255 * alpha).toString(16).padStart(2, '0')).join('');
ok('對照組：對比檢查抓得到 #777777 對白底（約 4.5：1）', ratio('#777777', '#ffffff') < 7);
const themeBlocks = [...css.matchAll(/(?:^|\n)((?::root, )?html\[data-theme="(\w+)"\])\s*\{([^}]*)\}/g)].map((m) => [m[2], Object.fromEntries([...m[3].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1], x[2]]))]);
ok('讀得到三套主題（warm、sky、forest）', themeBlocks.map((t) => t[0]).join(',') === 'warm,sky,forest', themeBlocks.map((t) => t[0]).join(','));
const ST = ['paid', 'note', 'due', 'not'];
const PAIRS = [
  ['fg', 'bg'], ['fg', 'bg2'], ['fg', 'surface'], ['fg', 'surface-2'], ['muted', 'surface'], ['muted', 'bg'], ['muted', 'bg2'],
  ['brand-ink', 'surface'], ['brand-fg', 'brand'], ['brand-fg', 'brand-2'],
  ['hero-fg', 'hero-1'], ['hero-fg', 'hero-2'], ['hero-sub', 'hero-1'], ['hero-sub', 'hero-2'],
  ...ST.flatMap((x) => [[`${x}-fg`, `${x}-bg`], [`${x}-fg`, 'surface'], ['fg', `${x}-bg`]]),
  ['bad', 'bad-bg'], ['bad', 'surface'], ['ok', 'surface'], ['warn-fg', 'warn-bg'], ['paid-fg', 'surface'],
  ['brand-ink', 'brand-soft'], ['brand-ink', 'surface-2'],   // 電話鍵、返回鍵
];
for (const [name, v] of themeBlocks) {
  const all = PAIRS.map(([a, b]) => [a, b, v[a] && v[b] ? ratio(v[a], v[b]) : 0]);
  // 頁首的返回鍵／上下月按鈕：白字放在「12% 白疊在頁首色上」
  all.push(['hero-fg', 'hero-2＋12%白', ratio(v['hero-fg'], blendWhite(v['hero-2'], 0.12))], ['hero-fg', 'hero-1＋12%白', ratio(v['hero-fg'], blendWhite(v['hero-1'], 0.12))]);
  all.push(['白字', 'edit-1', ratio('#ffffff', v['edit-1'])], ['白字', 'edit-2', ratio('#ffffff', v['edit-2'])], ['白字', 'bad', ratio('#ffffff', v.bad)]);
  const low = all.filter((x) => x[2] < 7).map(([a, b, r]) => `${a}/${b} ${r ? r.toFixed(1) : '（變數不存在）'}`);
  const min = Math.min(...all.map((x) => x[2]));
  ok(`主題 ${name}：文字與底色的對比都 ≥ 7：1（${all.length} 組，最低 ${min.toFixed(1)}：1）`, low.length === 0, low.join('; '));
}

// ---- 2d. 動畫：每一段（時間＋延遲）≤ 300ms；而且「減少動態效果」與設定裡的「關掉」都會把動畫全部關掉 ----
const ANIM = /(?:animation|transition)\s*:[^;]*/g;
const msOf = (t) => (t.endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000);
const durations = (decl) => decl.split(',').map((part) => { const ts = part.match(/\d*\.?\d+m?s\b/g) || []; return ts.map(msOf).reduce((a, b) => a + b, 0); });
ok('對照組：抓得到 400ms 的動畫', Math.max(...durations('animation: x 400ms ease')) > 300);
ok('對照組：時間加延遲也算（200ms＋150ms）', Math.max(...durations('animation: x 200ms ease 150ms')) > 300);
const animDecls = [...css.matchAll(ANIM)].map((m) => m[0]).filter((d) => !/none\s*!important/.test(d));
const tooLong = animDecls.filter((d) => Math.max(...durations(d)) > 300);
ok(`所有動畫（${animDecls.length} 處）時間＋延遲都 ≤ 300ms`, tooLong.length === 0, tooLong.join(' | '));
ok('有「減少動態效果」的規則，並且把動畫全部關掉', /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important; transition: none !important;/.test(css));
ok('設定裡「關掉動畫」也把動畫全部關掉', /html\[data-motion="off"\] \*[^{]*\{ animation: none !important; transition: none !important; \}/.test(css));

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
