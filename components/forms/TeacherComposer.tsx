"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { FormValues, ToolConfig, UserProfile } from "@/lib/types";
import { updateProfile, type ServerUser } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useConfirmClick } from "@/components/overlays/useConfirmClick";
import { profilePatchFrom } from "@/lib/profile-sync";
import { priceFor, formatTanga } from "@/lib/tools";
import {
  TEACHER_LIMITS,
  TEST_QUESTION_KINDS,
  TEST_VARIANT_CHOICES,
  TEST_VARIANT_DEFAULT,
  type TeacherKind,
  type TestQuestionKind,
} from "@/lib/generation/teacher/types";
import { teacherDefaultTypeId, teacherKindOf, teacherTypesOf } from "@/lib/generation/teacher/registry";
import { teacherInputFromValues, encodeTeacherValues, parseTeacherList, type TeacherInput } from "@/lib/generation/teacher/input";
import { teacherParamsOf } from "@/lib/generation/teacher-params";
import type { DocMeta } from "@/lib/generation/types";
import { Card, Row, Segmented, Switch, SelectField, SummaryChips } from "./compact";
import { TextArea, TextInput } from "./fields";
import { SourceFileField } from "./SourceFileField";
import { CurriculumPicker, type CurriculumSelection } from "./CurriculumPicker";
import { ToolChrome } from "./ToolChrome";
import { useFormDraft } from "./useFormDraft";
import { runGeneration } from "./runGeneration";

/**
 * O'QITUVCHI VOSITALARI 2 (AUDIT-20 WP-E) — dars rejasi / texnologik
 * xarita / glossariy / keys / test uchun BITTA forma.
 *
 * `WorkComposer`/`ArticleComposer` naqshi: kartalar, `useFormDraft`,
 * `runGeneration`, `uiFromValues` ↔ `toValues` — kirish qismi
 * `teacher/input.ts` (`teacherInputFromValues`/`encodeTeacherValues`)
 * orqali YAGONA manbadan, faqat TEST vositasining o'ziga xos maydonlari
 * (`mode`, `testType`, `count`, `openCount`, `questionKinds`,
 * `difficulty`, `variants`, `omr`, `answerKey`, `criteriaTable`,
 * `timeMin`) bevosita o'qiladi/yoziladi — `TeacherInput`/`teacher/
 * engine.ts` hali FAQAT lesson/map/glossary/keys ni biladi (WP-B test
 * dvigateli hali qo'shilmagan, R0 «Bajarilish yozuvi»). Bu WP-E ning
 * OCHIQ topilmasi: test dvigateli ulanganda shu maydonlar ham
 * `TeacherInput`ga ko'chishi kerak (`docs/AUDIT-20.md` §5).
 *
 * Reyestr shartnomasi — `lib/generation/teacher-params.ts`: har
 * `TEACHER_PARAMS` yozuvi shu formada, tegishli KIND mount qilinganda,
 * `data-field={id}` bilan chizilishi SHART (`tests/ui/teacher-composer.
 * test.mts` qamrov testi).
 */

const TYPE_PARAM_ID: Record<TeacherKind, string> = {
  lesson: "lessonType",
  map: "mapType",
  glossary: "glossaryType",
  keys: "keysType",
  test: "testType",
};

const LANGUAGE_OPTIONS = [
  { value: "uz", label: "O‘zbek" },
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
];

const MODE_OPTIONS = [
  { value: "topic", label: "Mavzu asosida" },
  { value: "file", label: "Fayl asosida" },
  { value: "curriculum", label: "Darslik dasturi asosida" },
];

const DIFFICULTY_OPTIONS: { value: "standart" | "oson" | "qiyin"; label: string }[] = [
  { value: "standart", label: "Standart" },
  { value: "oson", label: "Oson" },
  { value: "qiyin", label: "Qiyin" },
];

const ANSWER_KEY_OPTIONS = [
  { value: "alohida-bet", label: "Alohida bet" },
  { value: "oxirgi-bet", label: "Oxirgi bet" },
];

