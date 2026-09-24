/**
 * INSHO KIRISHI (AUDIT-19 WP-D) — formadan dvigatelgacha.
 *
 * `article/input.ts` naqshi: ikki tomonga ishlaydi —
 *   • `essayInputFromValues` — server (dvigatel, differensial zond);
 *   • `encodeEssayValues`    — klient (`EssayComposer`, WP-E) forma
 *                              qiymatlarini yig'adi.
 * Ikkalasi bitta faylda: maydon nomlari va shakli AYNAN mos bo'lishi
 * kerak, ajratilsa jim ajralib ketardi.
 *
 * Narx bu yerda O'ZGARMAYDI: `pages` chipi (`tools.ts` essay, 1–5 varaq,
 * 2 000–4 000 tanga) o'z joyida qoladi. Akademik esse va IELTS hajmi
 * so'z bilan o'lchanadi, lekin narx baribir `pages` dan — mahsulot egasi
 * qarori («narxlar o'zgarmaydi»).
 *
 * Server importi YO'Q (izomorf).
 */
import type { FormValues } from "../../types";
import {
  ESSAY_CONTEXTS,
  essayLanguage,
  essayKindSpec,
  type EssayLang,
  type EssayPerson,
} from "./registry";
import {
  ESSAY_KIND_IDS,
  ESSAY_LIMITS,
  isEssayContextId,
  isEssayKindId,
  type EssayContextId,
  type EssayEpigraph,
  type EssayKindId,
} from "./types";

export type EssayInput = {
  topic: string;
  context: EssayContextId;
  kind: EssayKindId;
  language: EssayLang;
  /** Varaq (1–5) — narx chipi; maktab kontekstida hajm ham shundan. */
  pages: number;
  /** Akademik esse: so'z maqsadi (0 — `pages` dan hisoblanadi). IELTS da e'tiborsiz. */
  wordTarget: number;
  /** Adabiy insho: asar nomi (iqtibos faqat shundan). */
  workTitle: string;
  /** Adabiy insho: epigraf (matn + muallif). */
  epigraph: EssayEpigraph | null;
  /** «O'z fikrlarim / dalillarim» — VERBATIM saqlanadi. */
  userFacts: string;
  /** Hujjat ramkasi (`ESSAY_DESIGNS`). */
  design: string;
  person: EssayPerson;
  extra: string;
  /** Yuklangan fayl matni (`meta.sourceText`) — kontekst. */
  sourceText: string;
};

/* ────────────────────────── yordamchilar ────────────────────────── */

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "";

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Varaq chipi → 1–5. Bo'sh/xato qiymat standart 2 ga tushadi, BERILGAN
 * lekin chegaradan tashqari qiymat esa CHEGARAGA qisiladi («0» → 1):
 * `|| 2` bilan nol ham «berilmagan» bo'lib qolardi.
 */
export function pagesOf(v: unknown): number {
  const raw = typeof v === "number" ? String(v) : String(v ?? "").trim();
  if (!raw) return 2;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2;
  return Math.max(ESSAY_LIMITS.pagesMin, Math.min(ESSAY_LIMITS.pagesMax, Math.round(n)));
}

/**
 * Epigraf bitta maydonda keladi: «matn — Muallif». Ajratuvchi sifatida
 * uzun tire, ikki defis yoki `|` qabul qilinadi; alohida `epigraphAuthor`
 * maydoni berilsa u ustun turadi (forma keyin ikkiga bo'lishi mumkin).
 */
