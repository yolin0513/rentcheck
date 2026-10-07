// 啟動、路由、設定模式。
// 原則：App 裡**沒有任何依賴 iOS 版本號或瀏覽器識別字串的邏輯**——Safari 26 起回報的 iOS 版本被固定成 18.x，
// 拿它判斷一定會錯。一律用功能偵測（matchMedia、navigator.storage、navigator.canShare）。
// scripts/staticcheck.mjs 會擋下 userAgent 這類字樣。

import * as store from './store.js';
import { ymOf } from './months.js';
import { VERSION } from './version.js';
import { renderGrid } from './views/grid.js';
import { renderTenantPage } from './views/tenant.js';
import { renderBackupPage, renderDonePrompt } from './views/backupview.js';
import { renderRestorePage } from './views/restore.js';
import { renderSettings, renderTenantForm } from './views/settings.js';
import { renderInstall } from './views/install.js';
import { h, fill } from './ui.js';

const EDIT_IDLE_MS = 3 * 60 * 1000;
const PREVIEW_KEY = 'rentcheck-preview';

export const state = {
  ym: ymOf(),
  edit: false,
  editTimer: null,
  preview: false,
  standalone: false,
  justChanged: null,   // 剛改過狀態的那一格（回到收租表時彈一下）
};

export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

// ---------- 設定模式 ----------
export function enterEdit() {
  state.edit = true;
  bumpEdit();
  go('#/settings');
}
export function exitEdit() {
  state.edit = false;
  clearTimeout(state.editTimer);
  document.body.classList.remove('editing');
  go('#/');
}
function bumpEdit() {
  if (!state.edit) return;
  clearTimeout(state.editTimer);
  state.editTimer = setTimeout(() => { if (state.edit) exitEdit(); }, EDIT_IDLE_MS);
}
addEventListener('pointerdown', bumpEdit, true);
addEventListener('keydown', bumpEdit, true);
document.addEventListener('visibilitychange', () => {
  // App 切到背景就離開設定：忘了按「離開」，下次打開也一定是收租表
  if (document.visibilityState === 'hidden' && state.edit) exitEdit();
});

// ---------- 字的大小 ----------
export async function applyFont(step) {
  const s = await store.settings();
  const root = document.documentElement;
  root.dataset.font = step || s.fontStep;
  root.dataset.theme = s.theme;
  root.dataset.motion = s.motion;
}

// ---------- 路由 ----------
const app = () => document.getElementById('app');
let renderSeq = 0;

export async function render() {
  const seq = ++renderSeq;
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('?')[0].split('/').map(decodeURIComponent);
  const ctx = { state, go, render, enterEdit, exitEdit, applyFont, version: VERSION };
  let view;
  try {
    if (!state.standalone && !state.preview) {
      view = renderInstall(ctx, { onPreview: () => { sessionStorage.setItem(PREVIEW_KEY, '1'); state.preview = true; go('#/'); } });
    } else if (parts[0] === 't' && parts[1] && parts[2]) {
      view = await renderTenantPage(ctx, parts[1], parts[2], parts[3] || '');
    } else if (parts[0] === 'backup') {
      view = await renderBackupPage(ctx);
    } else if (parts[0] === 'done' && parts[1]) {
      view = await renderDonePrompt(ctx, parts[1]);
    } else if (parts[0] === 'restore') {
      view = await renderRestorePage(ctx);
    } else if (parts[0] === 'settings') {
      if (!state.edit) { go('#/'); return; }
      view = parts[1] === 'tenant' ? await renderTenantForm(ctx, parts[2]) : await renderSettings(ctx);
    } else {
      if (parts[0] === 'm' && /^\d{4}-\d{2}$/.test(parts[1] || '')) state.ym = parts[1];
      else if (!parts[0]) state.ym = state.ym || ymOf();
      view = await renderGrid(ctx);
    }
  } catch (e) {
    console.error(e);
    view = h('div', { class: 'page' }, h('h1', null, '出了點問題'), h('p', { class: 'muted' }, String((e && e.message) || e)), h('a', { class: 'btn', href: '#/' }, '回到收租表'));
  }
  if (seq !== renderSeq) return; // 有更新的一次 render 在跑，這一次作廢
  document.body.classList.toggle('editing', state.edit && hash.startsWith('#/settings'));
  const root = app();
  fill(root, state.preview && !state.standalone ? previewBanner() : null, view);
  window.scrollTo(0, 0);
  document.body.dataset.rendered = String(Number(document.body.dataset.rendered || 0) + 1); // 給自動測試等「畫完了」
}

function previewBanner() {
  return h('div', { class: 'preview-banner' }, '預覽模式（瀏覽器分頁）：這裡的資料可能被 iPhone 清掉。正式使用請從主畫面的圖示打開。');
}

// ---------- 啟動 ----------
async function boot() {
  state.standalone = isStandalone();
  try { state.preview = sessionStorage.getItem(PREVIEW_KEY) === '1'; } catch { state.preview = false; }
  await applyFont();
  addEventListener('hashchange', render);
  await render();
  if ('serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
boot();
