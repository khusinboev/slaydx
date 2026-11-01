/**
 * Storage (docs/studio/P0-SPEC.md §3.10): where finished media lives. The host picks the implementation (SlaydX P0:
 * Postgres rows as today; later a disk or S3-compatible store) behind this one interface, so callers never change.
 *
 * Outputs are checked here before they are stored: the type is SNIFFED from the bytes (a provider's or a client's
 * claim is never trusted) and must be one the model may return; the size must fit.
 */
export type StoredObject = { key: string; mime: string; size: number; sha256: string };

export interface MediaStore {
  put(o: { key: string; bytes: Uint8Array; mime: string; sha256: string }): Promise<StoredObject>;
  get(key: string, range?: { start: number; end?: number }): Promise<{ bytes: Uint8Array; size: number; mime: string } | null>;
  /** Short-lived signed GET, for stores that can serve directly (absent: the host streams `get`). */
  url?(key: string, ttlSec: number): Promise<string>;
  delete(key: string): Promise<void>;
}

const at = (b: Uint8Array, i: number, ...sig: number[]) => sig.every((s, k) => b[i + k] === s);
const ascii = (b: Uint8Array, i: number, s: string) => at(b, i, ...[...s].map((c) => c.charCodeAt(0)));

/** The media type of `bytes` by magic number, `null` when unknown. */
export function sniffMime(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (at(b, 0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(b, 0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return "image/webp";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE")) return "audio/wav";
  if (ascii(b, 0, "GIF8")) return "image/gif";
  if (ascii(b, 4, "ftyp")) return "video/mp4";
  if (ascii(b, 0, "OggS")) return "audio/ogg";
  if (ascii(b, 0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const d = await crypto.subtle.digest("SHA-256", view.buffer);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export type OutputCheck = { ok: true; mime: string; sha256: string } | { ok: false; error: string };

export async function checkOutput(bytes: Uint8Array, spec: { mimes: readonly string[]; maxBytes: number }): Promise<OutputCheck> {
  if (bytes.byteLength === 0) return { ok: false, error: "empty output" };
  if (bytes.byteLength > spec.maxBytes) return { ok: false, error: `output too large (${bytes.byteLength} bytes)` };
  const mime = sniffMime(bytes);
  if (!mime || !spec.mimes.includes(mime)) return { ok: false, error: `unexpected output type ${mime ?? "unknown"}` };
  return { ok: true, mime, sha256: await sha256Hex(bytes) };
}
