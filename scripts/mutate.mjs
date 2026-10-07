// 突變驗證：把程式故意改壞一處，確認「該抓到的那一條檢查」真的會紅；改壞的是暫存副本，不碰原檔。
// 每一條都先確認改壞的那段原文確實存在（不存在＝情境沒成立，判紅，不當作通過）。
// 用法：node scripts/mutate.mjs        （約 28 × 35 秒）

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
// 放在專案底下，node 才找得到上層的 node_modules（puppeteer）
const WORK = path.join(ROOT, '.logs', 'mut');

const MUTANTS = [
  { file: 'js/ui.js', from: 'timer = setTimeout(() => { timer = null; reset(); onDone(); }, ms);', to: 'timer = setTimeout(() => { timer = null; reset(); onDone(); }, 50);',
    test: 'e2e', expect: '只按一下：不會進設定', why: '按住的時間被縮短' },
  { file: 'js/backupcore.js', from: 'return h === p.hash;', to: 'return true;',
    test: 'unittest', expect: '對照組：改了金額 → 驗證不通過', why: '備份檔驗證永遠通過' },
  { file: 'js/months.js', from: "'號弄巷段路街'", to: "''",
    test: 'unittest', expect: '去掉共同的「中山路12號」', why: '格子名稱不去前綴' },
  { file: 'js/views/grid.js', from: 'return !!s.firstChangeAt && since(s.firstChangeAt) > FIRST_REMIND_DAYS * 86400000;', to: 'return true;',
    test: 'e2e', expect: '剛設定完：還不會出現「匯出備份」提醒', why: '從沒匯出過就立刻提醒' },
  { file: 'js/views/restore.js', from: 'let savedCurrent = !hasData;', to: 'let savedCurrent = true;',
    test: 'e2e', expect: '已有資料：沒先匯出一份目前的', why: '覆蓋前不必先匯出一份' },
  { file: 'js/app.js', from: "if (document.visibilityState === 'hidden' && state.edit) exitEdit();", to: '',
    test: 'e2e', expect: 'App 切到背景：自動離開設定', why: '切到背景不離開設定' },
  { file: 'js/backup.js', from: "if (e && e.name === 'AbortError') return 'cancelled';", to: "if (e && e.name === 'AbortError') { await store.markBackedUp({ seq: prepared.seq, bytes: prepared.bytes, how: 'x' }); return 'cancelled'; }",
    test: 'e2e', expect: '對照組：按了取消 → 不算匯出', why: '取消分享也算匯出' },
  { file: 'js/app.js', from: 'export function isStandalone() {', to: 'export function isStandalone() { if (navigator.userAgent) {}',
    test: 'staticcheck', expect: 'App 程式沒有依賴瀏覽器識別字串或 iOS 版本號', why: '加了看瀏覽器識別字串的程式' },
  { file: 'js/views/grid.js', from: "holdButton('設定（按住 3 秒）'", to: "holdButton('晚輩設定（按住 3 秒）'",
    test: 'staticcheck', expect: '畫面文字沒有「晚輩」「家人」', why: '畫面上又出現「晚輩」' },
  { file: 'js/views/grid.js', from: "holdButton('設定（按住 3 秒）'", to: "holdButton('晚' + '輩設定（按住 3 秒）'",
    test: 'e2e', expect: '走過的每個畫面都沒有「晚輩」「家人」', why: '畫面上又出現「晚輩」（拆字躲過靜態檢查）' },
  { file: 'js/views/backupview.js', from: "show('cancelled',", to: "show('shared',",
    test: 'e2e', expect: '取消：明確寫「沒有匯出」，和成功分得出來', why: '取消時顯示成成功的樣子' },
  // 重現實機那個錯的機制：原生 append 會把 null 轉成文字「null」（只拿掉 nodes() 的過濾不對——那會讓 null.nodeType 直接當掉，不是同一種錯）
  { file: 'js/ui.js', from: 'export function add(el, ...kids) { for (const n of nodes(kids)) el.appendChild(n); return el; }', to: 'export function add(el, ...kids) { el.append(...kids.flat(Infinity)); return el; }',
    test: 'e2e', expect: '走過的每個畫面都沒有出現 null／undefined／NaN', why: 'add() 改回直接用原生 append（今天實機那個錯的機制）' },
  // 單行比對：Windows 上的工作檔可能是 CRLF
  { file: 'js/views/grid.js', from: '  add(page,', to: '  page.append(',
    test: 'staticcheck', expect: '畫面程式沒有直接呼叫原生', why: '畫面程式改回直接呼叫原生 append' },
  { file: 'css/app.css', from: '--fg: #1f1a16; --muted: #574a40;', to: '--fg: #1f1a16; --muted: #8a8a8a;',
    test: 'staticcheck', expect: '主題 warm：文字與底色的對比都 ≥ 7', why: '為了好看把灰字調淡' },
  { file: 'js/views/tenant.js', from: "topbar(`${monthName(ym)}的租金`, back)", to: 'null',
    test: 'e2e', expect: '詳情頁：最上面有標題列', why: '詳情頁拿掉標題列' },
  { file: 'css/app.css', from: '.tile-label { font-weight: 800;', to: '.tile-label { font-size: .8em; font-weight: 800;',
    test: 'e2e', expect: '放不下也不縮字', why: '為了塞進一屏把格子字縮小' },
  { file: 'css/app.css', from: 'html[data-motion="off"] *, html[data-motion="off"] *::before, html[data-motion="off"] *::after { animation: none !important; transition: none !important; }', to: '',
    test: 'staticcheck', expect: '設定裡「關掉動畫」也把動畫全部關掉', why: '設定裡的「關掉動畫」不再生效' },
  { file: 'css/app.css', from: '@media (prefers-reduced-motion: reduce) {', to: '@media (prefers-reduced-motion: no-such-thing) {',
    test: 'e2e', expect: 'iPhone 開了「減少動態效果」', why: '不理 iPhone 的「減少動態效果」' },
  { file: 'css/app.css', from: '  pointer-events: none; background: rgba(255, 255, 255, .55);', to: '  background: rgba(255, 255, 255, .55);',
    test: 'e2e', expect: '打勾動畫不擋操作', why: '打勾動畫擋住底下的操作' },
  { file: 'css/app.css', from: '.tile.just-changed { animation: tile-pop 260ms ease-out; }', to: '.tile.just-changed { animation: tile-pop 600ms ease-out; }',
    test: 'staticcheck', expect: '時間＋延遲都 ≤ 300ms', why: '格子彈一下改成 0.6 秒' },
  { file: 'css/app.css', from: '--hero-1: #0b3a8a; --hero-2: #08475c;', to: '--hero-1: #0b3a8a; --hero-2: #2a7fa0;',
    test: 'staticcheck', expect: '主題 sky：文字與底色的對比都 ≥ 7', why: '為了好看把晴空的頁首調亮' },
  { file: 'js/ui.js', from: "  document.querySelectorAll('[data-celebrate]').forEach((x) => x.remove());", to: '',
    test: 'e2e', expect: '連續按好幾戶時，打勾動畫不會疊好幾層', why: '打勾動畫疊好幾層（最上面是前一戶）' },
  { file: 'js/ui.js', from: "    return Array.from(note).length <= NOTE_MAX_ON_TILE ? `${s.icon} ${note}` : `${s.icon} 看原因`;", to: "    return `${s.icon} ${Array.from(note).slice(0, 3).join('')}`;",
    test: 'unittest', expect: '短的原因整句顯示：「說晚點給」', why: '原因改回只取前三個字（實機看到的「說晚點」）' },
  { file: 'js/ui.js', from: "  return h('a', { class: 'btn back', href, 'data-act': 'bottom-back' }, '‹ ', label);", to: "  return h('a', { class: 'btn', href, 'data-act': 'bottom-back' }, '‹ ', label);",
    test: 'e2e', expect: '「回收租表／回上一頁／回設定」都不是主按鈕', why: '返回鍵做成主按鈕樣式' },
  { file: 'css/app.css', from: '  position: fixed; left: 0; right: 0; bottom: 0; z-index: 5;', to: '  position: static; left: 0; right: 0; bottom: 0; z-index: 5;',
    test: 'e2e', expect: '固定在最下面，捲動之後也在', why: '底部那一條不固定' },
  { file: 'css/app.css', from: '.grid-page { padding-bottom: calc(var(--footbar-h) + 16px); }', to: '.grid-page { padding-bottom: 16px; }',
    test: 'e2e', expect: '捲到底時最後一列完整看得到', why: '房間格下面沒留底部那一條的高度（最後一列被蓋住）' },
  { file: 'css/app.css', from: '  margin: 0 -16px 10px; padding: calc(var(--safe-top) + 14px) 16px 8px;', to: '  margin: 0 -16px 10px; padding: 4px 16px 8px;',
    test: 'e2e', expect: '頁首的月份離狀態列至少 10 點', why: '頁首沒留狀態列的空間（黏在一起）' },
  { file: 'js/views/tenant.js', from: "  const phone = digits.length >= 3 ? h('a',", to: "  const phone = true ? h('a',",
    test: 'e2e', expect: '沒填電話的租客：不顯示電話那一塊', why: '沒填電話也顯示電話那一塊' },
  { file: 'css/app.css', from: '.phone .num { white-space: nowrap; }', to: '.phone .num { }',
    test: 'e2e', expect: '電話號碼不從中間斷開', why: '電話號碼可以從中間斷行（實際截圖看到的 0900-000- ／ 111）' },
  { file: 'css/app.css', from: 'max-width: 100%; min-height: 48px; margin: .3rem 0 .1rem; padding: .15em .6em;', to: 'min-height: 48px; margin: .3rem 0 .1rem; padding: 0 .9em;',
    test: 'e2e', expect: '電話鍵在卡片裡面', why: '電話鍵在最窄＋最大字時凸出卡片（量出來的 6 點）' },
];

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const d of fs.readdirSync(src, { withFileTypes: true })) {
    if (['node_modules', '.logs', '.git'].includes(d.name)) continue;
    const s = path.join(src, d.name), t = path.join(dst, d.name);
    if (d.isDirectory()) copyTree(s, t); else fs.copyFileSync(s, t);
  }
}

