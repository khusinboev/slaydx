"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { FormValues, ToolConfig, UserProfile } from "@/lib/types";
import { curriculumIndex } from "@/lib/curriculum";
import {
  TEST_QUESTION_KINDS,
  TEST_VARIANT_CHOICES,
  TEST_VARIANT_DEFAULT,
  type TeacherKind,
  type TestQuestionKind,
} from "@/lib/generation/teacher/types";
import { teacherDefaultTypeId, teacherTypesOf } from "@/lib/generation/teacher/registry";
import { teacherInputFromValues, encodeTeacherValues, parseTeacherList, type TeacherInput } from "@/lib/generation/teacher/input";
import type { DocMeta } from "@/lib/generation/types";
import { Row, Segmented, SelectField } from "../compact";
import { Field } from "../shared";
import { TextInput } from "../fields";
import { CurriculumPicker, type CurriculumSelection } from "../CurriculumPicker";

/**
 * FORMALAR 3 (AUDIT-24 WP-B) — o'qituvchi formasining UMUMIY qismi.
 *
 * Bu fayl eski `TeacherComposer.tsx` (831 qator) dan ajratildi: holat
 * tipi (`Ui`), qoralama ↔ forma o'girishlari (`uiFromValues`/`toValues` —
 * `teacher/input.ts` yagona manbasi orqali) va 5 vositada BIR XIL
 * chiziladigan qatorlar (fan/sinf/til, o'quv dasturi, sana).
 *
 * `FormValues` kalitlari va `teacher-params.ts` id lari O'ZGARMAYDI
 * (egasi qarori, `docs/AUDIT-24.md` §1.5) — faqat JSX joylashuvi.
 */

export const LANGUAGE_OPTIONS = [
  { value: "uz", label: "O‘zbek" },
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
];

