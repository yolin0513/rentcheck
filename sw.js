/* RentCheck Service Worker
 * - SHELL：install 時整組預快取，之後 cache-first（離線也能打開、記帳）
 * - 導覽請求：network-first，離線時回退 index.html
 * - 不快取任何使用者資料（資料在 IndexedDB，不經過網路）
 *
 * 每次改動任何 SHELL 檔案都要 bump VERSION，並同步 js/version.js（scripts/staticcheck.mjs 會比對）。
 */
const VERSION = 'rentcheck-v0.7.1';
const SHELL = `${VERSION}-shell`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/app.js',
  './js/backup.js',
  './js/backupcore.js',
  './js/db.js',
  './js/months.js',
  './js/photos.js',
  './js/store.js',
  './js/ui.js',
  './js/version.js',
  './js/views/backupview.js',
  './js/views/grid.js',
  './js/views/install.js',
  './js/views/restore.js',
  './js/views/settings.js',
  './js/views/tenant.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rentcheck-') && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