let bad = 0;
// 只跑指定的幾條：node scripts/mutate.mjs 29,30（從 1 開始數）；不給就全部跑
const ONLY = (process.argv[2] || '').split(',').filter(Boolean).map(Number);
for (const [i, m] of MUTANTS.entries()) {
  if (ONLY.length && !ONLY.includes(i + 1)) continue;
  fs.rmSync(WORK, { recursive: true, force: true });
  copyTree(ROOT, WORK);
  const f = path.join(WORK, m.file);
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes(m.from)) { console.log(`FAIL M${i + 1} 情境未成立：${m.file} 裡找不到要改壞的原文`); bad++; continue; }
  fs.writeFileSync(f, src.replace(m.from, m.to));
  const r = spawnSync(process.execPath, [path.join(WORK, 'scripts', m.test + '.mjs')], { cwd: WORK, encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const caught = r.status !== 0 && out.split('\n').some((l) => l.startsWith('FAIL') && l.includes(m.expect));
  console.log(`${caught ? 'PASS' : 'FAIL'} M${i + 1}（${m.why}）→ ${m.test}「${m.expect}」${caught ? '紅了' : '沒有紅'}`);
  if (!caught) { bad++; console.log(out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 5).join('\n')); }
}
fs.rmSync(WORK, { recursive: true, force: true });
// 只跑一部分時照實寫跑了幾條——「全部被抓到」只能在真的全部跑過時說
const ran = ONLY.length ? ONLY.length : MUTANTS.length;
console.log(bad ? `\n${bad} 條突變沒被抓到（這次跑了 ${ran}／${MUTANTS.length} 條）`
  : ONLY.length ? `\n這次跑的 ${ran} 條突變都被抓到（共 ${MUTANTS.length} 條，其餘這次沒跑）` : `\n${MUTANTS.length} 條突變全部被抓到`);
process.exit(bad ? 1 : 0);
