/**
 * Minimal MP4 reading (no dependency): is this really an MP4, and how long is it. Isomorphic.
 *
 * Why: a provider's download URL can answer 200 with an HTML/JSON error page; storing that as «the video» would sell
 * an unplayable file. And the delivered length (`moov/mvhd`) is what `delivered` compares with the seconds paid for.
 */

const u32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;

/** `ftyp` box at the start: every ISO-BMFF file begins with it. */
export function isMp4(bytes: Uint8Array): boolean {
  return bytes.length > 12 && String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!) === "ftyp";
}

function boxType(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o + 4]!, b[o + 5]!, b[o + 6]!, b[o + 7]!);
}

/** Walks the sibling boxes in [start, end) and returns the payload range of the first `type`. */
function findBox(b: Uint8Array, start: number, end: number, type: string): [number, number] | null {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o);
    let header = 8;
    if (size === 1 && o + 16 <= end) {
      // 64-bit size: the high word is zero for any file we accept (<= 25 MB).
      size = u32(b, o + 12);
      header = 16;
    } else if (size === 0) size = end - o;
    if (size < header || o + size > end) return null;
    if (boxType(b, o) === type) return [o + header, o + size];
    o += size;
  }
  return null;
}

/** Duration in seconds from `moov/mvhd`, or 0 when it cannot be read. */
export function mp4Seconds(bytes: Uint8Array): number {
  const moov = findBox(bytes, 0, bytes.length, "moov");
  if (!moov) return 0;
  const mvhd = findBox(bytes, moov[0], moov[1], "mvhd");
  if (!mvhd) return 0;
  const [s] = mvhd;
  const version = bytes[s]!;
  const timescale = version === 1 ? u32(bytes, s + 20) : u32(bytes, s + 12);
  const duration = version === 1 ? u32(bytes, s + 28) : u32(bytes, s + 16);
  return timescale > 0 ? Number((duration / timescale).toFixed(2)) : 0;
}
