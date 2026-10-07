// 點一格之後：這位租客這個月的頁面。步驟：'' 主頁、'confirm' 確認收款、'note' 記原因。

import * as store from '../store.js';
import { h, add, fill, topbar, toast, STATUS, statusLine } from '../ui.js';
import { monthName, money, shortDate, isoDate, dueDayIn, isActive, cellStatus } from '../months.js';
import { compress } from '../photos.js';

// 確認頁上「還沒按確定」的照片，暫存在記憶體（切頁面就丟掉）
const pending = { key: '', photoIds: [] };

export async function renderTenantPage(ctx, id, ym, step) {
  const t = await store.tenant(id);
  if (!t || !isActive(t, ym)) {
    return h('div', { class: 'page' }, topbar('找不到', '#/'), h('div', { class: 'card' }, h('p', null, '找不到這位租客。')));
  }
  const p = await store.payment(id, ym);
  const s = await store.settings();
  const back = `#/m/${ym}`;
  const self = `#/t/${encodeURIComponent(t.id)}/${ym}`;
  const who = h('div', { class: 'who' }, h('div', { class: 'who-label' }, t.label), t.name ? h('div', { class: 'who-name' }, t.name) : null);

  if (step === 'confirm') return confirmPage(ctx, t, ym, p, self, who);
  if (step === 'note') return notePage(ctx, t, ym, p, self, who, s);

  const status = cellStatus({ payment: p, ym, dueDay: t.dueDay, today: isoDate() });
  const chip = h('span', { class: `chip ${STATUS[status].cls}` }, statusLine(status, p));
  const page = h('div', { class: 'page tenant-page' }, topbar(`${monthName(ym)}的租金`, back));
  if (p && p.status === 'paid') {
    add(page,
      h('section', { class: 'card' }, who, chip,
        h('p', { class: 'big st-text-paid' }, `已收 ${money(p.amount)} 元`),
        h('p', { class: 'muted' }, `${shortDate(p.paidOn)} 收`),
        photoStrip(ctx, t, ym, p)),
      h('a', { class: 'btn', href: back }, '回收租表'),
      h('button', { type: 'button', class: 'btn secondary', onclick: async () => { await store.markUnpaid(t, ym); ctx.go(back); } }, '改回「沒收到」'));
  } else {
    add(page,
      h('section', { class: 'card' }, who, chip,
        h('p', { class: 'big' }, `${money(t.rent)} 元`),
        h('p', { class: 'muted' }, `每月 ${dueDayIn(ym, t.dueDay)} 號繳`),
        p && p.note ? h('p', { class: 'note-box' }, `還沒收的原因：${p.note}`) : null,
        p && p.photoIds && p.photoIds.length ? photoStrip(ctx, t, ym, p) : null),
      h('a', { class: 'btn primary', href: `${self}/confirm` }, '✔ 收到了'),
      h('a', { class: 'btn secondary', href: `${self}/note` }, p && p.note ? '改還沒收的原因' : '還沒收，記個原因'),
      h('a', { class: 'btn secondary', href: back }, '回收租表'));
  }
  return page;
}

function confirmPage(ctx, t, ym, p, self, who) {
  const key = `${t.id}:${ym}`;
  if (pending.key !== key) { pending.key = key; pending.photoIds = []; }
  const amount = h('input', { type: 'number', inputmode: 'numeric', class: 'field', value: String(t.rent), 'aria-label': '金額' });
  const date = h('input', { type: 'date', class: 'field', value: isoDate(), 'aria-label': '收款日' });
  const more = h('div', { class: 'more', hidden: true },
    h('label', null, '金額（元）', amount), h('label', null, '收款日', date));
  const amountText = h('span', null, `${money(t.rent)} 元？`);
  amount.addEventListener('input', () => { amountText.textContent = `${money(amount.value)} 元？`; });
  const thumbs = h('div', { class: 'thumbs' });
  const fileIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const photoBtn = h('button', { type: 'button', class: 'btn secondary' }, '📷 拍收據（可不拍）');
  const drawThumbs = async () => {
    const imgs = [];
    for (const id of pending.photoIds) {
      const ph = await store.photo(id);
      if (ph) imgs.push(h('img', { src: URL.createObjectURL(ph.blob), alt: '收據', class: 'thumb' }));
    }
    fill(thumbs, imgs);
    photoBtn.hidden = pending.photoIds.length + ((p && p.photoIds) || []).length >= 2;
  };
  photoBtn.addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    if (!f) return;
    photoBtn.disabled = true; photoBtn.textContent = '處理照片中…';
    try {
      const out = await compress(f);
      pending.photoIds.push(await store.savePhoto(out));
    } catch (e) { toast(e.message || '照片存不起來'); }
    photoBtn.disabled = false; photoBtn.textContent = '📷 再拍一張（可不拍）';
    fileIn.value = '';
    drawThumbs();
  });
  drawThumbs();

  return h('div', { class: 'page tenant-page' },
    topbar('確定收到', self, '回上一頁'),
    h('section', { class: 'card confirm-card' },
      who,
      h('p', { class: 'big' }, `${monthName(ym)}　`, amountText),
      thumbs),
    photoBtn, fileIn,
    h('button', { type: 'button', class: 'btn primary', 'data-act': 'confirm', onclick: async (e) => {
      e.currentTarget.disabled = true;
      await store.markPaid(t, ym, { amount: amount.value || t.rent, paidOn: date.value || isoDate(), photoIds: pending.photoIds });
      pending.key = ''; pending.photoIds = [];
      tryPersist();
      ctx.go(await afterPaidTarget(ym, `#/m/${ym}`));
    } }, '✔ 確定收到'),
    h('a', { class: 'btn secondary', href: self }, '不是，回去'),
    h('button', { type: 'button', class: 'linkbtn', onclick: () => { more.hidden = !more.hidden; } }, '不是今天收的／金額不一樣？'),
    more);
}

