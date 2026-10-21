// Shrinks an encoded image in the browser (a canvas), keeping its format where the browser can write it.
export async function resizeImage(img: Uint8Array, mime: string, max: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([img as BlobPart], { type: mime }));
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot resize images.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = mime === 'image/jpeg' || mime === 'image/webp' ? mime : 'image/png';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error('This browser could not save the resized image.');
  return new Uint8Array(await blob.arrayBuffer());
}
