// 主畫面：一個月 × 所有租客，2 欄 × 5 列的房間格。位置固定、照門牌排，不依狀態移動。

import * as store from '../store.js';
import { h, add, holdButton, statusLine, STATUS, toast, addrNodes } from '../ui.js';
import { ymOf, isoDate, addMonths, monthName, yearOf, isActive, cellStatus, shortDate } from '../months.js';

export const REMIND_DAYS = 30;        // 距上次傳出超過幾天，就在格子上方提醒
export const FIRST_REMIND_DAYS = 7;   // 從沒匯出過：第一筆資料滿幾天後提醒（剛設定完通常會當場先匯出第一份）
export const SNOOZE_DAYS = 7;

export async function loadMonth(ym) {
  const [all, pays, s] = await Promise.all([store.tenants(), store.paymentsFor(ym), store.settings()]);
  const today = isoDate();
  const cells = all.filter((t) => isActive(t, ym)).map((t) => {
    const p = pays[t.id];
    return { t, p, status: cellStatus({ payment: p, ym, dueDay: t.dueDay, today }) };
  });
  return { all, cells, s, ym, today };
}

/** 建出房間格（不含提醒與底部），量測「一屏放不放得下」時也用這一支 */
export function buildTiles(cells, ym, justChanged = null) {
  return h('div', { class: 'grid', role: 'list' }, cells.map(({ t, p, status }) =>
    h('a', { class: `tile ${STATUS[status].cls}${t.id === justChanged ? ' just-changed' : ''}`, href: `#/t/${encodeURIComponent(t.id)}/${ym}`, role: 'listitem', dataset: { status, tenant: t.id } },
      h('span', { class: 'tile-label' }, addrNodes(t.label)),
      t.name ? h('span', { class: 'tile-name' }, t.name) : null,   // 2026-10-07 Yolin：門牌下面加稱呼
      h('span', { class: 'tile-status' }, statusLine(status, p)))));
}

export function buildHeader(ym, cells) {
  const cur = ymOf();
  const paid = cells.filter((c) => c.status === 'paid').length;
  const left = cells.length - paid;
  const summary = ym !== cur
    // 「回到本月」要明確指向本月：#/ 這個路由沿用「目前看的月份」（從詳情頁、設定回來時要停在原來那個月），
    // 2026-10-08 Yolin 實機：連到 #/ 按了沒反應——一直停在原來那個月
    ? h('div', { class: 'summary other' }, `這是 ${monthName(ym)}的紀錄　`, h('a', { href: `#/m/${cur}`, class: 'linkbtn', 'data-act': 'this-month' }, '回到本月'))
    : h('div', { class: 'summary' }, left === 0 && cells.length ? '這個月全部收齊了 ✔'
      : ['已收 ', h('span', { class: 'num' }, String(paid)), ' 戶　還有 ', h('span', { class: 'num' }, String(left)), ' 戶']);
  const pct = cells.length ? Math.round((paid / cells.length) * 100) : 0;
  return h('header', { class: 'monthbar-wrap' },
    h('div', { class: 'monthbar' },
      h('a', { class: 'navbtn', href: `#/m/${addMonths(ym, -1)}` }, '◀ 上月'),
      h('div', { class: 'monthtitle' }, h('span', { class: 'mname' }, monthName(ym)), h('span', { class: 'myear' }, `${yearOf(ym)} 年`)),
      h('a', { class: 'navbtn', href: `#/m/${addMonths(ym, 1)}` }, '下月 ▶')),
    summary,
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(cells.length), 'aria-valuenow': String(paid), 'aria-label': '本月已收' },
      h('div', { class: 'progress-fill', style: `--pct:${pct}%` })));
}

