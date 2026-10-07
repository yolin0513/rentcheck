// 部署前掃描 dist/：確認要公開的檔案裡沒有個資或本機資訊。
// 掃：本機使用者名稱、本機路徑、email、電話號碼、身分證號格式，以及「真實資料黑名單」（.logs/private-words.txt，一行一個，不進版控）。
// 每一類都先跑對照組（一定該命中的合成樣本）；對照組沒命中＝掃描器壞了，判紅。
// 命中時只印檔名與類別，不印命中的原文（避免把個資印進記錄）。
// 用法：node scripts/predeploy-scan.mjs     回傳 0＝乾淨可部署；1＝有命中或掃描器壞了

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');
let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fail++; };

const user = os.userInfo().username;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const privateFile = path.join(ROOT, '.logs', 'private-words.txt');
const privateWords = fs.existsSync(privateFile) ? fs.readFileSync(privateFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
const RULES = [
  ['本機使用者名稱', new RegExp(esc(user), 'i'), ['path', user, 'here'].join(' ')],
  // 任何「磁碟代號:\」或「磁碟代號:/」開頭的路徑（前面不能接英文字母，才不會誤抓 https://）
  ['本機路徑', /(^|[^A-Za-z])[A-Za-z]:[\\/][^\s'"]|AppData/, ['X:', 'Work', 'x'].join('\\')],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, ['someone', 'example-mail.test'].join('@')],
  ['手機號碼', /09\d{2}[-\s]?\d{3}[-\s]?\d{3}/, '0912-345-678'],
  ['身分證號格式', /\b[A-Z][12]\d{8}\b/, 'A123456789'],
  ...privateWords.map((w, i) => [`真實資料黑名單第 ${i + 1} 行`, new RegExp(esc(w)), `x${w}x`]),
];

for (const [name, re, sample] of RULES) ok(`對照組：抓得到${name}`, re.test(sample));
ok('dist/ 存在', fs.existsSync(DIST), '先跑 node scripts/pack.mjs');
console.log(`真實資料黑名單：${privateWords.length} 行${privateWords.length ? '' : '（.logs/private-words.txt 不存在或是空的）'}`);

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = fs.existsSync(DIST) ? walk(DIST) : [];
let hits = 0;
for (const f of files) {
  if (/\.png$/i.test(f)) continue; // 圖示是程式畫的，不含文字
  const text = fs.readFileSync(f, 'utf8');
  for (const [name, re] of RULES) if (re.test(text)) { hits++; console.log(`  命中：${path.relative(ROOT, f)}（${name}）`); }
}
ok(`dist/ 的 ${files.length} 個檔都沒有命中`, hits === 0);
console.log(fail ? `\n${fail} 項失敗——不要部署` : '\n乾淨，可以部署');
process.exit(fail ? 1 : 0);
