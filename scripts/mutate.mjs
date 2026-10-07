// 突變驗證：把程式故意改壞一處，確認「該抓到的那一條檢查」真的會紅；改壞的是暫存副本，不碰原檔。
// 每一條都先確認改壞的那段原文確實存在（不存在＝情境沒成立，判紅，不當作通過）。
// 用法：node scripts/mutate.mjs        （約 16 × 25 秒）

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
  { file: 'css/app.css', from: '--muted: #454b54;', to: '--muted: #8a8a8a;',
    test: 'staticcheck', expect: '文字與底色的對比都 ≥ 7', why: '為了好看把灰字調淡' },
  { file: 'js/views/tenant.js', from: "topbar(`${monthName(ym)}的租金`, back)", to: 'null',
    test: 'e2e', expect: '詳情頁：最上面有標題列', why: '詳情頁拿掉標題列' },
  { file: 'css/app.css', from: '.tile-label { font-weight: 800;', to: '.tile-label { font-size: .8em; font-weight: 800;',
    test: 'e2e', expect: '放不下也不縮字', why: '為了塞進一屏把格子字縮小' },
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
for (const [i, m] of MUTANTS.entries()) {
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
console.log(bad ? `\n${bad} 條突變沒被抓到` : `\n${MUTANTS.length} 條突變全部被抓到`);
process.exit(bad ? 1 : 0);
