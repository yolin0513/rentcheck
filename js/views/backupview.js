// 「傳一份紀錄給家人」：先在背景把檔案準備好，按鈕一按就叫出 iPhone 的分享畫面。

import * as store from '../store.js';
import * as backup from '../backup.js';
import { h, fmtMB } from '../ui.js';
import { monthName } from '../months.js';
import { SNOOZE_DAYS } from './grid.js';

export async function renderBackupPage(ctx, { after = '#/' } = {}) {
  const s = await store.settings();
  const status = h('p', { class: 'muted', role: 'status' }, '準備中…');
  const btn = h('button', { type: 'button', class: 'btn primary', disabled: true, 'data-act': 'share' }, '準備中…');
  const done = h('div', { hidden: true },
    h('p', { class: 'big st-text-paid' }, '傳好了！'),
    h('p', { class: 'lead' }, `請${s.recipient}把檔案存到 LINE 的 Keep，或 iPhone 的「檔案」。`),
    h('a', { class: 'btn', href: after }, '回到收租表'));
  let prepared = null;

  backup.prepare().then((p) => {
    prepared = p;
    btn.disabled = false;
    btn.textContent = `傳給${s.recipient}`;
    status.textContent = `檔案準備好了（${fmtMB(p.bytes)}）。`;
    if (p.bytes > backup.SIZE_WARN_BYTES) status.textContent += '檔案有點大，LINE 可能傳比較久；請晚輩看一下設定頁。';
  }).catch((e) => { status.textContent = '準備檔案時出了問題：' + e.message; });

  btn.addEventListener('click', async () => {
    if (!prepared) return;
    try {
      const r = await backup.share(prepared);
      if (r === 'cancelled') { status.textContent = '沒有傳出去。要傳的話，再按一次上面的按鈕。'; return; }
      btn.hidden = true;
      status.textContent = r === 'downloaded' ? '這支手機不能直接分享，已經把檔案下載下來了。' : '';
      done.hidden = false;
    } catch (e) {
      status.textContent = e && e.name === 'NotAllowedError' ? '請再按一次上面的按鈕。' : '沒有傳成功：' + (e.message || e);
    }
  });

  return h('div', { class: 'page' },
    h('h1', null, `傳一份紀錄給${s.recipient}`),
    h('p', { class: 'lead' }, `按下面的按鈕，會出現分享畫面：請選「LINE」，再選「${s.recipient}」，按傳送。`),
    btn, status, done,
    h('button', { type: 'button', class: 'btn secondary', onclick: async () => {
      // 從提醒條進來按「先不要」＝這週不再提醒；不能永久關閉
      await store.setMeta('backupSnoozeUntil', new Date(Date.now() + SNOOZE_DAYS * 86400000).toISOString());
      ctx.go(after);
    } }, '這週先不要'));
}

/** 這個月收齊時問一次 */
export async function renderDonePrompt(ctx, ym) {
  const s = await store.settings();
  await store.setMeta('completePrompted', { ...(s.completePrompted || {}), [ym]: new Date().toISOString() });
  return h('div', { class: 'page center-page' },
    h('p', { class: 'big st-text-paid' }, `${monthName(ym)}收齊了！`),
    h('p', { class: 'lead' }, `要不要傳一份紀錄給${s.recipient}收著？`),
    h('a', { class: 'btn primary', href: '#/backup' }, `傳給${s.recipient}`),
    h('a', { class: 'btn secondary', href: `#/m/${ym}` }, '先不要'));
}
