/**
 * TAYYORLIK HISOBOTI — O'QITUVCHI VOSITALARI (AUDIT-20 WP-A) — `reviewTeacher`.
 *
 * Ikki qatlam (`work/review.ts` bilan bir xil naqsh, mantiq NEYTRAL
 * qatlamda `report/`):
 *   1. QOIDALAR — deterministik bandlar, id lari `registry.ts`
 *      `TEACHER_RULE_IDS` da QULFLANGAN (tadqiqot hisobotlari §4).
 *      Yorliqlar o'zbekcha (interfeys tili).
 *   2. BAHOLOVCHI — `judge` rol, turning `JudgeSpec` i bo'yicha 5 mezon
 *      × 0–3 (`registry.ts`).
 *
 * BALL = `report/score.ts scoreReviewFor` (60 % qoidalar + 40 % baholovchi).
 *
 * Nega qoidalarning bir qismi MODELDAN, bir qismi MATNDAN: son-sanoq
 * (daqiqa yig'indisi, soat yig'indisi, atama soni, rubrika bali) —
 * `doc.teacher` modelidan, chunki u yagona manba va matndan qayta
 * ajratish xato beradi; SIFAT bandlari (mavzuga bog'liqlik, umumiy
 * shablon, ta'rif uzunligi) — BO'LIM MATNIDAN, chunki hisobot
 * tahrirdan va avto-sayqaldan KEYIN ham chaqiriladi va o'shanda
 * o'zgargan narsa aynan matn bo'ladi. Faqat modelga tayanilsa sayqal
 * hech qachon ball ko'tarmasdi — va shu sababli hech qachon qabul
 * qilinmasdi.
 *
 * Izomorf: DOM/server importi yo'q.
 */
import type { AcademicDoc, DocSection } from "../types";
import type { DocReview, JudgeResult, JudgeSpec, ReviewCheck, ReviewGuardInput } from "../report/types";
import { check, rewrite, scoreReviewFor, sectionText } from "../report/score";
import { JUDGE_MIN_MS, JUDGE_NO_ANSWER, JUDGE_TIMEOUT_MS, judgeChecksFor, judgeSystemPromptFor, neutralJudgeFor, parseJudgeFor } from "../report/judge";
import { sampleForJudge } from "../report/text";
import { isGenericGlossaryTerm, remainingMs } from "../quality";
import type { LlmUsage } from "../llm-roles";
import type { CompleteFn } from "../research/pipeline";
import { TEACHER_LIMITS, type GlossaryModel, type KeysModel, type LessonModel, type MapModel, type TeacherKind, type TeacherModel } from "./types";
import { TEACHER_RULE_IDS, teacherTypeOf, type GlossaryTypeSpec, type KeysTypeSpec, type LessonTypeSpec, type TeacherTypeSpec } from "./registry";
import { caseKey, clean, hasRealisticDetail, isGenericActivity, isGenericResult, isPlaceholderTopic, isStubDefinition, isAlphaOrdered, mentionsTopic, sumOf, weeksFor } from "./guard";

/* ────────────────────────── tiplar ────────────────────────── */

/**
 * Mezon nomlari kind bo'yicha boshqacha (`LESSON_JUDGE_CRITERIA` …),
 * mantiq esa bitta. Yadro (`report/judge.ts`) mezonni OCHMAYDI, shuning
 * uchun bu qatlamda ular `string` sifatida ko'rinadi.
 */
export type TeacherJudgeResult = JudgeResult<string>;

export type TeacherReviewOpts = {
  complete?: CompleteFn;
  deadline?: number;
  /** `false` — baholovchi chaqirilmaydi (testlar). */
  judge?: boolean;
  guard?: ReviewGuardInput;
  now?: Date;
  onUsage?: (u: LlmUsage) => void;
};

