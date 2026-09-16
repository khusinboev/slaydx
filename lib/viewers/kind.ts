import type { ToolId } from "@/lib/types";

export type ViewerKind =
  | "academic"
  | "essay"
  | "article"
  | "resume"
  | "slides"
  /**
   * O'qituvchi hujjatlari (AUDIT-20): dars rejasi, texnologik xarita,
   * glossariy, keys va test — BESHALASI bitta ko'ruvchida (`WordViewer`,
   * `teacherFlow`). «Ko'rdim = oldim»: ular rasmiy DOCX shakli, ya'ni
   * bitta maketdan (`teacher/layout.ts planTeacher`) chiziladi.
   *
   * Eski `lesson`/`table`/`glossary`/`keys` qiymatlari WP-C da OLIB
   * TASHLANDI — ularga tegishli to'rt ko'ruvchi brend-muqova chizardi
   * (saytda faylda yo'q birinchi bet), egasi qarori 12 buni yopdi.
   */
  | "teacher"
  | "translation"
  | "image";

export function viewerKind(id: ToolId): ViewerKind {
  switch (id) {
    case "slide":
    case "pro-slide":
      return "slides";
    case "resume":
      return "resume";
    case "lesson-plan":
    case "texnologik-xarita":
    case "glossary":
    case "keys":
    case "test":
      // AUDIT-20: beshala o'qituvchi vositasi bitta ko'ruvchida.
      return "teacher";
    case "translation":
      return "translation";
    case "image":
      return "image";
    case "essay":
      return "essay";
    case "article":
    case "thesis":
      // AUDIT-19: tezis maqola dvigatelida — ko'ruvchi, hisobot paneli va tahrir maqolaniki.
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
