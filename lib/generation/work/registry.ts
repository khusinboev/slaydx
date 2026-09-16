/**
 * JANR × TUR REYESTRI (AUDIT-19 WP-A) — `article/types-registry.ts` naqshi.
 *
 * Har tur uchun: skelet (kirish elementlari, bob/paragraf shakli va soni),
 * hajm ulushlari (kirish 10–15 %, xulosa 2–4 bet), manba minimumi, hajm
 * paketlari (`lib/tools.ts` chiplari bilan AYNAN bir xil), vizual talabi,
 * YOZISH qoidalari (`guidance` — tizim promptining «TYPE RULES» i) va
 * BAHOLOVCHI spetsifikatsiyasi (`JudgeSpec` — mezon ta'riflari turga
 * moslangan: informativ referatda «chuqurlik» = manba mazmunini ANIQ
 * bayon qilish, tadqiqot chuqurligi emas).
 *
 * Bu ma'lumot to'rt joyda ishlatiladi: (1) promptlar (`prompts.ts`),
 * (2) dvigatel skeletga moslash (`engine.ts`), (3) hisobot qoidalari
 * (`review.ts`), (4) forma (WP-E `WorkComposer`).
 *
 * Asos — reja «Standartlar» bo'limi (BuxDU/TATU/TSUULL/TDIU uslubiy
 * ko'rsatmalari, VM 824 / OTV 311, ГОСТ 7.32-2017).
 */
import type { JudgeSpec } from "../report/types";
import type { WorkGenreId, WorkIntroPartId, WorkKindId } from "./types";

/* ────────────────────────── baholovchi mezonlari ────────────────────────── */

export const WORK_JUDGE_CRITERIA = ["logic", "depth", "style", "aimMatch", "originality"] as const;
export type WorkJudgeCriterion = (typeof WORK_JUDGE_CRITERIA)[number];

export const WORK_JUDGE_LABELS: Record<WorkJudgeCriterion, string> = {
  logic: "Bayon mantiqi va izchilligi",
  depth: "Mazmun chuqurligi",
  style: "Ilmiy uslub",
  aimMatch: "Maqsad ↔ vazifalar ↔ xulosa mosligi",
  originality: "Mustaqillik va ijodiylik",
};

const JUDGE_DESCRIBE: Record<WorkJudgeCriterion, string> = {
  logic: "the paper moves from general to specific without gaps: each chapter follows from the previous one, each paragraph develops one idea and links to the next.",
  depth: "claims are developed with evidence from the cited sources (mechanism, comparison, example), not merely asserted or retold.",
  style: "academic register throughout — third person, field terminology, no filler openers, no journalistic or motivational sentences.",
  aimMatch: "the aim and the tasks stated in the introduction are each answered in the conclusion; nothing is concluded that was not investigated.",
  originality: "the author's own analysis, systematisation or position is visible — the text is not a chain of paraphrased sources.",
};

/** Baholovchi roli — «kurs ishini baholayotgan o'qituvchi» (jurnal taqrizchisi emas). */
export const WORK_JUDGE_ROLE = "a university lecturer grading a student's course paper against the methodological requirements of an Uzbek university";

function judgeSpec(typeLabel: string, o: { describe?: Partial<Record<WorkJudgeCriterion, string>>; skip?: WorkJudgeCriterion[] } = {}): JudgeSpec<WorkJudgeCriterion> {
  return {
    criteria: WORK_JUDGE_CRITERIA,
    describe: { ...JUDGE_DESCRIBE, ...(o.describe ?? {}) },
    labels: WORK_JUDGE_LABELS,
    ...(o.skip?.length ? { skip: o.skip } : {}),
    roleLine: WORK_JUDGE_ROLE,
    typeLabel,
    typeNoun: "work type",
  };
}

/* ────────────────────────── tur ────────────────────────── */

/**
 * Asosiy qismning SHAKLI:
 *   `theory-2x2`                 — 2 bob × 2 paragraf (gumanitar/iqtisodiy kurs ishi);
 *   `review-experiment-results`  — adabiyot sharhi → tajriba/hisob → natijalar (tabiiy/texnik);
 *   `theory-analysis-practice`   — nazariy + tahliliy + amaliy (mustaqil ish, VM 824);
 *   `sections`                   — BOB EMAS, bo'limlar (referat): raqamlanadi, lekin «1-BOB» yozilmaydi.
 */
export type WorkShape = "theory-2x2" | "review-experiment-results" | "theory-analysis-practice" | "sections";