/** Baholovchiga beriladigan matn shu belgidan oshmaydi. */
export const JUDGE_TEXT_CHARS = 18_000;
/** Misol ulushi shu darajadan past bo'lsa sariq (`exampleCoverage`, R2 §4). */
export const EXAMPLE_COVERAGE_MIN = 0.6;
/** Noyob mavzu ulushi (`uniqueTopics`, R1 §4). */
export const UNIQUE_TOPIC_MIN = 0.7;

/** Modelsiz (eski) hujjat uchun bo'sh baholovchi natijasi. */
const EMPTY_JUDGE = { notes: [], fixes: [] } as unknown as TeacherJudgeResult;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const list = (xs: string[], max = 5) => (xs.length > max ? `${xs.slice(0, max).join(", ")} … (+${xs.length - max})` : xs.join(", "));

function specOf(model: TeacherModel): TeacherTypeSpec {
  return teacherTypeOf(model.kind, model.type);
}

/** Hujjat matni (barcha bo'limlar + jadval kataklari) — matn bandlari uchun. */
function docText(doc: AcademicDoc): string {
  const sections = doc.sections.map((s) => sectionText(s)).join("\n");
  const tables = (doc.tables ?? []).map((t) => t.rows.map((r) => r.join(" ")).join("\n")).join("\n");
  return `${sections}\n${tables}`;
}

const sectionOf = (doc: AcademicDoc, id: string): DocSection | undefined => doc.sections.find((s) => s.id === id);

/**
 * Jadvalni nishon qilish sintaksisi: `table:0`.
 *
 * Xaritada hujjat MAZMUNI jadvalda — bo'lim matnini qayta yozish u
 * yerda hech nimani tuzatmaydi. `polish.ts rewriteTeacherFix` shu
 * prefiksni taniydi.
 */
export const tableTarget = (i: number) => `table:${i}`;
export const parseTableTarget = (target: string): number | null => {
  const m = /^table:(\d+)$/.exec(target);
  return m ? Number(m[1]) : null;
};

/* ══════════════════════════ dars rejasi ══════════════════════════ */

