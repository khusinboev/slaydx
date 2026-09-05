import type { ToolId } from "@/lib/types";

export type ViewerKind =
  | "academic"
  | "essay"
  | "article"
  | "resume"
  | "slides"
  | "lesson"
  | "table"
  | "glossary"
  | "keys"
  | "translation"
  | "image";

export function viewerKind(id: ToolId): ViewerKind {
  switch (id) {
    case "slide":
      return "slides";
    case "resume":
      return "resume";
    case "lesson-plan":
      return "lesson";
    case "texnologik-xarita":
      return "table";
    case "glossary":
      return "glossary";
    case "keys":
      return "keys";
    case "translation":
      return "translation";
    case "image":
      return "image";
    case "essay":
      return "essay";
    case "article":
      return "article";
    default:
      return "academic";
  }
}

/**
 * Rasm MIME turidan fayl kengaytmasi.
 *
 * Ko'ruvchi ham, generator ham shu YAGONA manbadan foydalanadi.
 * Ilgari ikkalasi mustaqil qaror qilardi va mos kelmasdi: generator
 * PNG ni to'g'ri aniqlar, ko'ruvchidagi yuklash tugmasi esa qattiq
 * yozilgan `.jpg` nomini berardi. Bu modulda server kodi yo'q, shuning
 * uchun uni klient komponenti ham import qila oladi.
 */
export function imageExt(mime: string | undefined): string {
  if (!mime) return "jpg";
  if (/png/i.test(mime)) return "png";
  if (/webp/i.test(mime)) return "webp";
  return "jpg";
}