/** Vizual talabi: majburiy (hisobotda qizil) / tavsiya (sariq) / talab qilinmaydi. */
export type WorkVisualNeed = "required" | "optional" | "none";

export type WorkKind = {
  id: WorkKindId;
  genre: WorkGenreId;
  label: { uz: string; ru: string; en: string };
  /** Formadagi bir qatorli izoh (uz). */
  hint: string;
  /** Kirishning MAJBURIY elementlari — tartibda; hisobot `introParts` shu ro'yxat bo'yicha. */
  introParts: WorkIntroPartId[];
  chapters: { min: number; max: number };
  paragraphsPerChapter: { min: number; max: number };
  shape: WorkShape;
  /** Kirish hajmi — umumiy betning ulushi. */
  introShare: [number, number];
  /** Xulosa hajmi — bet. */
  conclusionPages: [number, number];
  /** Adabiyotlar minimumi (janr standarti). */
  refsMin: number;
  /** Hajm paketlari — `lib/tools.ts` chiplari bilan AYNAN bir xil. */
  pages: readonly string[];
  visuals: { tables: WorkVisualNeed; figures: WorkVisualNeed };
  /** Yozish qoidalari (en, 3–5 qator) — tizim promptining «TYPE RULES» i. */
  guidance: string[];
  judge: JudgeSpec<WorkJudgeCriterion>;
};

export type WorkGenre = {
  id: WorkGenreId;
  label: { uz: string; ru: string; en: string };
  hint: string;
  /** Vosita id (`lib/tools.ts`). */
  toolId: string;
  defaultKind: WorkKindId;
  kinds: Partial<Record<WorkKindId, WorkKind>>;
};

/* ────────────────────────── hajm paketlari ────────────────────────── */

export const COURSEWORK_PAGES = ["10-15", "15-20", "20-25", "25-30", "30-35", "35-40", "40-45"] as const;
export const REFERAT_PAGES = ["10-15", "15-20", "20-25", "25-30"] as const;
export const INDEPENDENT_PAGES = ["10-15", "15-20", "20-25", "25-30"] as const;

/** Kurs ishi kirishining 7 majburiy elementi (BuxDU/TATU uslubiy ko'rsatmasi). */
export const COURSEWORK_INTRO_PARTS: WorkIntroPartId[] = ["relevance", "aim", "tasks", "object", "subject", "methods", "structure"];
/** Referat kirishi — 3 element (dolzarblik, maqsad, vazifalar). */
export const REFERAT_INTRO_PARTS: WorkIntroPartId[] = ["relevance", "aim", "tasks"];
/** Mustaqil ish kirishi — 4 element (VM 824 / OTV 311). */
export const INDEPENDENT_INTRO_PARTS: WorkIntroPartId[] = ["relevance", "aim", "tasks", "structure"];

/* ────────────────────────── reyestr ────────────────────────── */

