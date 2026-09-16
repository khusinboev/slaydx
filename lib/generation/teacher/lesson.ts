/**
 * DARS REJASI YOZUVCHISI (AUDIT-20 WP-A).
 *
 * `write-specials.ts lessonDoc` ning o'rnini bosadi. Farqlar reja
 * bo'yicha (R1 §3–§4):
 *   • maqsad ENDI UCHTA (ta'limiy / tarbiyaviy / rivojlantiruvchi) —
 *     eski versiya bitta `goal` satri berardi, holbuki rasmiy
 *     ishlanmada uchlik majburiy;
 *   • bosqichda o'qituvchi va O'QUVCHI ustuni ajratildi (`teacher`/
 *     `student`) — «o'quvchi tinglaydi» yozilgan bosqich hisobotda
 *     ko'rinadi;
 *   • `method` (interaktiv usul) va `competencies` — formadan yoki
 *     modeldan; `assessmentStyle=bsb` bo'lsa alohida `assessment`
 *     bo'limi qo'shiladi (parametrning STRUKTURAVIY ta'siri);
 *   • daqiqa yig'indisi `duration` ga QAT'IY teng (`normalizeMinutes`,
 *     o'zgarmagan qoida).
 *
 * Sifat darvozasi: bosqichlarning hech biri mavzuga bog'lanmagan VA
 * hammasi qisqa bo'lsa — `null` (hujjat chiqmaydi, chaqiruvchi eski
 * yo'lga tushadi). Eski `lessonDoc` dagi shu shart saqlanadi.
 */
import type { Block, DocSection, DocTable } from "../types";
import { remainingMs } from "../quality";
import { TEACHER_LIMITS, type LessonModel, type LessonStage } from "./types";
import type { LessonTypeSpec } from "./registry";
import { lessonUserPrompt, type TeacherContext } from "./prompts";
import { clip, isGenericActivity, listOf, mentionsTopic, normalizeMinutes, sumOf } from "./guard";
import { teacherJson, type TeacherAsk, type TeacherWriter, type TeacherWritten } from "./engine";

const CALL_MS = 60_000;
const RETRY_MS = 40_000;

type RawStage = { title?: unknown; minutes?: unknown; teacher?: unknown; student?: unknown; activity?: unknown; method?: unknown; result?: unknown };

type LessonJson = {
  goal?: { talim?: unknown; tarbiya?: unknown; rivoj?: unknown } | unknown;
  competencies?: unknown;
  equipment?: unknown;
  tools?: unknown;
  stages?: unknown;
  homework?: unknown;
  assessment?: unknown;
};

const goalPart = (v: unknown, fallback: string): string => clip(v, 400) || fallback;

/**
 * Model bosqichlari -> `LessonStage[]`.
 *
 * `activity` (eski bitta ustun) ham qabul qilinadi: model ba'zan eski
 * sxemani qaytaradi, va o'shanda uni O'QITUVCHI ustuniga qo'yish
 * ma'lumotni yo'qotmaydi — tashlab yuborish esa bosqichni bo'shatardi.
 */
function stagesOf(raw: unknown[], want: number, duration: number): LessonStage[] {
  const picked = raw
    .filter((x): x is RawStage => Boolean(x) && typeof x === "object")
    .slice(0, Math.min(want, TEACHER_LIMITS.stagesMax));
  if (!picked.length) return [];
  const minutes = normalizeMinutes(picked.map((s) => s.minutes), duration);
  return picked.map((s, i) => ({
    title: clip(s.title, 80) || `${i + 1}`,
    minutes: minutes[i],
    teacher: clip(s.teacher ?? s.activity, 700),
    student: clip(s.student, 500),
    method: clip(s.method, 80),
    result: clip(s.result, 140),
  }));
}

/** Bosqich bloklari — sarlavha, o'qituvchi, o'quvchi, metod. */
function stageBlocks(ctx: TeacherContext, stages: readonly LessonStage[]): Block[] {
  const L = ctx.labels;
  const out: Block[] = [];
  stages.forEach((st, i) => {
    out.push({ kind: "h3", text: `${i + 1}. ${st.title} (${st.minutes} ${L.minutesShort})` });
    if (st.teacher) out.push({ kind: "p", text: st.teacher });
    if (st.student) out.push({ kind: "p", text: st.student });
    if (st.method) out.push({ kind: "p", text: `${L.stage}: ${st.method}` });
  });
  return out;
}

