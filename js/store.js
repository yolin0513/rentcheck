// 領域邏輯：租客、收款、照片、設定、異動紀錄。
// 每一次改資料都會：(1) 寫一筆異動紀錄 (2) changeSeq＋1。
// 「還沒傳出的變更」＝ changeSeq － backedUpSeq——這就是「萬一現在被清掉會損失多少」。

import * as db from './db.js';
import { naturalCompare, isoDate, autoLabels } from './months.js';

export const DEFAULTS = {
  fontStep: 'large',
  theme: 'warm',          // 外觀：warm（暖陽）／sky（晴空）／forest（森林）
  motion: 'auto',         // 動畫：auto（跟著 iPhone 的「減少動態效果」）／off（關掉）
  noteOptions: ['說晚點給', '分次給', '聯絡不到', '其他'],
  changeSeq: 0,
  backedUpSeq: 0,
  lastChangeAt: null,
  firstChangeAt: null,   // 第一次改資料的時間（還沒傳過備份時，用它算提醒）
  lastBackupAt: null,
  lastBackupBytes: null,
  lastBackupHow: null,
  backupSnoozeUntil: null,
  completePrompted: {},
  persist: null,          // { at, result }
  screenSig: null,        // 上次確認字級時的螢幕尺寸
  needFontCheck: false,
  restoredAt: null,
};
// 會跟著備份走的設定（其餘是這支手機自己的狀態）
export const PORTABLE_META = ['fontStep', 'theme', 'motion', 'noteOptions', 'screenSig'];

const nowISO = () => new Date().toISOString();
export function uid() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  return Date.now().toString(36) + [...r].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

export async function settings() {
  const rows = await db.getAll('meta');
  const o = { ...DEFAULTS };
  for (const r of rows) o[r.k] = r.v;
  o.unsent = Math.max(0, o.changeSeq - o.backedUpSeq);
  return o;
}
export async function setMeta(k, v) {
  await db.run(['meta'], 'readwrite', (s) => { s.meta.put({ k, v }); });
}

/** 改資料的唯一入口：資料、異動紀錄、changeSeq 在同一個交易裡一起寫 */
async function mutate(stores, fn, logEntry) {
  const cur = await settings();
  const all = [...new Set([...stores, 'meta', 'log'])];
  return db.run(all, 'readwrite', (s) => {
    const out = fn(s);
    s.meta.put({ k: 'changeSeq', v: cur.changeSeq + 1 });
    s.meta.put({ k: 'lastChangeAt', v: nowISO() });
    if (!cur.firstChangeAt) s.meta.put({ k: 'firstChangeAt', v: nowISO() });
    s.log.add({ at: nowISO(), ...logEntry });
    return out;
  });
}

// ---------- 租客 ----------
/** 格子名稱沒被手動改過（labelAuto）的，跟著所有門牌重新去掉共同前綴 */
function relabel(list) {
  const labels = autoLabels(list.map((x) => x.address));
  list.forEach((x, i) => { if (x.labelAuto) x.label = labels[i]; });
}
export async function tenants() {
  const list = await db.getAll('tenants');
  return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || naturalCompare(a.address, b.address));
}
export async function tenant(id) { return db.get('tenants', id); }

/** 新增：依門牌自然排序插到對的位置（不打亂手動調過的順序） */
export async function addTenant(data) {
  const list = await tenants();
  const t = { id: uid(), createdAt: nowISO(), updatedAt: nowISO(), endMonth: null, ...data };
  let idx = list.findIndex((x) => naturalCompare(x.address, t.address) > 0);
  if (idx < 0) idx = list.length;
  list.splice(idx, 0, t);
  list.forEach((x, i) => { x.order = i; });
  relabel(list);
  await mutate(['tenants'], (s) => { list.forEach((x) => s.tenants.put(x)); }, { kind: 'tenant-add', text: `新增租客 ${t.label}（${t.name || ''}）`, after: t });
  return t;
}
export async function updateTenant(id, patch) {
  const before = await tenant(id);
  if (!before) throw new Error('找不到這位租客');
  const after = { ...before, ...patch, updatedAt: nowISO() };
  const list = (await tenants()).map((x) => (x.id === id ? after : x));
  relabel(list);
  await mutate(['tenants'], (s) => { list.forEach((x) => s.tenants.put(x)); }, { kind: 'tenant-edit', text: `修改租客 ${after.label}`, before, after });
  return after;
}
export async function moveTenant(id, delta) {
  const list = await tenants();
  const i = list.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((x, k) => { x.order = k; });
  await mutate(['tenants'], (s) => { list.forEach((x) => s.tenants.put(x)); }, { kind: 'tenant-order', text: `調整順序：${list[j].label}` });
}
export async function resortByAddress() {
  const list = (await tenants()).sort((a, b) => naturalCompare(a.address, b.address));
  list.forEach((x, k) => { x.order = k; });
  await mutate(['tenants'], (s) => { list.forEach((x) => s.tenants.put(x)); }, { kind: 'tenant-order', text: '依門牌重新排序' });
}

// ---------- 收款 ----------
export const pid = (tenantId, ym) => `${tenantId}:${ym}`;
export async function paymentsFor(ym) {
  const list = await db.getByIndex('payments', 'month', ym);
  return Object.fromEntries(list.map((p) => [p.tenantId, p]));
}
export async function payment(tenantId, ym) { return db.get('payments', pid(tenantId, ym)); }