export const GRADE_OPTIONS = Array.from({ length: 11 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}-sinf` }));

/** Ruxsat etilgan qiymatlar ro'yxatidan eng yaqini (tur almashganda). */
export function nearestNum(allowed: readonly number[], current: number, fallback: number): number {
  if (!allowed.length) return fallback;
  if (allowed.includes(current)) return current;
  return allowed.reduce((best, x) => (Math.abs(x - current) < Math.abs(best - current) ? x : best), allowed[0]!);
}

/**
 * `teacherInputFromValues` FormValues bilan bir qatorda `DocMeta` ni ham
 * so'raydi, lekin faqat FALLBACK sifatida (`values.X ?? meta.X`) —
 * composer har doim TO'LIQ `values` yuboradi, shuning uchun meta hech
 * qachon o'qilmaydi.
 */
const FAKE_META = {} as unknown as DocMeta;

export type Ui = {
  topic: string;
  subject: string;
  subjectTouched: boolean;
  grade: number;
  gradeLetter: string;
  date: string;
  language: "uz" | "ru" | "en";
  university: string;
  author: string;
  approver: string;
  extra: string;
  typeId: string;
  /* lesson */
  duration: number;
  stageCount: number;
  competencies: string[];
  assessmentStyle: "an'anaviy" | "bsb";
  /* map */
  weeklyHours: number;
  totalHours: number;
  controlLink: "erkin" | "bsb-chsb";
  /* glossary */
  termCount: number;
  includeExample: boolean;
  translationLangs: string[];
  /* keys */
  caseCount: number;
  audience: "maktab" | "otm";
  /* test */
  mode: "topic" | "file" | "curriculum";
  count: number;
  openCount: number;
  questionKinds: TestQuestionKind[];
  difficulty: "standart" | "oson" | "qiyin";
  variants: number;
  omr: boolean;
  answerKey: "alohida-bet" | "oxirgi-bet";
  criteriaTable: boolean;
  timeMin: number;
  /* o'quv dasturi (lesson/map/test barchasi ishlatishi mumkin) */
  subjectId: string;
  topicIds: string[];
  fileName: string;
  sourceText: string;
};

/** Kind-xos qatorlar shu propslar bilan chiziladi (har fayl bitta shartnoma). */
export type KindProps = {
  ui: Ui;
  set: <K extends keyof Ui>(key: K, v: Ui[K]) => void;
  setUi: Dispatch<SetStateAction<Ui>>;
  tool: ToolConfig;
};

export function emptyUi(profile: UserProfile, kind: TeacherKind): Ui {
  const base: Ui = {
    topic: "",
    subject: profile.subject || "",
    subjectTouched: false,
    grade: 8,
    gradeLetter: "",
    date: "",
    language: "uz",
    university: profile.university || "",
    author: profile.author || "",
    approver: "",
    extra: "",
    typeId: teacherDefaultTypeId(kind),
    duration: 45,
    stageCount: 6,
    competencies: [],
    assessmentStyle: "an'anaviy",
    weeklyHours: 4,
    totalHours: 136,
    controlLink: "erkin",
    termCount: 10,
    includeExample: true,
    translationLangs: [],
    caseCount: 5,
    audience: "otm",
    mode: "topic",
    count: 20,
    openCount: 0,
    questionKinds: [],
    difficulty: "standart",
    variants: TEST_VARIANT_DEFAULT,
    omr: true,
    answerKey: "alohida-bet",
    criteriaTable: false,
    timeMin: 45,
    subjectId: "",
    topicIds: [],
    fileName: "",
    sourceText: "",
  };
  if (kind === "lesson") {
    const t = teacherTypesOf("lesson")[0]!;
    return { ...base, duration: t.limits.durationDefault, stageCount: t.limits.stagesDefault };
  }
  if (kind === "glossary") {
    const t = teacherTypesOf("glossary")[0]!;
    return { ...base, termCount: t.limits.termsDefault, includeExample: t.limits.includeExampleDefault };
  }
  if (kind === "keys") {
    const t = teacherTypesOf("keys")[0]!;
    return { ...base, caseCount: t.limits.casesDefault };
  }
  if (kind === "test") {
    const t = teacherTypesOf("test")[0]!;
    return {
      ...base,
      count: t.limits.countDefault,
      openCount: Math.round(t.limits.countDefault * t.limits.openShare),
      questionKinds: [...t.limits.kinds],
      variants: t.limits.variantsDefault,
      criteriaTable: t.limits.criteriaTable,
      timeMin: t.limits.timeMinDefault,
    };
  }
  return base;
}

/** Qoralamadagi `FormValues` → forma holati — `teacherInputFromValues` bitta manba (umumiy qism). */
export function uiFromValues(values: FormValues, base: Ui, kind: TeacherKind): Ui {
  const input = teacherInputFromValues(FAKE_META, values, kind);
  const next: Ui = {
    ...base,
    topic: input.topic,
    subject: input.subject,
    subjectTouched: base.subjectTouched,
    grade: input.grade || base.grade,
    gradeLetter: input.gradeLetter,
    date: input.date,
    language: input.language,
    university: input.institution,
    author: input.author,
    approver: input.approver,
    extra: input.extra,
    typeId: input.type,
    duration: input.duration,
    stageCount: input.stageCount,
    competencies: input.competencies,
    assessmentStyle: input.assessmentStyle,
    weeklyHours: input.weeklyHours,
    totalHours: input.totalHours,
    controlLink: input.controlLink,
    termCount: input.termCount,
    includeExample: input.includeExample,
    translationLangs: input.translationLangs,
    caseCount: input.caseCount,
    audience: input.audience,
    subjectId: input.curriculumSubject,
    topicIds: input.topicIds,
    sourceText: input.sourceText,
    fileName: typeof values.fileName === "string" ? values.fileName : base.fileName,
  };
  if (kind === "test") {
    const modeRaw = String(values.mode ?? "");
    next.mode = modeRaw === "file" || modeRaw === "curriculum" ? modeRaw : "topic";
    next.count = Number(values.count) || base.count;
    next.openCount = Number.isFinite(Number(values.openCount)) ? Number(values.openCount) : base.openCount;
    const kinds = parseTeacherList(values.questionKinds, 5).filter((k): k is TestQuestionKind =>
      (TEST_QUESTION_KINDS as readonly string[]).includes(k),
    );
    next.questionKinds = kinds.length ? kinds : base.questionKinds;
    const diff = String(values.difficulty ?? "");
    next.difficulty = diff === "oson" || diff === "qiyin" ? diff : "standart";
    next.variants = (TEST_VARIANT_CHOICES as readonly number[]).includes(Number(values.variants)) ? Number(values.variants) : base.variants;
    next.omr = values.omr === true || values.omr === "true";
    const ak = String(values.answerKey ?? "");
    next.answerKey = ak === "oxirgi-bet" ? "oxirgi-bet" : "alohida-bet";
    next.criteriaTable = values.criteriaTable === true || values.criteriaTable === "true";
    next.timeMin = Number(values.timeMin) || base.timeMin;
  }
  return next;
}

/** Forma holati → yuboriladigan `FormValues` — umumiy qism `encodeTeacherValues`, test maydonlari bevosita. */
export function toValues(ui: Ui, kind: TeacherKind): FormValues {
  const input: TeacherInput = {
    kind,
    type: ui.typeId,
    topic: ui.topic,
    subject: ui.subject,
    language: ui.language,
    institution: ui.university,
    author: ui.author,
    approver: ui.approver,
    grade: ui.grade,
    gradeLetter: ui.gradeLetter,
    date: ui.date,
    extra: ui.extra,
    sourceText: ui.sourceText,
    duration: ui.duration,
    stageCount: ui.stageCount,
    competencies: ui.competencies,
    assessmentStyle: ui.assessmentStyle,
    mapType: ui.typeId === "choraklik" ? "choraklik" : "yillik",
    weeklyHours: ui.weeklyHours,
    totalHours: ui.totalHours,
    controlLink: ui.controlLink,
    termCount: ui.termCount,
    includeExample: ui.includeExample,
    translationLangs: ui.translationLangs,
    caseCount: ui.caseCount,
    audience: ui.audience,
    curriculumSubject: ui.subjectId,
    topicIds: ui.topicIds,
  };
  const out = encodeTeacherValues(input);
  if (kind === "test") {
    out.mode = ui.mode;
    out.count = ui.count;
    out.openCount = ui.openCount;
    out.questionKinds = JSON.stringify(ui.questionKinds);
    out.difficulty = ui.difficulty;
    out.variants = ui.variants;
    out.omr = ui.omr;
    out.answerKey = ui.answerKey;
    out.criteriaTable = ui.criteriaTable;
    out.timeMin = ui.timeMin;
  }
  if (ui.fileName) out.fileName = ui.fileName;
  return out;
}

/* ───────────────────────── fan / sinf / til ───────────────────────── */

/** O'quv dasturidagi fan id → ko'rinadigan nomi (fan BITTA manba bo'lishi uchun). */
export function curriculumSubjectLabel(id: string): string {
  if (!id) return "";
  const s = curriculumIndex().subjects.find((x) => x.id === id);
  return s ? s.uz || s.id : "";
}

/**
 * «Fan, sinf, til» kartasining ichi.
 *
 * FAN BITTA MANBA (R3 topilmasi, `forms3-oqituvchi.md` §3): ilgari erkin
 * matn va `CurriculumPicker` ning o'z `<select>`i SINXRON EMAS edi —
 * foydalanuvchi ikkita «fan» ni alohida to'ldirishi kerakligini bilmasdi.
 * Endi dasturdan fan tanlansa `subject` matni AVTO to'ladi va matn qatori
 * ko'rinmaydi (DOM da `.hidden` ichida qoladi — reyestr qamrovi shu
 * `data-field` ni qidiradi, `tests/ui/teacher-composer.test.mts`).
 */
export function SubjectGradeLanguage({
  ui,
  set,
  onSubjectChange,
  subjectHint,
}: {
  ui: Ui;
  set: KindProps["set"];
  onSubjectChange: (v: string) => void;
  subjectHint?: string;
}) {
  const auto = Boolean(ui.subjectId);
  const autoLabel = curriculumSubjectLabel(ui.subjectId);
  return (
    <>
      <div className={auto ? "hidden" : ""}>
        <Row label="Fan nomi" hint={subjectHint}>
          <Field id="subject">
            <TextInput value={ui.subject} onChange={onSubjectChange} placeholder="Biologiya" />
          </Field>
        </Row>
      </div>
      {auto ? (
        <Row label="Fan nomi" hint="O'quv dasturidan olindi — o'zgartirish uchun dasturdagi fanni bo'shating">
          <span className="text-[13px] font-medium" data-subject-auto>
            {autoLabel || ui.subject}
          </span>
        </Row>
      ) : null}
      <Row label="Sinf">
        <Field id="grade">
          <SelectField ariaLabel="Sinf" value={String(ui.grade)} onChange={(v) => set("grade", Number(v))} options={GRADE_OPTIONS} />
        </Field>
      </Row>
      <Row label="Til">
        <Field id="language">
          <Segmented ariaLabel="Til" options={LANGUAGE_OPTIONS} value={ui.language} onChange={(v) => set("language", v as Ui["language"])} />
        </Field>
      </Row>
    </>
  );
}

/* ───────────────────────── o'quv dasturi ───────────────────────── */

export function CurriculumRow({
  ui,
  onChange,
  label = "O'quv dasturi",
  hint,
}: {
  ui: Ui;
  onChange: (next: CurriculumSelection) => void;
  label?: string;
  hint?: string;
}) {
  return (
    <Row label={label} hint={hint} wide>
      <CurriculumPicker value={{ subjectId: ui.subjectId, grade: ui.grade, topicIds: ui.topicIds }} onChange={onChange} />
    </Row>
  );
}

/* ───────────────────────── sana ───────────────────────── */

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
/** Joriy o'quv yili atrofi — o'tgan, joriy va keyingi yil. */
const YEARS = (() => {
  const y = new Date().getFullYear();
  return [y - 1, y, y + 1].map(String);
})();

function parseIso(v: string): { y: string; m: string; d: string } {
  const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || "");
  return { y: x?.[1] ?? "", m: x?.[2] ?? "", d: x?.[3] ?? "" };
}

/**
 * SANA — kun · oy · yil tanlagichi (`YYYY-MM-DD` qaytaradi).
 *
 * Nega `<input type="date">` emas: brauzer uni O'Z tilida chizadi —
 * o'zbek foydalanuvchi `mm/dd/yyyy` ni ko'rardi (`forms3-olchov.md`
 * kuzatuvi). Qiymat shakli o'zgarmaydi: `teacher/input.ts isoDate`
 * faqat `YYYY-MM-DD` ni qabul qiladi, shuning uchun uchala tanlov
 * to'lmaguncha bo'sh yuboriladi (sana ixtiyoriy).
 */
export function DateRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  /*
   * Tanlovlar ICHKI holatda: `date` faqat uchala bo'lak to'lganda ISO
   * bo'lib chiqadi, aks holda bo'sh — agar bo'laklarni tashqi (bo'sh)
   * qiymatdan o'qisak, birinchi tanlov darhol o'chib ketardi.
   */
  const [parts, setParts] = useState(() => parseIso(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    // Tashqi qiymat o'zgardi (qoralama tiklandi yoki forma tozalandi).
    setSeen(value);
    setParts(parseIso(value));
  }
  const { y, m, d } = parts;
  const emit = (nd: string, nm: string, ny: string) => {
    setParts({ d: nd, m: nm, y: ny });
    const iso = nd && nm && ny ? `${ny}-${nm}-${nd}` : "";
    setSeen(iso);
    onChange(iso);
  };
  const cls = "border-input bg-card focus:ring-ring h-8 rounded-lg border px-1.5 text-[12.5px] outline-none focus:ring-2";
  return (
    <Row label="Sana" hint="Ixtiyoriy — shapkadagi sana">
      <Field id="date">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <select aria-label="Sana — kun" value={d} onChange={(e) => emit(e.target.value, m, y)} className={cls}>
            <option value="">kun —</option>
            {DAYS.map((x) => (
              <option key={x} value={x}>
                {Number(x)}
              </option>
            ))}
          </select>
          <select aria-label="Sana — oy" value={m} onChange={(e) => emit(d, e.target.value, y)} className={cls}>
            <option value="">oy —</option>
            {MONTHS.map((x, i) => (
              <option key={x} value={String(i + 1).padStart(2, "0")}>
                {x}
              </option>
            ))}
          </select>
          <select aria-label="Sana — yil" value={y} onChange={(e) => emit(d, m, e.target.value)} className={cls}>
            <option value="">yil —</option>
            {YEARS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </span>
      </Field>
    </Row>
  );
}
