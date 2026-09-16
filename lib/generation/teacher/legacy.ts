/**
 * ESKI O'QITUVCHI HUJJATI → MINIMAL MODEL (AUDIT-20 WP-C, X-5).
 *
 * Bazada minglab dars rejasi / texnologik xarita / glossariy / keys
 * `doc_json` i bor va ularda `doc.teacher` YO'Q. Ilgari ular o'z
 * ko'ruvchilarida (`LessonViewer`/`TableViewer`/`GlossaryViewer`/
 * `KeysViewer`) ochilardi; WP-C da o'sha to'rt ko'ruvchi O'CHIRILDI
 * (qaror 12: sayt = fayl, brend-muqova yo'q), ya'ni eski hujjat ham
 * YANGI yo'ldan (`planTeacher` → `drawTeacher` / `teacherFlow`)
 * chizilishi kerak.
 *
 * Bu modul shuning uchun bor: u `meta` dan RASMIY SHAPKA ni tiklaydi
 * (muassasa, fan, sinf, tuzuvchi, til) va kind modelini BO'SH qoldiradi.
 * Bo'sh model — ataylab: `planTeacher` ning tuzilma biriktirmalari
 * (vaqt jadvali, chorak jadvali, atamalar ro'yxati, savollar) hech
 * narsa qo'shmaydi va hujjat avvalgidek «sarlavha + bloklar +
 * langarlangan jadval» bo'lib qoladi. Ya'ni eski hujjatning MAZMUNI
 * o'zgarmaydi — faqat titul beti o'rniga shapka chiqadi.
 *
 * FAQAT O'QISH. Model bu yerda TAXMIN qilinadi (bosqichlarni nasrdan
 * qayta ajratib bo'lmaydi), shuning uchun tahrir yo'llari (`teacher.
 * lesson.stages.2.teacher`) kafolatlanmaydi — WP-D tahrir adapteri
 * `plan.legacy` bo'lsa 409 qaytaradi (`work/edit.ts` dagi qaror).
 */
import type { AcademicDoc } from "../types";
import { teacherKindOf } from "./registry";
import type { TeacherKind, TeacherModel, TeacherSchool } from "./types";

/**
 * Eski hujjatda tur ID si saqlanmagan — har kindning STANDART turi
 * olinadi (`registry.ts`: ro'yxatning birinchi elementi). Reyestrni bu
 * yerda qayta o'qimaymiz: `teacherTypeOf(kind, "")` baribir standartga
 * tushadi, `type` esa hisobot/prompt uchun emas, faqat ko'rsatish uchun.
 */
const LEGACY_TYPE: Record<TeacherKind, string> = {
  lesson: "yangi-mavzu",
  map: "yillik",
  glossary: "fan-lugati",
  keys: "muammoli",
  test: "nazorat",
};

function legacySchool(doc: AcademicDoc): TeacherSchool {
  const m = doc.meta;
  return {
    /*
     * Eski formada muassasa `university` maydonida (o'qituvchi
     * vositalarida u «maktab» ma'nosini bildirardi — `TEACHER_FIELDS`).
     */
    institution: (m.university || "").trim(),
    author: (m.author || "").trim(),
    subject: (m.subject || "").trim(),
    grade: Number(m.grade) || 0,
    language: m.language || "uz",
    /*
     * «Tasdiqlayman» eski hujjatda YO'Q edi (forma maydoni ham yo'q edi)
     * — uni o'ylab topib qo'ymaymiz: shapkada bo'sh imzo joyi paydo
     * bo'lishi «bu hujjat tasdiqlangan» degan yolg'on taassurot berardi.
     */
  };
}

/**
 * `null` — hujjat o'qituvchi oilasiga tegishli emas (`toolId` boshqa).
 * `planTeacher` shunda xato tashlaydi, `renderDocx`/`docToFlow` esa bu
 * yergacha umuman kelmaydi (`isTeacherDoc` shoxi).
 */
export function legacyTeacherModel(doc: AcademicDoc): TeacherModel | null {
  const kind = teacherKindOf(doc.meta.toolId);
  if (!kind) return null;
  return {
    v: 1,
    kind,
    type: LEGACY_TYPE[kind],
    school: legacySchool(doc),
  };
}