export async function markPaid(t, ym, { amount, paidOn, photoIds = [] }) {
  const before = await payment(t.id, ym);
  const after = {
    id: pid(t.id, ym), tenantId: t.id, month: ym, status: 'paid',
    amount: Number(amount ?? t.rent), paidOn: paidOn || isoDate(),
    note: before?.note || '',
    photoIds: [...new Set([...(before?.photoIds || []), ...photoIds])].slice(0, 2),
    updatedAt: nowISO(),
  };
  await mutate(['payments'], (s) => { s.payments.put(after); }, { kind: 'paid', text: `${t.label} ${ym} 已收 ${after.amount}`, before: before || null, after });
  return after;
}
/** 改回「沒收到」：原因、照片都保留；什麼都沒有了就整筆刪掉（等於從沒按過） */
export async function markUnpaid(t, ym) {
  const before = await payment(t.id, ym);
  if (!before) return;
  const after = { ...before, status: 'unpaid', paidOn: null, updatedAt: nowISO() };
  const empty = !after.note && !(after.photoIds && after.photoIds.length);
  await mutate(['payments'], (s) => { if (empty) s.payments.delete(before.id); else s.payments.put(after); },
    { kind: 'unpaid', text: `${t.label} ${ym} 改回沒收到`, before, after: empty ? null : after });
}
export async function setNote(t, ym, note) {
  const before = await payment(t.id, ym);
  const base = before || { id: pid(t.id, ym), tenantId: t.id, month: ym, status: 'unpaid', amount: t.rent, paidOn: null, photoIds: [] };
  const after = { ...base, note: String(note || '').trim(), updatedAt: nowISO() };
  const empty = after.status !== 'paid' && !after.note && !(after.photoIds && after.photoIds.length);
  await mutate(['payments'], (s) => { if (empty) s.payments.delete(after.id); else s.payments.put(after); },
    { kind: 'note', text: `${t.label} ${ym} 原因：${after.note || '（清掉）'}`, before: before || null, after: empty ? null : after });
}

// ---------- 照片 ----------
export async function savePhoto({ blob, w, h }) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const d = await crypto.subtle.digest('SHA-256', bytes);
  const id = 'ph-' + [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  await db.run(['photos'], 'readwrite', (s) => { s.photos.put({ id, blob, type: blob.type, w, h, bytes: blob.size, createdAt: nowISO(), deletedAt: null }); });
  return id;
}
export async function photo(id) { return db.get('photos', id); }
export async function detachPhoto(t, ym, photoId) {
  const before = await payment(t.id, ym);
  if (!before) return;
  const after = { ...before, photoIds: (before.photoIds || []).filter((x) => x !== photoId), updatedAt: nowISO() };
  const ph = await photo(photoId);
  await mutate(['payments', 'photos'], (s) => {
    s.payments.put(after);
    if (ph) s.photos.put({ ...ph, deletedAt: nowISO() }); // 先標記，不真的刪（異動紀錄裡查得到）
  }, { kind: 'photo-remove', text: `${t.label} ${ym} 刪掉一張收據照片`, before, after });
}

// ---------- 備份狀態 ----------
export async function markBackedUp({ seq, bytes, how }) {
  await db.run(['meta'], 'readwrite', (s) => {
    s.meta.put({ k: 'backedUpSeq', v: seq });
    s.meta.put({ k: 'lastBackupAt', v: nowISO() });
    s.meta.put({ k: 'lastBackupBytes', v: bytes });
    s.meta.put({ k: 'lastBackupHow', v: how });
    s.meta.put({ k: 'backupSnoozeUntil', v: null });
  });
}

/** 還原：整份取代。備份的時間就是「這份資料最後一次安全的時間」。 */
export async function replaceAll(p, { photoBlobs, screenSig }) {
  const meta = p.meta || {};
  await db.run(db.STORES, 'readwrite', (s) => {
    for (const n of db.STORES) s[n].clear();
    p.tenants.forEach((x) => s.tenants.put(x));
    p.payments.forEach((x) => s.payments.put(x));
    photoBlobs.forEach((x) => s.photos.put(x));
    (p.log || []).forEach((x) => { const { seq, ...rest } = x; s.log.add(rest); });
    for (const k of PORTABLE_META) if (meta[k] !== undefined) s.meta.put({ k, v: meta[k] });
    s.meta.put({ k: 'changeSeq', v: 0 });
    s.meta.put({ k: 'backedUpSeq', v: 0 });
    s.meta.put({ k: 'lastBackupAt', v: p.exportedAt });
    s.meta.put({ k: 'lastBackupHow', v: 'restored' });
    s.meta.put({ k: 'restoredAt', v: nowISO() });
    s.meta.put({ k: 'needFontCheck', v: !!(meta.screenSig && screenSig && meta.screenSig !== screenSig) });
    s.log.add({ at: nowISO(), kind: 'restore', text: `從 ${p.exportedAt.slice(0, 10)} 的備份找回` });
  });
}

export async function recentLog(n = 50) {
  const all = await db.getAll('log');
  return all.slice(-n).reverse();
}
export async function counts() {
  const [t, p, photos] = await Promise.all([db.count('tenants'), db.count('payments'), db.getAll('photos')]);
  return { tenants: t, payments: p, photos: photos.filter((x) => !x.deletedAt).length };
}
