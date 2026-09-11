import { parseManualOutline, type ManualChapter } from "./quality";
import { ARTICLE_TYPES, hardSections } from "./article/types-registry";
import { articleLabels } from "./article/labels";
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
/**
 * `section:<id>` — maqola tur skeletidagi `hard` bo'lim (Maqola 2);
 * `prismaFigure` — sistematik sharhda PRISMA sxemasi (`review_systematic`).
 */
export type StructureNeed = "abstract" | "table" | "ownTask" | "prismaFigure" | `section:${string}`;

/**
 * Qat'iy talab: bajarilmasa ish xato bilan tugaydi va kredit qaytadi.
 *
 * Faqat `abstract` shu darajada. Sabab: `writeAbstracts` allaqachon
 * ikki marta uriniladi, ya'ni bu yerga yetib kelish kam uchraydi; jurnal
 * maqolasi yoki konferensiya tezisi esa annotatsiyasiz o'z janrida
 * umuman yaroqsiz — uni yuborib bo'lmaydi.
 *
 * Maqola 2: tur skeletidagi `hard` bo'limlar (`section:results` kabi) va
 * PRISMA ham qat'iy — «Natijalar»siz IMRAD yoki PRISMA'siz sistematik
 * sharh jurnalga yuborilmaydi. Manbalar ulushi esa ATAYIN qat'iy emas:
 * OpenAlex tushsa maqola baribir chiqadi, hisobotda qizil bo'ladi.
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
const HARD_FIXED: ReadonlySet<string> = new Set(["abstract", "prismaFigure"]);
const isHard = (n: StructureNeed) => HARD_FIXED.has(n) || n.startsWith("section:");

const LABEL: Record<"abstract" | "table" | "ownTask" | "prismaFigure", string> = {
  abstract: "annotatsiya",
  table: "jadval",
  ownTask: "mustaqil bajarilgan vazifa",
  prismaFigure: "PRISMA sxemasi",
};

export function structureNeeds(meta: DocMeta): StructureNeed[] {
  switch (meta.toolId) {
    case "article": {
      /*
       * Maqola 2: annotatsiya + tur skeletidagi `hard` bo'limlar + PRISMA.
       * Tur `meta.articleType` dan (dvigatel uni `doc.meta` ga yozadi);
       * berilmasa `imrad_oak` — reyestr standarti.
       */
      const type = ARTICLE_TYPES[meta.articleType ?? "imrad_oak"];
      const out: StructureNeed[] = ["abstract", ...hardSections(type.id).map((id): StructureNeed => `section:${id}`)];
      if (type.requiresPrisma) out.push("prismaFigure");
      return out;
    }
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

/**
 * Maqola bo'limi bormi: id aynan yoki `body-1`, `body-2` (erkin bo'limlar
 * skeletdagi `body` o'rnida) — va kamida bitta blok bilan. Bo'sh bo'lim
 * «bor» hisoblanmaydi: dvigatel javobsiz qolgan bo'limni bo'sh qaytaradi,
 * darvoza aynan shuni ushlashi kerak.
 */
function hasArticleSection(doc: AcademicDoc, id: string): boolean {
  return doc.sections.some((s) => (s.id === id || s.id.startsWith(`${id}-`)) && s.blocks.length > 0);
}

export function missingStructure(meta: DocMeta, doc: AcademicDoc): StructureNeed[] {
  const out: StructureNeed[] = [];
  /*
   * Maqola turi HUJJATDAN: dvigatel eski `kind: "imrad"` ni
   * `imrad_classic` ga ko'chirib `doc.meta`/`doc.article` ga yozadi —
   * formadan kelgan `meta` da bu bo'lmasligi mumkin, darvoza esa
   * yozilgan turga qarab tekshirishi kerak.
   */
  const effective: DocMeta = meta.toolId === "article" ? { ...meta, articleType: doc.article?.type ?? doc.meta.articleType ?? meta.articleType } : meta;
  for (const need of structureNeeds(effective)) {
    if (need === "abstract" && !doc.abstracts?.length) out.push(need);
    if (need === "table" && !doc.tables?.length) out.push(need);
    if (need === "ownTask" && !hasOwnTask(doc)) out.push(need);
    if (need === "prismaFigure" && !doc.article?.figures.some((f) => f.spec.kind === "prisma")) out.push(need);
    if (need.startsWith("section:") && !hasArticleSection(doc, need.slice("section:".length))) out.push(need);
  }
  return out;
}