export const writeLesson: TeacherWriter = async (ctx, ask, o) => {
  const spec = ctx.spec as LessonTypeSpec;
  const i = ctx.input;
  const user = lessonUserPrompt(ctx);
  const maxTokens = Math.min(6000, 1400 + i.stageCount * 320);

  const call = async (timeoutMs: number) => teacherJson<LessonJson>(await askWith(ask, user, maxTokens, timeoutMs));
  let data = await call(Math.min(CALL_MS, remainingMs(o.deadline)));
  let stages = stagesOf(listOf(data as Record<string, unknown> | null, "stages"), i.stageCount, i.duration);
  /*
   * Bitta qayta urinish. Eski `writeLessonWithLlm` da ham shu bor edi va
   * jonli sinovda ishlagan: model yuk ostida bo'sh JSON qaytaradi, 40 s
   * lik ikkinchi so'rov esa odatda o'tadi.
   */
  if (stages.length < spec.limits.stages[0] && remainingMs(o.deadline) > 12_000) {
    o.stage(30, "Qayta urinilmoqda");
    data = await call(Math.min(RETRY_MS, remainingMs(o.deadline)));
    stages = stagesOf(listOf(data as Record<string, unknown> | null, "stages"), i.stageCount, i.duration);
  }
  if (!stages.length) return null;

  /*
   * Sifat darvozasi (eski `lessonDoc:120` shartining aniqroq shakli):
   * birorta bosqich mavzuga bog'lanmagan VA hammasi qisqa bo'lsa —
   * bu har qanday mavzuga mos «bo'sh» ishlanma, uni yetkazib bo'lmaydi.
   */
  const grounded = stages.some((st) => mentionsTopic(`${st.title} ${st.teacher} ${st.student}`, i.topic));
  if (!grounded && stages.every((st) => isGenericActivity(st.teacher))) {
    console.warn("[teacher] dars rejasi: bosqichlar mavzuga bog'lanmagan");
    return null;
  }

  o.stage(55, `Bosqichlar: ${stages.length} ta, ${sumOf(stages.map((s) => s.minutes))} ${ctx.labels.minutesShort}`);

  const L = ctx.labels;
  const obj = (data?.goal ?? {}) as { talim?: unknown; tarbiya?: unknown; rivoj?: unknown };
  const goal = {
    talim: goalPart(obj.talim, L.goalFallback(i.topic)),
    tarbiya: goalPart(obj.tarbiya, ""),
    rivoj: goalPart(obj.rivoj, ""),
  };
  /*
   * Formadagi kompetensiyalar USTUN: foydalanuvchi ularni DTS
   * ro'yxatidan tanlaydi, model esa o'zinikini o'ylab topishi mumkin.
   * Tanlanmagan bo'lsa modelniki olinadi (`competencyTagged` bandi
   * shundan keyin matnda aks etganini tekshiradi).
   */
  const competencies = (i.competencies.length ? i.competencies : listOf(data as Record<string, unknown> | null, "competencies").map((c) => clip(c, 120)))
    .filter(Boolean)
    .slice(0, TEACHER_LIMITS.competenciesMax);
  const equipment = listOf(data as Record<string, unknown> | null, "equipment", "tools")
    .map((e) => clip(e, 120))
    .filter(Boolean)
    .slice(0, TEACHER_LIMITS.equipmentMax);
  const homework = clip(data?.homework, 500) || L.homeworkFallback(i.topic);
  const assessment = clip(data?.assessment, 700);

  const model: LessonModel = {
    type: i.type,
    goal,
    competencies,
    equipment: equipment.length ? equipment : [L.equipmentFallback],
    stages,
    homework,
    assessment,
    durationMin: i.duration,
  };

  /* ── bo'limlar: id lar SHARTNOMA (WP-C `planTeacher`) ── */
  const passport: Block[] = [
    {
      kind: "p",
      text: [
        `${L.fieldSubject}: ${i.subject}`,
        i.grade > 0 ? `${L.fieldGrade}: ${i.grade}${i.gradeLetter ? `-${i.gradeLetter}` : ""}` : "",
        `${L.fieldDuration}: ${i.duration} ${L.minutesShort}`,
      ]
        .filter(Boolean)
        .join(". ") + ".",
    },
    { kind: "p", text: `${L.fieldTopic}: ${i.topic}` },
  ];
  if (model.competencies.length) {
    passport.push({ kind: "h3", text: L.competencies });
    for (const c of model.competencies) passport.push({ kind: "li", text: c });
  }
  passport.push({ kind: "h3", text: L.equipment });
  for (const e of model.equipment) passport.push({ kind: "li", text: e });

  const goalBlocks: Block[] = [
    { kind: "p", text: `${L.goalTalim}: ${goal.talim}` },
    ...(goal.tarbiya ? [{ kind: "p" as const, text: `${L.goalTarbiya}: ${goal.tarbiya}` }] : []),
    ...(goal.rivoj ? [{ kind: "p" as const, text: `${L.goalRivoj}: ${goal.rivoj}` }] : []),
  ];

  const sections: DocSection[] = [
    { id: "passport", title: L.lessonPassport, blocks: passport },
    { id: "goal", title: L.goal, blocks: goalBlocks },
    { id: "stages", title: L.stages, blocks: stageBlocks(ctx, stages) },
    { id: "homework", title: L.homework, blocks: [{ kind: "p", text: homework }] },
  ];
  /*
   * `assessment` bo'limi — turning skeleti talab qilsa (nazorat/amaliy)
   * yoki `assessmentStyle=bsb` tanlansa. Ya'ni parametr HUJJAT
   * SKELETINI o'zgartiradi, prompt qatorini emas («bezak maydon yo'q»).
   */
  const wantAssessment = spec.skeleton.some((s) => /baholash/i.test(s)) || i.assessmentStyle === "bsb";
  if (wantAssessment && assessment) sections.push({ id: "assessment", title: L.assessment, blocks: [{ kind: "p", text: assessment }] });

  /*
   * Vaqt jadvali bosqichlardan KEYIN (langar `stages`): o'qituvchi
   * darsni jadval bilan olib boradi. «Faoliyat» ustuni ATAYIN yo'q
   * (AUDIT-6 B5) — u yuqoridagi to'liq matnning kesilgan takrori edi.
   */
  const table: DocTable = {
    caption: L.timeTable,
    anchor: "stages",
    widths: [42, 13, 45],
    headers: [...L.timeCols],
    rows: stages.map((st) => [clip(st.title, 44), String(st.minutes), clip(st.result, 110)]),
  };

  const out: TeacherWritten = { sections, tables: [table], model: { lesson: model } };
  return out;
};

/** `ask` ni bitta joyda o'raymiz — yozuvchilar `role` ni takrorlamasin. */
function askWith(ask: TeacherAsk, user: string, maxTokens: number, timeoutMs: number) {
  return ask("writer", user, { maxTokens, timeoutMs });
}
