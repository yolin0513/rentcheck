// 匯出備份：一顆按鈕叫出 iPhone 的分享畫面，存去哪由使用者自己決定（「儲存到檔案」、iCloud、傳訊息都可以）。
// App 不指定對象、不指定管道。
// 備份的意義在於「檔案離開網頁儲存區」：存進「檔案」App 或 iCloud 之後，App 的資料被清掉，那份檔案還在。
// 所以結果一定要講清楚：成功、取消、失敗三種，畫面上分得出來（不能讓人以為按一下就自動存好了）。
//
// iPhone 只在「剛按下按鈕」的那一下允許叫出分享畫面：檔案先在背景準備好，按鈕一按就分享。

import * as store from '../store.js';
import * as backup from '../backup.js';
import { h, fill, topbar, fmtMB, backButton } from '../ui.js';
import { monthName } from '../months.js';
import { SNOOZE_DAYS } from './grid.js';

export async function renderBackupPage(ctx, { after = '#/' } = {}) {
  const fromRemind = location.hash.includes('from=remind');
  const status = h('p', { class: 'muted', role: 'status' }, '正在準備備份檔…');
  const btn = h('button', { type: 'button', class: 'btn primary', disabled: true, 'data-act': 'share' }, '準備中…');
  const result = h('div', { class: 'result', role: 'status', 'aria-live': 'polite' });
  let prepared = null;

  backup.prepare().then((p) => {
    prepared = p;
    btn.disabled = false;
    btn.textContent = '匯出備份';
    status.textContent = `備份檔準備好了：${p.file.name}（${fmtMB(p.bytes)}）。`;
    if (p.bytes > backup.SIZE_WARN_BYTES) status.textContent += '檔案比較大，存起來可能要等一下。';
  }).catch((e) => { status.textContent = '準備備份檔時出了問題：' + e.message; });

  const show = (kind, ...kids) => {
    result.dataset.result = kind;
    result.className = `result ${kind === 'shared' || kind === 'downloaded' ? 'result-ok' : 'result-bad'}`;
    fill(result, kids);
  };

  btn.addEventListener('click', async () => {
    if (!prepared) return;
    let r;
    try {
      r = await backup.share(prepared);
    } catch (e) {
      show('error',
        h('p', { class: 'big' }, '✘ 沒有匯出成功'),
        h('p', null, e && e.name === 'NotAllowedError' ? '請再按一次「匯出備份」。' : `原因：${e.message || e}`));
      return;
    }
    if (r === 'cancelled') {
      show('cancelled',
        h('p', { class: 'big' }, '✘ 沒有匯出'),
        h('p', null, '剛才取消了，備份還沒有存起來。要存的話，再按一次「匯出備份」。'));
      return;
    }
    btn.hidden = true;
    show(r,
      h('p', { class: 'big' }, r === 'downloaded' ? '✔ 備份檔已下載' : '✔ 備份已匯出'),
      h('p', null, `檔名：${prepared.file.name}`),
      h('p', null, '請記得剛才把它存在哪裡。這份檔案在 App 以外的地方，就算 App 裡的資料被清掉，它也還在。'),
      h('p', { class: 'muted' }, '要找回資料時：設定 →「從備份找回」→ 選這個檔案。'),
      backButton(after, '回收租表'));
  });

  return h('div', { class: 'page' },
    topbar('匯出備份', after),
    h('p', { class: 'lead' }, '按「匯出備份」會出現 iPhone 的分享畫面。選一個地方把檔案存起來，例如「儲存到檔案」。'),
    btn, status, result,
    fromRemind
      ? h('button', { type: 'button', class: 'btn secondary', onclick: async () => {
        // 從提醒條進來按「先不要」＝這週不再提醒；不能永久關閉
        await store.setMeta('backupSnoozeUntil', new Date(Date.now() + SNOOZE_DAYS * 86400000).toISOString());
        ctx.go(after);
      } }, '這週先不要')
      : null,
    backButton(after, '回收租表'));
}

/** 這個月收齊時問一次 */
export async function renderDonePrompt(ctx, ym) {
  const s = await store.settings();
  await store.setMeta('completePrompted', { ...(s.completePrompted || {}), [ym]: new Date().toISOString() });
  return h('div', { class: 'page' },
    topbar('收齊了', `#/m/${ym}`),
    h('section', { class: 'card center' }, h('p', { class: 'big st-text-paid' }, `${monthName(ym)}收齊了！`)),
    h('p', { class: 'lead' }, '要不要匯出一份備份？'),
    h('a', { class: 'btn primary', href: '#/backup' }, '匯出備份'),
    backButton(`#/m/${ym}`, '先不要，回收租表'));
}
