/** Test helper: a tiny structurally valid MP4 (ftyp + moov/mvhd) of `seconds`, padded to `size` bytes with `mdat`. */
export function fakeMp4(seconds: number, size = 2048): Uint8Array {
  const out = new Uint8Array(Math.max(size, 128));
  const view = new DataView(out.buffer);
  const put = (o: number, type: string) => [...type].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  // ftyp (24 bytes)
  view.setUint32(0, 24);
  put(4, "ftyp");
  put(8, "isom");
  put(20, "isom");
  // moov (8 + mvhd 108)
  view.setUint32(24, 8 + 108);
  put(28, "moov");
  view.setUint32(32, 108);
  put(36, "mvhd");
  view.setUint32(36 + 4 + 12, 1000); // timescale (version 0: flags(4) creation(4) modification(4) -> timescale)
  view.setUint32(36 + 4 + 16, Math.round(seconds * 1000));
  // mdat for the rest
  const mdat = 24 + 8 + 108;
  view.setUint32(mdat, out.length - mdat);
  put(mdat + 4, "mdat");
  return out;
}
