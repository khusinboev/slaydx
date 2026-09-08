import type { SlideTemplateId } from "./slide-templates";
import type { DocMeta } from "./types";
import { PLAN_ITEMS_DEFAULT, type SlideTextVolume } from "./slide-params";

/**
 * Auditoriya — deck KIM uchun.
 *
 * Ilgari 4 ta (+auto) edi: himoya, ma'ruza, maktab, pitch. Raqobatchi
 * tahlili (AUDIT-9) ko'rsatdiki, foydalanuvchi aniqroq tanlashni
 * kutadi: 1–4 sinf bilan 10–11 sinf, o'quv markazi bolalari bilan
 * kattalar bir xil deck olmasligi kerak. Endi 14 ta. Har biri
 * tipografika chegarasini (`bodyPt`, `minPt`) VA promptdagi band
 * sonini/uzunligini o'zgartiradi — ikkalasi ham o'lchanadigan.
 *
 * Eski id lar bazadagi `doc_json` da qoladi — `LEGACY_AUDIENCE_ALIASES`
 * ularni yangi ro'yxatga yo'naltiradi (`normalizeTemplateId` naqshi).
 */
export const SLIDE_AUDIENCES = [
  "auto",
  "school_1_4",
  "school_5_7",
  "school_8_9",
  "school_10_11",
  "students_bachelor",
  "students_master",
  "center_kids",
  "center_teens",
  "center_adults",
  "educators",
  "management",
  "public",
  "employees",
  "general",
] as const;
export type SlideAudience = (typeof SLIDE_AUDIENCES)[number];

export function isSlideAudience(v: string): v is SlideAudience {
  return (SLIDE_AUDIENCES as readonly string[]).includes(v);
}

export const LEGACY_AUDIENCE_ALIASES: Record<string, SlideAudience> = {
  defense: "students_master",
  lecture: "students_bachelor",
  school: "school_5_7",
  pitch: "management",
};

export function normalizeAudienceId(v: string | undefined): SlideAudience {
  if (!v) return "auto";
  if (isSlideAudience(v)) return v;
  return LEGACY_AUDIENCE_ALIASES[v] ?? "auto";
}

export type AudienceRule = {
  /** Tana shrifti boshlang'ich va POL (pt). Pol Slide Law: ≥15, maktabda ≥20. */
  bodyPt: number;
  minPt: number;
  minBullets: number;
  maxBullets: number;
  /** Bitta banddagi eng ko'p belgi — maketdan o'lchangan. */
  bulletChars: number;
  /** Promptga tushadigan bitta qatorlik ko'rsatma. */
  note: string;
  /** Formadagi yorliq. */
  label: string;
};

/**
 * Chegaralar `bulletChars` × band soni jihatidan maketdan o'lchangan
 * (`fitLines`): 4 × 165 → 18 pt (min 15); 3 × 120 → 24 pt (min 20).
 * Katta shrift = kam va qisqa band. Raqamlar shu munosabatni saqlaydi.
 */
