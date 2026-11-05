import { normalizeText } from "./normalize";
import type { MarketSubjectId } from "./types";

/**
 * The 14 fixed subjects of the catalog (docs/market/PLAN.md §1.2) and their keyword classifier. Keywords are matched
 * on `normalizeText` output, so one Latin entry covers Uzbek Latin and Cyrillic; Russian stems are listed as they come
 * out of the Cyrillic → Latin step. The first subject with the most hits wins; ties go to the list order. The classifier
 * only proposes: the admin edits the subject at approval.
 */

export const MARKET_SUBJECTS: readonly { id: MarketSubjectId; label: string }[] = [
  { id: "matematika", label: "Matematika" },
  { id: "fizika", label: "Fizika" },
  { id: "kimyo", label: "Kimyo" },
  { id: "biologiya", label: "Biologiya" },
  { id: "informatika", label: "Informatika" },
  { id: "tarix", label: "Tarix" },
  { id: "ona-tili-adabiyot", label: "Ona tili va adabiyot" },
  { id: "ingliz-tili", label: "Ingliz tili" },
  { id: "iqtisodiyot", label: "Iqtisodiyot" },
  { id: "huquq", label: "Huquq" },
  { id: "pedagogika-psixologiya", label: "Pedagogika va psixologiya" },
  { id: "tibbiyot", label: "Tibbiyot" },
  { id: "texnika", label: "Texnika" },
  { id: "boshqa", label: "Boshqa" },
];

export const isMarketSubject = (v: unknown): v is MarketSubjectId => MARKET_SUBJECTS.some((s) => s.id === v);

export const subjectLabel = (id: MarketSubjectId): string => MARKET_SUBJECTS.find((s) => s.id === id)?.label ?? "Boshqa";

/** Stems matched at a word start. */
const KEYWORDS: Readonly<Record<Exclude<MarketSubjectId, "boshqa">, readonly string[]>> = {
  matematika: ["matemat", "algebra", "geometr", "trigonometr", "tenglama", "integral", "hosila", "funksiya", "statistik", "ehtimol", "uravneni", "mathemat"],
  fizika: ["fizik", "mexanika", "termodinamik", "elektromagnit", "optika", "kvant", "yadro fizik", "physics"],
  kimyo: ["kimyo", "ximi", "organik", "noorganik", "kislota", "molekula", "chemistry", "reaksiya"],
  biologiya: ["biolog", "botanik", "zoolog", "genetik", "ekolog", "hujayra", "anatomiya", "biology", "evolyutsiya"],
  informatika: ["informatik", "dasturlash", "algoritm", "kompyuter", "python", "java", "malumotlar bazasi", "sun iy intellekt", "suniy intellekt", "web", "tarmoq", "kiberxavfsizlik", "axborot texnolog", "programm", "software", "computer"],
  tarix: ["tarix", "istori", "temuriy", "qadimgi", "sivilizatsiya", "amir temur", "ipak yoli", "history", "arxeolog"],
  "ona-tili-adabiyot": ["ona tili", "adabiyot", "tilshunos", "morfolog", "sintaksis", "fonetik", "sheriyat", "navoiy", "alisher", "gazal", "doston", "literatur"],
  "ingliz-tili": ["ingliz", "english", "ielts", "grammar", "angliy"],
  iqtisodiyot: ["iqtisod", "ekonom", "moliya", "marketing", "menejment", "biznes", "buxgalter", "bank", "soliq", "investits", "tadbirkor", "finans", "business", "econom"],
  huquq: ["huquq", "qonun", "konstitutsiya", "jinoyat", "fuqarolik", "pravo", "yurid", "advokat", "sudlov", "law"],
  "pedagogika-psixologiya": ["pedagog", "psixolog", "tarbiya", "talim metod", "oqitish", "metodika", "didaktik", "psycholog", "boshlangich talim"],
  tibbiyot: ["tibbiyot", "kasallik", "davolash", "farmakolog", "shifokor", "medits", "hamshira", "gigiyena", "stomatolog", "medicine", "salomatlik"],
  texnika: ["texnika", "mashinasozlik", "qurilish", "energetik", "elektrotexnik", "avtomatlashtirish", "muhandis", "transport", "arxitektura", "metallurg", "ishlab chiqarish", "engineering"],
};

/** Profile of a student work (`work.subject`) → subject, used when the keywords find nothing. */
const PROFILE_FALLBACK: Readonly<Record<string, MarketSubjectId>> = {
  technical: "texnika",
  natural: "biologiya",
  economic: "iqtisodiyot",
  legal: "huquq",
  humanities: "boshqa",
};

/** Classifies a work: keywords over topic + subject name, then the work's subject profile, else `boshqa`. */
export function classifySubject(input: { topic: string; subjectName?: string; profile?: string }): MarketSubjectId {
  const text = ` ${normalizeText(`${input.topic} ${input.subjectName ?? ""}`)}`;
  let best: MarketSubjectId = "boshqa";
  let bestHits = 0;
  for (const { id } of MARKET_SUBJECTS) {
    if (id === "boshqa") continue;
    const hits = KEYWORDS[id].filter((k) => text.includes(` ${k}`)).length;
    if (hits > bestHits) {
      best = id;
      bestHits = hits;
    }
  }
  if (bestHits) return best;
  return PROFILE_FALLBACK[input.profile ?? ""] ?? "boshqa";
}
