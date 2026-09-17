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
  /**
   * Bosma o'yinlar (AUDIT-21): krossvord va flesh kartalar — IKKALASI
   * bitta ko'ruvchida (`WordViewer`, `gameFlow` — WP-A/WP-B). «Ko'rdim =
   * oldim»: ular DOCX shakli (to'r rasmi + savol ro'yxatlari; A7 karta
   * jadvali), ya'ni bitta maketdan (`games/layout.ts planGame`)
   * chiziladi.
   *
   * Nega `academic` emas: o'yin hujjatida OQADIGAN matn yo'q — to'r
   * rasmi sahifa uzilishlari bilan, kartalar esa qat'iy 2×4 panjara
   * bilan chiziladi. Umumiy Word oqimi ularni oddiy paragraf deb
   * sahifalab yuborardi.
   */
  | "game"
  /**
   * AUDIO (AUDIT-22): podkast va tabriknoma — chiqish MP3.
   *
   * Nega alohida ko'ruvchi: bu oilada VARAQ yo'q. Word oqimi ham,
   * rasm galereyasi ham audioga yaramaydi — kerak bo'lgani pleer va
   * TRANSKRIPT (`doc.audio.script`), ya'ni «eshitgan matnim ekranda
   * turgan matn». Fayl `/api/generations/{id}/file?inline=1` dan
   * oqadi (`AudioViewer`).
   */
  | "audio"
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
    case "crossword":
    case "flashcards":
    case "sorting":
    case "listening":
      /*
       * AUDIT-21/22: to'rtala o'yin bitta ko'ruvchida (`planGame`).
       * Saralash va tinglash EKRAN o'yinlari, lekin ularning ham bosma
       * varag'i bor (jadval + javob kaliti) — natija sahifasida aynan
       * shu ko'rinadi, interaktiv rejim esa ochiq havolada
       * (`app/o/[token]`, `publicGameView`).
       */
      return "game";
    case "podcast":
    case "greeting":
      // AUDIT-22: chiqish MP3 — pleer + transkript (`AudioViewer`).
      return "audio";
    case "translation":
      return "translation";
    case "image":
    case "infographic":
      // AUDIT-21: infografika — bir betlik PNG plakat, `rasm` bilan bir
      // xil ko'ruvchi (`ImageViewer`, `packImages` qadoqlash naqshi).
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
