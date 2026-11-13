/**
 * «Qattiqqo'l domla» web answers: a browser's MediaRecorder writes Opus in a WebM container (Chrome, Android WebView,
 * Telegram's in-app browser), which the scorer (Gemini) does not list as an audio type -- while Ogg/Opus, the format of
 * a Telegram voice message, is what the bot path already sends it. So a WebM answer is REMUXED (not transcoded: the Opus
 * packets are copied byte for byte) into an Ogg/Opus stream (RFC 7845) here. No dependency, no ffmpeg.
 *
 * The WebM parser is flat: master elements (Segment, Cluster, Tracks, TrackEntry, BlockGroup) are entered, every other
 * element is read or skipped by its size. That handles the live-recording shape Chrome writes (Segment and Cluster of
 * UNKNOWN size) as well as a finished file. Laced blocks are refused (MediaRecorder never laces audio).
 */

export class RemuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemuxError";
  }
}

/** What the container of an uploaded answer is, from its first bytes (the client's mime type is not trusted). */
export function sniffAnswerAudio(b: Uint8Array): "webm" | "ogg" | "mp4" | "mp3" | "wav" | null {
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return "ogg";
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "mp4";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return "wav";
  if (b.length >= 3 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0))) return "mp3";
  return null;
}

/* ───────────────────────── EBML ───────────────────────── */

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Audio: 0xe1,
  Channels: 0x9f,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
} as const;

const MASTERS = new Set<number>([ID.Segment, ID.Cluster, ID.Tracks, ID.TrackEntry, ID.BlockGroup, ID.Audio]);

function vintLength(first: number): number {
  for (let i = 0; i < 8; i++) if (first & (0x80 >> i)) return i + 1;
  return 0;
}

/** Element id (marker bits kept, as the spec writes them). */
function readId(b: Uint8Array, p: number): { id: number; len: number } {
  const len = vintLength(b[p] ?? 0);
  if (len < 1 || len > 4 || p + len > b.length) throw new RemuxError("WebM: buzuq element id");
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[p + i]!;
  return { id, len };
}

/** Element size; `-1` = unknown (all value bits set). */
function readSize(b: Uint8Array, p: number): { size: number; len: number } {
  const len = vintLength(b[p] ?? 0);
  if (len < 1 || p + len > b.length) throw new RemuxError("WebM: buzuq element o‘lchami");
  let v = (b[p]! & (0xff >> len)) as number;
  let allOnes = v === 0xff >> len;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[p + i]!;
    if (b[p + i] !== 0xff) allOnes = false;
  }
  return { size: allOnes ? -1 : v, len };
}

type Track = { number: number; codec: string; priv: Uint8Array | null; channels: number };

/** The Opus packets of the (first) Opus track, in order, and its OpusHead (CodecPrivate) when present. */
export function webmOpusPackets(b: Uint8Array): { head: Uint8Array | null; channels: number; packets: Uint8Array[] } {
  const tracks: Track[] = [];
  let cur: Track | null = null;
  const blocks: { track: number; data: Uint8Array }[] = [];
  let p = 0;
  let sawEbml = false;
  while (p < b.length) {
    const { id, len: il } = readId(b, p);
    const { size, len: sl } = readSize(b, p + il);
    const start = p + il + sl;
    if (id === ID.EBML) sawEbml = true;
    if (MASTERS.has(id)) {
      if (id === ID.TrackEntry) {
        cur = { number: 0, codec: "", priv: null, channels: 1 };
        tracks.push(cur);
      }
      p = start; // enter (flat walk)
      continue;
    }
    if (size < 0) throw new RemuxError("WebM: o‘lchami noma’lum oddiy element");
    const end = start + size;
    if (end > b.length) {
      // A recording cut mid-element (the last block of a stopped recorder may be partial): stop here.
      break;
    }
    const data = b.subarray(start, end);
    if (cur && id === ID.TrackNumber) cur.number = uint(data);
    else if (cur && id === ID.CodecID) cur.codec = new TextDecoder().decode(data);
    else if (cur && id === ID.CodecPrivate) cur.priv = data;
    else if (cur && id === ID.Channels) cur.channels = uint(data) || 1;
    else if (id === ID.SimpleBlock || id === ID.Block) {
      const tn = readSize(data, 0);
      if (data.length < tn.len + 3) throw new RemuxError("WebM: buzuq blok");
      const flags = data[tn.len + 2]!;
      if (flags & 0x06) throw new RemuxError("WebM: lacing qo‘llab-quvvatlanmaydi");
      blocks.push({ track: tn.size, data: data.subarray(tn.len + 3) });
    }
    p = end;
  }
  if (!sawEbml) throw new RemuxError("WebM emas");
  const opus = tracks.find((t) => t.codec === "A_OPUS");
  if (!opus) throw new RemuxError("WebM ichida Opus audio yo‘q");
  const packets = blocks.filter((x) => x.track === opus.number && x.data.length > 0).map((x) => x.data);
  const head = opus.priv && opus.priv.length >= 19 && ascii(opus.priv, 0, 8) === "OpusHead" ? opus.priv : null;
  return { head, channels: head ? head[9]! : opus.channels, packets };
}