export const WORK_GENRES: Record<WorkGenreId, WorkGenre> = {
  coursework: {
    id: "coursework",
    label: { uz: "Kurs ishi", ru: "Курсовая работа", en: "Course paper" },
    hint: "Titul → mundarija → kirish → boblar → xulosa → adabiyotlar → ilovalar",
    toolId: "coursework",
    defaultKind: "theory",
    kinds: {
      theory: {
        id: "theory",
        genre: "coursework",
        label: { uz: "Nazariy kurs ishi", ru: "Теоретическая курсовая", en: "Theoretical course paper" },
        hint: "Manbalarni tahlil qilib nazariy asoslarni tizimlashtirish — 2 bob × 2 paragraf",
        introParts: COURSEWORK_INTRO_PARTS,
        chapters: { min: 2, max: 3 },
        paragraphsPerChapter: { min: 2, max: 3 },
        shape: "theory-2x2",
        introShare: [0.1, 0.15],
        conclusionPages: [2, 4],
        refsMin: 15,
        pages: COURSEWORK_PAGES,
        visuals: { tables: "required", figures: "required" },
        guidance: [
          "Theoretical course paper: chapter 1 builds the conceptual framework (definitions, approaches, classifications with cited authors), chapter 2 analyses how that framework applies to the specific topic — never repeat chapter 1 in chapter 2.",
          "Each chapter has at least two numbered paragraphs (1.1., 1.2.); the chapter title is a NOUN PHRASE naming its content, not «Nazariy qism».",
          "Every position attributed to a scholar carries a citation; where sources disagree, say so explicitly and state which position the author follows and why.",
          "End every chapter with a short paragraph summarising its findings — the conclusion of the paper then answers the tasks listed in the introduction, task by task.",
          "At least one classification/comparison table and one scheme; refer to each in the text BEFORE it appears.",
        ],
        judge: judgeSpec("Theoretical course paper"),
      },
      applied: {
        id: "applied",
        genre: "coursework",
        label: { uz: "Amaliy (hisob-tajriba) kurs ishi", ru: "Практическая (расчётная) курсовая", en: "Applied course paper" },
        hint: "Nazariy asos → hisob/tajriba → natijalar tahlili; hisob-kitob va jadval majburiy",
        introParts: COURSEWORK_INTRO_PARTS,
        chapters: { min: 2, max: 4 },
        paragraphsPerChapter: { min: 2, max: 4 },
        shape: "review-experiment-results",
        introShare: [0.1, 0.15],
        conclusionPages: [2, 4],
        refsMin: 15,
        pages: COURSEWORK_PAGES,
        visuals: { tables: "required", figures: "required" },
        guidance: [
          "Applied course paper: chapter 1 is the literature/normative basis, chapter 2 describes the procedure (calculation, experiment or case analysis) step by step, chapter 3 (or the last one) reports and discusses the results.",
          "The procedure must be reproducible: input data, formula or method, sequence of steps, expected output — but use ONLY numbers from USER FACTS or a cited SOURCE; if the author gave none, state the method qualitatively and say the data was not reported.",
          "Results are shown in a table or scheme and then INTERPRETED in the text (what the number means, how it compares with the sources) — a table alone is not a result.",
          "The conclusion reports what was calculated/measured and what follows for practice; it never introduces a result that is absent from the body.",
        ],
        judge: judgeSpec("Applied (calculation/experiment) course paper", {
          describe: {
            depth: "the calculation or experimental procedure is described so it could be repeated, and its results are interpreted against the cited sources.",
          },
        }),
      },
      project: {
        id: "project",
        genre: "coursework",
        label: { uz: "Kurs loyihasi", ru: "Курсовой проект", en: "Course project" },
        hint: "Loyiha topshirig‘i → yechim varianti → hisob va chizma → baholash",
        introParts: COURSEWORK_INTRO_PARTS,
        chapters: { min: 3, max: 4 },
        paragraphsPerChapter: { min: 2, max: 4 },
        shape: "review-experiment-results",
        introShare: [0.1, 0.15],
        conclusionPages: [2, 4],
        refsMin: 15,
        pages: COURSEWORK_PAGES,
        visuals: { tables: "required", figures: "required" },
        guidance: [
          "Course project: state the design task and its requirements first (what must be built and under which constraints/standards), then compare at least two solution variants and justify the chosen one.",
          "The design chapter presents the structure of the solution as a scheme (block diagram, architecture or process) and describes each element's function; calculations follow the standard's method and cite it.",
          "Close with an evaluation of the solution (does it meet each stated requirement?) and the limits of the project.",
          "Never invent measured values, standards numbers or costs — take them from USER FACTS or a cited SOURCE, otherwise state that the value must be specified by the author.",
        ],
        judge: judgeSpec("Course project (engineering design)", {
          describe: {
            originality: "the choice between solution variants is argued by the author (criteria, trade-offs), not copied from one source.",
          },
        }),
      },
    },
  },
  referat: {
    id: "referat",
    label: { uz: "Referat", ru: "Реферат", en: "Referat (topic report)" },
    hint: "Titul → reja → kirish → BO‘LIMLAR → xulosa → adabiyotlar (ilova/annotatsiya yo‘q)",
    toolId: "referat",
    defaultKind: "informative",
    kinds: {
      informative: {
        id: "informative",
        genre: "referat",
        label: { uz: "Informativ referat", ru: "Информативный реферат", en: "Informative referat" },
        hint: "Manbalar mazmunining qisqa, aniq bayoni — «matnda qanday yangilik bor?»",
        introParts: REFERAT_INTRO_PARTS,
        chapters: { min: 2, max: 4 },
        paragraphsPerChapter: { min: 1, max: 2 },
        shape: "sections",
        introShare: [0.1, 0.15],
        conclusionPages: [0.8, 1.3],
        refsMin: 5,
        pages: REFERAT_PAGES,
        visuals: { tables: "optional", figures: "optional" },
        guidance: [
          "Referat = a concise, faithful account of what the SOURCES say — NOT new research and NOT the author's opinion piece; the leading question of every section is «what new information does this source give on the topic?».",
          "The body is divided into SECTIONS (bo'limlar), not chapters: no «1-BOB» headings, each section covers one aspect of the topic and names the sources it summarises.",
          "Summarise accurately and compactly: definitions, facts, positions and their authors; do not pad with general sentences and do not repeat the same idea in two sections.",
          "The conclusion states what the reviewed sources establish about the topic and what remains open — with no claim that is absent from the body.",
        ],
        judge: judgeSpec("Informative referat", {
          describe: {
            depth: "the content of the sources is set out accurately and specifically (definitions, facts, positions with their authors) rather than in vague generalities.",
            originality: "the author's contribution here is the SELECTION and ORGANISATION of the material, plus explicit links between sources — not new claims.",
          },
        }),
      },
      analytic: {
        id: "analytic",
        genre: "referat",
        label: { uz: "Tahliliy-taqqoslovchi referat", ru: "Аналитический реферат", en: "Analytical referat" },
        hint: "Bir necha manbani taqqoslab, qarama-qarshiliklarni ko‘rsatish",
        introParts: REFERAT_INTRO_PARTS,
        chapters: { min: 2, max: 4 },
        paragraphsPerChapter: { min: 1, max: 3 },
        shape: "sections",
        introShare: [0.1, 0.15],
        conclusionPages: [0.8, 1.3],
        refsMin: 6,
        pages: REFERAT_PAGES,
        visuals: { tables: "optional", figures: "optional" },
        guidance: [
          "Analytical referat: the point is COMPARISON — each section confronts at least two sources on one question (agreement, contradiction, different scope) and states what follows from the difference.",
          "Organise by question/criterion, not source by source; a comparison table of approaches is usually the clearest form.",
          "Name the criteria of comparison explicitly in the introduction of each section, so the reader can check the analysis.",
          "The conclusion states which position is better supported by the reviewed evidence and why — without inventing evidence of its own.",
        ],
        judge: judgeSpec("Analytical (comparative) referat", {
          describe: {
            depth: "sources are genuinely compared on stated criteria — agreements, contradictions and their consequences — not listed one after another.",
          },
        }),
      },
      evaluative: {
        id: "evaluative",
        genre: "referat",
        label: { uz: "Baholovchi referat", ru: "Оценочный реферат", en: "Evaluative referat" },
        hint: "Manbalarni tanqidiy baholash: dalil kuchi, cheklovlar, qo‘llanish doirasi",
        introParts: REFERAT_INTRO_PARTS,
        chapters: { min: 2, max: 4 },
        paragraphsPerChapter: { min: 1, max: 3 },
        shape: "sections",
        introShare: [0.1, 0.15],
        conclusionPages: [0.8, 1.3],
        refsMin: 6,
        pages: REFERAT_PAGES,
        visuals: { tables: "optional", figures: "optional" },
        guidance: [
          "Evaluative referat: after setting out what a source claims, assess it — how strong is the evidence, what is the scope, what are the limitations — using explicit, stated criteria.",
          "Every evaluation is argued from the source's own content or from another cited source; never from taste («qiziqarli», «juda muhim»).",
          "Keep description and evaluation visibly separate inside each section so the reader sees what is reported and what is judged.",
          "The conclusion gives an overall, qualified verdict and names what further evidence would be needed.",
        ],
        judge: judgeSpec("Evaluative referat", {
          describe: {
            originality: "the evaluative criteria and the resulting verdict are the author's own and are applied consistently across sources.",
          },
        }),
      },
      report: {
        id: "report",
        genre: "referat",
        label: { uz: "Doklad (ma’ruza)", ru: "Доклад", en: "Oral report (doklad)" },
        hint: "Uch qism: muammo → asosiy mazmun → xulosa; sxema/jadval majburiy",
        introParts: REFERAT_INTRO_PARTS,
        chapters: { min: 3, max: 3 },
        paragraphsPerChapter: { min: 1, max: 2 },
        shape: "sections",
        introShare: [0.1, 0.15],
        conclusionPages: [0.8, 1.3],
        refsMin: 5,
        pages: REFERAT_PAGES,
        visuals: { tables: "required", figures: "required" },
        guidance: [
          "Doklad (oral report): exactly THREE parts — (1) the problem and why it matters now, (2) the substance: facts, positions and evidence, (3) conclusions and what the audience should take away.",
          "Written to be SPOKEN: short sentences, one idea per paragraph, explicit transitions («Endi …», «Shundan kelib chiqib …»); no long subordinate chains.",
          "At least one scheme or table that carries the core content — the speaker points at it; refer to it in the text.",
          "Keep the whole text within the stated volume: a doklad that cannot be read aloud in the allotted time has failed its genre.",
        ],
        judge: judgeSpec("Oral report (doklad)", {
          describe: {
            style: "spoken-presentation register: short sentences, explicit transitions, one idea per paragraph — while staying academic.",
            logic: "the three parts (problem → substance → conclusions) are clearly separated and follow from each other.",
          },
        }),
      },
    },
  },
  independent: {
    id: "independent",
    label: { uz: "Mustaqil ish", ru: "Самостоятельная работа", en: "Independent study work" },
    hint: "VM 824 / OTV 311: nazariy + tahliliy + amaliy qism; 5–15 bet",
    toolId: "mustaqil-ish",
    defaultKind: "written",
    kinds: {
      written: {
        id: "written",
        genre: "independent",
        label: { uz: "Yozma mustaqil ish", ru: "Письменная самостоятельная работа", en: "Written independent work" },
        hint: "Titul → mundarija → kirish → nazariy/tahliliy/amaliy → xulosa → adabiyotlar",
        introParts: INDEPENDENT_INTRO_PARTS,
        chapters: { min: 2, max: 3 },
        paragraphsPerChapter: { min: 2, max: 3 },
        shape: "theory-analysis-practice",
        introShare: [0.1, 0.15],
        conclusionPages: [1, 2],
        refsMin: 8,
        pages: INDEPENDENT_PAGES,
        visuals: { tables: "optional", figures: "optional" },
        guidance: [
          "Written independent work: the body has three functions — THEORY (what the concepts and approaches are, with sources), ANALYSIS (how they apply to the chosen case/topic) and PRACTICE (the author's own worked result: an example, a calculation, a plan, a set of recommendations).",
          "The practical part must contain something the STUDENT did: at least one worked example, scheme, comparison table or concrete set of proposals — a purely theoretical ending fails the genre.",
          "Keep the volume tight (5–15 pages): every paragraph carries a specific claim; no repetition between the theoretical and analytical parts.",
          "The conclusion answers the tasks from the introduction and states what the student learned to do, not only what was read.",
        ],
        judge: judgeSpec("Written independent work", {
          describe: {
            originality: "the practical part contains the student's OWN worked result (example, calculation, scheme or concrete recommendations), not only paraphrased sources.",
          },
        }),
      },
    },
  },
};

