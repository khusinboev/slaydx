/**
 * Byte limits shared by client-safe modules (the media catalog, read by the forms and the Studio page) and the server.
 * Isomorphic on purpose: `pptx-image.ts` pulls `sharp`, which must never reach a browser bundle, so the number lives
 * here and `pptx-image.ts` re-exports it for its existing importers.
 */

/** Largest stored file. Mirrors `lib/server/storage.ts MAX_FILE_BYTES` (a test keeps them equal). */
export const PPTX_SIZE_LIMIT = 25 * 1024 * 1024;