function uint(d: Uint8Array): number {
  let v = 0;
  for (const x of d) v = v * 256 + x;
  return v;
}
const ascii = (d: Uint8Array, at: number, n: number): string => String.fromCharCode(...d.subarray(at, at + n));

/* ───────────────────────── Opus ───────────────────────── */

/** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 §3.1). */
export function opusPacketSamples(pkt: Uint8Array): number {
  if (pkt.length < 1) return 0;
  const toc = pkt[0]!;
  const config = toc >> 3;
  const tenthsMs = config < 12 ? [100, 200, 400, 600][config % 4]! : config < 16 ? [100, 200][config % 2]! : [25, 50, 100, 200][config % 4]!;
  const c = toc & 3;
  const frames = c === 0 ? 1 : c === 3 ? (pkt[1] ?? 0) & 0x3f : 2;
  return (frames * tenthsMs * 48) / 10;
}

/* ───────────────────────── Ogg ───────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    t[i] = r >>> 0;
  }
  return t;
})();

/** Ogg page checksum (CRC-32, polynomial 0x04C11DB7, not reflected, init 0). */
export function oggCrc(d: Uint8Array): number {
  let crc = 0;
  for (const x of d) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ x) & 0xff]!) >>> 0;
  return crc >>> 0;
}

function lacing(len: number): number[] {
  const out: number[] = [];
  let n = len;
  while (n >= 255) {
    out.push(255);
    n -= 255;
  }
  out.push(n);
  return out;
}

function page(packets: Uint8Array[], granule: bigint, serial: number, seq: number, type: number): Uint8Array {
  const segs = packets.flatMap((pk) => lacing(pk.length));
  const bodyLen = packets.reduce((a, pk) => a + pk.length, 0);
  const out = new Uint8Array(27 + segs.length + bodyLen);
  const v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0);
  out[4] = 0;
  out[5] = type;
  v.setBigUint64(6, granule, true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  out[26] = segs.length;
  out.set(segs, 27);
  let o = 27 + segs.length;
  for (const pk of packets) {
    out.set(pk, o);
    o += pk.length;
  }
  v.setUint32(22, oggCrc(out), true);
  return out;
}

function opusHead(channels: number): Uint8Array {
  const h = new Uint8Array(19);
  const v = new DataView(h.buffer);
  h.set(new TextEncoder().encode("OpusHead"), 0);
  h[8] = 1;
  h[9] = channels;
  v.setUint16(10, 312, true);
  v.setUint32(12, 48_000, true);
  return h;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("slaydx-domla");
  const t = new Uint8Array(8 + 4 + vendor.length + 4);
  const v = new DataView(t.buffer);
  t.set(new TextEncoder().encode("OpusTags"), 0);
  v.setUint32(8, vendor.length, true);
  t.set(vendor, 12);
  v.setUint32(12 + vendor.length, 0, true);
  return t;
}

/** Packets per audio page (each Opus packet is < 255 * 4 bytes, so the 255-segment limit is never reached). */
const PACKETS_PER_PAGE = 50;

/**
 * WebM/Opus -> Ogg/Opus. Returns the Ogg bytes and the length in seconds (from the packets' own durations, so a
 * client that lies about the length is measured, not trusted). Throws `RemuxError` on anything else.
 */
export function webmToOgg(webm: Uint8Array, serial = 0x5d0a1a): { bytes: Uint8Array; seconds: number } {
  const { head, channels, packets } = webmOpusPackets(webm);
  if (packets.length === 0) throw new RemuxError("WebM ichida audio yo‘q");
  const pages: Uint8Array[] = [page([head ?? opusHead(channels)], BigInt(0), serial, 0, 0x02), page([opusTags()], BigInt(0), serial, 1, 0)];
  let granule = BigInt(0);
  let total = 0;
  let seq = 2;
  for (let i = 0; i < packets.length; i += PACKETS_PER_PAGE) {
    const chunk = packets.slice(i, i + PACKETS_PER_PAGE);
    for (const pk of chunk) {
      const n = opusPacketSamples(pk);
      total += n;
      granule += BigInt(n);
    }
    const last = i + PACKETS_PER_PAGE >= packets.length;
    pages.push(page(chunk, granule, serial, seq++, last ? 0x04 : 0));
  }
  const len = pages.reduce((a, pg) => a + pg.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const pg of pages) {
    out.set(pg, o);
    o += pg.length;
  }
  return { bytes: out, seconds: total / 48_000 };
}
