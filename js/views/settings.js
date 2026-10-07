// 設定（畫面上不寫「晚輩」——通常由家人協助，但不指定是誰）。進入要按住 3 秒；App 切到背景或 3 分鐘沒動作就自動離開。
// 這裡沒有「刪除租客」：只有「搬走」（可搬回）。收款狀態也不在這裡改——那是長輩在收租表做的事。

import * as store from '../store.js';
import * as backup from '../backup.js';
import { h, add, fill, fmtMB, daysAgo, toast, backButton } from '../ui.js';
import { ymOf, addMonths, autoLabels } from '../months.js';
import { loadMonth, buildHeader, buildTiles, buildReminder, buildFootbar } from './grid.js';
import { tryPersist } from './tenant.js';

const FONT_STEPS = [['normal', '標準'], ['large', '大'], ['xlarge', '特大'], ['xxlarge', '超大']];
const THEMES = [['warm', '暖陽', '#703009'], ['sky', '晴空', '#08475c'], ['forest', '森林', '#1f4d36']];

function topbar(ctx, title, back) {
  return h('div', { class: 'edit-top' },
    h('div', { class: 'edit-title' }, '設定中', title ? `｜${title}` : ''),
    back ? h('a', { class: 'btn small light', href: back }, '上一頁') : null,
    h('button', { type: 'button', class: 'btn small light', 'data-act': 'exit', onclick: () => ctx.exitEdit() }, '離開設定'));
}
const section = (title, ...kids) => h('section', { class: 'card' }, h('h2', null, title), ...kids);
const row = (k, v, cls) => h('div', { class: 'kv' + (cls ? ' ' + cls : '') }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));

/** 量「這個字級下，房間格一屏放不放得下」：把真的房間格畫在看不見的地方量（平常、與出現備份提醒時各一次） */
export async function measureFit() {
  const ym = ymOf();
  const { cells, s } = await loadMonth(ym);
  const once = (withRemind) => {
    const bar = buildFootbar(s, null);
    const host = h('div', { class: 'measure-host page grid-page', 'aria-hidden': 'true' }, buildHeader(ym, cells), withRemind ? buildReminder(s) : null, buildTiles(cells, ym), bar);
    add(document.body, host);
    const tiles = [...host.querySelectorAll('.tile')];
    const top = host.getBoundingClientRect().top;
    const bottom = tiles.length ? tiles[tiles.length - 1].getBoundingClientRect().bottom - top : 0;
    // 可用高度＝整個畫面減掉最下面固定的那一條（它會蓋在房間格上面）
    const avail = innerHeight - bar.offsetHeight;
    const tooLong = [...host.querySelectorAll('.tile-label')].filter((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 1;
      return el.getBoundingClientRect().height > lh * 2.2; // 超過兩行
    }).map((el) => el.textContent);
    host.remove();
    return { count: tiles.length, bottom: Math.round(bottom), avail: Math.round(avail), fits: bottom <= avail, tooLong };
  };
  const plain = once(false);
  const remind = once(true);
  return { ...plain, fitsWithRemind: remind.fits, overWithRemind: remind.bottom - remind.avail };
}

