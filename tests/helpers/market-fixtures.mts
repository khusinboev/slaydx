import type { AcademicDoc, DocMeta } from "../../lib/generation/types.ts";

/**
 * Synthetic market fixtures shared by the market tests (`tests/market-*.test.mts`; WP-B reuses them for the purchase and
 * clone tests). No real person: every name below is made up; phones stay on the project's test list.
 */

const WORDS = "energiya tizim tahlil natija usul jarayon samaradorlik model qurilma tajriba hisob parametr ko'rsatkich baholash bosqich resurs texnologiya vosita sifat rivojlanish muammo yechim tadqiqot ilmiy amaliy nazariya tushuncha tamoyil yondashuv mexanizm".split(" ");

/** Pseudo-random text from a seed: two seeds share vocabulary, not shingles. */
export function bodyText(seed: number, words = 1200): string {
  let x = (seed * 2654435761 + 12345) >>> 0;
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out.push(WORDS[x % WORDS.length]!);
  }
  return out.join(" ");
}

const META: Partial<DocMeta> = {
  workLabel: "Referat",
  language: "uz",
  extra: "",
  sourceText: "",
  author: "Sintetik Muallif",
  university: "Sintetik Universitet",
  faculty: "",
  department: "",
  subject: "Energetika",
  teacher: "",
  city: "Toshkent",
  group: "",
  course: "",
  ministry: "oliy",
  kind: "standard",
  pagesLabel: "2",
  targetPages: 2,
  fileNameHint: "ish",
  email: "",
  organization: "",
  degree: "",
  position: "",
  logoAssetId: "",
  templateAssetId: "",
  photoAssetId: "",
};

/** A student work with a model, a high report score and a body of its own. */
export function marketWorkDoc(toolId: string, topic: string, seed: number, over: { score?: number; words?: number } = {}): AcademicDoc {
  const words = over.words ?? 1200;
  const third = Math.floor(words / 3);
  return {
    meta: { ...META, toolId, topic } as DocMeta,
    titlePage: true,
    toc: true,
    sections: [
      { id: "intro", title: "Kirish", blocks: [{ kind: "p", text: bodyText(seed, third) }] },
      { id: "ch1", title: "Asosiy qism", blocks: [{ kind: "p", text: bodyText(seed + 1000, third) }] },
      { id: "conclusion", title: "Xulosa", blocks: [{ kind: "p", text: bodyText(seed + 2000, third) }] },
    ],
    work: {
      v: 1,
      genre: "referat",
      kind: "informative",
      subject: "technical",
      language: "uz",
      university: "Sintetik Universitet",
      faculty: "",
      department: "",
      subjectName: "Energetika",
      group: "",
      course: "",
      author: "Sintetik Muallif",
      teacher: "",
      city: "Toshkent",
      ministry: "oliy",
      chapters: [],
      intro: { parts: {} as never },
      references: [],
      figures: [],
      refsMin: 0,
      review: { score: over.score ?? 90, checks: [], judgeNotes: [], verifiedShare: 1, recentShare: 1, builtAt: "2026-11-01" },
    },
  } as AcademicDoc;
}
