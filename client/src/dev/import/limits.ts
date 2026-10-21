// The numbers an imported model must respect, and a reader for image sizes (so textures can be checked without decoding them).
export const IMPORT_LIMITS = { maxFileBytes: 100e6, mobTris: 30000, bossTris: 60000, maxTexture: 1024 };

export interface ImageSize {
  w: number;
  h: number;
}

/** Width and height from the header of a PNG, JPEG or WebP, or null when the bytes are none of those. */
export function imageSize(b: Uint8Array): ImageSize | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: dv.getUint32(16), h: dv.getUint32(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      i += 2 + dv.getUint16(i + 2);
    }
    return null;
  }
  const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
  if (b.length > 30 && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const kind = tag(12);
    if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
    if (kind === 'VP8L') {
      const bits = dv.getUint32(21, true);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}
