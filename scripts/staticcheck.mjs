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

// 去掉註解，只檢查程式本身。區塊註解的「/*」前面要是行首或空白：2026-10-08 突變抓到，舊寫法把 tenant.js 的
// accept: 'image/*' 當成註解開頭，一路吃到下一個「*/」——整個確認頁（約 50 行）所有靜態檢查都看不到。
const stripComments = (t) => t.replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1').replace(/(^|[^:])\/\/.*$/gm, '$1');
ok('對照組：字串裡的「image/*」不會被當成註解開頭', stripComments("h('input', { accept: 'image/*' });\nel.append(x);\n/** 說明 */\n").includes('el.append(x)')
  && !stripComments('/** 說明 el.append(x) */ y();').includes('append'));

// ---- 1. 不看瀏覽器識別字串、不看 iOS 版本 ----
const FORBIDDEN = [/userAgent/, /navigator\.platform/, /appVersion/, /iPhone OS/, /Version\//, /\bOS \d+_\d+/];
const hits = (text) => FORBIDDEN.filter((re) => re.test(text)).map(String);
ok('對照組：檢查器抓得到 navigator.userAgent', hits('if (navigator.userAgent.includes("iPhone OS 18_6")) {}').length >= 2);
ok('對照組：乾淨的程式不命中', hits('if (matchMedia("(display-mode: standalone)").matches) {}').length === 0);
const appFiles = [path.join(ROOT, 'index.html'), path.join(ROOT, 'sw.js'), ...walk(path.join(ROOT, 'js'))];
const bad = appFiles.flatMap((f) => {
  // 註解裡提到這些字（解釋為什麼不用）不算；只檢查去掉註解後的程式
  const code = stripComments(fs.readFileSync(f, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
  return hits(code).map((h) => `${path.relative(ROOT, f)}: ${h}`);
});
ok('App 程式沒有依賴瀏覽器識別字串或 iOS 版本號', bad.length === 0, bad.join('; '));

// ---- 2. 畫面文字不指定對象 ----
const WORDS = [/晚輩/, /家人/];
const wordHits = (code) => WORDS.filter((re) => re.test(code)).map(String);
ok('對照組：檢查器抓得到畫面文字裡的「晚輩」', wordHits("h('button', null, '晚輩設定')").length === 1);
const badWords = appFiles.flatMap((f) => {
  const code = stripComments(fs.readFileSync(f, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
  return wordHits(code).map((h) => `${path.relative(ROOT, f)}: ${h}`);
});
ok('畫面文字沒有「晚輩」「家人」', badWords.length === 0, badWords.join('; '));

// ---- 2b. 畫面程式不直接呼叫原生的 append／prepend／replaceChildren／innerHTML ----
// 2026-10-07 實機出現「null」「nullnull」：原生方法會把 null 轉成文字。一律用 ui.js 的 add()／fill()（會略過 null）。
const NATIVE = /\.(append|prepend|replaceChildren)\(|\.innerHTML\s*=/;
ok('對照組：檢查器抓得到 page.append(…)', NATIVE.test("page.append(h('p'), null);") && NATIVE.test("el.innerHTML = '<b>x</b>';"));
ok('對照組：add(page, …) 不命中', !NATIVE.test("add(page, h('p'), null);"));
const nativeHits = appFiles.filter((f) => !f.endsWith(path.join('js', 'ui.js'))).flatMap((f) => {
  const code = stripComments(fs.readFileSync(f, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
  return code.split('\n').map((l, i) => (NATIVE.test(l) ? `${path.relative(ROOT, f)}:${i + 1}` : null)).filter(Boolean);
});
ok('畫面程式沒有直接呼叫原生 append／prepend／replaceChildren／innerHTML（ui.js 以外）', nativeHits.length === 0, nativeHits.join(', '));

// ---- 2b'. emoji 字元不繞過 ui.js 的 nodes() 直接塞進畫面 ----
// 2026-10-08 實機：✔ 在 iPhone 上用 emoji 字型畫，顏色固定（深綠按鈕上是深灰黑）。nodes() 會把 ✔ ◀ ▶ 📞 📷 換成跟著文字顏色的 SVG；
// 直接設 textContent／innerText 就繞過了它。（端對端測試另外擋「畫面上出現任何 emoji 字元」。）
const EMOJI_SET = /\.(textContent|innerText)\s*=.*\p{Extended_Pictographic}/u;
ok('對照組：檢查器抓得到 btn.textContent = \'📷 再拍一張\'', EMOJI_SET.test("photoBtn.textContent = '📷 再拍一張';") && !EMOJI_SET.test("fill(photoBtn, '📷 再拍一張');"));
const emojiHits = appFiles.flatMap((f) => {
  const code = stripComments(fs.readFileSync(f, 'utf8'));
  return code.split('\n').map((l, i) => (EMOJI_SET.test(l) ? `${path.relative(ROOT, f)}:${i + 1}` : null)).filter(Boolean);
});
ok('沒有用 textContent／innerText 直接放 emoji 字元（要經過 nodes() 換成圖示）', emojiHits.length === 0, emojiHits.join(', '));

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

// ---- 2e. 長按：iPhone 會把「長按一段文字」當成選取，叫出選取選單／書寫工具（2026-10-08 Yolin 實機，長按「設定」）----
// 電腦的瀏覽器沒有這個行為，端對端測不到；改成靜態檢查三件事：
//   (1) 寫了 user-select: none 的地方，一定也要寫 -webkit-user-select: none（iPhone 的 Safari 只認帶前綴的；之前就是只寫了一種）
//   (2) 有一條規則同時涵蓋 [data-longpress]，而且三個宣告都在（-webkit-user-select、user-select、-webkit-touch-callout）
//   (3) 會「按住一段時間才動作」的程式（pointerdown／touchstart）只能在已審查過的地方，而且長按元件要掛 data-longpress
const cssBlocks = (text) => [...stripComments(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const UNPREFIXED = /(^|[;\s])user-select\s*:\s*none/;
const PREFIXED = /-webkit-user-select\s*:\s*none/;
const CALLOUT = /-webkit-touch-callout\s*:\s*none/;
const halfSelect = (text) => cssBlocks(text).filter((b) => UNPREFIXED.test(b.body) !== PREFIXED.test(b.body)).map((b) => b.sel.replace(/\s+/g, ' ').slice(0, 40));
ok('對照組：只寫 user-select: none（沒有 -webkit-）會被抓到', halfSelect('.hold { user-select: none; }').length === 1 && halfSelect('.hold { -webkit-user-select: none; user-select: none; }').length === 0);
const half = halfSelect(css);
ok('寫了 user-select: none 的地方都同時寫了 -webkit-user-select: none（iPhone 只認帶前綴的）', half.length === 0, half.join('、'));
const lp = cssBlocks(css).filter((b) => b.sel.split(',').map((x) => x.trim()).includes('[data-longpress]'));
ok('[data-longpress]（要按住的元件）關掉文字選取與長按選單：-webkit-user-select、user-select、-webkit-touch-callout 三個都有',
  lp.some((b) => UNPREFIXED.test(b.body) && PREFIXED.test(b.body) && CALLOUT.test(b.body)), lp.map((b) => b.sel.slice(0, 30)).join('；') || '沒有這條規則');
const PRESS = /addEventListener\(\s*['"](pointerdown|touchstart|mousedown)['"]/;
const REVIEWED = [/addEventListener\('pointerdown', bumpEdit, true\)/, /btn\.addEventListener\('pointerdown', \(e\) => \{/];   // app.js：任何點擊都延長設定的時間；ui.js：holdButton
const pressHits = appFiles.flatMap((f) => stripComments(fs.readFileSync(f, 'utf8')).split('\n').map((l, i) => (PRESS.test(l) && !REVIEWED.some((re) => re.test(l)) ? `${path.relative(ROOT, f)}:${i + 1}` : null)).filter(Boolean));
ok('對照組：新的 pointerdown 處理會被抓到', PRESS.test("tile.addEventListener('pointerdown', start);") && !REVIEWED.some((re) => re.test("tile.addEventListener('pointerdown', start);")));
ok('按住／拖曳的處理只在審查過的地方（新加的要掛 data-longpress 並加進 REVIEWED）', pressHits.length === 0, pressHits.join(', '));
ok('holdButton 掛了 data-longpress', /class: 'hold', 'data-longpress': ''/.test(fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8')));

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
