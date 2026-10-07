// 收據照片：拍下就壓縮（長邊 1024px、JPEG 品質 0.6），原圖不留。
// 用 <img> 解碼再畫到 canvas：iPhone 的 Safari 會依照片的方向資訊自動轉正。
// TripQuest 踩過：有的 Safari 版本 toBlob 會默默吐出別的格式，所以一定檢查結果的 type。

export const MAX_EDGE = 1024;
export const QUALITY = 0.6;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('讀不了這張照片')); };
    img.src = url;
  });
}

export async function compress(file) {
  const img = await loadImage(file);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const k = Math.min(1, MAX_EDGE / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', QUALITY));
  if (!blob || blob.type !== 'image/jpeg') throw new Error('這支手機沒辦法把照片轉成 JPEG');
  return { blob, w, h };
}