export const AUDIENCE_RULES: Record<Exclude<SlideAudience, "auto">, AudienceRule> = {
  school_1_4: { bodyPt: 28, minPt: 24, minBullets: 2, maxBullets: 3, bulletChars: 80, label: "Boshlang‘ich sinf (1–4)", note: "AUDITORIYA — boshlang‘ich sinf: bitta gap = bitta fikr, faqat tanish so‘zlar; har slaydda ko‘rsatib bo‘ladigan narsa." },
  school_5_7: { bodyPt: 26, minPt: 22, minBullets: 2, maxBullets: 3, bulletChars: 100, label: "5–7 sinf", note: "AUDITORIYA — 5–7-sinf: sodda gap, kundalik misol, yangi atama darhol izohlansin." },
  school_8_9: { bodyPt: 24, minPt: 20, minBullets: 2, maxBullets: 3, bulletChars: 120, label: "8–9 sinf", note: "AUDITORIYA — 8–9-sinf: ta’rif + misol + sabab. Bir slaydda sinf 2 daqiqada bajaradigan mashq bo‘lsin." },
  school_10_11: { bodyPt: 22, minPt: 18, minBullets: 3, maxBullets: 4, bulletChars: 140, label: "10–11 sinf", note: "AUDITORIYA — 10–11-sinf: imtihonda so‘raladigan formulirovka, aniq misol." },
  students_bachelor: { bodyPt: 18, minPt: 15, minBullets: 3, maxBullets: 4, bulletChars: 165, label: "Talabalar (bakalavriat)", note: "AUDITORIYA — talabalar. Har tushuncha ta’rif + misol bilan. Yangi atama kiritilsa darhol izohlansin." },
  students_master: { bodyPt: 18, minPt: 15, minBullets: 3, maxBullets: 4, bulletChars: 180, label: "Magistrantlar va tadqiqotchilar", note: "AUDITORIYA — magistrant/tadqiqotchi va komissiya. Har da’vo ortida asos ko‘rinsin, cheklov va manba aytilsin. Shior yo‘q." },
  center_kids: { bodyPt: 26, minPt: 22, minBullets: 2, maxBullets: 3, bulletChars: 90, label: "O‘quv markazi: bolalar", note: "AUDITORIYA — o‘quv markazi bolalari: o‘yin, savol, ko‘rsatma. Har slaydda qiziqarli faktcha." },
  center_teens: { bodyPt: 22, minPt: 18, minBullets: 3, maxBullets: 4, bulletChars: 130, label: "O‘quv markazi: o‘smirlar", note: "AUDITORIYA — o‘smirlar: amaliy natija, real misol, nega kerakligi." },
  center_adults: { bodyPt: 20, minPt: 16, minBullets: 3, maxBullets: 4, bulletChars: 150, label: "O‘quv markazi: kattalar", note: "AUDITORIYA — kattalar kursi: ishda darhol qo‘llash mumkin bo‘lgan qadam va misol." },
  educators: { bodyPt: 18, minPt: 15, minBullets: 3, maxBullets: 4, bulletChars: 170, label: "Pedagoglar va hamkasblar", note: "AUDITORIYA — pedagoglar: metodika, baholash mezoni, sinfda qanday qo‘llanadi." },
  management: { bodyPt: 20, minPt: 16, minBullets: 2, maxBullets: 3, bulletChars: 130, label: "Rahbariyat va komissiya", note: "AUDITORIYA — rahbariyat: bitta slayd — bitta qaror. Raqam, tavsiya, keyingi qadam. Uydirma raqam YO‘Q." },
  public: { bodyPt: 22, minPt: 18, minBullets: 2, maxBullets: 3, bulletChars: 120, label: "Keng auditoriya", note: "AUDITORIYA — keng auditoriya (konferensiya, ota-onalar): atamasiz, hikoya va misol bilan." },
  employees: { bodyPt: 20, minPt: 16, minBullets: 3, maxBullets: 4, bulletChars: 145, label: "Kompaniya xodimlari", note: "AUDITORIYA — xodimlar: tartib, mas’ul, muddat. Nima o‘zgaradi va kimdan nima kutiladi." },
  general: { bodyPt: 20, minPt: 16, minBullets: 3, maxBullets: 4, bulletChars: 150, label: "Umumiy", note: "AUDITORIYA — aralash: sodda til, lekin fikr to‘liq." },
};

/**
 * «auto»: shablon o'zi auditoriyani bildiradi (eski mantiq saqlangan,
 * faqat yangi id larga o'girilgan).
 */
export function audienceRules(a: SlideAudience | string | undefined, tplId: SlideTemplateId): AudienceRule {
  const id = normalizeAudienceId(a);
  if (id !== "auto") return AUDIENCE_RULES[id];
  if (tplId === "defense") return AUDIENCE_RULES.students_master;
  // Eski `school` aliasi bilan BIR XIL — `auto`+dars shabloni ilgari ham shu auditoriyani berardi.
  if (tplId === "lesson") return AUDIENCE_RULES.school_5_7;
  if (tplId === "pitch") return AUDIENCE_RULES.management;
  return AUDIENCE_RULES.students_bachelor;
}

/** `planSlide` va `normalizeSlide` o'qiydigan tana qoidasi — auditoriya × matn hajmi. */
export type BodyRules = AudienceRule & { agendaMax: number };

/**
 * Matn hajmi ko'paytuvchisi — band SONI va UZUNLIGINI o'zgartiradi,
 * shrift polini EMAS. Dizayn agenti shriftni ham `/√k` bilan
 * kichraytirmoqchi edi — bu ma'ruza polini 15 dan 13 pt ga tushirar va
 * Slide Law ni buzardi. `fitLines` shriftni auditoriya oralig'ida
 * o'zi siqadi; ko'proq matn → shrift polga yaqinroq, lekin pol saqlanadi.
 */
const VOLUME: Record<SlideTextVolume, number> = { qisqa: 0.72, standart: 1, kop: 1.35 };

export function bodyRules(meta: Pick<DocMeta, "slideAudience" | "textVolume" | "planItems">, tplId: SlideTemplateId): BodyRules {
  const base = audienceRules(meta.slideAudience, tplId);
  const k = VOLUME[meta.textVolume ?? "standart"] ?? 1;
  return {
    ...base,
    minBullets: Math.max(2, Math.round(base.minBullets * k)),
    maxBullets: Math.max(2, Math.min(6, Math.round(base.maxBullets * k))),
    bulletChars: Math.round(base.bulletChars * k),
    agendaMax: meta.planItems || PLAN_ITEMS_DEFAULT,
  };
}
