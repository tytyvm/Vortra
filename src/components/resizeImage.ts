// Resize a photo in the browser to max 1024px on the long side and re-encode as JPEG.
export async function resizeImage(file: File, max = 1024, quality = 0.85): Promise<{ mimeType: string; data: string; url: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions).catch(() => createImageBitmap(file));
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const url = canvas.toDataURL("image/jpeg", quality);
  return { mimeType: "image/jpeg", data: url.split(",")[1], url };
}