function lessonChecks(doc: AcademicDoc, model: LessonModel, spec: LessonTypeSpec): ReviewCheck[] {
  const out: ReviewCheck[] = [];
  const topic = doc.meta.topic;
  const stages = model.stages;
  const stagesText = sectionText(sectionOf(doc, "stages") ?? { id: "stages", title: "", blocks: [] });

  /* ── 1. minutesSum ── */
  {
    const sum = sumOf(stages.map((s) => s.minutes));
    const d = `${sum} ${doc.meta.language === "ru" ? "мин" : "daq"} (dars ${model.durationMin})`;
    out.push(
      sum === model.durationMin
        ? check("minutesSum", "green", "Daqiqa yig‘indisi", d)
        : check("minutesSum", "red", "Daqiqa yig‘indisi", `${d} — mos emas`, rewrite("stages", `Redistribute the stage minutes so that they add up to EXACTLY ${model.durationMin} minutes; keep the same stages and their content.`)),
    );
  }

  /* ── 2. topicGrounded ── */
  {
    const hits = stages.filter((s) => mentionsTopic(`${s.title} ${s.teacher} ${s.student} ${s.result}`, topic)).length;
    const d = `${stages.length} bosqichdan ${hits} tasi mavzuga bog‘langan`;
    out.push(
      hits >= Math.max(1, Math.ceil(stages.length / 2))
        ? check("topicGrounded", "green", "Mavzuga bog‘liqlik", d)
        : check(
            "topicGrounded",
            hits ? "yellow" : "red",
            "Mavzuga bog‘liqlik",
            d,
            rewrite("stages", `Rewrite the stages so that each one names a concrete example, question or exercise from the topic «${topic}»; keep the stage titles and the minutes.`),
          ),
    );
  }

  /* ── 3. stageCount ── */
  {
    const [lo, hi] = spec.limits.stages;
    const n = stages.length;
    const d = `${n} ta (tur uchun ${lo}–${hi})`;
    out.push(n >= lo && n <= hi ? check("stageCount", "green", "Bosqichlar soni", d) : check("stageCount", n < lo ? "red" : "yellow", "Bosqichlar soni", d));
  }

  /* ── 4. noGenericActivity ── */
  {
    const bad = stages.filter((s) => isGenericActivity(s.teacher) || !s.student).map((s) => s.title);
    out.push(
      bad.length
        ? check(
            "noGenericActivity",
            bad.length > stages.length / 2 ? "red" : "yellow",
            "Umumiy shablon",
            `Aniq faoliyat yo‘q: ${list(bad)}`,
            rewrite("stages", "For each stage write 2–3 concrete sentences of what the TEACHER does (naming the actual example, rule or exercise) and one observable action the PUPIL performs. Remove all-purpose sentences."),
          )
        : check("noGenericActivity", "green", "Umumiy shablon", "Har bosqichda aniq faoliyat bor"),
    );
  }

  /* ── 5. homeworkPresent ── */
  {
    const hw = clean(model.homework);
    out.push(
      hw.length >= 20
        ? check("homeworkPresent", "green", "Uyga vazifa", `${hw.length} belgi`)
        : check("homeworkPresent", "red", "Uyga vazifa", hw ? "Juda qisqa" : "Yo‘q", rewrite("homework", `Write one concrete homework task on «${topic}» that follows from the lesson goal and fits this grade.`)),
    );
  }

  /* ── 6. competencyTagged ── */
  {
    const hay = `${stagesText} ${sectionText(sectionOf(doc, "passport") ?? { id: "", title: "", blocks: [] })}`.toLowerCase();
    if (!model.competencies.length) out.push(check("competencyTagged", "green", "Kompetensiyalar", "Tanlanmagan"));
    else {
      const seen = model.competencies.filter((c) => {
        const w = clean(c).toLowerCase().split(/\s+/).filter((x) => x.length >= 5)[0] ?? clean(c).toLowerCase();
        return w.length >= 4 && hay.includes(w.slice(0, 8));
      });
      out.push(
        seen.length
          ? check("competencyTagged", "green", "Kompetensiyalar", `${model.competencies.length} tadan ${seen.length} tasi matnda aks etgan`)
          : check(
              "competencyTagged",
              "yellow",
              "Kompetensiyalar",
              "Tanlangan kompetensiyalar bosqichlarda ko‘rinmaydi",
              rewrite("stages", `Make the stages visibly develop these competencies: ${model.competencies.join("; ")}. Name the competency-building activity in the stage where it happens.`),
            ),
      );
    }
  }

  return out;
}

/* ══════════════════════════ texnologik xarita ══════════════════════════ */

