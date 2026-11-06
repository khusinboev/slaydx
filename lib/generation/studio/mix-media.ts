/**
 * Studio «Montaj» — what the job needs to know about its input bytes, read in JS (the web container has no ffmpeg /
 * ffprobe, and the worker must not trust a stored number either): the length of an MP4 / MP3 and whether an MP4 has a
 * sound track. Pure.
 */
import { mp4Seconds } from "../video/mp4";
import { mp3Seconds } from "../tts/mp3";

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const type = (b: Uint8Array, o: number) => String.fromCharCode(b[o + 4]!, b[o + 5]!, b[o + 6]!, b[o + 7]!);

/** More boxes on one level than any real file holds: untrusted bytes must not become millions of objects in the web process. */
const MAX_BOXES = 1024;
/** A real clip has a few tracks; only the first picture and sound are ever used. */
const MAX_TRACKS = 16;

/** Child boxes of `[start, end)`: `[type, payloadStart, boxEnd]`. Stops at the first malformed size, and at `MAX_BOXES`. */
function boxes(b: Uint8Array, start: number, end: number): [string, number, number][] {
  const out: [string, number, number][] = [];
  let o = start;
  while (o + 8 <= end && out.length < MAX_BOXES) {
    let size = u32(b, o);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      const hi = u32(b, o + 8);
      size = hi * 2 ** 32 + u32(b, o + 12);
      header = 16;
    } else if (size === 0) size = end - o;
    if (size < header || o + size > end) break;
    out.push([type(b, o), o + header, o + size]);
    o += size;
  }
  return out;
}

/** The handler types of every track (`vide`, `soun`, …) of an MP4. */
export function mp4TrackHandlers(b: Uint8Array): string[] {
  const moov = boxes(b, 0, b.length).find((x) => x[0] === "moov");
  if (!moov) return [];
  const out: string[] = [];
  for (const trak of boxes(b, moov[1], moov[2]).filter((x) => x[0] === "trak")) {
    const mdia = boxes(b, trak[1], trak[2]).find((x) => x[0] === "mdia");
    const hdlr = mdia ? boxes(b, mdia[1], mdia[2]).find((x) => x[0] === "hdlr") : undefined;
    // hdlr payload: version+flags (4), pre_defined (4), handler_type (4).
    if (hdlr && hdlr[1] + 12 <= hdlr[2]) out.push(String.fromCharCode(b[hdlr[1] + 8]!, b[hdlr[1] + 9]!, b[hdlr[1] + 10]!, b[hdlr[1] + 11]!));
  }
  return out;
}

export function mp4HasVideo(b: Uint8Array): boolean {
  return mp4TrackHandlers(b).includes("vide");
}

export function mp4HasAudio(b: Uint8Array): boolean {
  return mp4TrackHandlers(b).includes("soun");
}

/** Measured length (s) of an input by its stored mime; 0 = unreadable. */
export function mediaSeconds(bytes: Uint8Array, mime: string): number {
  if (mime === "video/mp4") return mp4Seconds(bytes);
  if (mime === "audio/mpeg") return mp3Seconds(bytes);
  return 0;
}

/** One track of an MP4 as its own tables state it. */
export type Mp4Track = {
  handler: string;
  /** `stsd` entry format («avc1», «hvc1», «mp4a»…), "" when unreadable. */
  codec: string;
  /** The track's length (s): the longer of `mdhd` and the sum of `stts`. */
  seconds: number;
  /** Samples: the larger of what `stts` and `stsz` count (a short `stts` is stretched by the demuxer to `stsz`). */
  samples: number;
  /** Stored picture size: the larger of `tkhd` and the `stsd` entry, per side; 0 for a non-picture track. */
  width: number;
  height: number;
  /** The picture turned by a quarter (the `tkhd` matrix): a phone's portrait clip stores 1920×1080 and turns it. */
  rotated: boolean;
  /** An audio entry's sample rate (Hz), 0 for other tracks (a QuickTime v2 entry states it in its own float field). */
  sampleRate: number;
};
export type Mp4Probe = { movieSeconds: number; fragmented: boolean; tracks: Mp4Track[] };

const fourcc = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const childOf = (b: Uint8Array, parent: readonly [string, number, number] | undefined, name: string) => (parent ? boxes(b, parent[1], parent[2]).find((x) => x[0] === name) : undefined);

