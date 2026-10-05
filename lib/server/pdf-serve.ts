import "server-only";

/**
 * `Content-Disposition` for every file response (`GET …/file`, `GET /api/dl/<token>`).
 *
 * The synchronous PDF responder that used to live here (`pdfResponse`) is gone:
 * `GET …/file?format=pdf` goes through the shared download producer
 * (`produceDownload`, docs/mobile/PLAN.md §4.2) — registry check, derived cache,
 * per-user limit and the shared LibreOffice gate.
 */

/**
 * RFC 8187 `value-chars`: `encodeURIComponent` leaves `' ( ) *` raw, which are
 * not `attr-char`s — strict clients then drop `filename*` and fall back to the
 * ASCII name where Uzbek letters became `_` (n3).
 */
function encodeRfc8187(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Fayl nomidagi sarlavha injeksiyasini oldini oladi. */
export function contentDisposition(name: string, kind: "attachment" | "inline" = "attachment"): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeRfc8187(name)}`;
}
