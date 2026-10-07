// 從備份找回（晚輩做）。手機上已有資料時：先把目前的資料存一份、再輸入「找回」才覆蓋。

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
      h('li', null, '把最新的備份檔存進這支 iPhone 的「檔案」：在 LINE 點開備份檔 → 分享 →「儲存到檔案」→「我的 iPhone」。'),
      h('li', null, '按下面的「選擇檔案」→ 瀏覽 → 我的 iPhone → 選那個檔。')),
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
    const savePrev = h('button', { type: 'button', class: 'btn secondary', 'data-act': 'save-current' }, '先把目前的資料存一份');
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
          if (res === 'cancelled') { prevStatus.textContent = '沒有存到。要找回之前，一定要先存一份。'; return; }
          savedCurrent = true; savePrev.disabled = true;
          prevStatus.textContent = '✔ 目前的資料已經存一份了。';
          refresh();
        } catch (e) { prevStatus.textContent = '沒有存成功：' + (e.message || e); }
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
