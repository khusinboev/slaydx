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

  /*
   * Maqola kartochkasi (Maqola 2 / AUDIT-17, WP4): generik matn
   * ajratgichi (pastda) `sections` ichidagi `figure`/`tableRef`/`formula`
   * bloklarini (matn emas, `text` — sarlavha) va `[W…]` iqtibos
   * markerlarini noto'g'ri chiqarardi. Shuning uchun maqola uchun
   * ALOHIDA: sarlavha (mavzu) + birinchi annotatsiyaning 160 belgisi,
   * rasm — birinchi topilgan sxema (aktiv URL, `extractAssets` dan
   * keyin). `thumb` yo'li (LibreOffice birinchi sahifa) buni sinamaydi.
   */
  if (doc.article) {
    const topic = doc.meta?.topic?.trim();
    const lang = doc.article.language;
    const abstract = doc.abstracts?.find((a) => a.lang === lang) ?? doc.abstracts?.[0];
    const annotation = abstract?.text?.trim().slice(0, 160);
    const lines = [topic, annotation].filter((s): s is string => Boolean(s));
    const image = doc.article.figures.find((f) => f.url)?.url;
    if (image || lines.length) {
      return { ...(image ? { url: image } : {}), ...(lines.length ? { lines } : {}) };
    }
    return null;
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
