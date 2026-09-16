/**
 * TALABA ISHI QO'RIQCHISI (AUDIT-19 WP-A) — model javobini qabul
 * qilishdan oldin.
 *
 * Umumiy qism (iqtibos tozalash, manbasiz foizlar, foydalanuvchi
 * raqamlari, «suv» iboralar, so'z hisobi) NEYTRAL qatlamda —
 * `report/guard.ts guardSection`; bu yerda faqat RE-EXPORT va TALABA
 * ISHIGA XOS ikki tekshiruv:
 *
 *   intakeCheck     — kirishda MAJBURIY elementlar (kurs ishida 7 ta)
 *                     bormi: model bergan `parts` JSON va MATN ustidan
 *                     kalit so'z regexlari (uz/ru/en). Ikkalasi ham
 *                     kerak: model `parts` ni bersa ham matn boshqacha
 *                     chiqishi mumkin, tahrirdan keyin esa `parts`
 *                     umuman yo'q — hisobot MATNGA qarab qayta hisoblaydi.
 *   chapterBalance  — har bobda ≥2 paragraf va boblar hajmi ±30 % ichida
 *                     (uslubiy ko'rsatma: «boblar taxminan teng»).
 */
import type { Block, DocSection } from "../types";
import { wordsOf } from "../report/guard";
import { WORK_INTRO_PART_IDS, isChapterHeadId, parseWorkSectionId, type WorkIntroPartId } from "./types";

export { factNumbers, guardSection, missingFactNumbers, numbersOf, wordsOf } from "../report/guard";
export type { GuardOpts, SectionGuardReport } from "../report/guard";

/* ────────────────────────── kirish elementlari ────────────────────────── */

/*
 * Har element uchun uz/ru/en kalit so'zlari. Qolip ATAYLAB keng emas:
 * «maqsad» so'zining o'zi matnning istalgan joyida uchraydi, shuning
 * uchun element BAYONI ko'rinishida qidiriladi («ishning maqsadi»,
 * «maqsadi —»). `\b` JS da faqat ASCII uchun ishlaydi — kirill/lotin
 * so'z chegarasi uchun lookbehind ishlatiladi.
 */
const B = "(?<![\\p{L}])";

const INTRO_PART_RE: Record<WorkIntroPartId, RegExp> = {
  relevance: new RegExp(`${B}(dolzarb\\w*|aktual\\w*|актуальн\\w*|relevance|topicality)`, "iu"),
  aim: new RegExp(`${B}(maqsad\\w*|цель\\b|цели\\b|целью|aim of the (work|study|paper)|the aim is|purpose of the (work|study|paper))`, "iu"),
  tasks: new RegExp(`${B}(vazifa\\w*|задач\\w*|tasks of the|following tasks|objectives of the)`, "iu"),
  object: new RegExp(`${B}(ob[‘’'\`]?yekt\\w*|obyekti|объект\\w*|object of (the )?(study|research))`, "iu"),
  subject: new RegExp(`${B}(predmet\\w*|предмет\\w*|subject of (the )?(study|research))`, "iu"),
  methods: new RegExp(`${B}(metod\\w*|usullar\\w*|метод\\w*|research methods|methods of (the )?(study|research))`, "iu"),
  structure: new RegExp(`${B}(tuzilma\\w*|tarkib\\w*|tuzilishi|структур\\w*|состои[тл]|structure of the (work|paper)|consists of)`, "iu"),
  novelty: new RegExp(`${B}(yangilik\\w*|новизн\\w*|novelty)`, "iu"),
  significance: new RegExp(`${B}(amaliy ahamiyat\\w*|ahamiyat\\w*|значимост\\w*|practical (significance|value))`, "iu"),
};

export type IntakeReport = {
  /** Element → matnda (yoki `parts` da) topildimi. */
  parts: Record<WorkIntroPartId, boolean>;
  /** Talab qilingan, lekin topilmagan elementlar. */
  missing: WorkIntroPartId[];
  found: WorkIntroPartId[];
};

/**
 * Kirish elementlari tekshiruvi.
 *
 * @param required  Turning majburiy elementlari (`registry.ts introParts`).
 * @param blocks    Kirish bo'limining bloklari (matn tekshiruvi).
 * @param parts     Model bergan JSON (`{aim: "…"}`) — bo'lsa, matn bilan
 *                  BIRGA hisobga olinadi: element o'z matnida bo'lsa ham
 *                  yetarli.
 */
export function intakeCheck(required: readonly WorkIntroPartId[], blocks: Block[], parts?: Partial<Record<WorkIntroPartId, string>> | null): IntakeReport {
  const text = blocks
    .filter((b) => b.kind !== "figure" && b.kind !== "tableRef" && b.kind !== "formula")
    .map((b) => b.text)
    .join("\n");
  const all = Object.fromEntries(WORK_INTRO_PART_IDS.map((p) => [p, false])) as Record<WorkIntroPartId, boolean>;
  for (const p of WORK_INTRO_PART_IDS) {
    const own = String(parts?.[p] ?? "").trim();
    all[p] = (own.length >= 20 && INTRO_PART_RE[p].test(own)) || INTRO_PART_RE[p].test(text);
  }
  const missing = required.filter((p) => !all[p]);
  return { parts: all, missing, found: required.filter((p) => all[p]) };
}

/* ────────────────────────── bob balansi ────────────────────────── */

export type ChapterStat = { id: string; title: string; words: number; paragraphs: number };

export type ChapterBalance = {
  chapters: ChapterStat[];
  /** Eng katta bob eng kichigidan necha marta katta (1 — teng). */
  spread: number;
  /** ±30 % ichidami (`BALANCE_TOLERANCE`). */
  balanced: boolean;
  /** Minimal paragraf sonidan kam bo'lgan boblar. */
  thin: string[];
};

/** Boblar hajmi o'rtachadan shu ulushdan ko'p farq qilmasligi kerak. */
export const BALANCE_TOLERANCE = 0.3;

/**
 * Boblar balansi: har bobda `minParagraphs` ta paragraf bormi va
 * boblarning so'z hajmi o'rtachadan ±30 % ichidami.
 *
 * Bob sarlavhasi bo'limi (`ch1`) matn TUTMAYDI — so'zlar uning
 * paragraflaridan (`ch1.1`, `ch1.2`) yig'iladi.
 */
export function chapterBalance(sections: DocSection[], minParagraphs = 2): ChapterBalance {
  const byChapter = new Map<number, ChapterStat>();
  for (const s of sections) {
    const parsed = parseWorkSectionId(s.id);
    if (!parsed) continue;
    const cur = byChapter.get(parsed.chapter) ?? { id: `ch${parsed.chapter}`, title: "", words: 0, paragraphs: 0 };
    if (isChapterHeadId(s.id)) cur.title = s.title;
    else {
      cur.words += wordsOf(s.blocks);
      if (s.blocks.length) cur.paragraphs++;
    }
    byChapter.set(parsed.chapter, cur);
  }
  const chapters = [...byChapter.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const words = chapters.map((c) => c.words);
  const avg = words.length ? words.reduce((a, b) => a + b, 0) / words.length : 0;
  const max = words.length ? Math.max(...words) : 0;
  const min = words.length ? Math.min(...words) : 0;
  const spread = min > 0 ? max / min : max > 0 ? Infinity : 1;
  const balanced = !avg || words.every((w) => Math.abs(w - avg) <= avg * BALANCE_TOLERANCE);
  const thin = chapters.filter((c) => c.paragraphs < minParagraphs).map((c) => c.id);
  return { chapters, spread, balanced, thin };
}