/** 要不要在格子上方提醒傳備份（語氣溫和、可延 7 天、不能永久關閉） */
export function needsReminder(s, now = Date.now()) {
  if (s.unsent <= 0) return false;
  if (s.backupSnoozeUntil && new Date(s.backupSnoozeUntil).getTime() > now) return false;
  const since = (iso) => now - new Date(iso).getTime();
  if (s.lastBackupAt) return since(s.lastBackupAt) > REMIND_DAYS * 86400000;
  return !!s.firstChangeAt && since(s.firstChangeAt) > FIRST_REMIND_DAYS * 86400000;
}

/** 提醒條：最多兩行、整條就是按鈕（「這週先不要」在備份頁）——不把房間格擠出畫面太多 */
export function buildReminder(s) {
  return h('a', { class: 'remind', href: '#/backup?from=remind', role: 'note' },
    s.lastBackupAt ? '好一陣子沒有匯出備份了，按這裡匯出 ›' : '還沒有匯出過備份，按這裡匯出 ›');
}

/** 剛改過狀態的那一格（只用一次：彈一下之後就清掉） */
function takeJustChanged(ctx) { const id = ctx.state.justChanged; ctx.state.justChanged = null; return id; }

export async function renderGrid(ctx) {
  const ym = ctx.state.ym;
  const { all, cells, s } = await loadMonth(ym);

  if (!all.length) return emptyState(ctx);

  const page = h('div', { class: 'page grid-page' });
  add(page,
    buildHeader(ym, cells),
    needsReminder(s) ? buildReminder(s) : null,
    cells.length ? buildTiles(cells, ym, takeJustChanged(ctx)) : h('p', { class: 'muted center' }, '這個月沒有在租的租客。'));
  const bar = buildFootbar(s, ctx);
  // 底部那一條的高度隨字級改變：量到多高，房間格下面就留多高（捲到底時最後一列要完整看得到）
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { if (bar.isConnected) document.documentElement.style.setProperty('--footbar-h', `${bar.offsetHeight}px`); }).observe(bar);
  }
  // 放在 .page 外面：.page 有進場動畫（transform），fixed 的元素放在裡面會跟著動
  return h('div', { class: 'grid-screen' }, page, bar);
}

/** 進設定要按住多久。2026-10-08 Yolin：3 秒太久、按鈕上的「（按住 3 秒）」拿掉；1 秒仍比單擊長很多，防誤觸的目的還在 */
export const SETTINGS_HOLD_MS = 1000;

/** 收租表最下面固定的一條：「匯出備份（第二行：上次匯出的日期）」＋「設定」。越矮越好——它蓋在房間格上面 */
export function buildFootbar(s, ctx) {
  const last = s.lastBackupAt ? `上次 ${shortDate(isoDate(new Date(s.lastBackupAt)))}` : '還沒匯出過';
  return h('footer', { class: 'footbar', 'data-footbar': '' },
    h('div', { class: 'footbar-inner' },
      h('div', { class: 'footbar-row' },
        h('a', { class: 'btn secondary', href: '#/backup', 'data-act': 'foot-backup' }, h('span', { class: 'fb-main' }, '匯出備份'), h('span', { class: 'fb-sub', 'data-last-backup': '' }, last)),
        holdButton('設定', SETTINGS_HOLD_MS, () => ctx && ctx.enterEdit(), () => toast('按住不放，才會打開設定')))));
}

function emptyState(ctx) {
  // 沒有任何資料：可能是第一次用，也可能是被 iPhone 清掉了。App 分不出來，所以兩條路都給。
  return h('div', { class: 'page empty' },
    h('header', { class: 'topbar' }, h('span', { class: 'backspace' }), h('h1', { class: 'topbar-title' }, '收租紀錄'), h('span', { class: 'backspace' })),
    h('section', { class: 'card' },
      h('p', { class: 'lead' }, '這裡還沒有紀錄。'),
      h('p', { class: 'lead' }, '如果以前用過、紀錄卻不見了，可以用之前匯出的備份檔找回來。')),
    h('a', { class: 'btn', href: '#/restore' }, '從備份找回'),
    h('button', { type: 'button', class: 'btn secondary', onclick: () => ctx.enterEdit() }, '第一次使用：開始設定'));
}
