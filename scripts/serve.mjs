// 極簡靜態檔伺服器，給測試與 npm run dev 用（不裝任何相依）。
// 只服務專案根目錄底下的檔案，路徑正規化後再比對，不讓 ../ 跑出去。
// 用法：node scripts/serve.mjs [port] [host]
//   host 預設 127.0.0.1（只有本機連得到）。要讓同一個 Wi-Fi 的手機連，才傳 0.0.0.0。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};
const DENY = [/^\/node_modules\//, /^\/\.git\//, /^\/scripts\//, /^\/docs\//];

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (DENY.some((re) => re.test(rel))) { res.writeHead(403); res.end('forbidden'); return; }
    if (rel.endsWith('/')) rel += 'index.html';
    const full = path.resolve(ROOT, '.' + rel);
    if (!full.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 5190);
  const host = process.argv[3] || '127.0.0.1';
  createServer().listen(port, host, () => console.log(`RentCheck: http://${host}:${port}/`));
}
