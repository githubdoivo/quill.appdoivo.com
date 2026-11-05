// Photos are re-drawn before they are kept: at most 2000 px on the long side and
// saved as JPEG. Re-drawing also drops everything hidden in the original file
// (camera details and the GPS location), so a diary photo never carries where it was taken.
const MAX = 2000, QUALITY = 0.85, MAX_INPUT = 40 * 1024 * 1024;
export const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";

export async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type || "image/")) throw new Error("not-image");
  if (file.size > MAX_INPUT) throw new Error("too-big");
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { bmp = await viaImg(file); }
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", QUALITY));
  if (!blob) throw new Error("not-image");
  return blob;
}
function viaImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("not-image")); };
    img.src = url;
  });
}
