import "server-only";
import type { GenerationPreview } from "./jobs";
import type { AcademicDoc } from "../generation/types";
import type { SlideModel } from "../generation/slide-types";
import { buildSlideDeck } from "../generation/slides";

/**
 * Ro'yxat kartochkasi uchun kichik ko'rinish.
 *
 * Ro'yxat endpointi butun hujjatni qaytarmaydi, shuning uchun rasm
 * havolasi va bir necha qator matn shu yerda oldindan tayyorlanadi.
 *
 * Slayd dekalari (`doc.slides` bor) uchun endi rasm/matn o'rniga
 * BIRINCHI slaydning to'liq maket modeli (`preview.slide`) tayyorlanadi
 * — kartochka (`FilePreview.tsx`) uni `SlideCanvas` bilan ko'ruvchidagidek
 * chizadi. Maket qiymatlari (`themeId`/`templateId`/`visual`/`bodyType`)
 * `buildSlideDeck` dan olinadi — bu ham `render-pptx.ts` va veb-ko'ruvchi
 * ishlatadigan AYNAN o'sha "yagona manba" ("ko'rdim = oldim").
 *
 * Ilgari `worker.ts` ichida edi — tahrirdan keyin (`commitDocOps`) ham
 * kerak bo'ladi, shuning uchun alohida modulga ko'chirildi.
 */
export function buildPreview(doc: AcademicDoc | null): GenerationPreview | null {
  if (!doc) return null;

  if (doc.slides?.length) {
    const deck = buildSlideDeck(doc);
    const first = deck.slides[0];
    if (first) {
      return {
        slide: {
          model: stripNotes(first),
          themeId: deck.themeId,
          templateId: deck.templateId,
          visual: deck.visual,
          audience: deck.audience,
          bodyType: deck.bodyType,
          ...(deck.logo ? { logo: deck.logo } : {}),
        },
      };
    }
  }

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

/**
 * `notes` (notiq nutqi) kartochkada hech qachon ko'rsatilmaydi — faqat
 * `preview` ustunining hajmini bekorga oshiradi. `void` — eslint
 * "ishlatilmagan o'zgaruvchi" ogohlantirishini konfiguratsiyaga
 * qaramasdan bostirish uchun (destrukturizatsiyadan qolgan qism).
 */
function stripNotes(slide: SlideModel): Omit<SlideModel, "notes"> {
  const { notes: _notes, ...rest } = slide;
  void _notes;
  return rest;
}
