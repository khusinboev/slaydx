/**
 * HTTP `Range` (RFC 9110 §14) for the stored media files.
 *
 * Why: `<video>` on iOS Safari does not play an MP4 unless the server answers `Range: bytes=…` requests with
 * `206 Partial Content`, and every browser needs it to seek. The file is read whole from Postgres (`getGenerationFile`),
 * so this saves no database work -- it only slices the buffer already in memory.
 *
 * Only a single `bytes=a-b` / `bytes=a-` / `bytes=-n` range is honoured; a multi-range or malformed header is ignored
 * (the full 200 response, which every client accepts), exactly what RFC 9110 allows.
 */
export type ByteRange = { start: number; end: number };

/** `null`: no (usable) Range header, answer 200. `"unsatisfiable"`: answer 416. */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange | "unsatisfiable" | null {
  if (!header || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    // Suffix range: the last n bytes.
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n <= 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    if (start >= size) return "unsatisfiable";
    if (end < start) return null;
  }
  return { start, end };
}
