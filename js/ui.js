// 小工具：建立元素、把子元素放進去、頁首標題列、按住 N 秒的按鈕、狀態文字。
//
// 2026-10-07 實機發現畫面上出現「null」「nullnull」：h() 會略過 null，但瀏覽器原生的 append()／replaceChildren()
// 不會——它們把 null 轉成文字「null」。畫面程式裡「有就顯示、沒有就 null」的寫法很多，直接交給原生方法就會漏。
// 所以：畫面程式一律用這裡的 add()／fill()（和 h() 用同一個 nodes()），不直接呼叫原生 append／prepend／replaceChildren。
// scripts/staticcheck.mjs 會擋直接呼叫；端對端測試會擋畫面上出現 null／undefined／NaN。

// 2026-10-08 Yolin（森林主題）：深綠的「✔ 收到了」按鈕上，字是白的、勾卻是深灰黑，幾乎看不見、也沒對齊。
// 根因：✔ ◀ ▶ 📞 📷 都是「可以當 emoji 的字元」，iPhone 用 Apple 的 emoji 字型畫它們，顏色固定、不跟著文字顏色走——
// 三套主題、每一顆按鈕都一樣。所以不在個別按鈕上修：所有文字都經過 nodes()，在這裡把這些字元換成 SVG 圖示
// （線條用 currentColor＝跟文字同色），畫面程式照樣寫「'✔ 收到了'」。
// scripts/staticcheck.mjs 擋 textContent 直接塞這些字元（繞過 nodes()）；端對端測試擋畫面上出現任何 emoji 字元。
const ICONS = {
  '✔': ['M4.5 12.5l5 5L19.5 7', 'stroke'],
  '◀': ['M16 5L7 12l9 7z', 'fill'],
  '▶': ['M8 5l9 7-9 7z', 'fill'],
  '📞': ['M7.2 3.5l2.6 4.2-1.9 2a12 12 0 0 0 6.4 6.4l2-1.9 4.2 2.6-.9 3.4c-.2.7-.9 1.2-1.6 1.1C10.4 20.9 3.1 13.6 2.6 6c0-.7.4-1.4 1.1-1.6z', 'fill'],
  '📷': ['M4 7.5h3.2L9 5h6l1.8 2.5H20a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1zM12 9.8a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z', 'stroke'],
};
const ICON_RE = new RegExp(`(${Object.keys(ICONS).join('|')})\uFE0F?`, 'u');
/** 一個跟著文字顏色走的圖示（SVG，大小＝1 個字） */
export function icon(ch) {
  const [d, mode] = ICONS[ch];
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.icon = ch;
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  if (mode === 'fill') { path.setAttribute('fill', 'currentColor'); } else {
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  }
  svg.appendChild(path);
  return svg;
}
/** 一段文字 → 文字節點與圖示（遇到 ✔ ◀ ▶ 📞 📷 換成 SVG） */
function textNodes(str) {
  const out = [];
  for (const [i, part] of str.split(ICON_RE).entries()) {
    if (i % 2) out.push(icon(part)); else if (part) out.push(document.createTextNode(part));
  }
  return out;
}

/** 子元素清單 → 真正要放進去的節點：攤平、略過 null／undefined／false、其他值轉成文字（圖示字元換成 SVG） */
export function nodes(kids) {
  const out = [];
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    if (c.nodeType) out.push(c); else out.push(...textNodes(String(c)));
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
/**
 * 格子上的狀態文字。有原因時：短的（≤ 6 個字，例如預設的「說晚點給」「聯絡不到」）整句顯示、可以換行；
 * 長的不顯示半句（半句話比不顯示更糟，長輩看不懂），改成「看原因」，完整原因在點進去的頁面。
 * 2026-10-07 Yolin 實機看到「！說晚點」「！聯絡不」——舊版只取前三個字。
 */
export const NOTE_MAX_ON_TILE = 6;
export function statusLine(status, payment) {
  const s = STATUS[status];
  if (status === 'note') {
    const note = String(payment.note).trim();
    return Array.from(note).length <= NOTE_MAX_ON_TILE ? `${s.icon} ${note}` : `${s.icon} 看原因`;
  }
  return `${s.icon} ${s.text}`;
}

/**
 * 頁面最下面的返回鍵：每一頁都在同一個位置（最後一顆）、同一個樣式（.btn.back），而且不是主按鈕——
 * 主按鈕留給那一頁真正的動作（2026-10-07 Yolin：已收的頁把「回收租表」做成最醒目的實心按鈕，層級是反的）。
 */
/**
 * 地址、門牌 → 一段一段（「中和區｜永和路｜60號｜1樓」），每段是 inline-block：放不下時整段換到下一行，
 * 數字和單位不會被拆開（2026-10-08 實機看到「中和區永和路60／號1樓」，像壞掉）。
 * 只有一段本身就比一整行還寬時，才會在段內換行（不裁字、不縮字）。
 */
const ADDR_RE = /.+?(?:大道|[縣市區鄉鎮村里路街段巷弄號樓室])(?:之[0-9０-９一二三四五六七八九十]+)?|.+$/gu;
export function addrChunks(s) { return String(s).match(ADDR_RE) || []; }
export function addrNodes(s) {
  const out = [];
  for (const [i, part] of addrChunks(s).entries()) {
    if (i) out.push(document.createElement('wbr'));
    out.push(h('span', { class: 'addr-part' }, part));
  }
  return out;
}

export function backButton(href, label) {
  return h('a', { class: 'btn back', href, 'data-act': 'bottom-back' }, '‹ ', label);
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

/**
 * 「確定收到」那一刻的打勾動畫：疊在收租表上、pointer-events: none，不擋任何操作。
 * 呼叫的時候資料已經存好、畫面已經換好——動畫只是回饋，不是關卡。
 * 每段動畫 ≤ 300ms（CSS）；關掉動畫時（iOS「減少動態效果」或設定裡關掉）一樣顯示，只是不動。
 */
export function celebrate(title, sub) {
  // 連續按好幾戶時，舊的那一個先拿掉——不然最上面看到的是「前一戶」（2026-10-07 端對端測試抓到）
  document.querySelectorAll('[data-celebrate]').forEach((x) => x.remove());
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 52 52');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('class', 'cel-check');
  path.setAttribute('d', 'M14 27 L23 36 L39 18');
  svg.appendChild(path);
  const ov = h('div', { class: 'celebrate', role: 'status', 'aria-live': 'polite', 'data-celebrate': '' },
    h('div', { class: 'cel-card' }, h('div', { class: 'cel-ring' }, svg), h('div', { class: 'cel-title' }, title), sub ? h('div', { class: 'cel-sub' }, sub) : null));
  add(document.body, ov);
  setTimeout(() => ov.classList.add('out'), 900);
  setTimeout(() => ov.remove(), 1200);
  return ov;
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
