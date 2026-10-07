// 主畫面圖示的三個候選設計（給 Yolin 挑）。每個都是「純色底＋一個粗圖形」，不用中文字、不用細線、不用漸層。
// draw 函式會被送進瀏覽器的 canvas 執行（puppeteer），所以只能用 canvas API、不能引用外部變數。
//
// 共同原則：
// - 全版不透明的正方形（iOS 會自己切圓角；透明的角會變黑）
// - 圖形放在中央約 70% 內（Android 的 maskable 安全區是 80%）
// - 圖形與底色的對比 ≥ 7:1（WCAG AAA 的文字標準）

export const DESIGNS = {
  A: {
    name: '房子打勾',
    idea: '深綠底、白色房子，房子裡一個大勾。「房子」＝收租，「勾」＝收到了。',
    fg: '#ffffff', bg: '#05592A',
    draw: `(g, s) => {
      g.fillStyle = '#05592A'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(0.50 * s, 0.15 * s);               // 屋頂尖
      g.lineTo(0.87 * s, 0.47 * s);
      g.lineTo(0.79 * s, 0.47 * s);
      g.lineTo(0.79 * s, 0.85 * s);
      g.lineTo(0.21 * s, 0.85 * s);
      g.lineTo(0.21 * s, 0.47 * s);
      g.lineTo(0.13 * s, 0.47 * s);
      g.closePath();
      g.fill();
      g.strokeStyle = '#05592A'; g.lineWidth = 0.095 * s; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(0.33 * s, 0.64 * s); g.lineTo(0.46 * s, 0.76 * s); g.lineTo(0.68 * s, 0.53 * s);
      g.stroke();
    }`,
  },
  B: {
    name: '硬幣打勾',
    idea: '亮黃底、黑色圓形（像一枚硬幣），中間一個黃色大勾。黃黑是路標用的配色，對比最強。',
    fg: '#111111', bg: '#FFC414',
    draw: `(g, s) => {
      g.fillStyle = '#FFC414'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#111111';
      g.beginPath(); g.arc(0.5 * s, 0.5 * s, 0.35 * s, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#FFC414'; g.lineWidth = 0.1 * s; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(0.33 * s, 0.51 * s); g.lineTo(0.45 * s, 0.63 * s); g.lineTo(0.68 * s, 0.38 * s);
      g.stroke();
    }`,
  },
  C: {
    name: '房間格',
    idea: '深藍底、四格房間（白），右下那一格是黃色、打了勾。和 App 裡的房間格是同一個樣子。',
    fg: '#ffffff', bg: '#0A3577',
    draw: `(g, s) => {
      g.fillStyle = '#0A3577'; g.fillRect(0, 0, s, s);
      const box = 0.31 * s, gap = 0.07 * s, x0 = (s - (2 * box + gap)) / 2, r = 0.05 * s;
      const rr = (x, y, w, h) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill(); };
      for (const [i, j] of [[0, 0], [1, 0], [0, 1]]) { g.fillStyle = '#ffffff'; rr(x0 + i * (box + gap), x0 + j * (box + gap), box, box); }
      g.fillStyle = '#FFC414'; const bx = x0 + box + gap, by = x0 + box + gap; rr(bx, by, box, box);
      g.strokeStyle = '#0A3577'; g.lineWidth = 0.06 * s; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(bx + 0.24 * box, by + 0.52 * box); g.lineTo(bx + 0.43 * box, by + 0.70 * box); g.lineTo(bx + 0.77 * box, by + 0.32 * box);
      g.stroke();
    }`,
  },
};

/** WCAG 對比值 */
export function contrast(a, b) {
  const lum = (hex) => {
    const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