/* ────────────────────────── kirish nuqtalari ────────────────────────── */

export function genreOf(genre: WorkGenreId): WorkGenre {
  return WORK_GENRES[genre];
}

/** Janr × tur; noma'lum tur → janrning standarti. */
export function workKindOf(genre: WorkGenreId, kind: unknown): WorkKind {
  const g = WORK_GENRES[genre];
  const k = String(kind ?? "");
  return g.kinds[k as WorkKindId] ?? g.kinds[g.defaultKind]!;
}

/** Janrning barcha turlari (forma galereyasi tartibida). */
export function workKindsOf(genre: WorkGenreId): WorkKind[] {
  return Object.values(WORK_GENRES[genre].kinds).filter((k): k is WorkKind => Boolean(k));
}

/** Noma'lum tur → janr standarti; tur boshqa janrniki bo'lsa ham standartga tushadi. */
export function normalizeWorkKind(genre: WorkGenreId, v: unknown): WorkKindId {
  return workKindOf(genre, v).id;
}

/** Hajm paketi turga mos bo'lishi kerak (narx ham shu qoidadan). */
export function normalizeWorkPages(kind: WorkKind, raw: unknown): string {
  const v = String(raw ?? "").trim();
  return kind.pages.includes(v) ? v : (kind.pages.find((p) => p === "20-25") ?? kind.pages[0]);
}

/** Paket yorlig'ining chegaralari («25-30» → [25, 30]). */
export function pagesRange(pages: string): [number, number] {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(pages ?? "").trim());
  if (m) return [Number(m[1]), Number(m[2])];
  const n = Number(pages);
  return Number.isFinite(n) && n > 0 ? [n, n] : [10, 15];
}

/** Paketning o'rtacha beti — so'z rejasi shu sondan hisoblanadi. */
export function pagesMid(pages: string): number {
  const [lo, hi] = pagesRange(pages);
  return Math.round((lo + hi) / 2);
}