function mapChecks(doc: AcademicDoc, model: MapModel): ReviewCheck[] {
  const out: ReviewCheck[] = [];
  const weeks = model.quarters.flatMap((q) => q.weeks);
  const want = weeksFor(model.weeklyHours, model.totalHours);

  /* ── 1. weekCount ── */
  {
    const d = `${weeks.length} hafta (soatlardan: ${want})`;
    out.push(
      weeks.length === want
        ? check("weekCount", "green", "Haftalar soni", d)
        : check("weekCount", weeks.length >= Math.ceil(want * UNIQUE_TOPIC_MIN) ? "yellow" : "red", "Haftalar soni", d),
    );
  }

  /* ── 2. uniqueTopics ── */
  {
    const keys = new Set(weeks.map((w) => clean(w.topic).toLowerCase()));
    const share = weeks.length ? keys.size / weeks.length : 0;
    const d = `${keys.size} noyob / ${weeks.length} (${pct(share)})`;
    out.push(
      share >= 1
        ? check("uniqueTopics", "green", "Noyob mavzular", d)
        : check("uniqueTopics", share >= UNIQUE_TOPIC_MIN ? "yellow" : "red", "Noyob mavzular", d, rewrite(tableTarget(0), "Replace the repeated topics with different lesson topics of this subject; keep the week numbers and the hours column unchanged.")),
    );
  }

  /* ── 3. hoursSum ── */
  {
    const sum = sumOf(weeks.map((w) => w.hours));
    const d = `${sum} soat (e’lon qilingan ${model.totalHours})`;
    out.push(sum === model.totalHours ? check("hoursSum", "green", "Soat yig‘indisi", d) : check("hoursSum", "red", "Soat yig‘indisi", `${d} — mos emas`));
  }

  /* ── 4. noPlaceholderTopic ── */
  {
    const bad = weeks.filter((w) => isPlaceholderTopic(w.topic)).map((w) => `${w.n}-hafta`);
    out.push(
      bad.length
        ? check("noPlaceholderTopic", "red", "Mavzu nomlari", `O‘rin egallovchi: ${list(bad)}`, rewrite(tableTarget(0), "Replace every placeholder topic («1-mavzu», «Topic 2») with the real lesson topic for that week."))
        : check("noPlaceholderTopic", "green", "Mavzu nomlari", "Barcha mavzular aniq nomlangan"),
    );
  }

  /* ── 5. resultVariety ── */
  {
    const generic = weeks.filter((w) => isGenericResult(w.result)).length;
    const uniq = new Set(weeks.map((w) => clean(w.result).toLowerCase())).size;
    const d = `${uniq} xil natija / ${weeks.length}${generic ? `, ${generic} ta umumiy shablon` : ""}`;
    out.push(
      !generic && uniq >= Math.ceil(weeks.length * 0.8)
        ? check("resultVariety", "green", "Kutilgan natijalar", d)
        : check(
            "resultVariety",
            generic > weeks.length / 3 ? "red" : "yellow",
            "Kutilgan natijalar",
            d,
            rewrite(tableTarget(0), "Rewrite the «expected result» column: 4–8 words specific to that week's topic, no all-purpose phrases and no repetitions."),
          ),
    );
  }

  /* ── 6. controlRelevance ── */
  {
    const empty = weeks.filter((w) => !clean(w.control)).length;
    const kinds = new Set(weeks.map((w) => clean(w.control).toLowerCase()).filter(Boolean));
    /*
     * Metod ↔ nazorat mosligi: laboratoriya/amaliy darsda og'zaki
     * so'rov — aynan `controlFit` mezoni rad etadigan holat.
     */
    const mismatch = weeks.filter((w) => /laborator|amaliy/i.test(w.method) && /og[‘’'`]?zaki/i.test(w.control)).map((w) => `${w.n}-hafta`);
    const d = `${kinds.size} xil nazorat${empty ? `, ${empty} ta bo‘sh` : ""}${mismatch.length ? `, metodga mos emas: ${list(mismatch)}` : ""}`;
    out.push(
      !empty && kinds.size >= 2 && !mismatch.length
        ? check("controlRelevance", "green", "Nazorat turi", d)
        : check("controlRelevance", empty || kinds.size < 2 ? "red" : "yellow", "Nazorat turi", d, rewrite(tableTarget(0), "Fill the «control» column so that the assessment type matches the topic and the method of that week (a laboratory or practical week gets a practical check, not an oral question).")),
    );
  }

  return out;
}

/* ══════════════════════════ glossariy ══════════════════════════ */

function glossaryChecks(doc: AcademicDoc, model: GlossaryModel, spec: GlossaryTypeSpec): ReviewCheck[] {
  const out: ReviewCheck[] = [];
  const terms = model.terms;
  const want = Math.max(spec.limits.termsMin, doc.meta.termCount || terms.length);
  const [defMin, defMax] = spec.limits.defChars;

  /* ── 1. termCount ── */
  {
    const d = `${terms.length} ta (so‘ralgan ${want})`;
    out.push(terms.length >= want ? check("termCount", "green", "Atamalar soni", d) : check("termCount", terms.length >= Math.ceil(want * 0.7) ? "yellow" : "red", "Atamalar soni", d));
  }

  /* ── 2. alphaOrder ── */
  out.push(
    isAlphaOrdered(terms, model.terms.length ? doc.meta.language : "uz")
      ? check("alphaOrder", "green", "Alifbo tartibi", "Ro‘yxat hujjat tilida tartiblangan")
      : check("alphaOrder", "yellow", "Alifbo tartibi", "Atamalar alifbo tartibida emas"),
  );

  /* ── 3. defLength ── */
  {
    const short = terms.filter((t) => t.def.length < defMin).map((t) => t.term);
    const long = terms.filter((t) => t.def.length > defMax).map((t) => t.term);
    const d = `${defMin}–${defMax} belgi; qisqa: ${short.length}, uzun: ${long.length}`;
    out.push(
      !short.length && !long.length
        ? check("defLength", "green", "Ta’rif uzunligi", d)
        : check("defLength", short.length > terms.length / 3 ? "red" : "yellow", "Ta’rif uzunligi", `${d}${short.length ? ` — ${list(short)}` : ""}`, rewrite("terms", `Rewrite the too-short definitions so that each is ${defMin}–${defMax} characters and says what the thing IS and what distinguishes it; keep the alphabetical order.`)),
    );
  }

  /* ── 4. noGenericTerm ── */
  {
    const bad = terms.filter((t) => isGenericGlossaryTerm(t.term)).map((t) => t.term);
    out.push(
      bad.length
        ? check("noGenericTerm", "red", "Umumiy atamalar", `Sohaga xos emas: ${list(bad)}`, rewrite("terms", "Replace the general pedagogical words with genuine terms of this subject."))
        : check("noGenericTerm", "green", "Umumiy atamalar", "Barcha atamalar sohaga xos"),
    );
  }

  /* ── 5. exampleCoverage ── */
  {
    const withExample = terms.filter((t) => clean(t.example ?? "")).length;
    const share = terms.length ? withExample / terms.length : 0;
    if (!model.includeExample) out.push(check("exampleCoverage", "green", "Misollar", "Misol so‘ralmagan"));
    else if (share >= EXAMPLE_COVERAGE_MIN) out.push(check("exampleCoverage", "green", "Misollar", `${withExample}/${terms.length} (${pct(share)})`));
    else
      out.push(
        check("exampleCoverage", share ? "yellow" : "red", "Misollar", `${withExample}/${terms.length} (${pct(share)}, kerak ≥${pct(EXAMPLE_COVERAGE_MIN)})`, rewrite("terms", "Add a short example sentence to every entry that has none: the term used in a real subject context, not a paraphrase of the definition.")),
      );
  }

  /* ── 6. duplicateTerm ── */
  {
    const seen = new Set<string>();
    const dup: string[] = [];
    for (const t of terms) {
      const k = t.term.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (seen.has(k)) dup.push(t.term);
      else seen.add(k);
    }
    out.push(dup.length ? check("duplicateTerm", "red", "Takror atamalar", list(dup), rewrite("terms", "Remove the duplicated entries and add different terms of this subject instead.")) : check("duplicateTerm", "green", "Takror atamalar", "Takror yo‘q"));
  }

  /* ── 7. noStubDefinition ── */
  {
    const stub = terms.filter((t) => isStubDefinition(t.term, t.def)).map((t) => t.term);
    out.push(
      stub.length
        ? check("noStubDefinition", stub.length > terms.length / 4 ? "red" : "yellow", "Tavtologik ta’riflar", `Atamani o‘zi bilan izohlagan: ${list(stub)}`, rewrite("terms", "Rewrite the tautological definitions: say what the thing IS, through what mechanism it works and what distinguishes it — never repeat the term as its own explanation."))
        : check("noStubDefinition", "green", "Tavtologik ta’riflar", "Har ta’rif mazmunli"),
    );
  }

  return out;
}

/* ══════════════════════════ keys ══════════════════════════ */

function keysChecks(doc: AcademicDoc, model: KeysModel, spec: KeysTypeSpec): ReviewCheck[] {
  const out: ReviewCheck[] = [];
  const cases = model.cases;
  const label = (i: number) => `Keys ${i + 1}`;
  const target = (i: number) => (sectionOf(doc, `case${i + 1}`) ? `case${i + 1}` : "intro");

  /* ── 1. caseCount ── */
  {
    const lo = spec.limits.cases[0];
    const hi = spec.limits.cases[spec.limits.cases.length - 1];
    const d = `${cases.length} ta (tur uchun ${lo}–${hi})`;
    out.push(cases.length >= lo && cases.length <= hi ? check("caseCount", "green", "Keyslar soni", d) : check("caseCount", cases.length < lo ? "red" : "yellow", "Keyslar soni", d));
  }

  /* ── 2. hasQuestions ── */
  {
    const bad = cases.map((c, i) => (c.questions.length < TEACHER_LIMITS.caseQuestionsMin ? label(i) : "")).filter(Boolean);
    out.push(
      bad.length
        ? check("hasQuestions", "red", "Topshiriqlar", `Kamida ${TEACHER_LIMITS.caseQuestionsMin} ta kerak — ${list(bad)}`, rewrite(target(0), `Add tasks so that this case has ${TEACHER_LIMITS.caseQuestionsMin}–${TEACHER_LIMITS.caseQuestionsMax} questions, each answerable only from this case's own facts.`))
        : check("hasQuestions", "green", "Topshiriqlar", `Har keysda ≥${TEACHER_LIMITS.caseQuestionsMin} topshiriq`),
    );
  }

  /* ── 3. hasSolution ── */
  {
    const bad = cases.map((c, i) => (clean(c.solution).length < 40 ? label(i) : "")).filter(Boolean);
    out.push(
      bad.length
        ? check("hasSolution", "red", "Namunaviy kalit", `Bo‘sh yoki juda qisqa: ${list(bad)}`, rewrite(target(0), "Write the model answer: resolve each task with reasoning based on the situation's facts; do not retell the situation."))
        : check("hasSolution", "green", "Namunaviy kalit", "Har keysda kalit bor"),
    );
  }

  /* ── 4. rubricSum ── */
  {
    const bad = cases
      .map((c, i) => {
        const sum = sumOf(c.rubric.map((r) => r.points));
        return c.rubric.length < TEACHER_LIMITS.rubricMin || sum !== TEACHER_LIMITS.rubricTotal ? `${label(i)} (${c.rubric.length} mezon, ${sum} ball)` : "";
      })
      .filter(Boolean);
    out.push(
      bad.length
        ? check("rubricSum", "red", "Rubrika ballari", `Jami ${TEACHER_LIMITS.rubricTotal} bo‘lishi kerak: ${list(bad)}`, rewrite("rubric", `Rewrite the rubric: ${TEACHER_LIMITS.rubricMin}–${TEACHER_LIMITS.rubricMax} criteria specific to that case, points adding up to exactly ${TEACHER_LIMITS.rubricTotal}.`))
        : check("rubricSum", "green", "Rubrika ballari", `Har rubrika ${TEACHER_LIMITS.rubricTotal} ball`),
    );
  }

  /* ── 5. situationLength ── */
  {
    const bad = cases.map((c, i) => (clean(c.situation).length < TEACHER_LIMITS.situationCharsMin ? label(i) : "")).filter(Boolean);
    out.push(
      bad.length
        ? check("situationLength", "yellow", "Vaziyat hajmi", `≥${TEACHER_LIMITS.situationCharsMin} belgi kerak — ${list(bad)}`, rewrite(target(0), `Expand the situation to at least ${TEACHER_LIMITS.situationCharsMin} characters: name the participants and their roles, the setting and the concrete facts the tasks rely on.`))
        : check("situationLength", "green", "Vaziyat hajmi", "Barcha vaziyatlar yetarli"),
    );
  }

  /* ── 6. realism ── */
  {
    const bad = cases.map((c, i) => (hasRealisticDetail(c.situation) ? "" : label(i))).filter(Boolean);
    out.push(
      bad.length
        ? check("realism", bad.length > cases.length / 2 ? "red" : "yellow", "Vaziyat aniqligi", `Ism/rol/son yo‘q: ${list(bad)}`, rewrite(target(0), "Make the situation concrete: give the participants names and roles and add the numbers the tasks need. It stays a fictional teaching case — do not name real organisations or cite real statistics."))
        : check("realism", "green", "Vaziyat aniqligi", "Har vaziyatda aniq rol va kontekst bor"),
    );
  }

  /* ── 7. noDuplicateCase ── */
  {
    const seen = new Set<string>();
    const dup: string[] = [];
    cases.forEach((c, i) => {
      const k = caseKey(c.title, c.situation);
      if (seen.has(k)) dup.push(label(i));
      else seen.add(k);
    });
    out.push(dup.length ? check("noDuplicateCase", "red", "Takror keyslar", list(dup), rewrite(target(0), "Replace this case with a different situation of the same topic — another role, another setting and different facts.")) : check("noDuplicateCase", "green", "Takror keyslar", "Keyslar bir-birini takrorlamaydi"));
  }

  return out;
}

/* ══════════════════════════ qoidalar ══════════════════════════ */

export function teacherRuleChecks(doc: AcademicDoc): ReviewCheck[] {
  const model = doc.teacher;
  if (!model) return [check("structure", "red", "Tuzilma", "Eski hujjat — tayyorlik hisoboti uchun qaytadan yarating")];
  const spec = specOf(model);
  if (model.kind === "lesson" && model.lesson) return lessonChecks(doc, model.lesson, spec as LessonTypeSpec);
  if (model.kind === "map" && model.map) return mapChecks(doc, model.map);
  if (model.kind === "glossary" && model.glossary) return glossaryChecks(doc, model.glossary, spec as GlossaryTypeSpec);
  if (model.kind === "keys" && model.keys) return keysChecks(doc, model.keys, spec as KeysTypeSpec);
  return [check("structure", "red", "Tuzilma", `«${model.kind}» modeli hujjatda yo‘q`)];
}

/** Kindning qoida id lari — reyestr bilan MOS ekanini test qulflaydi. */
export function teacherRuleIdsOf(kind: TeacherKind): readonly string[] {
  return TEACHER_RULE_IDS[kind];
}

/* ══════════════════════════ baholovchi ══════════════════════════ */

function judgeSpecOf(model: TeacherModel): JudgeSpec<string> {
  return specOf(model).judge as JudgeSpec<string>;
}

export function teacherJudgeSystemPrompt(model: TeacherModel, sectionIds: string[]): string {
  return judgeSystemPromptFor(judgeSpecOf(model), sectionIds);
}

export function parseTeacherJudge(model: TeacherModel, raw: string | null | undefined, sectionIds: string[]): TeacherJudgeResult | null {
  return parseJudgeFor(judgeSpecOf(model), raw, sectionIds);
}

export function neutralTeacherJudge(model: TeacherModel): TeacherJudgeResult {
  return neutralJudgeFor(judgeSpecOf(model));
}

export function teacherJudgeChecks(model: TeacherModel, j: TeacherJudgeResult): ReviewCheck[] {
  return judgeChecksFor(judgeSpecOf(model), j);
}

export function scoreTeacherReview(rules: ReviewCheck[], model: TeacherModel, j: TeacherJudgeResult): number {
  return scoreReviewFor(rules, j, judgeSpecOf(model).criteria);
}

/**
 * Baholovchiga beriladigan matn: shapka, tur, va bo'limlar mutanosib
 * kesilgan holda. Jadval ham KIRADI — xaritada hujjatning butun
 * mazmuni jadvalda, uni tashlab yuborish baholovchini ko'r qilardi.
 */
export function teacherJudgeUserPrompt(doc: AcademicDoc, maxChars = JUDGE_TEXT_CHARS): string {
  const model = doc.teacher;
  const groups = doc.sections
    .filter((s) => s.blocks.length)
    .map((s) => ({ id: s.id, title: s.title, lines: s.blocks.map((b) => b.text) }));
  for (const [i, t] of (doc.tables ?? []).entries()) {
    groups.push({
      id: tableTarget(i),
      title: t.caption ?? "",
      lines: [t.headers.join(" | "), ...t.rows.map((r) => r.join(" | "))],
    });
  }
  const body = sampleForJudge(groups, maxChars)
    .map((g) => `## ${g.id} — ${g.title}\n${g.text}${g.truncated ? "\n[…truncated]" : ""}`)
    .join("\n\n");
  const school = model?.school;
  return [
    `TOOL: ${model?.kind ?? "?"} · TYPE: ${model?.type ?? "?"}`,
    `SUBJECT: ${school?.subject ?? doc.meta.subject} · GRADE: ${(school?.grade ?? doc.meta.grade) || "—"} · LANGUAGE: ${school?.language ?? doc.meta.language}`,
    `TOPIC: ${doc.meta.topic}`,
    "",
    "DOCUMENT:",
    body,
  ].join("\n");
}

/* ══════════════════════════ asosiy ══════════════════════════ */

/** Baholovchi nishonlari: matnli bo'limlar + jadvallar. */
export function teacherTargets(doc: AcademicDoc): string[] {
  return [...doc.sections.filter((s) => s.blocks.length).map((s) => s.id), ...(doc.tables ?? []).map((_, i) => tableTarget(i))];
}

export async function reviewTeacher(doc: AcademicDoc, opts: TeacherReviewOpts = {}): Promise<DocReview> {
  const now = opts.now ?? new Date();
  const model = doc.teacher;
  const rules = teacherRuleChecks(doc);

  let judge: TeacherJudgeResult | null = null;
  const judgeNotes: string[] = [];
  if (model && opts.judge !== false && opts.complete) {
    const timeoutMs = Math.min(JUDGE_TIMEOUT_MS, remainingMs(opts.deadline));
    if (timeoutMs >= JUDGE_MIN_MS) {
      const ids = teacherTargets(doc);
      try {
        const r = await opts.complete("judge", teacherJudgeSystemPrompt(model, ids), teacherJudgeUserPrompt(doc), { json: true, maxTokens: 1200, timeoutMs });
        if (r?.usage) opts.onUsage?.(r.usage);
        judge = parseTeacherJudge(model, r?.text, ids);
      } catch (e) {
        console.warn("[teacher] baholovchi xatosi:", e instanceof Error ? e.message : e);
      }
    }
    if (!judge) judgeNotes.push(JUDGE_NO_ANSWER);
  }

  const j = judge ?? (model ? neutralTeacherJudge(model) : EMPTY_JUDGE);
  judgeNotes.push(...j.notes);

  return {
    score: model ? scoreTeacherReview(rules, model, j) : 0,
    checks: [...rules, ...(model ? teacherJudgeChecks(model, j) : [])],
    judgeNotes,
    // Bu oilada manba ro'yxati yo'q — ko'rsatkichlar 0 (panel ularni ko'rsatmaydi).
    verifiedShare: 0,
    recentShare: 0,
    builtAt: now.toISOString(),
  };
}

/** Matn hajmi — sinovlar va panel uchun (bo'sh hujjatni ajratish). */
export const teacherDocChars = (doc: AcademicDoc): number => docText(doc).length;
