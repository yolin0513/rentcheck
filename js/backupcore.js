// 備份檔的純函式：組資料、算內容雜湊、產生 .html、從 .html 讀回來、驗證。
// 不碰 DOM、不碰 IndexedDB——Node 也能直接跑測試。
//
// 為什麼是 .html：要能經由 iPhone 的分享畫面交給其他 App；可分享的檔案類型有 HTML、沒有 JSON／ZIP（MDN）。
// 而且檔案本身點開就是一張看得懂的表，不用裝 App。

export const BACKUP_VERSION = 1;
export const SCHEMA_VERSION = 1;
const MARK_OPEN = '<script type="application/json" id="rentcheck-backup">';
const MARK_CLOSE = '</script>';

export function bytesToB64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
export function b64ToBytes(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** 物件的鍵排序後再 JSON，讓「同樣的內容」一定算出同樣的雜湊 */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v ?? null);
}

/** 內容雜湊：租客＋收款紀錄＋照片位元組。只要有一個字或一個位元不同，雜湊就不同。 */
export async function contentHash({ tenants, payments, photos /* [{id, bytes}] */ }) {
  const enc = new TextEncoder();
  const parts = [enc.encode(canonical({ tenants: [...tenants].sort(byId), payments: [...payments].sort(byId) }))];
  for (const p of [...photos].sort(byId)) parts.push(enc.encode('|' + p.id + '|'), p.bytes);
  const total = parts.reduce((n, x) => n + x.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const x of parts) { all.set(x, o); o += x.length; }
  const h = await crypto.subtle.digest('SHA-256', all);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 組出備份的內容。photos：[{id, type, createdAt, bytes:Uint8Array}]
 * meta 只帶設定類的值（原因選項、字的大小、螢幕尺寸），不帶「上次備份」這類狀態。
 */
export async function buildPayload({ meta, tenants, payments, photos, log, now = new Date() }) {
  const hash = await contentHash({ tenants, payments, photos });
  return {
    app: 'rentcheck',
    backupVersion: BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    meta,
    tenants,
    payments,
    photos: photos.map((p) => ({ id: p.id, type: p.type, createdAt: p.createdAt, b64: bytesToB64(p.bytes) })),
    log: log || [],
    hash,
  };
}

export async function verifyPayload(p) {
  if (!p || p.app !== 'rentcheck' || !Array.isArray(p.tenants) || !Array.isArray(p.payments) || !Array.isArray(p.photos)) return false;
  const h = await contentHash({ tenants: p.tenants, payments: p.payments, photos: p.photos.map((x) => ({ id: x.id, bytes: b64ToBytes(x.b64) })) });
  return h === p.hash;
}

/** 從備份 .html 的文字取出內容；不是本 App 的備份就丟錯 */
export function extractPayload(htmlText) {
  const i = htmlText.indexOf(MARK_OPEN);
  if (i < 0) throw new Error('這個檔案不是收租紀錄的備份檔');
  const j = htmlText.indexOf(MARK_CLOSE, i + MARK_OPEN.length);
  if (j < 0) throw new Error('備份檔不完整（被截斷了）');
  const p = JSON.parse(htmlText.slice(i + MARK_OPEN.length, j));
  if (p.app !== 'rentcheck') throw new Error('這個檔案不是收租紀錄的備份檔');
  if (p.backupVersion > BACKUP_VERSION) throw new Error('這份備份是較新版本的 App 做的，請先更新 App');
  return p;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US');
const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '');

/** 備份檔的檔名：收租紀錄_2026-10-07.html */
export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `收租紀錄_${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.html`;
}

/** 產生備份 .html：上半部是人看的表（不需要網路、不需要 App），下半部是給 App 讀回的資料 */
export function renderBackupHtml(p) {
  const tenants = [...p.tenants].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const months = [...new Set(p.payments.map((x) => x.month))].sort().reverse();
  const byKey = new Map(p.payments.map((x) => [x.tenantId + ':' + x.month, x]));
  const sections = months.map((ym) => {
    const rows = tenants.filter((t) => (!t.startMonth || t.startMonth <= ym) && (!t.endMonth || ym <= t.endMonth)).map((t) => {
      const pay = byKey.get(t.id + ':' + ym);
      const st = pay && pay.status === 'paid' ? '✔ 已收' : pay && pay.note ? '！ 沒收' : '— 沒有紀錄';
      return `<tr><td>${esc(t.label)}</td><td>${esc(t.name)}</td><td class="n">${fmtMoney(pay && pay.status === 'paid' ? pay.amount : t.rent)}</td>` +
        `<td>${st}</td><td>${esc(fmtDate(pay && pay.paidOn))}</td><td>${esc(pay && pay.note)}</td><td class="n">${(pay && pay.photoIds ? pay.photoIds.length : 0) || ''}</td></tr>`;
    }).join('');
    return `<h2>${esc(ym)}</h2><table><tr><th>門牌</th><th>稱呼</th><th>金額</th><th>狀態</th><th>收款日</th><th>註記</th><th>照片</th></tr>${rows}</table>`;
  }).join('');
  const json = JSON.stringify(p).replace(/</g, '\\u003c');
  return '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>收租紀錄 ${esc(fmtDate(p.exportedAt))}</title>` +
    '<style>body{font:17px/1.5 -apple-system,"PingFang TC",sans-serif;margin:16px;color:#111;background:#fff}table{border-collapse:collapse;width:100%;margin-bottom:1rem}' +
    'td,th{border-bottom:1px solid #ddd;padding:4px;text-align:left;vertical-align:top}.n{text-align:right}h2{margin:1.5rem 0 .25rem}img{max-width:100%;margin:.5rem 0}</style></head><body>' +
    `<h1>收租紀錄</h1><p>備份時間：${esc(p.exportedAt.slice(0, 16).replace('T', ' '))}（世界標準時間）<br>租客 ${p.tenants.length} 位、收款紀錄 ${p.payments.length} 筆、收據照片 ${p.photos.length} 張。</p>` +
    '<p><b>請把這個檔案存好</b>（例如 iPhone 的「檔案」App 或 iCloud 雲碟）。傳到聊天軟體的檔案可能過一陣子就不能下載，最好另外存一份。要找回資料時，在收租 App 的設定裡選「從備份找回」，選這個檔案。</p>' +
    sections +
    '<div id="photos"></div>' +
    `${MARK_OPEN}${json}${MARK_CLOSE}` +
    '<script>try{var d=JSON.parse(document.getElementById("rentcheck-backup").textContent),b=document.getElementById("photos");' +
    'if(d.photos.length){var h=document.createElement("h2");h.textContent="收據照片";b.appendChild(h);' +
    'd.photos.forEach(function(x){var i=document.createElement("img");i.src="data:"+x.type+";base64,"+x.b64;i.alt="收據";b.appendChild(i);});}}catch(e){}</script>' +
    '</body></html>';
}
