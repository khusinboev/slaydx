import "server-only";

/**
 * `Content-Disposition` for every file response (`GET …/file`, `GET /api/dl/<token>`).
 *
 * The synchronous PDF responder that used to live here (`pdfResponse`) is gone:
 * `GET …/file?format=pdf` goes through the shared download producer
 * (`produceDownload`, docs/mobile/PLAN.md §4.2) — registry check, derived cache,
 * per-user limit and the shared LibreOffice gate.
 */

/** Fayl nomidagi sarlavha injeksiyasini oldini oladi. */
export function contentDisposition(name: string, kind: "attachment" | "inline" = "attachment"): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
