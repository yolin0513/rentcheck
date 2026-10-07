// 月份、排序、狀態的純函式（不碰 DOM、不碰 IndexedDB，Node 也能直接跑測試）。

const CN_MONTH = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM'（以手機的當地時間為準） */
export function ymOf(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}
/** 'YYYY-MM-DD'（當地時間） */
export function isoDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function addMonths(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return `${y}-${pad(m)}`;
}
export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export const monthNum = (ym) => Number(ym.slice(5, 7));
export const yearOf = (ym) => Number(ym.slice(0, 4));
/** 「十月」 */
export const monthName = (ym) => CN_MONTH[monthNum(ym) - 1] + '月';
/** 繳款日遇到小月：31 號在 30 天的月份就是 30 號 */
export const dueDayIn = (ym, dueDay) => Math.min(Number(dueDay) || 1, daysInMonth(ym));
/** 「10/5」 */
export function shortDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${m}/${d}`;
}
/** 8000 → 「8,000」 */
export const money = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * 門牌的「自然排序」：數字照大小比（2號在10號前面；3樓之1在3樓之2前面）。
 * 回傳負數＝a 在前。
 */
export function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const A = String(a ?? '').match(re) || [];
  const B = String(b ?? '').match(re) || [];
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const x = A[i], y = B[i];
    const nx = /^\d/.test(x), ny = /^\d/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d;
      if (x.length !== y.length) return x.length - y.length;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return A.length - B.length;
}

/**
 * 從完整門牌自動產生格子名稱：去掉所有人共同的前綴。
 * 只切在「號、弄、巷、段、路、街」之後，避免切成「之1」「之2」這種看不懂的名字。
 * 例：["中山路12號3樓之1","中山路12號3樓之2","中山路12號4樓"] → ["3樓之1","3樓之2","4樓"]
 */
export function autoLabels(addresses) {
  const list = addresses.map((a) => String(a ?? '').trim());
  if (list.length < 2) return list;
  let p = list[0];
  for (const s of list) {
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i++;
    p = p.slice(0, i);
  }
  const cut = Math.max(...'號弄巷段路街'.split('').map((c) => p.lastIndexOf(c)));
  p = cut >= 0 ? p.slice(0, cut + 1) : '';
  if (!p || list.some((s) => s.length <= p.length)) return list;
  return list.map((s) => s.slice(p.length).replace(/^[\s,，、]+/, ''));
}

/** 這位租客在這個月是否在租（startMonth ≤ ym ≤ endMonth；endMonth 空白＝還在租） */
export function isActive(t, ym) {
  return (!t.startMonth || t.startMonth <= ym) && (!t.endMonth || ym <= t.endMonth);
}

/**
 * 一格的狀態：
 *  'paid'   已收
 *  'note'   還沒收，有記原因
 *  'due'    該收了（過了繳款日，或是過去的月份還沒收）
 *  'notyet' 還沒到
 * today：'YYYY-MM-DD'
 */
export function cellStatus({ payment, ym, dueDay, today }) {
  if (payment && payment.status === 'paid') return 'paid';
  if (payment && payment.note) return 'note';
  const cur = today.slice(0, 7);
  if (ym < cur) return 'due';
  if (ym > cur) return 'notyet';
  return Number(today.slice(8, 10)) >= dueDayIn(ym, dueDay) ? 'due' : 'notyet';
}
