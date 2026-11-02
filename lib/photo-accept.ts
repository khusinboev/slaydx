/** Surat yuklash uchun qabul qilinadigan turlar — klient va test bir manbadan. */
export const PHOTO_ACCEPT = "image/png,image/jpeg";

/** The photo upload's size limit, enforced by `POST /api/uploads/photo` (`lib/server/photo.ts`); forms state it from here. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** «PNG yoki JPEG, 5 MB gacha» — the upload hint, built from the limits the endpoint enforces. */
export function photoHint(): string {
  return `PNG yoki JPEG, ${Math.round(PHOTO_MAX_BYTES / (1024 * 1024))} MB gacha`;
}
