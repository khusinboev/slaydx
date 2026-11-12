/**
 * «Titul» (title-page builder) — the vocabulary of the free tool.
 *
 * The tool renders ONE A4 title page from a form, without any LLM call. The
 * input is normalized once (`input.ts`), planned once (`layout.ts
 * planTitlePage`) and drawn twice from that one plan: the DOCX renderer
 * (`render-docx.ts`) and the web viewer (`components/viewers/titul/`).
 * Spec: `docs/title-page/SPEC.md`.
 */

/** Work types (the big heading of the page). */
export const TITUL_WORK_TYPES = ["coursework", "bmi", "independent", "referat", "practice", "lab", "master"] as const;
export type TitulWorkType = (typeof TITUL_WORK_TYPES)[number];

/**
 * Arrangements. `dissertation` is the fixed arrangement of the master's
 * dissertation and is offered only for `master` (the form keeps one select).
 */
export const TITUL_LAYOUTS = ["classic", "mavzusida", "right-block", "bmi-official", "dissertation"] as const;
export type TitulLayoutId = (typeof TITUL_LAYOUTS)[number];

/** Language of the FIXED labels (user texts stay as typed). */
export const TITUL_LANGS = ["uz", "uz-cyrl", "ru"] as const;
export type TitulLang = (typeof TITUL_LANGS)[number];

export const TITUL_MINISTRIES = ["oliy", "maktab", "custom", "none"] as const;
export type TitulMinistry = (typeof TITUL_MINISTRIES)[number];

/** The label in front of the teacher's name. */
export const TITUL_CHECKER_LABELS = ["accepted", "checked", "supervisor"] as const;
export type TitulCheckerLabel = (typeof TITUL_CHECKER_LABELS)[number];

/** Who allows the defence of a BMI: the faculty dean or the head of the department. */
export const TITUL_APPROVER_ROLES = ["dean", "head"] as const;
export type TitulApproverRole = (typeof TITUL_APPROVER_ROLES)[number];

/** Laboratory work or practical work (the `lab` type only). */
export const TITUL_LAB_KINDS = ["lab", "practical"] as const;
export type TitulLabKind = (typeof TITUL_LAB_KINDS)[number];

/** Form labels of the work types (Uzbek UI). */
export const TITUL_WORK_TYPE_LABEL: Record<TitulWorkType, string> = {
  coursework: "Kurs ishi",
  bmi: "Diplom ishi (BMI)",
  independent: "Mustaqil ish",
  referat: "Referat",
  practice: "Amaliyot hisoboti",
  lab: "Laboratoriya / amaliy ish",
  master: "Magistrlik dissertatsiyasi",
};

export const TITUL_LAYOUT_LABEL: Record<TitulLayoutId, string> = {
  classic: "Klassik (ramkali)",
  mavzusida: "«… mavzusida»",
  "right-block": "O‘ngda muallif",
  "bmi-official": "BMI rasmiy",
  dissertation: "Dissertatsiya",
};

/** Layouts that make sense for each type; the FIRST one is the default. */
export const TITUL_LAYOUTS_OF: Record<TitulWorkType, readonly TitulLayoutId[]> = {
  coursework: ["classic", "mavzusida", "right-block"],
  bmi: ["bmi-official", "classic", "right-block"],
  independent: ["classic", "mavzusida", "right-block"],
  referat: ["classic", "mavzusida", "right-block"],
  practice: ["classic", "right-block", "mavzusida"],
  lab: ["classic", "right-block", "mavzusida"],
  master: ["dissertation"],
};

/** Character caps of the form fields (the plan is tested to fit ONE page at these lengths). */
export const TITUL_LIMITS = {
  topic: 220,
  ministryCustom: 160,
  university: 150,
  faculty: 100,
  department: 100,
  subject: 100,
  name: 60,
  group: 20,
  course: 2,
  direction: 120,
  directionCode: 16,
  role: 60,
  udk: 40,
  specialityCode: 16,
  speciality: 120,
  labNumber: 4,
  city: 40,
  yearMin: 1990,
  yearMax: 2100,
} as const;

/**
 * Normalized input — what the job stores (`doc.titul.input`) and what
 * `planTitlePage` reads. Every field is always present (empty string = not
 * given), so the plan never meets `undefined`.
 */
export type TitulInput = {
  workType: TitulWorkType;
  layout: TitulLayoutId;
  lang: TitulLang;
  ministry: TitulMinistry;
  ministryCustom: string;
  university: string;
  faculty: string;
  department: string;
  subject: string;
  topic: string;
  author: string;
  group: string;
  course: string;
  direction: string;
  directionCode: string;
  supervisor: string;
  supervisorRole: string;
  checkerLabel: TitulCheckerLabel;
  approverRole: TitulApproverRole;
  approver: string;
  reviewer: string;
  udk: string;
  specialityCode: string;
  speciality: string;
  labKind: TitulLabKind;
  labNumber: string;
  city: string;
  year: number;
  border: boolean;
};

/**
 * The stored model (`AcademicDoc.titul`): the input plus in-place edits.
 * `overrides` maps a run id of the plan (`TitulRun.id`) to the text the user
 * typed in the viewer; the plan uses it verbatim instead of the generated text.
 */
export type TitulModel = {
  input: TitulInput;
  overrides: Record<string, string>;
};

export const isTitulWorkType = (v: unknown): v is TitulWorkType => (TITUL_WORK_TYPES as readonly string[]).includes(String(v));
export const isTitulLayout = (v: unknown): v is TitulLayoutId => (TITUL_LAYOUTS as readonly string[]).includes(String(v));
export const isTitulLang = (v: unknown): v is TitulLang => (TITUL_LANGS as readonly string[]).includes(String(v));
