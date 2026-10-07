// 本機截圖（自己看用，不進版控；輸出到 .logs/shots/）：主要畫面在兩種大小下的樣子。
// 用法：node scripts/shots.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from './serve.mjs';

const OUT = fileURLToPath(new URL('../.logs/shots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const server = createServer();
await new Promise((r) => server.listen(5198, '127.0.0.1', r));
const browser = await puppeteer.launch({ headless: true });
const CASES = [['iphone12-large', 390, 763, 'large'], ['zoom320-xlarge', 320, 626, 'xlarge']];
for (const [name, w, hgt, font] of CASES) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: hgt, deviceScaleFactor: 2, isMobile: true });
  await p.goto('http://127.0.0.1:5198/');
  await p.evaluate(() => sessionStorage.setItem('rentcheck-preview', '1'));
  // 每一組都從空的資料庫開始（兩組共用同一個網址來源）
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('rentcheck'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await p.reload({ waitUntil: 'networkidle0' });
  const ids = await p.evaluate(async (font) => {
    const st = await import('/js/store.js');
    await st.setMeta('fontStep', font);
    const floors = ['2樓之1', '2樓之2', '3樓之1', '3樓之2', '4樓', '5樓', '6樓', '7樓', '8樓', '10樓'];
    const names = ['王先生', '李小姐', '陳太太', '林先生', '黃同學', '吳小姐', '張先生', '劉阿姨', '蔡先生', '鄭小姐'];
    for (let i = 0; i < 10; i++) await st.addTenant({ address: `中山路60號${floors[i]}`, label: '', labelAuto: true, name: names[i], rent: 6000 + i * 500, dueDay: i % 2 ? 5 : 20, startMonth: '2026-01', phone: '' });
    const ts = await st.tenants();
    const ym = (await import('/js/months.js')).ymOf();
    await st.markPaid(ts[2], ym, { amount: ts[2].rent });
    await st.markPaid(ts[5], ym, { amount: ts[5].rent });
    await st.setNote(ts[0], ym, '說月底給');
    return { ids: ts.map((t) => t.id), ym };
  }, font);
  await p.reload({ waitUntil: 'networkidle0' });
  const shot = async (hash, file, prep) => {
    await p.evaluate((h) => { location.hash = h; }, hash);
    await new Promise((r) => setTimeout(r, 700));
    if (prep) { await p.evaluate(prep); await new Promise((r) => setTimeout(r, 300)); }
    await p.screenshot({ path: `${OUT}${name}-${file}.png` });
  };
  await shot('#/', 'grid');
  await shot(`#/t/${ids.ids[1]}/${ids.ym}`, 'tenant');
  await shot(`#/t/${ids.ids[1]}/${ids.ym}/confirm`, 'confirm', () => document.querySelector('.linkbtn').click());
  await shot('#/backup', 'backup');
  await p.evaluate(async () => (await import('/js/app.js')).enterEdit());
  await new Promise((r) => setTimeout(r, 1200));
  await p.screenshot({ path: `${OUT}${name}-settings.png` });
  await shot(`#/settings/tenant/${ids.ids[0]}`, 'tenantform', () => document.querySelector('input[name="startMonth"]').scrollIntoView({ block: 'center' }));
  await p.close();
}
await browser.close();
server.close();
console.log('輸出在 .logs/shots/');
