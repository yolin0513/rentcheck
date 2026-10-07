// 從備份找回。檔案從哪裡來都可以（「檔案」App、iCloud、任何地方）。手機上已有資料時：先匯出一份目前的、再輸入「找回」才覆蓋。

import * as store from '../store.js';
import * as backup from '../backup.js';
import { h } from '../ui.js';

export async function renderRestorePage(ctx) {
  const c = await store.counts();
  const hasData = c.tenants > 0;
  if (hasData && !ctx.state.edit) { ctx.go('#/'); return h('div'); }
  const back = hasData ? '#/settings' : '#/';

  const out = h('div', { role: 'status' });
  const fileIn = h('input', { type: 'file', accept: '.html,text/html', class: 'file', 'aria-label': '選擇備份檔' });
  const page = h('div', { class: 'page' },
    h('h1', null, '從備份找回'),
    h('ol', { class: 'steps' },
      h('li', null, '找到之前匯出的備份檔（檔名像「收租紀錄_2026-10-07.html」）。它可能在「檔案」App、iCloud 雲碟，或你存放的任何地方。'),
      h('li', null, '按下面的「選擇檔案」，找到那個檔，選它。')),
    h('label', { class: 'btn secondary file-label' }, '選擇檔案', fileIn),
    out,
    h('a', { class: 'btn secondary', href: back }, '回去'));

  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    if (!f) return;
    out.replaceChildren(h('p', { class: 'muted' }, '讀取中…'));
    let r;
    try { r = await backup.readBackupFile(f); } catch (e) { out.replaceChildren(h('p', { class: 'bad' }, '✘ ' + e.message)); return; }
    if (!r.ok) { out.replaceChildren(h('p', { class: 'bad' }, '✘ 這個備份檔不完整（內容和當初存的時候不一樣），請改用另一份。')); return; }
    const sm = r.summary;
    const when = new Date(sm.exportedAt).toLocaleString('zh-TW', { hour12: false });
    const info = h('p', { class: 'ok' }, `✔ 備份檔完整：${when} 的備份，${sm.tenants} 位租客、${sm.months} 個月、${sm.payments} 筆紀錄、${sm.photos} 張照片。`);
    const typed = h('input', { type: 'text', class: 'field', placeholder: '輸入「找回」兩個字', 'aria-label': '確認文字' });
    const go = h('button', { type: 'button', class: 'btn primary', disabled: true, 'data-act': 'restore' }, '用這份備份找回');
    let savedCurrent = !hasData;
    const savePrev = h('button', { type: 'button', class: 'btn secondary', 'data-act': 'save-current' }, '先匯出一份目前的資料');
    const prevStatus = h('p', { class: 'muted' });
    const refresh = () => { go.disabled = !(savedCurrent && typed.value.trim() === '找回'); };
    typed.addEventListener('input', refresh);
    let prepared = null;
    if (hasData) {
      savePrev.disabled = true;
      backup.prepare().then((p) => { prepared = p; savePrev.disabled = false; });
      savePrev.addEventListener('click', async () => {
        try {
          const res = await backup.share(prepared);
          if (res === 'cancelled') { prevStatus.textContent = '✘ 沒有匯出（剛才取消了）。要找回之前，一定要先匯出一份目前的資料。'; return; }
          savedCurrent = true; savePrev.disabled = true;
          prevStatus.textContent = '✔ 目前的資料已經匯出一份了。';
          refresh();
        } catch (e) { prevStatus.textContent = '✘ 沒有匯出成功：' + (e.message || e); }
      });
    }
    go.addEventListener('click', async () => {
      go.disabled = true; go.textContent = '找回中…';
      const same = await backup.restore(r.payload);
      await ctx.applyFont();
      out.replaceChildren(
        h('p', { class: same ? 'big st-text-paid' : 'bad' }, same ? '✔ 找回完成，內容與備份完全相同。' : '✘ 找回後的內容與備份不一樣，請聯絡開發者。'),
        h('a', { class: 'btn', href: '#/' }, '回到收租表'));
    });
    out.replaceChildren(info,
      hasData ? h('div', { class: 'warnbox' }, h('p', null, '這支手機上已經有資料，找回會整個換掉。'), savePrev, prevStatus) : null,
      typed, go);
  });
  return page;
}
