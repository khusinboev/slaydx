import type { AcademicDoc, DocMeta } from "./types";

/**
 * Janr uchun MAJBURIY tuzilma elementlari.
 *
 * Hajm darvozasi (`index.ts`) «yetarli yozildimi» ni so'raydi. Bu esa
 * ikkinchi savolni: «va'da qilingan JANR chiqdimi». Annotatsiyasiz
 * maqola — uzun referat, o'z vazifasisiz mustaqil ish — referat kloni.
 * Ikkalasi ham to'langan narsa emas.
 *
 * Nega bob SONI janrga qarab ajratilmadi: `outlineShape` bob sonini
 * bet sonidan hisoblaydi va bu son bir vaqtning o'zida CHAQIRUV sonini
 * belgilaydi — ya'ni hajmni. Referatga sun'iy ravishda kamroq bob berish
 * uni hajm darvozasidan yiqitardi. 12 betlik referat ham, mustaqil ish
 * ham 2 bobda yoziladi; farq boblar SONIDA emas, ularning MAZMUNIDA —
 * uni prompt (`mustaqilIshSystemPrompt`) so'raydi, bu modul esa
 * tekshiradi.
 */
export type StructureNeed = "abstract" | "table" | "ownTask";

/**
 * Qat'iy talab: bajarilmasa ish xato bilan tugaydi va kredit qaytadi.
 *
 * Faqat `abstract` shu darajada. Sabab: `writeAbstracts` allaqachon
 * ikki marta uriniladi, ya'ni bu yerga yetib kelish kam uchraydi; jurnal
 * maqolasi yoki konferensiya tezisi esa annotatsiyasiz o'z janrida
 * umuman yaroqsiz — uni yuborib bo'lmaydi.
 *
 * `table` ATAYIN yumshoq: u `meta.includeVisuals` — foydalanuvchining
 * O'Z tanloviga bog'liq va bezak xarakterida. To'liq yozilgan 24 000
 * tangalik kurs ishini bitta jadval yo'qligi uchun yiqitish
 * foydalanuvchiga olganidan ko'proq zarar berardi.
 *
 * `ownTask` hozircha KUZATUVDA: aniqlash evristik, shuning uchun avval
 * jonli statistika yig'iladi (`console.warn`), keyin qaror qilinadi.
 * Darvoza noto'g'ri ishga tushsa, u foydalanuvchidan pul emas, ishonch
 * oladi.
 */
const HARD: ReadonlySet<StructureNeed> = new Set<StructureNeed>(["abstract"]);

const LABEL: Record<StructureNeed, string> = {
  abstract: "annotatsiya",
  table: "jadval",
  ownTask: "mustaqil bajarilgan vazifa",
};

export function structureNeeds(meta: DocMeta): StructureNeed[] {
  switch (meta.toolId) {
    case "article":
    case "thesis":
      return ["abstract"];
    case "coursework":
      // Jadval faqat foydalanuvchi vizual so'ragan bo'lsa kutiladi.
      return meta.includeVisuals ? ["table"] : [];
    case "mustaqil-ish":
      return ["ownTask"];
    default:
      return [];
  }
}

/**
 * Mustaqil ishning oxirgi bobida haqiqiy natija bormi.
 *
 * Prompt «kamida bitta raqamli yoki qadamma-qadam natija» so'raydi.
 * Tekshiruv ATAYIN keng: raqam, kod namunasi yoki jadval — uchtasidan
 * biri yetarli. Maqsad — «oxirgi bob ham sof nazariya bo'lib qolgan»
 * holatini ushlash, uslubni baholash emas.
 */
function hasOwnTask(doc: AcademicDoc): boolean {
  /*
   * `qoshimcha` — hajm darvozasi uchun qo'shiladigan to'ldiruvchi bob
   * (`write-llm.ts`), janr bobi emas. U hisobga olinmaydi: aks holda
   * tekshiruv har doim o'sha umumiy bobga qarab, amaliy bobni umuman
   * ko'rmasdi.
   */
  const body = doc.sections.filter(
    (s) => s.id !== "kirish" && s.id !== "xulosa" && s.id !== "qoshimcha",
  );
  const last = body[body.length - 1];
  if (!last) return false;
  if (doc.tables?.length) return true;
  if (last.blocks.some((b) => b.kind === "code")) return true;
  // Raqamli natija: kamida ikkita raqam tutgan gap.
  return last.blocks.some((b) => (b.text.match(/\d/g) ?? []).length >= 2);
}

export function missingStructure(meta: DocMeta, doc: AcademicDoc): StructureNeed[] {
  const out: StructureNeed[] = [];
  for (const need of structureNeeds(meta)) {
    if (need === "abstract" && !doc.abstracts?.length) out.push(need);
    if (need === "table" && !doc.tables?.length) out.push(need);
    if (need === "ownTask" && !hasOwnTask(doc)) out.push(need);
  }
  return out;
}

/** Qat'iy talablardan qaysilari bajarilmagan. Bo'sh bo'lmasa — xato. */
export function hardMissing(meta: DocMeta, doc: AcademicDoc): StructureNeed[] {
  return missingStructure(meta, doc).filter((n) => HARD.has(n));
}

export function needLabel(need: StructureNeed): string {
  return LABEL[need];
}
