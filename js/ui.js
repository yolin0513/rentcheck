// 小工具：建立元素、把子元素放進去、頁首標題列、按住 N 秒的按鈕、狀態文字。
//
// 2026-10-07 實機發現畫面上出現「null」「nullnull」：h() 會略過 null，但瀏覽器原生的 append()／replaceChildren()
// 不會——它們把 null 轉成文字「null」。畫面程式裡「有就顯示、沒有就 null」的寫法很多，直接交給原生方法就會漏。
// 所以：畫面程式一律用這裡的 add()／fill()（和 h() 用同一個 nodes()），不直接呼叫原生 append／prepend／replaceChildren。
// scripts/staticcheck.mjs 會擋直接呼叫；端對端測試會擋畫面上出現 null／undefined／NaN。

/** 子元素清單 → 真正要放進去的節點：攤平、略過 null／undefined／false、其他值轉成文字 */
export function nodes(kids) {
  const out = [];
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    out.push(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return out;
}
/** 在 el 後面加子元素（略過 null） */
export function add(el, ...kids) { for (const n of nodes(kids)) el.appendChild(n); return el; }
/** 把 el 的內容換成這些子元素（略過 null） */
export function fill(el, ...kids) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return add(el, ...kids);
}

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
  return add(el, ...children);
}

/**
 * 每一頁最上面的標題列：左邊是夠大的返回鍵（寫字，不只用箭頭——長輩不一定看得懂圖示），中間是頁面名稱。
 * back 不給就只有標題（例如安裝說明頁）。
 */
export function topbar(title, back, backLabel = '回收租表') {
  return h('header', { class: 'topbar' },
    back ? h('a', { class: 'backbtn', href: back, 'data-act': 'back' }, h('span', { class: 'backarrow', 'aria-hidden': 'true' }, '‹'), backLabel) : h('span', { class: 'backspace' }),
    h('h1', { class: 'topbar-title' }, title),
    h('span', { class: 'backspace' }));
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
  const fillEl = h('span', { class: 'hold-fill', 'aria-hidden': 'true' });
  const text = h('span', { class: 'hold-label' }, label);
  const btn = h('button', { type: 'button', class: 'hold' }, fillEl, text);
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
  add(document.body, t);
  setTimeout(() => t.remove(), ms);
}

export function fmtMB(n) { return n == null ? '—' : (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB'; }
export function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