function trackOf(b: Uint8Array, trak: readonly [string, number, number]): Mp4Track {
  const out: Mp4Track = { handler: "", codec: "", seconds: 0, samples: 0, width: 0, height: 0, rotated: false, sampleRate: 0 };
  const tkhd = childOf(b, trak, "tkhd");
  if (tkhd) {
    // Version 1 carries 64-bit times: every later field sits 12 bytes further.
    const shift = b[tkhd[1]] === 1 ? 12 : 0;
    const matrix = tkhd[1] + 40 + shift;
    if (matrix + 44 <= tkhd[2]) {
      // A quarter turn: the matrix's `a` is zero and its `b` is not.
      out.rotated = u32(b, matrix) === 0 && u32(b, matrix + 4) !== 0;
      // 16.16 fixed point.
      out.width = u32(b, matrix + 36) >>> 16;
      out.height = u32(b, matrix + 40) >>> 16;
    }
  }
  const mdia = childOf(b, trak, "mdia");
  const hdlr = childOf(b, mdia, "hdlr");
  if (hdlr && hdlr[1] + 12 <= hdlr[2]) out.handler = fourcc(b, hdlr[1] + 8);
  const mdhd = childOf(b, mdia, "mdhd");
  let timescale = 0;
  if (mdhd && mdhd[1] + 32 <= mdhd[2] + 8) {
    const v1 = b[mdhd[1]] === 1;
    timescale = u32(b, mdhd[1] + (v1 ? 20 : 12));
    const duration = v1 ? u32(b, mdhd[1] + 24) * 2 ** 32 + u32(b, mdhd[1] + 28) : u32(b, mdhd[1] + 16);
    if (timescale > 0) out.seconds = duration / timescale;
  }
  const stbl = childOf(b, childOf(b, mdia, "minf"), "stbl");
  const stts = childOf(b, stbl, "stts");
  if (stts && stts[1] + 8 <= stts[2]) {
    // Only the entries that really fit the box: a count may lie.
    const count = Math.min(u32(b, stts[1] + 4), Math.floor((stts[2] - stts[1] - 8) / 8));
    let total = 0;
    for (let i = 0; i < count; i++) {
      const at = stts[1] + 8 + i * 8;
      const n = u32(b, at);
      out.samples += n;
      total += n * u32(b, at + 4);
    }
    if (timescale > 0) out.seconds = Math.max(out.seconds, total / timescale);
  }
  const stsz = childOf(b, stbl, "stsz");
  // stsz payload: version+flags (4), a fixed size (4), the sample count (4).
  if (stsz && stsz[1] + 12 <= stsz[2]) out.samples = Math.max(out.samples, u32(b, stsz[1] + 8));
  const stsd = childOf(b, stbl, "stsd");
  // stsd payload: version+flags (4), entry count (4), then the first entry: size (4), format (4), its fields.
  if (stsd && stsd[1] + 16 <= stsd[2]) {
    const entry = stsd[1] + 8;
    out.codec = fourcc(b, entry + 4);
    if (out.handler === "vide" && entry + 36 <= stsd[2]) {
      // VisualSampleEntry: width and height after 24 bytes of the fixed fields.
      out.width = Math.max(out.width, (b[entry + 32]! << 8) | b[entry + 33]!);
      out.height = Math.max(out.height, (b[entry + 34]! << 8) | b[entry + 35]!);
    }
    // AudioSampleEntry: the 16.16 sample rate after 24 bytes of the fixed fields.
    if (out.handler === "soun" && entry + 36 <= stsd[2]) {
      const version = (b[entry + 16]! << 8) | b[entry + 17]!;
      out.sampleRate = u32(b, entry + 32) >>> 16;
      // QuickTime v2: that field is a constant 1; the real rate is a float64 after the extension's size.
      if (version === 2 && entry + 48 <= stsd[2]) out.sampleRate = Math.round(new DataView(b.buffer, b.byteOffset, b.byteLength).getFloat64(entry + 40));
    }
  }
  return out;
}

/**
 * What an MP4 says about itself, table by table, so a file whose `mvhd` lies can be caught: every track's length from
 * `mdhd` and `stts`, its codec and picture size, and whether it is fragmented (`mvex` / `moof`: the sample tables
 * above do not describe its media at all). `null` without a `moov`. Reads only what fits the boxes: untrusted bytes.
 */