export function parseEpigraph(raw: unknown, author?: unknown): EssayEpigraph | null {
  const full = text(raw, ESSAY_LIMITS.epigraphChars + ESSAY_LIMITS.epigraphAuthorChars);
  if (!full) return null;
  const explicit = str(author, ESSAY_LIMITS.epigraphAuthorChars);
  if (explicit) return { text: full.slice(0, ESSAY_LIMITS.epigraphChars), author: explicit };
  const m = /^([\s\S]+?)\s*(?:—|–|--|\||\n)\s*([^\n—–|]{2,120})\s*$/.exec(full);
  if (m) return { text: m[1].replace(/\s+/g, " ").trim().slice(0, ESSAY_LIMITS.epigraphChars), author: m[2].replace(/\s+/g, " ").trim() };
  return { text: full.replace(/\s+/g, " ").trim().slice(0, ESSAY_LIMITS.epigraphChars), author: "" };
}

/** Kontekst — noma'lum/bo'sh qiymat maktab inshosiga tushadi (eski hujjatlar). */
export function essayContextOf(values: FormValues): EssayContextId {
  const v = str(values.essayContext, 40);
  return isEssayContextId(v) ? v : "school_dtm";
}

/** Tur — kontekstga MOS bo'lishi shart; nomuvofiq bo'lsa birinchi tur. */
export function essayKindOf(context: EssayContextId, raw: unknown): EssayKindId {
  const v = str(raw, 40);
  return isEssayKindId(context, v) ? v : ESSAY_KIND_IDS[context][0];
}

/* ────────────────────────── kirish ────────────────────────── */

export function essayInputFromValues(values: FormValues): EssayInput {
  const context = essayContextOf(values);
  const spec = ESSAY_CONTEXTS[context];
  const kind = essayKindOf(context, values.essayKind ?? values.kind);
  const kindSpec = essayKindSpec(context, kind);
  const person = str(values.person, 10);
  const pages = pagesOf(values.pages);
  return {
    topic: str(values.topic, ESSAY_LIMITS.topicChars),
    context,
    kind,
    // IELTS — faqat ingliz tili (qaror 3); maktab inshosi — o'zbek.
    language: essayLanguage(context, str(values.language, 8)),
    pages,
    wordTarget: spec.sizing === "words" ? Math.max(0, Math.round(num(values.wordTarget))) : 0,
    workTitle: kindSpec.needsWork ? str(values.workTitle, ESSAY_LIMITS.workTitleChars) : "",
    epigraph: (kindSpec.epigraph ?? spec.epigraph) === "optional" ? parseEpigraph(values.epigraph, values.epigraphAuthor) : null,
    userFacts: text(values.userFacts, ESSAY_LIMITS.userFactsChars),
    design: str(values.design, 40) || "iris",
    person: person === "first" || person === "third" ? person : spec.person,
    extra: text(values.extra, ESSAY_LIMITS.extraChars),
    sourceText: typeof values.sourceText === "string" ? values.sourceText : "",
  };
}

/* ────────────────────────── chiqish (forma) ────────────────────────── */

/**
 * Forma qiymatlari — `essayInputFromValues` ning teskarisi. Faqat
 * BERILGAN maydonlar yoziladi (qoralama ustiga yozib yubormasin).
 */
export function encodeEssayValues(input: Partial<EssayInput>): FormValues {
  const out: FormValues = {};
  if (input.topic !== undefined) out.topic = input.topic;
  if (input.context !== undefined) out.essayContext = input.context;
  if (input.kind !== undefined) out.essayKind = input.kind;
  if (input.language !== undefined) out.language = input.language;
  if (input.pages !== undefined) out.pages = String(input.pages);
  if (input.wordTarget !== undefined) out.wordTarget = input.wordTarget ? String(input.wordTarget) : "";
  if (input.workTitle !== undefined) out.workTitle = input.workTitle;
  if (input.epigraph !== undefined) {
    out.epigraph = input.epigraph ? input.epigraph.text : "";
    out.epigraphAuthor = input.epigraph?.author ?? "";
  }
  if (input.userFacts !== undefined) out.userFacts = input.userFacts;
  if (input.design !== undefined) out.design = input.design;
  if (input.person !== undefined) out.person = input.person;
  if (input.extra !== undefined) out.extra = input.extra;
  return out;
}
