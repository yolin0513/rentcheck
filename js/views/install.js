// 不是從主畫面圖示打開時：只顯示安裝說明，不讓記帳。
// 理由：iPhone 的瀏覽器分頁和主畫面 App 是兩個分開的儲存區；分頁還會套「7 天沒用就清掉」的規則。
// 判斷只用 display-mode，不看瀏覽器識別字串。

import { h } from '../ui.js';

export function renderInstall(ctx, { onPreview }) {
  return h('div', { class: 'page install' },
    h('h1', null, '收租紀錄'),
    h('p', { class: 'lead' }, '請先把這一頁加到主畫面，之後都從主畫面的圖示打開。'),
    h('ol', { class: 'steps' },
      h('li', null, '如果是在其他 App 裡點連結打開的：按「⋯」或分享鈕，選「用 Safari 開啟」。'),
      h('li', null, '在 Safari 按下方的分享鈕（方框加向上箭頭）。'),
      h('li', null, '往下找「加入主畫面」，按「加入」。'),
      h('li', null, '回到主畫面，按「收租」圖示打開。')),
    h('p', { class: 'muted' }, '為什麼：從瀏覽器打開時，iPhone 可能會清掉這裡的紀錄；從主畫面圖示打開比較安全。'),
    h('button', { type: 'button', class: 'btn secondary', onclick: onPreview }, '先在瀏覽器裡看看（預覽，資料可能被清掉）'));
}
