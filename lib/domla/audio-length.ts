/**
 * The length of a web voice answer, measured from the bytes (the client's number is not trusted), so the
 * `DOMLA_VOICE_MAX_SECONDS` limit holds for every container the chat accepts:
 *   ogg   the last page's granule position (Opus: 48 kHz; Vorbis: the identification header's rate);
 *   wav   data chunk size / byte rate from the header;
 *   mp3   file size / the first frame's bitrate (MediaRecorder never writes VBR MP3);
 *   mp4   `mvhd` duration, or for a fragmented file (Safari's MediaRecorder) the sum of its `trun` sample durations.
 * `null` when the bytes do not say; the caller then bounds it by `minSeconds` (size / the highest voice bitrate).
 * WebM is measured by its remuxer (`webm-ogg.ts`).
 */

/** The highest bitrate a recorded voice answer plausibly has (bytes/s): size / this is a LOWER bound of its length. */
export const MAX_VOICE_BYTES_PER_SEC = 32_000; // 256 kbit/s

export const minSeconds = (bytes: number): number => bytes / MAX_VOICE_BYTES_PER_SEC;

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));
const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export function oggSeconds(b: Uint8Array): number | null {
  if (b.length < 28 || ascii(b, 0, 4) !== "OggS") return null;
  const v = dv(b);
  // The rate: OpusHead -> 48 kHz always; Vorbis id header -> its sample rate.
  const head = 27 + b[26]!;
  let rate = 0;
  if (ascii(b, head, 8) === "OpusHead") rate = 48_000;
  else if (b[head] === 1 && ascii(b, head + 1, 6) === "vorbis" && head + 16 <= b.length) rate = v.getUint32(head + 12, true);
  if (!rate) return null;
  // The last page: scan back for "OggS" and read its granule.
  for (let p = b.length - 27; p >= 0; p--) {
    if (b[p] === 0x4f && b[p + 1] === 0x67 && b[p + 2] === 0x67 && b[p + 3] === 0x53 && b[p + 4] === 0) {
      const g = v.getBigUint64(p + 6, true);
      if (g === BigInt("0xFFFFFFFFFFFFFFFF")) continue; // a page with no packet end
      return Number(g) / rate;
    }
  }
  return null;
}

export function wavSeconds(b: Uint8Array): number | null {
  if (b.length < 12 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WAVE") return null;
  const v = dv(b);
  let byteRate = 0;
  for (let p = 12; p + 8 <= b.length; ) {
    const id = ascii(b, p, 4);
    const size = v.getUint32(p + 4, true);
    if (id === "fmt " && p + 20 <= b.length) byteRate = v.getUint32(p + 16, true);
    if (id === "data") return byteRate > 0 ? Math.min(size, b.length - p - 8) / byteRate : null;
    p += 8 + size + (size & 1);
  }
  return null;
}

const MP3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]; // MPEG-1 Layer III
const MP3_KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]; // MPEG-2/2.5 Layer III

export function mp3Seconds(b: Uint8Array): number | null {
  let p = 0;
  if (ascii(b, 0, 3) === "ID3" && b.length >= 10) p = 10 + ((b[6]! & 0x7f) << 21) + ((b[7]! & 0x7f) << 14) + ((b[8]! & 0x7f) << 7) + (b[9]! & 0x7f);
  for (const end = Math.min(b.length - 4, p + 64 * 1024); p <= end; p++) {
    if (b[p] !== 0xff || (b[p + 1]! & 0xe0) !== 0xe0) continue;
    const version = (b[p + 1]! >> 3) & 3; // 3 = MPEG-1
    const layer = (b[p + 1]! >> 1) & 3; // 1 = Layer III
    const idx = b[p + 2]! >> 4;
    if (layer !== 1 || version === 1 || idx === 0 || idx === 15) continue;
    const kbps = (version === 3 ? MP3_KBPS : MP3_KBPS_V2)[idx]!;
    return ((b.length - p) * 8) / (kbps * 1000);
  }
  return null;
}

type Box = { type: string; start: number; end: number; body: number };

function* boxes(b: Uint8Array, from: number, to: number): Generator<Box> {
  const v = dv(b);
  let p = from;
  while (p + 8 <= to) {
    let size = v.getUint32(p);
    const type = ascii(b, p + 4, 4);
    let body = p + 8;
    if (size === 1) {
      if (p + 16 > to) return;
      size = Number(v.getBigUint64(p + 8));
      body = p + 16;
    } else if (size === 0) size = to - p;
    if (size < body - p || p + size > to) return;
    yield { type, start: p, end: p + size, body };
    p += size;
  }
}

export function mp4Seconds(b: Uint8Array): number | null {
  const v = dv(b);
  let mvhd: number | null = null;
  let timescale = 0;
  let total = 0;
  let sawTrun = false;
  const walk = (from: number, to: number, depth: number) => {
    if (depth > 8) return;
    for (const x of boxes(b, from, to)) {
      if (["moov", "trak", "mdia", "moof", "traf", "mvex"].includes(x.type)) walk(x.body, x.end, depth + 1);
      else if (x.type === "mvhd" && x.body + 32 <= x.end) {
        const ver = b[x.body]!;
        const ts = v.getUint32(x.body + (ver === 1 ? 20 : 12));
        const dur = ver === 1 ? Number(v.getBigUint64(x.body + 24)) : v.getUint32(x.body + 16);
        if (ts > 0 && dur > 0) mvhd = dur / ts;
      } else if (x.type === "mdhd" && x.body + 24 <= x.end) {
        const ver = b[x.body]!;
        timescale = v.getUint32(x.body + (ver === 1 ? 20 : 12));
      } else if (x.type === "trun" || x.type === "tfhd") {
        sawTrun ||= x.type === "trun";
        readFragment(x);
      }
    }
  };
  let defaultDuration = 0;
  const readFragment = (x: Box) => {
    const flags = v.getUint32(x.body) & 0xffffff;
    if (x.type === "tfhd") {
      let o = x.body + 8;
      if (flags & 0x01) o += 8;
      if (flags & 0x02) o += 4;
      if (flags & 0x08 && o + 4 <= x.end) defaultDuration = v.getUint32(o);
      return;
    }
    if (x.body + 8 > x.end) return;
    const count = v.getUint32(x.body + 4);
    let o = x.body + 8;
    if (flags & 0x01) o += 4;
    if (flags & 0x04) o += 4;
    const per = ((flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0)) || 0;
    for (let i = 0; i < count; i++) {
      if (flags & 0x100) {
        if (o + 4 > x.end) return;
        total += v.getUint32(o);
      } else total += defaultDuration;
      o += per;
      if (per === 0 && !(flags & 0x100) && defaultDuration === 0) return;
    }
  };
  try {
    walk(0, b.length, 0);
  } catch {
    return null;
  }
  if (mvhd !== null) return mvhd;
  if (sawTrun && timescale > 0 && total > 0) return total / timescale;
  return null;
}