const AUDIENCE_OPTIONS = [
  { value: "maktab", label: "Maktab" },
  { value: "otm", label: "OTM" },
];

const ASSESSMENT_STYLE_OPTIONS = [
  { value: "an'anaviy", label: "An'anaviy" },
  { value: "bsb", label: "BSB uslubida" },
];

const CONTROL_LINK_OPTIONS = [
  { value: "erkin", label: "Erkin" },
  { value: "bsb-chsb", label: "BSB/ChSB bilan bog'liq" },
];

const QUESTION_KIND_LABEL: Record<TestQuestionKind, string> = {
  single: "Bir tanlovli",
  multi: "Ko'p tanlovli",
  truefalse: "To'g'ri/Noto'g'ri",
  open: "Ochiq",
  match: "Moslashtirish",
};

const GRADE_OPTIONS = Array.from({ length: 11 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}-sinf` }));

function variantLabel(n: number): string {
  return n === 1 ? "1 (yagona)" : n === 2 ? "2 (A/B)" : n === 4 ? "4 (A/B/C/D)" : String(n);
}

/** Ruxsat etilgan qiymatlar ro'yxatidan eng yaqini (tur almashganda). */
function nearestNum(allowed: readonly number[], current: number, fallback: number): number {
  if (!allowed.length) return fallback;
  if (allowed.includes(current)) return current;
  return allowed.reduce((best, x) => (Math.abs(x - current) < Math.abs(best - current) ? x : best), allowed[0]!);
}

/**
 * `teacherInputFromValues` FormValues bilan bir qatorda `DocMeta` ni ham
 * so'raydi, lekin faqat FALLBACK sifatida (`values.X ?? meta.X`) —
 * composer har doim TO'LIQ `values` yuboradi, shuning uchun meta hech
 * qachon o'qilmaydi. Bo'sh obyekt xavfsiz (izoh: `work/input.ts` bunday
 * argument olmaydi, teacher oilasi meta bilan yozilgan — R0 qarori).
 */
const FAKE_META = {} as unknown as DocMeta;

type Ui = {
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

function emptyUi(profile: UserProfile, kind: TeacherKind): Ui {
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
    omr: false,
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
function uiFromValues(values: FormValues, base: Ui, kind: TeacherKind): Ui {
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
function toValues(ui: Ui, kind: TeacherKind): FormValues {
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

export function TeacherComposer({
  tool,
  profile,
  user,
}: {
  tool: ToolConfig;
  profile: UserProfile;
  user: ServerUser | null;
}) {
  void user;
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const kind: TeacherKind = teacherKindOf(tool.id) ?? "lesson";
  const own = new Set(teacherParamsOf(kind).map((p) => p.id));

  const [ui, setUi] = useState<Ui>(() => emptyUi(profile, kind));
  const [loading, setLoading] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { draft, ready, save, clear, flush } = useFormDraft(tool.id, { enabled: loggedIn });

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft && Object.keys(draft).length) setUi((s) => uiFromValues(draft, s, kind));
    // `kind` — vosita (`tool.id`) bilan bir marta hisoblanadi, mount paytida yetarli.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, draft, restored]);

  useEffect(() => {
    if (!restored) return;
    save(toValues(ui, kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui, restored, save]);

  const set = <K extends keyof Ui>(key: K, v: Ui[K]) => setUi((s) => ({ ...s, [key]: v }));

  const typeOptions = teacherTypesOf(kind).map((t) => ({ value: t.id, label: t.label.uz }));
  const currentType = teacherTypesOf(kind).find((t) => t.id === ui.typeId) ?? teacherTypesOf(kind)[0]!;

  function onTopicChange(v: string) {
    setUi((s) => ({ ...s, topic: v, subject: kind === "map" && !s.subjectTouched ? v : s.subject }));
  }
  function onSubjectChange(v: string) {
    setUi((s) => ({ ...s, subject: v, subjectTouched: true }));
  }

  function onTypeChange(id: string) {
    setUi((s) => {
      const next: Ui = { ...s, typeId: id };
      if (kind === "lesson") {
        const t = teacherTypesOf("lesson").find((x) => x.id === id) ?? teacherTypesOf("lesson")[0]!;
        next.duration = nearestNum(t.limits.durations, s.duration, t.limits.durationDefault);
        next.stageCount = Math.max(t.limits.stages[0], Math.min(t.limits.stages[1], s.stageCount));
      } else if (kind === "glossary") {
        const t = teacherTypesOf("glossary").find((x) => x.id === id) ?? teacherTypesOf("glossary")[0]!;
        next.termCount = nearestNum(t.limits.terms, s.termCount, t.limits.termsDefault);
        next.includeExample = t.limits.includeExampleDefault;
        if (id !== "uch-tilli") next.translationLangs = [];
      } else if (kind === "keys") {
        const t = teacherTypesOf("keys").find((x) => x.id === id) ?? teacherTypesOf("keys")[0]!;
        next.caseCount = nearestNum(t.limits.cases, s.caseCount, t.limits.casesDefault);
      } else if (kind === "test") {
        const t = teacherTypesOf("test").find((x) => x.id === id) ?? teacherTypesOf("test")[0]!;
        next.count = nearestNum(t.limits.count, s.count, t.limits.countDefault);
        const allowed: readonly string[] = t.limits.kinds;
        const kept = s.questionKinds.filter((k) => allowed.includes(k));
        next.questionKinds = kept.length ? kept : [...t.limits.kinds];
        next.variants = nearestNum(t.limits.variants, s.variants, t.limits.variantsDefault);
        next.criteriaTable = t.limits.criteriaTable;
        next.timeMin = nearestNum(t.limits.timeMin, s.timeMin, t.limits.timeMinDefault);
        next.openCount = Math.min(s.openCount, next.count);
      }
      return next;
    });
  }

  function onWeeklyHoursChange(v: string) {
    const n = Math.max(1, Math.min(TEACHER_LIMITS.weeklyHoursMax, Number(v) || 1));
    setUi((s) => ({ ...s, weeklyHours: n, totalHours: Math.max(n, s.totalHours) }));
  }
  function onTotalHoursChange(v: string) {
    setUi((s) => ({ ...s, totalHours: Math.max(s.weeklyHours, Math.min(TEACHER_LIMITS.totalHoursMax, Number(v) || s.weeklyHours)) }));
  }

  function toggleQuestionKind(k: TestQuestionKind) {
    setUi((s) => ({
      ...s,
      questionKinds: s.questionKinds.includes(k) ? s.questionKinds.filter((x) => x !== k) : [...s.questionKinds, k],
    }));
  }

  function curriculumValue(): CurriculumSelection {
    return { subjectId: ui.subjectId, grade: ui.grade, topicIds: ui.topicIds };
  }
  function onCurriculumChange(next: CurriculumSelection) {
    setUi((s) => ({ ...s, subjectId: next.subjectId, grade: next.grade || s.grade, topicIds: next.topicIds }));
  }

  const values = toValues(ui, kind);
  const price = priceFor(tool, values);

  const clearConfirm = useConfirmClick(() => {
    void clear();
    setUi(emptyUi(profile, kind));
  });

  async function submit() {
    setError(null);
    const isTest = kind === "test";
    if (isTest && ui.mode === "file") {
      if (!ui.sourceText.trim()) {
        setError("Avval fayl tanlang — matn olingandan keyin yaratish boshlanadi.");
        return;
      }
    } else if (isTest && ui.mode === "curriculum") {
      if (!ui.topicIds.length) {
        setError("Kamida bitta mavzu tanlang");
        return;
      }
    } else if (!ui.topic.trim()) {
      setError(tool.topicLegend ? `${tool.topicLegend}` : "Mavzuni kiriting");
      return;
    }
    if (!ui.university.trim()) {
      setError("Ta'lim muassasasi nomi to'ldirilishi kerak");
      return;
    }
    if (!ui.author.trim()) {
      setError("Tuzuvchi (F.I.Sh) to'ldirilishi kerak");
      return;
    }
    setLoading(true);
    flush();
    try {
      const v = toValues(ui, kind);
      const id = await runGeneration(tool, v);
      const patch = profilePatchFrom({ author: ui.author, subject: ui.subject, position: profile.position, organization: profile.organization }, profile);
      if (Object.keys(patch).length) void updateProfile(patch).catch(() => {});
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  /* ── Karta 2: kind-ga xos sozlamalar ── */
  let kindFields: ReactNode = null;
  if (kind === "lesson") {
    const t = teacherTypesOf("lesson").find((x) => x.id === ui.typeId) ?? teacherTypesOf("lesson")[0]!;
    kindFields = (
      <>
        <Row label="Davomiylik" hint="Daqiqa">
          <span data-field="duration" className="block">
            <Segmented ariaLabel="Davomiylik" options={t.limits.durations.map((n) => ({ value: String(n), label: `${n} daq` }))} value={String(ui.duration)} onChange={(v) => set("duration", Number(v))} />
          </span>
        </Row>
        <Row label="Bosqichlar">
          <span data-field="stageCount" className="block">
            <Segmented
              ariaLabel="Bosqichlar"
              options={Array.from({ length: t.limits.stages[1] - t.limits.stages[0] + 1 }, (_, i) => t.limits.stages[0] + i).map((n) => ({ value: String(n), label: String(n) }))}
              value={String(ui.stageCount)}
              onChange={(v) => set("stageCount", Number(v))}
            />
          </span>
        </Row>
        <Row label="Kompetensiyalar" hint="Vergul bilan ajratib yozing" wide>
          <span data-field="competencies" className="block">
            <TextArea value={ui.competencies.join(", ")} onChange={(v) => set("competencies", parseTeacherList(v, TEACHER_LIMITS.competenciesMax, 120))} placeholder="Axborot bilan ishlash, Muammoni hal qilish" />
          </span>
        </Row>
        <Row label="Baholash">
          <span data-field="assessmentStyle" className="block">
            <Segmented ariaLabel="Baholash" options={ASSESSMENT_STYLE_OPTIONS} value={ui.assessmentStyle} onChange={(v) => set("assessmentStyle", v as Ui["assessmentStyle"])} />
          </span>
        </Row>
      </>
    );
  } else if (kind === "map") {
    kindFields = (
      <>
        <Row label="Haftalik soat">
          <span data-field="weeklyHours" className="block">
            <TextInput type="number" value={String(ui.weeklyHours)} onChange={onWeeklyHoursChange} />
          </span>
        </Row>
        <Row label="Yillik soat">
          <span data-field="totalHours" className="block">
            <TextInput type="number" value={String(ui.totalHours)} onChange={onTotalHoursChange} />
          </span>
        </Row>
        <Row label="Nazorat ustuni" hint="BSB/ChSB bilan bog'lansinmi?">
          <span data-field="controlLink" className="block">
            <Segmented ariaLabel="Nazorat ustuni" options={CONTROL_LINK_OPTIONS} value={ui.controlLink} onChange={(v) => set("controlLink", v as Ui["controlLink"])} />
          </span>
        </Row>
      </>
    );
  } else if (kind === "glossary") {
    const t = teacherTypesOf("glossary").find((x) => x.id === ui.typeId) ?? teacherTypesOf("glossary")[0]!;
    kindFields = (
      <>
        <Row label="Atama soni" hint="Narx shu tanlovga bog'liq">
          <span data-field="termCount" className="block">
            <Segmented
              ariaLabel="Atama soni"
              options={t.limits.terms.map((n) => ({ value: String(n), label: `${n} ta · ${formatTanga(priceFor(tool, { termCount: n }))}` }))}
              value={String(ui.termCount)}
              onChange={(v) => set("termCount", Number(v))}
            />
          </span>
        </Row>
        <Row label="Misol qatori">
          <span data-field="includeExample" className="block">
            <Switch checked={ui.includeExample} onChange={(v) => set("includeExample", v)} ariaLabel="Misol qatori" />
          </span>
        </Row>
        <div className={ui.typeId === "uch-tilli" ? "" : "hidden"}>
          <Row label="Tarjima tillari" wide>
            <span data-field="translationLangs" className="block">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tarjima tillari">
                {(t.limits.translationLangs.length ? t.limits.translationLangs : ["ru", "en"]).map((l) => {
                  const on = ui.translationLangs.includes(l);
                  return (
                    <button
                      key={l}
                      type="button"
                      aria-pressed={on}
                      data-lang={l}
                      onClick={() => set("translationLangs", on ? ui.translationLangs.filter((x) => x !== l) : [...ui.translationLangs, l])}
                      className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted"}`}
                    >
                      {l.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </span>
          </Row>
        </div>
      </>
    );
  } else if (kind === "keys") {
    const t = teacherTypesOf("keys").find((x) => x.id === ui.typeId) ?? teacherTypesOf("keys")[0]!;
    kindFields = (
      <>
        <Row label="Keyslar soni">
          <span data-field="caseCount" className="block">
            <Segmented ariaLabel="Keyslar soni" options={t.limits.cases.map((n) => ({ value: String(n), label: String(n) }))} value={String(ui.caseCount)} onChange={(v) => set("caseCount", Number(v))} />
          </span>
        </Row>
        <Row label="Auditoriya">
          <span data-field="audience" className="block">
            <Segmented ariaLabel="Auditoriya" options={AUDIENCE_OPTIONS} value={ui.audience} onChange={(v) => set("audience", v as Ui["audience"])} />
          </span>
        </Row>
      </>
    );
  } else if (kind === "test") {
    const t = teacherTypesOf("test").find((x) => x.id === ui.typeId) ?? teacherTypesOf("test")[0]!;
    kindFields = (
      <>
        <Row label="Savol soni">
          <span data-field="count" className="block">
            <Segmented ariaLabel="Savol soni" options={t.limits.count.map((n) => ({ value: String(n), label: String(n) }))} value={String(ui.count)} onChange={(v) => { const n = Number(v); setUi((s) => ({ ...s, count: n, openCount: Math.min(s.openCount, n) })); }} />
          </span>
        </Row>
        <Row label="Ochiq savollar" hint="Savol sonidan oshmasin">
          <span data-field="openCount" className="block">
            <TextInput type="number" value={String(ui.openCount)} onChange={(v) => setUi((s) => ({ ...s, openCount: Math.max(0, Math.min(s.count, Number(v) || 0)) }))} />
          </span>
        </Row>
        <Row label="Savol turlari" wide>
          <span data-field="questionKinds" className="block">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Savol turlari">
              {t.limits.kinds.map((k) => {
                const on = ui.questionKinds.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    data-kind={k}
                    onClick={() => toggleQuestionKind(k)}
                    className={`rounded-full border px-2.5 py-1 text-[12.5px] transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted"}`}
                  >
                    {QUESTION_KIND_LABEL[k]}
                  </button>
                );
              })}
            </div>
          </span>
        </Row>
        <Row label="Qiyinlik">
          <span data-field="difficulty" className="block">
            <Segmented ariaLabel="Qiyinlik" options={DIFFICULTY_OPTIONS} value={ui.difficulty} onChange={(v) => set("difficulty", v as Ui["difficulty"])} />
          </span>
        </Row>
        <Row label="Variantlar">
          <span data-field="variants" className="block">
            <Segmented ariaLabel="Variantlar" options={t.limits.variants.map((n) => ({ value: String(n), label: variantLabel(n) }))} value={String(ui.variants)} onChange={(v) => set("variants", Number(v))} />
          </span>
        </Row>
        <Row label="OMR varag'i" hint="Javoblar varag'ini alohida chizish">
          <span data-field="omr" className="block">
            <Switch checked={ui.omr} onChange={(v) => set("omr", v)} ariaLabel="OMR varag'i" />
          </span>
        </Row>
        <Row label="Javoblar kaliti">
          <span data-field="answerKey" className="block">
            <Segmented ariaLabel="Javoblar kaliti" options={ANSWER_KEY_OPTIONS} value={ui.answerKey} onChange={(v) => set("answerKey", v as Ui["answerKey"])} />
          </span>
        </Row>
        <div className={t.limits.criteriaTable ? "" : "hidden"}>
          <Row label="Mezon jadvali">
            <span data-field="criteriaTable" className="block">
              <Switch checked={ui.criteriaTable} onChange={(v) => set("criteriaTable", v)} ariaLabel="Mezon jadvali" />
            </span>
          </Row>
        </div>
        <Row label="Vaqt" hint="Daqiqa">
          <span data-field="timeMin" className="block">
            <Segmented ariaLabel="Vaqt" options={t.limits.timeMin.map((n) => ({ value: String(n), label: `${n} daq` }))} value={String(ui.timeMin)} onChange={(v) => set("timeMin", Number(v))} />
          </span>
        </Row>
      </>
    );
  }

  /* ── Karta 1: mavzu/rejim ── */
  let modeFields: ReactNode = null;
  if (kind === "test") {
    modeFields = (
      <>
        <Row label="Rejim" wide>
          <span data-field="mode" className="block">
            <Segmented ariaLabel="Rejim" options={MODE_OPTIONS} value={ui.mode} onChange={(v) => set("mode", v as Ui["mode"])} />
          </span>
        </Row>
        <div className={ui.mode === "file" ? "" : "hidden"}>
          <div data-field="sourceText" data-source-file>
            <SourceFileField
              legend="Hujjat yuklang"
              fileName={ui.fileName}
              sourceText={ui.sourceText}
              onChange={({ fileName, sourceText }) => setUi((s) => ({ ...s, fileName, sourceText }))}
              onBusyChange={setFileBusy}
            />
          </div>
        </div>
        <div className={ui.mode === "curriculum" ? "" : "hidden"}>
          <Row label="O'quv dasturi" wide>
            <CurriculumPicker value={curriculumValue()} onChange={onCurriculumChange} />
          </Row>
        </div>
      </>
    );
  }

  // Dars rejasi/xarita: o'quv dasturidan mavzu tanlash IXTIYORIY (R1 tadqiqotdan
  // keyingi qaror) — alohida yoqish tugmasi shart emas, fan tanlanmasa
  // (`subjectId` bo'sh) `topicIds` ham bo'sh yuboriladi (`teacherInputFromValues`).
  const showCurriculumOptIn = kind === "lesson" || kind === "map";

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} onSubmit={submit} error={error}>
      <Card title="Mavzu va rejim">
        <div className={kind === "test" && ui.mode !== "topic" ? "hidden" : ""}>
          <Row label="Mavzu" hint={tool.topicLegend} wide>
            <span data-field="topic" className="block">
              <TextInput value={ui.topic} onChange={onTopicChange} placeholder={tool.topicPlaceholder} />
            </span>
          </Row>
        </div>
        {tool.topicExamples?.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tool.topicExamples.map((ex) => (
              <button key={ex} type="button" onClick={() => onTopicChange(ex)} className="bg-muted hover:bg-muted/70 rounded-md px-2 py-1 text-left text-[11px]">
                {ex}
              </button>
            ))}
          </div>
        ) : null}
        {modeFields}
        {showCurriculumOptIn ? (
          <Row label="O'quv dasturi" hint="Ixtiyoriy — dastur mavzularidan tanlash" wide>
            <CurriculumPicker value={curriculumValue()} onChange={onCurriculumChange} />
          </Row>
        ) : null}
      </Card>

      <Card title="Fan, sinf, til">
        <Row label="Fan nomi" hint={kind === "map" ? "Avto — mavzu maydonidan" : undefined}>
          <span data-field="subject" className="block">
            <TextInput value={ui.subject} onChange={onSubjectChange} placeholder="Biologiya" />
          </span>
        </Row>
        <Row label="Sinf">
          <span data-field="grade" className="block">
            <SelectField ariaLabel="Sinf" value={String(ui.grade)} onChange={(v) => set("grade", Number(v))} options={GRADE_OPTIONS} />
          </span>
        </Row>
        {own.has("gradeLetter") ? (
          <Row label="Sinf harfi">
            <span data-field="gradeLetter" className="block">
              <TextInput value={ui.gradeLetter} onChange={(v) => set("gradeLetter", v.slice(0, 1).toUpperCase())} placeholder="A" />
            </span>
          </Row>
        ) : null}
        <Row label="Til">
          <span data-field="language" className="block">
            <Segmented ariaLabel="Til" options={LANGUAGE_OPTIONS} value={ui.language} onChange={(v) => set("language", v as Ui["language"])} />
          </span>
        </Row>
        <Row label="Tur" hint={currentType.hint} wide>
          <span data-field={TYPE_PARAM_ID[kind]} className="block">
            <Segmented ariaLabel="Tur" options={typeOptions} value={ui.typeId} onChange={onTypeChange} />
          </span>
        </Row>
        {kindFields}
      </Card>

      <details open className="bg-card mb-3 rounded-2xl border p-4">
        <summary className="mb-1 cursor-pointer text-[11.5px] font-semibold tracking-wide uppercase">
          <span className="text-muted-foreground">Shapka</span>
        </summary>
        <div className="mt-2">
          <Row label="Muassasa">
            <span data-field="university" className="block">
              <TextInput value={ui.university} onChange={(v) => set("university", v)} placeholder="15-son umumiy o'rta ta'lim maktabi" />
            </span>
          </Row>
          <Row label="Tuzuvchi">
            <span data-field="author" className="block">
              <TextInput value={ui.author} onChange={(v) => set("author", v)} placeholder="F.I.Sh." />
            </span>
          </Row>
          {own.has("approver") ? (
            <Row label="Tasdiqlayman" hint="Lavozim (masalan direktorning o'quv ishlari bo'yicha o'rinbosari)">
              <span data-field="approver" className="block">
                <TextInput value={ui.approver} onChange={(v) => set("approver", v)} placeholder="Ixtiyoriy" />
              </span>
            </Row>
          ) : null}
          {own.has("date") ? (
            <Row label="Sana">
              <span data-field="date" className="block">
                <TextInput type="date" value={ui.date} onChange={(v) => set("date", v)} />
              </span>
            </Row>
          ) : null}
        </div>
      </details>

      <details
        open={settingsOpen}
        onToggle={(e) => setSettingsOpen((e.currentTarget as HTMLDetailsElement).open)}
        className="bg-card mb-3 rounded-2xl border p-4"
      >
        <summary className="flex cursor-pointer items-center justify-between gap-2">
          <span className="text-muted-foreground text-[11.5px] font-semibold tracking-wide uppercase">Qo&apos;shimcha</span>
          {!settingsOpen ? <SummaryChips items={[currentType.label.uz]} /> : null}
        </summary>
        <div className="mt-3">
          <Row label="Qo'shimcha" hint="Modelga alohida talab" wide>
            <span data-field="extra" className="block">
              <TextArea value={ui.extra} onChange={(v) => set("extra", v)} placeholder="Ixtiyoriy" />
            </span>
          </Row>
          <div className="mt-2">
            <button type="button" onClick={clearConfirm.trigger} className="text-muted-foreground hover:text-destructive text-[12px]">
              {clearConfirm.armed ? "Ishonchingiz komilmi? Yana bosing" : "Formani tozalash"}
            </button>
          </div>
        </div>
      </details>
      {fileBusy ? <p className="text-muted-foreground -mt-2 mb-4 text-[11px]">Fayl o‘qilmoqda…</p> : null}
    </ToolChrome>
  );
}
