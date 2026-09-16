/**
 * FAN PROFILLARI (AUDIT-19 WP-A) — 5 ta: texnik, tabiiy, iqtisodiy,
 * gumanitar, huquqiy.
 *
 * Profil HAJMNI yoki bob sonini o'zgartirmaydi (u — janr×tur ishi,
 * `registry.ts`); u YOZISH uslubini (`guidance` → tizim promptining
 * «SUBJECT RULES» bo'limi), MANBA tarkibini (`research.kinds`/`quota` —
 * huquqiy ishda normativ hujjat, iqtisodiyda statistika), VIZUAL
 * standartini va o'ng chegarani (gumanitar 1,0 sm — uslubiy
 * ko'rsatmalarda shunday) belgilaydi.
 *
 * `rightMarginCm` va `defaultVisuals` ni WP-C (`docx-profile.ts
 * workProfile`) o'qiydi — bu fayl RENDERNI bilmaydi, faqat raqamni beradi.
 */
import { SUBJECT_PROFILE_IDS, type SubjectProfileId, type WorkRefKind } from "./types";

export type SubjectResearch = {
  /** Qaysi manba turlari qidiriladi (tartib — ustuvorlik). */
  kinds: WorkRefKind[];
  /** Tur bo'yicha maqsadli son; yig'indisi `refsMin` dan katta bo'lishi mumkin. */
  quota?: Partial<Record<WorkRefKind, number>>;
};

export type SubjectProfile = {
  id: SubjectProfileId;
  label: { uz: string; ru: string; en: string };
  /** Formadagi bir qatorli izoh (uz). */
  hint: string;
  /** Tizim promptining «SUBJECT RULES» qatorlari (en, 2–4 ta). */
  guidance: string[];
  research: SubjectResearch;
  /** O'ng chegara (sm) — gumanitar 1,0; qolganlari 1,5 (WP-C o'qiydi). */
  rightMarginCm: number;
  /** Standart vizual rejasi (foydalanuvchi o'zgartirishi mumkin). */
  defaultVisuals: { figures: number; tables: number };
};

export const SUBJECT_PROFILES: Record<SubjectProfileId, SubjectProfile> = {
  technical: {
    id: "technical",
    label: { uz: "Texnika va IT", ru: "Технические науки и IT", en: "Engineering & IT" },
    hint: "Hisob-kitob, blok-sxema, ЕСКД talablari — muhandislik va dasturlash fanlari",
    guidance: [
      "Engineering/IT subject: every technical claim is tied to a standard, a specification or a cited source; where the work includes a calculation, give the formula, the symbols («bu yerda …» / «where …») and the numeric result — but ONLY with values from USER FACTS or a SOURCE.",
      "Prefer a block diagram or algorithm scheme (ЕСКД/ГОСТ style: rectangles for actions, rhombi for decisions) over prose when describing a procedure; refer to it in the text before it appears.",
      "Terminology is the field's own (no popular-science paraphrase); units are SI and consistent throughout.",
    ],
    research: { kinds: ["book", "article", "web", "user"], quota: { book: 4, article: 6, web: 2 } },
    rightMarginCm: 1.5,
    defaultVisuals: { figures: 2, tables: 1 },
  },
  natural: {
    id: "natural",
    label: { uz: "Tabiiy fanlar", ru: "Естественные науки", en: "Natural sciences" },
    hint: "Adabiyot sharhi → tajriba/kuzatuv → natijalar muhokamasi (IMRAD-ga yaqin)",
    guidance: [
      "Natural-science subject: organise the body as literature review → experiment/observation procedure → discussion of results; the review states what is already established and what is still open.",
      "Report only measurements, samples and conditions that appear in USER FACTS or a SOURCE; if the author reported no experiment, describe the analytical/desk procedure honestly instead of inventing one.",
      "Results are separated from interpretation: first what was observed, then what it means compared with the cited studies.",
    ],
    research: { kinds: ["article", "book", "web", "user"], quota: { article: 8, book: 3, web: 2 } },
    rightMarginCm: 1.5,
    defaultVisuals: { figures: 2, tables: 1 },
  },
  economic: {
    id: "economic",
    label: { uz: "Iqtisodiyot", ru: "Экономика", en: "Economics" },
    hint: "Statistik jadval, Statistika qo‘mitasi ma’lumotlari, atamalar lug‘ati",
    guidance: [
      "Economics subject: the analysis is built on statistics — every indicator is given with its period, unit and source (State Statistics Committee, ministry or a cited study); never invent a figure, a growth rate or a share.",
      "Use at least one statistical table (years in columns, indicators in rows) with a «Manba:» line under it, and interpret it in the text — a table without interpretation is not analysis.",
      "Define the key economic terms on first use; where a legal act regulates the subject (tax, tariff, programme), name it exactly as in the cited law.",
    ],
    research: { kinds: ["law", "book", "article", "web", "user"], quota: { law: 2, book: 4, article: 5, web: 3 } },
    rightMarginCm: 1.5,
    defaultVisuals: { figures: 1, tables: 2 },
  },
  humanities: {
    id: "humanities",
    label: { uz: "Gumanitar fanlar", ru: "Гуманитарные науки", en: "Humanities" },
    hint: "Kengaytirilgan kirish (ilmiy yangilik, farazlar), matn tahlili, iqtibos",
    guidance: [
      "Humanities subject: the introduction is EXTENDED — besides the standard elements it states the scientific novelty and the working hypothesis of the paper.",
      "Argue through close reading of sources: quote precisely (with a page locator where the source has pages), then interpret; a paragraph that only retells a source is not an argument.",
      "Keep the scholarly register: no journalistic evaluation, no first-person narrative, no rhetorical questions.",
    ],
    research: { kinds: ["book", "article", "web", "user"], quota: { book: 7, article: 5, web: 2 } },
    rightMarginCm: 1.0,
    defaultVisuals: { figures: 1, tables: 1 },
  },
  legal: {
    id: "legal",
    label: { uz: "Huquq", ru: "Юриспруденция", en: "Law" },
    hint: "Normativ hujjatlar ro‘yxat boshida (lex.uz), modda/band havolalari",
    guidance: [
      "Law subject: normative acts come FIRST in the argument and in the reference list — cite the exact act (title, number, date) and the article/clause you rely on; never paraphrase a norm you cannot cite.",
      "Distinguish the norm (what the act says), the doctrine (what scholars say) and the practice (how it is applied); each needs its own source.",
      "Where the paper proposes a change, formulate it as a concrete amendment to a named article, not as a general wish.",
    ],
    research: { kinds: ["law", "book", "article", "web", "user"], quota: { law: 5, book: 4, article: 3, web: 2 } },
    rightMarginCm: 1.5,
    defaultVisuals: { figures: 1, tables: 1 },
  },
};

export const SUBJECT_PROFILE_LIST: SubjectProfile[] = Object.values(SUBJECT_PROFILES);

/** Noma'lum/bo'sh → `humanities` (eng keng tarqalgan kurs ishi profili). */
export function normalizeSubjectProfile(v: unknown, fallback: SubjectProfileId = "humanities"): SubjectProfileId {
  const t = String(v ?? "").trim();
  return (SUBJECT_PROFILE_IDS as readonly string[]).includes(t) ? (t as SubjectProfileId) : fallback;
}