export function mp4Probe(b: Uint8Array): Mp4Probe | null {
  const top = boxes(b, 0, b.length);
  const moov = top.find((x) => x[0] === "moov");
  if (!moov) return null;
  const inside = boxes(b, moov[1], moov[2]);
  return {
    movieSeconds: mp4Seconds(b),
    fragmented: top.some((x) => x[0] === "moof") || inside.some((x) => x[0] === "mvex"),
    tracks: inside
      .filter((x) => x[0] === "trak")
      .slice(0, MAX_TRACKS)
      .map((t) => trackOf(b, t)),
  };
}

/** The tracks a job really uses (`capArgs` maps `0:v:0` and `0:a:0?`): a second sound track or a phone's metadata track never leaves. */
export function mappedTracks(probe: Mp4Probe): { picture: Mp4Track | null; sound: Mp4Track | null } {
  return { picture: probe.tracks.find((t) => t.handler === "vide") ?? null, sound: probe.tracks.find((t) => t.handler === "soun") ?? null };
}

/** How far a track's own tables may stand from `mvhd` (an AAC track ends a few frames off the picture). */
const TRACK_SLACK_SECONDS = 1;
/** Every picture codec a phone or an editor writes, and only those: a provider and our ffmpeg can read them. */
const PICTURE_CODECS: ReadonlySet<string> = new Set(["avc1", "avc3", "hvc1", "hev1", "dvh1", "dvhe", "av01", "vp09", "mp4v"]);
const SOUND_CODECS: ReadonlySet<string> = new Set(["mp4a"]);
/** More pictures a second than any camera: the sample tables were squeezed to make a long clip look short. */
const MAX_FPS = 240;
/** Samples an AAC frame decodes to (HE-AAC states half the rate with twice the samples: the product holds). */
const AAC_FRAME_SAMPLES = 1024;

/**
 * Why these tables cannot be trusted or used (Uzbek), `null` when they can. Read on the upload, where a forger wrote them,
 * and again on the worker's cut, where ffmpeg wrote them from the packets it really carried: that second reading is what
 * holds, whatever a parser here and the demuxer there disagree on. Only the tracks the job uses count.
 */
export function mp4Problem(probe: Mp4Probe): string | null {
  if (probe.fragmented) return "Bo‘laklangan (fragmented) MP4 qabul qilinmaydi — videoni oddiy MP4 qilib saqlang.";
  const { picture, sound } = mappedTracks(probe);
  if (picture && !PICTURE_CODECS.has(picture.codec)) return "Bu video kodeki qo‘llab-quvvatlanmaydi — H.264 yoki HEVC bilan saqlang.";
  if (sound && !SOUND_CODECS.has(sound.codec)) return "Bu ovoz kodeki qo‘llab-quvvatlanmaydi — AAC bilan saqlang.";
  const longest = Math.max(picture?.seconds ?? 0, sound?.seconds ?? 0);
  const lying =
    Math.abs(longest - probe.movieSeconds) > TRACK_SLACK_SECONDS ||
    (picture !== null && picture.seconds > 0 && picture.samples / picture.seconds > MAX_FPS) ||
    (sound !== null && (sound.sampleRate <= 0 || (sound.samples * AAC_FRAME_SAMPLES) / sound.sampleRate > sound.seconds * 1.5 + TRACK_SLACK_SECONDS));
  return lying ? "Video fayli buzilgan: uzunligi fayl ichida bir xil yozilmagan. Videoni qayta saqlang." : null;
}

/** The clip's shape as it is SHOWN (the `tkhd` turn applied), in the document's words; `null` without a sized picture. */
export function mp4Aspect(b: Uint8Array): "9:16" | "1:1" | "16:9" | null {
  const v = mp4Probe(b)?.tracks.find((t) => t.handler === "vide");
  if (!v || !v.width || !v.height) return null;
  const w = v.rotated ? v.height : v.width;
  const h = v.rotated ? v.width : v.height;
  if (Math.abs(w - h) <= 0.05 * Math.max(w, h)) return "1:1";
  return h > w ? "9:16" : "16:9";
}
