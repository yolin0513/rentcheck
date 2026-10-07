// 小工具：建立元素、按住 N 秒的按鈕、狀態文字。

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : String(c));
  }
  return el;
}

export const STATUS = {
  paid: { icon: '✔', text: '已收', cls: 'st-paid' },
  note: { icon: '！', text: '沒收', cls: 'st-note' },
  due: { icon: '●', text: '該收了', cls: 'st-due' },
  notyet: { icon: '○', text: '還沒到', cls: 'st-notyet' },
};
/** 有原因時，格子上顯示原因的前三個字（格子窄，放不下全文；全文在點進去的頁面） */
export function statusLine(status, payment) {
  const s = STATUS[status];
  if (status === 'note') return `${s.icon} ${Array.from(payment.note).slice(0, 3).join('')}`;
  return `${s.icon} ${s.text}`;
}

/**
 * 要「按住 ms 毫秒」才會觸發的按鈕（防止誤觸進入設定）。
 * 只點一下：呼叫 onShort（顯示說明），不進去。
 */
export function holdButton(label, ms, onDone, onShort) {
  const fill = h('span', { class: 'hold-fill', 'aria-hidden': 'true' });
  const text = h('span', { class: 'hold-label' }, label);
  const btn = h('button', { type: 'button', class: 'hold' }, fill, text);
  let timer = null, start = 0, raf = 0;
  const reset = () => {
    clearTimeout(timer); timer = null; cancelAnimationFrame(raf);
    btn.classList.remove('pressing'); btn.style.setProperty('--p', '0'); text.textContent = label;
  };
  const tick = () => {
    if (!timer) return;
    btn.style.setProperty('--p', String(Math.min(1, (performance.now() - start) / ms)));
    raf = requestAnimationFrame(tick);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    start = performance.now();
    btn.classList.add('pressing');
    text.textContent = '繼續按住…';
    timer = setTimeout(() => { timer = null; reset(); onDone(); }, ms);
    tick();
  });
  const end = () => { if (timer) { reset(); onShort && onShort(); } };
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', () => { if (timer) reset(); });
  btn.addEventListener('pointerleave', () => { if (timer) reset(); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // 鍵盤／輔助使用：按 Enter 不算數（同樣要按住）；只顯示說明
  btn.addEventListener('click', (e) => { if (e.detail === 0) onShort && onShort(); });
  return btn;
}

/** 畫面底部短暫顯示一行字（給設定頁用；主要流程不依賴它） */
export function toast(msg, ms = 2500) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function fmtMB(n) { return n == null ? '—' : (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB'; }
export function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
