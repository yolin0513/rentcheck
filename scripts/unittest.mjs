// 純函式測試（秒級，不開瀏覽器）：月份、門牌排序與格子名稱、格子狀態、備份檔的組裝／讀回／防竄改。

import { naturalCompare, autoLabels, cellStatus, addMonths, daysInMonth, dueDayIn, isActive, monthName } from '../js/months.js';
import { buildPayload, renderBackupHtml, extractPayload, verifyPayload, contentHash } from '../js/backupcore.js';

let fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!cond) fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 月份 ----
ok('addMonths 跨年往後', addMonths('2026-12', 1) === '2027-01');
ok('addMonths 跨年往前', addMonths('2026-01', -1) === '2025-12');
ok('addMonths 一次跨 13 個月', addMonths('2026-10', -13) === '2025-09');
ok('2028 年 2 月有 29 天', daysInMonth('2028-02') === 29);
ok('31 號繳的人在 9 月是 30 號', dueDayIn('2026-09', 31) === 30);
ok('月份中文', monthName('2026-10') === '十月' && monthName('2026-11') === '十一月');

// ---- 門牌自然排序 ----
const addrs = ['中山路12號10樓', '中山路12號3樓之2', '中山路12號2樓', '中山路12號3樓之1', '中山路12號3樓'];
const sorted = [...addrs].sort(naturalCompare);
ok('門牌自然排序（2樓 < 3樓 < 3樓之1 < 3樓之2 < 10樓）', eq(sorted, ['中山路12號2樓', '中山路12號3樓', '中山路12號3樓之1', '中山路12號3樓之2', '中山路12號10樓']), sorted.join(','));
ok('對照組：一般字串排序會把 10樓 排在 2樓 前面', [...addrs].sort()[0] === '中山路12號10樓');
ok('A棟在B棟前面、同棟依樓層', eq(['B棟1F', 'A棟10F', 'A棟2F'].sort(naturalCompare), ['A棟2F', 'A棟10F', 'B棟1F']));

// ---- 格子名稱：去掉共同前綴 ----
ok('去掉共同的「中山路12號」', eq(autoLabels(['中山路12號3樓之1', '中山路12號3樓之2', '中山路12號4樓']), ['3樓之1', '3樓之2', '4樓']));
ok('不切成「之1／之2」這種看不懂的名字', eq(autoLabels(['3樓之1', '3樓之2']), ['3樓之1', '3樓之2']));
ok('有人被整個吃光時不去前綴', eq(autoLabels(['中山路12號', '中山路12號3樓']), ['中山路12號', '中山路12號3樓']));
ok('不同條路：不去前綴', eq(autoLabels(['中山路1號', '民生路2號']), ['中山路1號', '民生路2號']));
ok('只有一戶：原樣', eq(autoLabels(['中山路12號3樓']), ['中山路12號3樓']));
ok('切在「巷」之後', eq(autoLabels(['仁愛路3段10巷2號', '仁愛路3段10巷5號']), ['2號', '5號']));

// ---- 格子狀態 ----
const st = (payment, ym, dueDay, today) => cellStatus({ payment, ym, dueDay, today });
ok('已收', st({ status: 'paid' }, '2026-10', 5, '2026-10-01') === 'paid');
ok('沒收但有原因', st({ status: 'unpaid', note: '說晚點給' }, '2026-10', 5, '2026-10-20') === 'note');
ok('本月、還沒到繳款日', st(null, '2026-10', 5, '2026-10-04') === 'notyet');
ok('本月、繳款日當天就算該收了', st(null, '2026-10', 5, '2026-10-05') === 'due');
ok('過去的月份沒收＝該收了', st(null, '2026-09', 28, '2026-10-01') === 'due');
ok('未來的月份＝還沒到', st(null, '2026-11', 1, '2026-10-30') === 'notyet');
ok('改回沒收到、沒有原因＝依日期判斷', st({ status: 'unpaid', note: '' }, '2026-10', 5, '2026-10-20') === 'due');
ok('在租期間：開始月份當月算', isActive({ startMonth: '2026-10', endMonth: null }, '2026-10'));
ok('搬走：搬走那個月之後不算', !isActive({ startMonth: '2026-01', endMonth: '2026-10' }, '2026-11') && isActive({ startMonth: '2026-01', endMonth: '2026-10' }, '2026-10'));

// ---- 備份 ----
const tenants = [
  { id: 't1', order: 0, address: '中山路12號3樓', label: '3樓', name: '測試甲', rent: 8000, dueDay: 5, startMonth: '2026-01', endMonth: null },
  { id: 't2', order: 1, address: '中山路12號4樓', label: '4樓', name: '測試乙<b>', rent: 6500, dueDay: 10, startMonth: '2026-01', endMonth: null },
];
const payments = [
  { id: 't1:2026-10', tenantId: 't1', month: '2026-10', status: 'paid', amount: 8000, paidOn: '2026-10-05', note: '', photoIds: ['ph-a'] },
  { id: 't2:2026-10', tenantId: 't2', month: '2026-10', status: 'unpaid', amount: 6500, paidOn: null, note: '說晚點給 </script>', photoIds: [] },
];
const photoBytes = new Uint8Array(3000).map((_, i) => (i * 37) % 256);
const photos = [{ id: 'ph-a', type: 'image/jpeg', createdAt: '2026-10-05T01:00:00.000Z', bytes: photoBytes }];
const payload = await buildPayload({ meta: { recipient: '家人' }, tenants, payments, photos, log: [], now: new Date('2026-10-07T00:00:00Z') });
const html = renderBackupHtml(payload);
ok('備份檔是 HTML，含人看的表', html.startsWith('<!doctype html>') && html.includes('<table>') && html.includes('3樓'));
ok('使用者輸入會被跳脫（不會變成 HTML 標籤）', html.includes('測試乙&lt;b&gt;') && !html.includes('測試乙<b>'));
ok('註記裡的 </script> 不會截斷資料', extractPayload(html).payments[1].note === '說晚點給 </script>');
const back = extractPayload(html);
ok('讀回來的內容與原本相同', eq(back.tenants, tenants) && eq(back.payments, payments));
ok('讀回來的照片位元組相同', back.photos[0].b64 === payload.photos[0].b64);
ok('讀回來驗證通過', await verifyPayload(back));
const tampered = extractPayload(html.replace('"amount":8000', '"amount":9000'));
ok('對照組：改了金額 → 驗證不通過', !(await verifyPayload(tampered)));
const tamperedPhoto = extractPayload(html);
tamperedPhoto.photos[0].b64 = tamperedPhoto.photos[0].b64.replace(/^.{4}/, 'AAAA');
ok('對照組：改了照片 → 驗證不通過', !(await verifyPayload(tamperedPhoto)));
ok('欄位順序不同、內容相同 → 雜湊相同', (await contentHash({ tenants: tenants.map((t) => Object.fromEntries(Object.entries(t).reverse())), payments, photos })) === payload.hash);
let threw = '';
try { extractPayload('<html><body>別的檔案</body></html>'); } catch (e) { threw = e.message; }
ok('別的檔案 → 說清楚不是備份檔', threw.includes('不是收租紀錄的備份檔'));
threw = '';
try { extractPayload(html.slice(0, html.indexOf('</script>', html.indexOf('rentcheck-backup')))); } catch (e) { threw = e.message; }
ok('被截斷的檔案 → 說清楚不完整', threw.includes('不完整'));

console.log(fail ? `\n${fail} 項失敗` : '\n全部通過');
process.exit(fail ? 1 : 0);