/** Qat'iy talablardan qaysilari bajarilmagan. Bo'sh bo'lmasa — xato. */
export function hardMissing(meta: DocMeta, doc: AcademicDoc): StructureNeed[] {
  return missingStructure(meta, doc).filter(isHard);
}

export function needLabel(need: StructureNeed): string {
  if (need.startsWith("section:")) {
    // Xato xabari foydalanuvchiga ko'rinadi — id emas, o'zbekcha bo'lim nomi.
    const id = need.slice("section:".length);
    const sk = Object.values(ARTICLE_TYPES).flatMap((t) => t.skeleton).find((s) => s.id === id);
    return `«${sk ? articleLabels("uz").section[sk.titleKey] : id}» bo'limi`;
  }
  return LABEL[need as keyof typeof LABEL];
}

/**
 * Reja o'lchami — nechta bob va har bobda nechta ostmavzu.
 *
 * Ilgari bu deyarli qat'iy edi: kurs ishida doim 3 bob, har bobda ≤3
 * ostmavzu. Natijada dvigatelning tuzilmaviy imkoniyati ~9 ostmavzu
 * bilan cheklanardi va HAJM 45 betlik va'daga hech qachon yetmasdi —
 * 25–30 va 40–45 betlik kurs ishlari (18 000 va 24 000 tanga) hajm
 * darvozasidan MUNTAZAM yiqilardi. Jonli o'lchov: ikkalasi ham ~5 000
 * so'zda to'xtardi, byudjetning esa uchdan ikkisi ishlatilmay qolardi.
 *
 * Sabab hajm emas, CHAQIRUV SONI edi: modeldan bitta javobda 9 paragraf
 * so'ralganda u ~45% ini beradi. Uch marta 3 paragraf so'rash bir marta
 * 9 paragraf so'rashdan ko'p matn beradi. Shuning uchun hajm endi
 * chaqiruv soni orqali olinadi, chaqiruv kattaligi orqali emas.
 *
 * Bu bir vaqtning o'zida AKADEMIK jihatdan ham to'g'riroq: 45 betlik
 * kurs ishi uch bobda emas, to'rt-besh bobda yoziladi.
 */
export function outlineShape(pages: number, toolId: string): { chapters: number; subs: number } {
  const p = Math.max(4, pages || 8);
  if (p >= 33) return { chapters: 5, subs: 4 };
  if (p >= 23) return { chapters: 4, subs: 4 };
  if (p >= 18 || toolId === "coursework") return { chapters: 3, subs: 3 };
  return { chapters: 2, subs: 3 };
}

/**
 * Foydalanuvchi yozgan reja — BAYROQ emas, MATN hal qiladi.
 *
 * Ilgari shart faqat `meta.tocMethod === "manual"` edi. Formada esa
 * ikkita boshqaruv bir narsani boshqarardi: chips (`ai`/`manual`,
 * standart `ai`) va reja matni maydoni. `tocMethod` FAQAT «AI reja
 * tuzsin» tugmasi bosilganda `manual` ga o'tardi — ya'ni foydalanuvchi
 * rejasini to'g'ridan-to'g'ri yozsa, u JIM tashlanardi va 16 000–24 000
 * tangalik hujjat butunlay boshqa tuzilmada chiqardi. Maydon ostidagi
 * yozuv («Bo'sh qoldirsangiz reja avtomatik tuziladi») aynan teskarisini
 * va'da qilardi.
 *
 * Endi qoida bitta va soddaroq: reja matni bor bo'lsa — u ishlatiladi.
 * Dvigatel UI bayrog'ining to'g'ri o'rnatilganiga tayanmasligi kerak;
 * bo'sh matn baribir `[]` beradi, ya'ni reja avtomatik tuziladi.
 *
 * `extra` ga qaytish faqat ANIQ `manual` rejimida qoladi (eski
 * xatti-harakat): «qo'shimcha talablar» maydoni reja emas, uni har
 * safar reja deb o'qish noto'g'ri bo'lardi.
 */
export function manualOutlineOf(meta: Pick<DocMeta, "tocMethod" | "tocText" | "extra">): ManualChapter[] {
  const text = meta.tocMethod === "manual" ? meta.tocText || meta.extra : meta.tocText;
  return String(text ?? "").trim() ? parseManualOutline(text) : [];
}