export async function renderSettings(ctx) {
  const [s, list, c] = await Promise.all([store.settings(), store.tenants(), store.counts()]);
  const page = h('div', { class: 'page settings' }, topbar(ctx, ''));

  // ---- 1. 資料安全：手機裡的紀錄只是副本，正本是最近一次傳出去的備份 ----
  let persisted = null;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch {}
  let est = null;
  try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch {}
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ago = daysAgo(s.lastBackupAt);
  const lossText = !s.lastBackupAt
    ? (c.tenants ? '全部的紀錄（還沒有匯出過）' : '沒有東西會損失')
    : s.unsent > 0 ? `上次匯出（${ago} 天前）之後的 ${s.unsent} 筆變更` : '不會損失（上次匯出之後沒有改過）';
  add(page, section('資料安全',
    h('p', { class: 'muted' }, '紀錄只存在這支 iPhone 的 App 裡，而且被清掉時不會有任何提示。所以 App 裡這份只是「副本」；正本是最近一次匯出、存在 App 以外（例如「檔案」或 iCloud）的備份檔。'),
    row('如果現在被清掉，會損失', lossText, s.unsent > 0 || !s.lastBackupAt ? 'warn' : 'ok'),
    row('上次匯出備份', s.lastBackupAt ? `${new Date(s.lastBackupAt).toLocaleString('zh-TW', { hour12: false })}（${ago} 天前，${fmtMB(s.lastBackupBytes)}${s.lastBackupHow === 'restored' ? '，從備份找回' : ''}）` : '還沒有'),
    row('還沒匯出的變更', `${s.unsent} 筆` + (s.lastChangeAt ? `（最後一筆：${new Date(s.lastChangeAt).toLocaleString('zh-TW', { hour12: false })}）` : '')),
    row('開啟方式', standalone ? '✔ 主畫面 App' : '✘ 瀏覽器分頁（預覽）——資料可能被清掉', standalone ? 'ok' : 'bad'),
    row('持久儲存', persisted === true ? '✔ iPhone 已答應保留這裡的資料（刪掉圖示、清除 Safari 資料時是否保留，尚未實測）'
      : persisted === false ? '✘ iPhone 沒有答應；空間不足時可能被清' : '？ 這支手機讀不到', persisted ? 'ok' : 'bad'),
    s.persist ? row('上次請求持久儲存', `${new Date(s.persist.at).toLocaleString('zh-TW', { hour12: false })}，結果 ${s.persist.result}`) : null,
    row('已用空間', est ? fmtMB(est.usage || 0) : '讀不到'),
    row('租客／紀錄／照片', `${c.tenants} 位／${c.payments} 筆／${c.photos} 張`),
    persisted === true ? null : h('button', { type: 'button', class: 'btn secondary', onclick: async () => {
      let r = '不支援';
      try { r = navigator.storage && navigator.storage.persist ? String(await navigator.storage.persist()) : '不支援'; } catch (e) { r = '錯誤 ' + e.name; }
      await store.setMeta('persist', { at: new Date().toISOString(), result: r });
      ctx.render();
    } }, '請求持久儲存'),
    h('a', { class: 'btn', href: '#/backup' }, '現在匯出備份'),
    h('a', { class: 'btn secondary', href: '#/restore' }, '從備份找回'),
    h('p', { class: 'muted' }, '匯出的檔案存在 App 以外的地方，App 的資料被清掉時它還在。每一份都是完整的，只要留最新的一份。傳到聊天軟體的檔案可能過一陣子就不能下載，最好另外存一份。')));

  // ---- 2. 租客 ----
  const cur = ymOf();
  add(page, section('租客',
    list.length ? h('ol', { class: 'tenant-list' }, list.map((t, i) => h('li', { class: t.endMonth && t.endMonth < cur ? 'moved' : '' },
      h('a', { href: `#/settings/tenant/${encodeURIComponent(t.id)}`, class: 'tl-main' },
        h('b', null, t.label), ` ${t.name || ''}　${Number(t.rent).toLocaleString('en-US')} 元／每月 ${t.dueDay} 號`,
        t.endMonth ? h('span', { class: 'muted' }, `（${t.endMonth} 起搬走）`) : null),
      h('span', { class: 'tl-ord' },
        h('button', { type: 'button', class: 'mini', 'aria-label': '往前', disabled: i === 0, onclick: async () => { await store.moveTenant(t.id, -1); ctx.render(); } }, '↑'),
        h('button', { type: 'button', class: 'mini', 'aria-label': '往後', disabled: i === list.length - 1, onclick: async () => { await store.moveTenant(t.id, 1); ctx.render(); } }, '↓'))))) : h('p', { class: 'muted' }, '還沒有租客。'),
    h('a', { class: 'btn', href: '#/settings/tenant/new', 'data-act': 'add-tenant' }, '＋ 新增租客'),
    list.length > 1 ? h('button', { type: 'button', class: 'btn secondary', onclick: async () => { await store.resortByAddress(); ctx.render(); } }, '依門牌重新排序') : null));

  // ---- 3. 字的大小 ----
  const fitBox = h('div', { class: 'fit', role: 'status' }, '量測中…');
  const fontBtns = FONT_STEPS.map(([k, label]) => h('button', { type: 'button', class: 'btn ' + (s.fontStep === k ? '' : 'secondary'), 'aria-pressed': String(s.fontStep === k), dataset: { font: k }, onclick: async () => {
    await store.setMeta('fontStep', k);
    await store.setMeta('screenSig', backup.screenSig());
    await store.setMeta('needFontCheck', false);
    await ctx.applyFont(k);
    ctx.render();
  } }, label));
  add(page, section('字的大小',
    s.needFontCheck ? h('p', { class: 'warnbox' }, '換了手機（或螢幕尺寸變了），請重新確認字的大小。') : null,
    h('div', { class: 'font-row' }, fontBtns),
    fitBox,
    h('p', { class: 'muted' }, '請讓長輩看著收租表選看得清楚的大小。放不下時 App 不會自己縮字，最下面幾格要往下捲。')));
  if (list.length) {
    measureFit().then((f) => {
      fill(fitBox, 
        h('p', { class: f.fits ? 'ok' : 'bad' }, f.fits ? `✔ 平常：一屏放得下這個月全部 ${f.count} 戶` : `✘ 平常：一屏放不下全部 ${f.count} 戶，最下面要往下捲（差 ${f.bottom - f.avail} 點）`),
        f.fits ? h('p', { class: f.fitsWithRemind ? 'ok' : 'muted' }, f.fitsWithRemind ? '✔ 出現「傳紀錄」提醒時也放得下' : `出現「傳紀錄」提醒的那幾天，最下面一列要捲一點（差 ${f.overWithRemind} 點）`) : null,
        f.tooLong.length ? h('p', { class: 'bad' }, `這些格子名稱太長（超過兩行），建議改短：${f.tooLong.join('、')}`) : null);
      fitBox.dataset.fits = String(f.fits);
    });
  } else fitBox.textContent = '還沒有租客，新增之後才量得出來。';

  // ---- 3b. 外觀與動畫 ----
  add(page, section('外觀',
    h('div', { class: 'theme-row' }, THEMES.map(([k, label, color]) => h('button', {
      type: 'button', class: 'btn ' + (s.theme === k ? '' : 'secondary'), 'aria-pressed': String(s.theme === k), dataset: { theme: k },
      onclick: async () => { await store.setMeta('theme', k); await ctx.applyFont(); ctx.render(); },
    }, h('span', { class: 'theme-swatch', style: `background:${color}` }), label))),
    h('label', null, '動畫',
      h('div', { class: 'motion-row' }, [['auto', '開（跟著 iPhone 設定）'], ['off', '關掉']].map(([k, label]) => h('button', {
        type: 'button', class: 'btn ' + (s.motion === k ? '' : 'secondary'), 'aria-pressed': String(s.motion === k), dataset: { motion: k },
        onclick: async () => { await store.setMeta('motion', k); await ctx.applyFont(); ctx.render(); },
      }, label)))),
    h('p', { class: 'muted' }, 'iPhone「設定 → 輔助使用 → 動態效果 → 減少動態效果」打開時，App 也不會有動畫。')));

  // ---- 4. 其他 ----
  const notes = h('textarea', { class: 'field', rows: '3', 'aria-label': '還沒收的原因選項' });
  notes.value = s.noteOptions.join('\n');
  add(page, section('還沒收的原因',
    h('label', null, '「還沒收的原因」選項（一行一個）', notes),
    h('button', { type: 'button', class: 'btn secondary', onclick: async () => {
      await store.setMeta('noteOptions', notes.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8));
      toast('存好了');
    } }, '存起來')));

  // ---- 5. 異動紀錄 ----
  const log = await store.recentLog(30);
  add(page, section('異動紀錄（最近 30 筆）',
    log.length ? h('ul', { class: 'log' }, log.map((e) => h('li', null, h('span', { class: 'muted' }, new Date(e.at).toLocaleString('zh-TW', { hour12: false }) + '　'), e.text))) : h('p', { class: 'muted' }, '還沒有。'),
    h('p', { class: 'muted' }, `版本 ${ctx.version}`)));

  add(page, h('button', { type: 'button', class: 'btn', onclick: () => ctx.exitEdit() }, '離開設定'));
  return page;
}

