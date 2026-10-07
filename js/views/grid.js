// 主畫面：一個月 × 所有租客，2 欄 × 5 列的房間格。位置固定、照門牌排，不依狀態移動。

import * as store from '../store.js';
import { h, holdButton, statusLine, STATUS, toast } from '../ui.js';
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
export function buildTiles(cells, ym) {
  return h('div', { class: 'grid', role: 'list' }, cells.map(({ t, p, status }) =>
    h('a', { class: `tile ${STATUS[status].cls}`, href: `#/t/${encodeURIComponent(t.id)}/${ym}`, role: 'listitem', dataset: { status, tenant: t.id } },
      h('span', { class: 'tile-label' }, t.label),
      h('span', { class: 'tile-status' }, statusLine(status, p)))));
}

export function buildHeader(ym, cells) {
  const cur = ymOf();
  const paid = cells.filter((c) => c.status === 'paid').length;
  const left = cells.length - paid;
  const summary = ym !== cur
    ? h('div', { class: 'summary other' }, `這是 ${monthName(ym)}的紀錄　`, h('a', { href: '#/', class: 'linkbtn' }, '回到本月'))
    : h('div', { class: 'summary' }, left === 0 && cells.length ? '這個月全部收齊了 ✔' : `已收 ${paid} 戶　還有 ${left} 戶`);
  return h('header', { class: 'monthbar-wrap' },
    h('div', { class: 'monthbar' },
      h('a', { class: 'navbtn', href: `#/m/${addMonths(ym, -1)}` }, '◀ 上月'),
      h('div', { class: 'monthtitle' }, h('span', { class: 'mname' }, monthName(ym)), h('span', { class: 'myear' }, `${yearOf(ym)} 年`)),
      h('a', { class: 'navbtn', href: `#/m/${addMonths(ym, 1)}` }, '下月 ▶')),
    summary);
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

export async function renderGrid(ctx) {
  const ym = ctx.state.ym;
  const { all, cells, s } = await loadMonth(ym);

  if (!all.length) return emptyState(ctx);

  const page = h('div', { class: 'page grid-page' });
  page.append(buildHeader(ym, cells));

  if (needsReminder(s)) page.append(buildReminder(s));

  page.append(cells.length ? buildTiles(cells, ym) : h('p', { class: 'muted center' }, '這個月沒有在租的租客。'));

  page.append(h('footer', { class: 'grid-foot' },
    h('p', { class: 'muted center' }, s.lastBackupAt ? `上次匯出備份：${shortDate(isoDate(new Date(s.lastBackupAt)))}` : '還沒有匯出過備份'),
    h('a', { class: 'btn secondary small', href: '#/backup' }, '匯出備份'),
    holdButton('設定（按住 3 秒）', 3000, () => ctx.enterEdit(), () => toast('要按住 3 秒才會打開設定'))));
  return page;
}

function emptyState(ctx) {
  // 沒有任何資料：可能是第一次用，也可能是被 iPhone 清掉了。App 分不出來，所以兩條路都給。
  return h('div', { class: 'page empty' },
    h('h1', null, '收租紀錄'),
    h('p', { class: 'lead' }, '這裡還沒有紀錄。'),
    h('p', { class: 'lead' }, '如果以前用過、紀錄卻不見了，可以用之前匯出的備份檔找回來。'),
    h('a', { class: 'btn', href: '#/restore' }, '從備份找回'),
    h('button', { type: 'button', class: 'btn secondary', onclick: () => ctx.enterEdit() }, '第一次使用：開始設定'));
}
