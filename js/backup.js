// 備份的瀏覽器端：從 IndexedDB 收集 → 產生 .html 檔 → 叫出分享畫面；以及從檔案還原。
//
// iPhone 只在「剛按下按鈕」的那一下允許叫出分享畫面。產生檔案要時間，
// 所以一律「先準備好檔案，再讓使用者按按鈕分享」——prepare() 與 share() 分開。

import * as db from './db.js';
import * as store from './store.js';
import { buildPayload, renderBackupHtml, extractPayload, verifyPayload, contentHash, backupFileName, b64ToBytes } from './backupcore.js';

export const PHOTO_WINDOW_MONTHS = 24;   // 每份備份帶最近 24 個月的照片（更舊的靠年度照片檔，尚未實作）
export const SIZE_WARN_BYTES = 45 * 1048576; // LINE Keep 50 MB 以下不過期（二手來源），留一點餘裕

export function screenSig() { return `${screen.width}x${screen.height}`; }

export async function collect() {
  const s = await store.settings();
  const [tenants, payments, photos, log] = await Promise.all([db.getAll('tenants'), db.getAll('payments'), db.getAll('photos'), store.recentLog(500)]);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - PHOTO_WINDOW_MONTHS);
  const used = new Set(payments.flatMap((p) => p.photoIds || []));
  const keep = photos.filter((p) => !p.deletedAt && used.has(p.id) && p.createdAt >= cutoff.toISOString());
  const photoBytes = await Promise.all(keep.map(async (p) => ({ id: p.id, type: p.blob.type || p.type, createdAt: p.createdAt, bytes: new Uint8Array(await p.blob.arrayBuffer()) })));
  // 被時間窗排除的照片：收款紀錄裡仍留著 id，但備份裡沒有檔案
  const meta = Object.fromEntries(store.PORTABLE_META.map((k) => [k, s[k]]));
  return { settings: s, meta, tenants, payments, photos: photoBytes, log: log.reverse() };
}

/** 準備好一份備份檔：{ file, seq, bytes, payload } */
export async function prepare() {
  const c = await collect();
  const payload = await buildPayload({ meta: c.meta, tenants: c.tenants, payments: c.payments, photos: c.photos, log: c.log });
  const html = renderBackupHtml(payload);
  const file = new File([html], backupFileName(), { type: 'text/html' });
  return { file, seq: c.settings.changeSeq, bytes: file.size, payload };
}

export function canShareFile(file) {
  try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch { return false; }
}

/**
 * 分享（或不支援時下載）。必須在按鈕的 click 裡直接呼叫。
 * 回傳 'shared' | 'downloaded' | 'cancelled'；其他錯誤丟出去。
 */
export async function share(prepared) {
  const f = prepared.file;
  if (canShareFile(f)) {
    try {
      await navigator.share({ files: [f], title: f.name });
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      throw e;
    }
    await store.markBackedUp({ seq: prepared.seq, bytes: prepared.bytes, how: 'shared' });
    return 'shared';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f);
  a.download = f.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  await store.markBackedUp({ seq: prepared.seq, bytes: prepared.bytes, how: 'downloaded' });
  return 'downloaded';
}

/** 讀檔並驗證：{ payload, ok, summary } */
export async function readBackupFile(file) {
  const text = await file.text();
  const payload = extractPayload(text);
  const ok = await verifyPayload(payload);
  return {
    payload, ok,
    summary: { exportedAt: payload.exportedAt, tenants: payload.tenants.length, payments: payload.payments.length, photos: payload.photos.length,
      months: new Set(payload.payments.map((x) => x.month)).size },
  };
}

/** 還原，並重新從資料庫算一次雜湊，確定寫進去的和備份一模一樣 */
export async function restore(payload) {
  const photoBlobs = payload.photos.map((x) => {
    const bytes = b64ToBytes(x.b64);
    const blob = new Blob([bytes], { type: x.type });
    return { id: x.id, blob, type: x.type, bytes: blob.size, createdAt: x.createdAt, deletedAt: null };
  });
  await store.replaceAll(payload, { photoBlobs, screenSig: screenSig() });
  const c = await collect();
  const h = await contentHash({ tenants: c.tenants, payments: c.payments, photos: c.photos });
  return h === payload.hash;
}