export async function renderTenantForm(ctx, id) {
  const isNew = !id || id === 'new';
  const t = isNew ? null : await store.tenant(id);
  if (!isNew && !t) return h('div', { class: 'page' }, topbar(ctx, '租客', '#/settings'), h('p', null, '找不到這位租客。'));
  const all = await store.tenants();
  const f = (label, input, hint) => h('label', null, label, input, hint ? h('span', { class: 'muted hint' }, hint) : null);
  const address = h('input', { type: 'text', class: 'field', name: 'address', value: t ? t.address : '', placeholder: '例如：中山路12號3樓之1' });
  const label = h('input', { type: 'text', class: 'field', name: 'label', value: t ? t.label : '', placeholder: '格子上顯示的名字' });
  const name = h('input', { type: 'text', class: 'field', name: 'name', value: t ? t.name : '', placeholder: '例如：王先生' });
  const rent = h('input', { type: 'number', inputmode: 'numeric', class: 'field', name: 'rent', value: t ? String(t.rent) : '' });
  const due = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '31', class: 'field', name: 'dueDay', value: t ? String(t.dueDay) : '5' });
  const start = h('input', { type: 'month', class: 'field', name: 'startMonth', value: t ? t.startMonth : ymOf() });
  const phone = h('input', { type: 'tel', class: 'field', name: 'phone', value: t ? (t.phone || '') : '' });
  const err = h('p', { class: 'bad', role: 'alert' });
  let labelTouched = !isNew && !t.labelAuto;
  label.addEventListener('input', () => { labelTouched = true; });
  address.addEventListener('input', () => {
    if (labelTouched) return;
    const addrs = [...all.filter((x) => !t || x.id !== t.id).map((x) => x.address), address.value];
    label.value = autoLabels(addrs).at(-1);
  });

  const save = h('button', { type: 'button', class: 'btn primary', 'data-act': 'save-tenant' }, isNew ? '新增' : '存起來');
  save.addEventListener('click', async () => {
    const data = {
      address: address.value.trim(), label: label.value.trim() || address.value.trim(), labelAuto: !labelTouched || !label.value.trim(), name: name.value.trim(),
      rent: Number(rent.value), dueDay: Math.min(31, Math.max(1, Number(due.value) || 1)), startMonth: start.value || ymOf(), phone: phone.value.trim(),
    };
    if (!data.address) { err.textContent = '請填門牌。'; return; }
    if (!(data.rent > 0)) { err.textContent = '請填月租（大於 0 的數字）。'; return; }
    if (isNew) await store.addTenant(data); else await store.updateTenant(t.id, data);
    tryPersist();
    ctx.go('#/settings');
  });

  const page = h('div', { class: 'page settings' }, topbar(ctx, isNew ? '新增租客' : '修改租客', '#/settings'),
    section(isNew ? '新增租客' : `修改：${t.label}`,
      f('門牌（完整地址，排序用）', address),
      f('格子名稱', label, '格子上顯示這個。會自動去掉大家相同的開頭（例如都在「中山路12號」）。'),
      f('稱呼', name),
      f('月租（元）', rent),
      f('每月幾號繳', due),
      f('從哪個月開始租', start),
      f('電話（可不填）', phone),
      err, save,
      backButton('#/settings', '不存，回設定')));

  if (!isNew) {
    const cur = ymOf();
    add(page, section('搬走／搬回',
      t.endMonth
        ? h('div', null, h('p', null, `${t.endMonth} 之後不再出現在收租表。舊的紀錄都還在。`),
          h('button', { type: 'button', class: 'btn secondary', onclick: async () => { await store.updateTenant(t.id, { endMonth: null }); ctx.go('#/settings'); } }, '搬回來（繼續出現在收租表）'))
        : h('div', null, h('p', { class: 'muted' }, '搬走不會刪掉任何紀錄，只是從下個月起不再出現在收租表；之後可以搬回來。'),
          h('button', { type: 'button', class: 'btn secondary', 'data-act': 'move-out', onclick: async () => {
            if (!confirm(`${t.label} 從下個月起不再出現在收租表？（紀錄會保留）`)) return;
            await store.updateTenant(t.id, { endMonth: cur });
            ctx.go('#/settings');
          } }, `搬走（${addMonths(cur, 1)} 起不出現）`))));
  }
  return page;
}
