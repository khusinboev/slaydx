/**
 * Studio «Montaj» — what the job needs to know about its input bytes, read in JS (the web container has no ffmpeg /
 * ffprobe, and the worker must not trust a stored number either): the length of an MP4 / MP3 and whether an MP4 has a
 * sound track. Pure.
 */
import { mp4Seconds } from "../video/mp4";
import { mp3Seconds } from "../tts/mp3";

const u32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const type = (b: Uint8Array, o: number) => String.fromCharCode(b[o + 4]!, b[o + 5]!, b[o + 6]!, b[o + 7]!);

/** Child boxes of `[start, end)`: `[type, payloadStart, boxEnd]`. Stops at the first malformed size. */
function boxes(b: Uint8Array, start: number, end: number): [string, number, number][] {
  const out: [string, number, number][] = [];
  let o = start;
  while (o + 8 <= end) {
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
