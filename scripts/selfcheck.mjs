// 公開前自查（共用慣例 §2.4、§2.5 第一關）：查「這次要推的每一個 commit 會公開的東西」。照 MealMate 的 scripts/selfcheck.mjs 移植。
// 用法：node scripts/selfcheck.mjs <範圍>   例：origin/main..HEAD；遠端還是空的（第一次推送）時傳 HEAD＝從第一個 commit 查起。
// 由 scripts/pushgate.sh 呼叫（它先問遠端的實際狀態，範圍才照遠端算）。
//
// 查什麼（範圍內的每一個 commit，不是只比兩端）：
//   · 新增行：照 diff 的結構抽——`diff --git` 到第一個 `@@` 之間是檔頭，跳過；`@@` 之後以 `+` 開頭的才是內容。
//   · commit 訊息、作者與提交者的名字與信箱。
//   · 抽出的新增行數用 `git log --numstat -U0`（和抽取同一種 diff）第一欄的加總核對，必須相等（抽多、抽少都停）。
// 回傳值：通過 0；有命中、任何一類的對照組沒命中（檢查器壞了）、範圍裡沒有 commit、抽取與 numstat 對不上、取不到訊息與作者欄 → 非 0。
// 命中時只印類別與來源，不印命中的原文。
// 真實資料黑名單：.logs/private-words.txt（不進版控，一行一個；例如長輩與租客的真實姓名、真實門牌）。沒有這個檔就跳過這一類，並印出來。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const realGit = (args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function addedLinesOf(diffText) {
  const out = [];
  let inHunk = false;
  for (const l of diffText.split('\n')) {
    if (l.startsWith('diff --git ')) { inHunk = false; continue; }
    if (l.startsWith('@@')) { inHunk = true; continue; }
    if (inHunk && l.startsWith('+')) out.push(l.slice(1));
  }
  return out;
}
function numstatAdded(numstatText) {
  let n = 0;
  for (const l of numstatText.split('\n')) {
    const m = /^(\d+)\t/.exec(l);
    if (m) n += Number(m[1]);
  }
  return n;
}

export function selfcheck(range, git = realGit, log = console.log, privateWords = []) {
  const commits = git(['rev-list', range]).split('\n').filter(Boolean);
  // --root：範圍從第一個 commit 開始時，第一個 commit 也要有 diff
  const added = addedLinesOf(git(['log', '-p', '--root', '--no-color', '--format=', '-U0', range]));
  // numstat 要和上面抽取用同一種 diff（-U0）：前後文行數不同時，git 對「搬移一整段」的對齊方式會不同，
  // 兩邊各算各的就會差一兩行（2026-10-08 v0.7.0 的 settings.js：43 對 44），把乾淨的 commit 當成「抽取壞了」擋下
  const numstat = numstatAdded(git(['log', '--root', '--numstat', '-U0', '--format=', range]));
  const meta = git(['log', '--format=%B%n%an <%ae>%n%cn <%ce>', range]).split('\n').filter((l) => l.trim());
  log(`查了：commit ${commits.length} 個；新增行 ${added.length} 行（numstat ${numstat} 行）；commit 訊息與作者欄 ${meta.length} 行`);

  let ok = true;
  if (commits.length === 0) { log('範圍裡沒有 commit：沒有東西可推，當成失敗（避免查錯範圍還顯示通過）'); ok = false; }
  if (added.length !== numstat) { log(`抽取壞了：抽出的新增行 ${added.length} 行，numstat 是 ${numstat} 行`); ok = false; }
  if (commits.length > 0 && meta.length === 0) { log('取不到 commit 訊息與作者欄'); ok = false; }

  const user = process.env.USERNAME || process.env.USER || '';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const checks = {
    金鑰或token: /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{12,})/i,
    email: { test: (s) => (s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).some((m) => !/@(users\.noreply\.github\.com|anthropic\.com)$/i.test(m)) },
    本機使用者名稱: user ? new RegExp(esc(user), 'i') : { test: () => { throw new Error('取不到使用者名稱'); } },
    磁碟機或家目錄路徑: /(\b[A-Za-z]:[\\/]|\/(Users|home)\/[^\s/]+)/,
  };
  // 對照組：當下組出來的合成樣本，跑的是同一個檢查；不寫進任何檔
  const fakeMail = ['someone', 'example-mail.test'].join('@');
  const controls = {
    金鑰或token: ['ghp_' + 'A'.repeat(30)],
    email: [fakeMail, 'Someone Else <' + fakeMail + '>'],
    本機使用者名稱: ['path ' + user + ' here'],
    磁碟機或家目錄路徑: ['E:' + '\\' + 'Foo', '/' + 'home' + '/someone/x'],
  };
  if (privateWords.length) {
    checks.真實資料黑名單 = new RegExp(privateWords.map(esc).join('|'));
    controls.真實資料黑名單 = privateWords.map((w) => `x${w}x`);
  } else {
    log('真實資料黑名單：.logs/private-words.txt 不存在或是空的，這一類沒查（真實姓名、門牌靠這份才抓得到）');
  }
  for (const [name, re] of Object.entries(checks)) {
    const ctl = controls[name].every((c) => re.test(c));
    const inAdded = added.filter((l) => re.test(l)).length;
    const inMeta = meta.filter((l) => re.test(l)).length;
    log(`${name}：對照組命中=${ctl}，新增行命中=${inAdded}，commit 訊息或作者欄命中=${inMeta}`);
    if (!ctl) ok = false;
    if (inAdded) { log(`  命中｜${name}｜來源：新增行 ${inAdded} 行`); ok = false; }
    if (inMeta) { log(`  命中｜${name}｜來源：commit 訊息或作者欄 ${inMeta} 行`); ok = false; }
  }
  const generic = '~' + '/.cache/x';
  if (checks.磁碟機或家目錄路徑.test(generic)) { log('磁碟機或家目錄路徑：連泛稱路徑也擋（樣式太寬）'); ok = false; }
  log(ok ? '自查通過' : '自查不通過');
  return ok;
}

export const GIT_ENV_ALLOW = ['GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_PAGER'];
export function gitEnvProblems(env) {
  return Object.keys(env).filter((k) => k.toUpperCase().startsWith('GIT_') && !GIT_ENV_ALLOW.includes(k.toUpperCase())).sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = gitEnvProblems(process.env);
  if (bad.length) { console.log(`【擋下：執行環境】${bad.join('、')} 有設定；先 unset 再跑`); process.exit(1); }
  const range = process.argv[2];
  if (!range) { console.log('用法：node scripts/selfcheck.mjs <範圍>'); process.exit(1); }
  const pf = path.join(process.cwd(), '.logs', 'private-words.txt');
  const words = fs.existsSync(pf) ? fs.readFileSync(pf, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  if (!selfcheck(range, realGit, console.log, words)) process.exitCode = 1;
}
