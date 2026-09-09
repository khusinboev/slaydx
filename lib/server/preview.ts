import "server-only";
import type { GenerationPreview } from "./jobs";
import type { AcademicDoc } from "../generation/types";

/**
 * Ro'yxat kartochkasi uchun kichik ko'rinish.
 *
 * Ro'yxat endpointi butun hujjatni qaytarmaydi, shuning uchun rasm
 * havolasi va bir necha qator matn shu yerda oldindan tayyorlanadi.
 *
 * Ilgari `worker.ts` ichida edi — tahrirdan keyin (`commitDocOps`) ham
 * kerak bo'ladi, shuning uchun alohida modulga ko'chirildi.
 */
export function buildPreview(doc: AcademicDoc | null): GenerationPreview | null {
  if (!doc) return null;
  const url =
    doc.images?.find((im) => im.url)?.url || doc.slides?.find((s) => s.image?.url)?.image?.url;
  const lines = (doc.sections ?? [])
    .flatMap((s) => s.blocks.filter((b) => b.kind === "p" || b.kind === "h2" || b.kind === "li"))
    .map((b) => b.text.trim())
    .filter((t) => t.length > 12)
    .slice(0, 5)
    .map((t) => t.slice(0, 160));
  if (!url && !lines.length) return null;
  return { ...(url ? { url } : {}), ...(lines.length ? { lines } : {}) };
}