/** 這個月剛好全部收齊、而且還有沒匯出的紀錄 → 問一次要不要匯出備份 */
async function afterPaidTarget(ym, back) {
  const [all, pays, s] = await Promise.all([store.tenants(), store.paymentsFor(ym), store.settings()]);
  const active = all.filter((x) => isActive(x, ym));
  const done = active.length > 0 && active.every((x) => pays[x.id] && pays[x.id].status === 'paid');
  if (done && s.unsent > 0 && !(s.completePrompted || {})[ym]) return `#/done/${ym}`;
  return back;
}

/** 在使用者按下按鈕的當下順便請求持久儲存（沒拿到才請；結果記下來，設定頁看得到） */
export async function tryPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return;
    if (await navigator.storage.persisted()) return;
    const r = await navigator.storage.persist();
    await store.setMeta('persist', { at: new Date().toISOString(), result: String(r) });
  } catch {}
}

function notePage(ctx, t, ym, p, self, who, s) {
  const ta = h('textarea', { class: 'field', rows: '3', placeholder: '也可以用鍵盤上的麥克風講', 'aria-label': '自己寫原因' });
  if (p && p.note && !s.noteOptions.includes(p.note)) ta.value = p.note;
  const save = async (text) => { await store.setNote(t, ym, text); ctx.go(`#/m/${ym}`); };
  return h('div', { class: 'page tenant-page' },
    topbar('還沒收的原因', self, '回上一頁'),
    h('section', { class: 'card' }, who, h('p', { class: 'muted' }, `${monthName(ym)}　選一個，或自己寫`)),
    s.noteOptions.map((o) => h('button', { type: 'button', class: 'btn secondary', onclick: () => save(o) }, o)),
    ta,
    h('button', { type: 'button', class: 'btn', onclick: () => save(ta.value) }, '存起來'),
    p && p.note ? h('button', { type: 'button', class: 'btn secondary', onclick: () => save('') }, '不用了，清掉原因') : null,
    h('a', { class: 'btn secondary', href: self }, '回上一頁'));
}

function photoStrip(ctx, t, ym, p) {
  const box = h('div', { class: 'thumbs' });
  (p.photoIds || []).forEach(async (id) => {
    const ph = await store.photo(id);
    if (!ph || ph.deletedAt) return;
    const url = URL.createObjectURL(ph.blob);
    add(box, h('button', { type: 'button', class: 'thumb-btn', onclick: () => viewer(ctx, t, ym, id, url) }, h('img', { src: url, alt: '收據照片', class: 'thumb' })));
  });
  return box;
}

function viewer(ctx, t, ym, id, url) {
  const ov = h('div', { class: 'viewer', role: 'dialog', 'aria-label': '收據照片' },
    h('img', { src: url, alt: '收據照片' }),
    h('button', { type: 'button', class: 'btn', onclick: () => ov.remove() }, '關閉'),
    h('button', { type: 'button', class: 'btn secondary', onclick: async () => {
      if (!confirm('要刪掉這張照片嗎？（設定裡的異動紀錄會記下來）')) return;
      await store.detachPhoto(t, ym, id);
      ov.remove();
      ctx.render();
    } }, '刪掉這張'));
  add(document.body, ov);
}
