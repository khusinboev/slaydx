/**
 * O'QITUVCHI VOSITALARI PROMPTLARI (AUDIT-20 WP-A) — `work/prompts.ts` naqshi.
 *
 * Ko'rsatmalar INGLIZCHA, birinchi qator `languageDirective`: tuzilma
 * qoidalarini (JSON sxemasi, daqiqa yig'indisi, ustun nomlari) model
 * inglizcha ko'rsatmada ishonchliroq bajaradi, chiqish tilini esa
 * birinchi qator qat'iy belgilaydi. Eski `prompts.ts` dagi to'rt
 * o'zbekcha prompt (`lessonSystemPrompt`, `glossarySystemPrompt`,
 * `keysSystemPrompt`, `mapSystemPrompt`) shu faylga ALMASHADI: ular
 * 4–6 qatorlik edi, tur farqi yo'q edi va halollik chegarasi faqat
 * dars rejasida yozilgan edi.
 *
 * HALOLLIK CHEGARASI endi TO'RTALASIDA (R1/R2 §4 xulosasi): darslik
 * sahifasi, bob raqami, dastur bandi, GOST/lug'at raqami, real tashkilot
 * nomi va real statistika O'YLAB TOPILMAYDI — faqat foydalanuvchi
 * bergani ishlatiladi. Bu qoida promptdan tashqari `polish.ts`
 * `teacherUserNeeds` da ham ko'rinadi: model bilmagan narsa hujjatga
 * uydirma bo'lib emas, «Sizdan kutiladi» bandi bo'lib tushadi.
 *
 * YORLIQLAR endi `i18n.ts` da (WP-F ko'chirdi): WP-A ularni vaqtincha
 * shu faylda (`EXTRA`) saqlagan edi, chunki `i18n.ts` boshqa paketning
 * egaligida turardi. `teacherLabels` shu yerda qoladi, chunki u
 * KONTEKST yig'uvchisi (`sectionLabels` + `teacherExtraLabels` + til
 * kodi), lekin QATORLARNING manbasi bitta — `i18n.ts`.
 */
import { languageDirective, sectionLabels, teacherExtraLabels, type SectionLabels, type TeacherExtraLabels } from "../i18n";
import { TEACHER_LIMITS } from "./types";
import type { TeacherKind } from "./types";
import type { TeacherTypeSpec } from "./registry";
import type { TeacherInput, TeacherLang } from "./input";
import type { DocMeta } from "../types";

/* ══════════════════════════ yorliqlar ══════════════════════════ */

/**
 * Yorliq qatorlari `i18n.ts` da — bu yerdan RE-EXPORT (bitta manba).
 * Eski chaqiruvchilar (`lesson.ts`, `map.ts`, `glossary.ts`, `keys.ts`)
 * turni shu fayldan import qiladi, shuning uchun nom saqlanadi.
 */
export type { TeacherExtraLabels } from "../i18n";

export type TeacherLabels = SectionLabels & TeacherExtraLabels & { lang: TeacherLang };

export function teacherLabels(language: string): TeacherLabels {
  const lang: TeacherLang = language === "ru" ? "ru" : language === "en" ? "en" : "uz";
  return { ...sectionLabels(lang), ...teacherExtraLabels(lang), lang };
}

/* ══════════════════════════ kontekst ══════════════════════════ */

/** Dvigatel bosqichlari o'rtasida uzatiladigan kontekst (`WorkContext` naqshi). */
export type TeacherContext = {
  kind: TeacherKind;
  spec: TeacherTypeSpec;
  input: TeacherInput;
  meta: DocMeta;
  labels: TeacherLabels;
  /** Dastur mavzulari (`lib/curriculum.ts pickTopics`) — ixtiyoriy. */
  curriculum: string[];
};

/* ══════════════════════════ bloklar ══════════════════════════ */

const KIND_NOUN: Record<TeacherKind, string> = {
  lesson: "lesson outline (dars ishlanmasi) for an Uzbek school teacher",
  map: "calendar-thematic plan (texnologik xarita) for an Uzbek school subject",
  glossary: "terminology glossary for an Uzbek school or university course",
  keys: "set of case-study tasks (keys) with model answers and grading rubrics",
  test: "test paper for an Uzbek school",
};

/**
 * Maktab konteksti — shapkaga tushadigan qatorlar. Model ularni MATN
 * ichida takrorlamasligi kerak (shapkani `layout.ts planTeacher` chizadi,
 * WP-C), lekin bilishi kerak: 3-sinf va 10-sinf uchun bir xil matn
 * yozilmasin.
 */
export function schoolBlock(ctx: TeacherContext): string {
  const i = ctx.input;
  const rows = [
    i.institution && `institution: ${i.institution}`,
    i.subject && `subject (fan): ${i.subject}`,
    i.grade > 0 && `grade: ${i.grade}${i.gradeLetter ? `-${i.gradeLetter}` : ""}`,
    i.grade === 0 && ctx.kind === "keys" && `audience: ${i.audience === "otm" ? "university students" : "senior school pupils"}`,
    i.date && `date: ${i.date}`,
    i.author && `prepared by: ${i.author}`,
    i.approver && `approved by (position): ${i.approver}`,
  ].filter(Boolean);
  return rows.length ? `CONTEXT (document header — do NOT repeat these lines inside the body text): ${rows.join("; ")}.` : "";
}

/**
 * Fayl rejimi bloki. `prompts.ts sourceBlock` dan farqi: u akademik
 * yozuvchi uchun («akademik uslubda qayta yozing»), bu esa o'quv
 * hujjati uchun — mavzular/atamalar MANBADAN olinadi.
 */
export function sourceBlock(meta: Pick<DocMeta, "sourceText">): string {
  const src = (meta.sourceText || "").trim().slice(0, TEACHER_LIMITS.sourceTextChars);
  if (!src) return "";
  return [
    "SOURCE DOCUMENT (uploaded by the teacher). Build the material from THIS text:",
    "— take the topics, terms, facts and examples from the source;",
    "— do NOT add a fact, number or date that is not in the source;",
    "— do not copy long passages verbatim — restate them for the pupils.",
    "--- SOURCE START ---",
    src,
    "--- SOURCE END ---",
  ].join("\n");
}

/**
 * O'quv dasturi mavzulari (`lib/curriculum.ts`) — dars rejasi va xarita
 * uchun IXTIYORIY. Mavzular RASMIY dasturdan, shuning uchun ular
 * «tavsiya» emas, BOG'LOVCHI ro'yxat: model o'z mavzusini o'ylab
 * topsa, xarita rasmiy dasturdan chetga chiqardi.
 */
export function curriculumBlock(topics: readonly string[]): string {
  if (!topics.length) return "";
  return [
    "OFFICIAL CURRICULUM TOPICS (from the state programme for this subject and grade — binding):",
    ...topics.map((t, i) => `  ${i + 1}. ${t}`),
    "Use these topic names as given; keep their order. Do not invent replacements and do not add textbook page numbers — the programme does not give them.",
  ].join("\n");
}

/* ══════════════════════════ tizim prompti ══════════════════════════ */

/**
 * Tizim prompti — kindning BARCHA yozuv chaqiruvlari uchun bitta.
 * Turga xos qoidalar «TYPE RULES» bo'limida (reyestr `guidance`).
 */
export function teacherSystemPrompt(ctx: TeacherContext): string {
  const { input, spec } = ctx;
  const lang = ctx.meta.language || input.language;
  const lines = [
    languageDirective(lang),
    `You are an experienced Uzbek school methodologist preparing a ${KIND_NOUN[ctx.kind]}.`,
    `Topic: «${input.topic}». Subject: ${input.subject || "infer from the topic"}.`,
    `Document type: ${spec.label.en} (${spec.id}).`,
    "RULES (strict):",
    "1. HONESTY: never invent a textbook page or chapter number, a curriculum clause number («Milliy o‘quv dasturi 47-band»), a standard or dictionary reference, an author name, a real organisation, a real person or a real statistic. If the teacher did not supply it, leave it out. Case situations are FICTIONAL and must not be presented as real events.",
    "2. CONCRETE: every line must be usable as written by a teacher of this subject and grade — a named activity, a real task, a checkable outcome. Generic sentences that would fit any topic («pupils consolidate their knowledge and skills») are rejected automatically.",
    `3. AUDIENCE: write for ${input.grade > 0 ? `grade ${input.grade}` : "the stated audience"} — vocabulary, task difficulty and time estimates must match it.`,
    "4. Uzbek school reality: the working language of the document is set above; methods, equipment and assessment must be things an ordinary Uzbek school actually has.",
    "5. Output: return ONLY the JSON requested — no markdown fences, no commentary, no explanation before or after.",
    `TYPE RULES (${spec.label.en}):`,
    ...spec.guidance.map((g, i) => `${i + 1}. ${g}`),
  ];
  if (input.extra) lines.push(`TEACHER'S ADDITIONAL REQUEST (follow it unless it conflicts with the rules above): ${input.extra}`);
  const school = schoolBlock(ctx);
  if (school) lines.push(school);
  const curriculum = curriculumBlock(ctx.curriculum);
  if (curriculum) lines.push(curriculum);
  const source = sourceBlock(ctx.meta);
  if (source) lines.push(source);
  return lines.filter(Boolean).join("\n");
}

/* ══════════════════════════ dars rejasi ══════════════════════════ */

export function lessonUserPrompt(ctx: TeacherContext): string {
  const i = ctx.input;
  const lines = [
    "Write the lesson outline. Return ONLY this JSON:",
    '{"goal":{"talim":"","tarbiya":"","rivoj":""},"competencies":[""],"equipment":[""],' +
      '"stages":[{"title":"","minutes":0,"teacher":"","student":"","method":"","result":""}],' +
      '"homework":"","assessment":""}',
    `Exactly ${i.stageCount} stages. The «minutes» values must add up to EXACTLY ${i.duration}.`,
    "goal: three separate objectives — talim (what the pupil will KNOW/BE ABLE TO DO), tarbiya (the value or attitude), rivoj (the thinking skill). One sentence each, all three about THIS topic.",
    i.competencies.length
      ? `competencies: the teacher selected these — use them verbatim and make sure the stages actually develop them: ${i.competencies.join("; ")}.`
      : `competencies: 2–${TEACHER_LIMITS.competenciesMax} competencies this lesson really develops (DTS wording), not a generic list.`,
    `equipment: up to ${TEACHER_LIMITS.equipmentMax} concrete items this exact lesson needs.`,
    "stages[].teacher: what the TEACHER does (2–3 sentences, naming the actual example, question, rule or exercise).",
    "stages[].student: what the PUPIL does — an observable action (solves, compares, writes, answers), never «listens».",
    "stages[].method: the interactive method used at this stage (e.g. «Brainstorming», «Pair work», «Venn diagram», «T-chart»); the methods across the lesson must differ.",
    "stages[].result: one short sentence (6–14 words) — what the pupil knows or can do at the end of THIS stage.",
    "homework: one concrete task a pupil of this grade can finish at home, following from the lesson goal.",
    i.assessmentStyle === "bsb"
      ? "assessment: criterion-based (BSB-style) — list the criteria with their point values, and state the total. Note that these are BSB-STYLE criteria written by the teacher, not the official assessment centre's materials."
      : "assessment: how the pupils' work in this lesson is graded (traditional 5-point scale) — name what exactly earns the mark.",
  ];
  return lines.filter(Boolean).join("\n");
}

/* ══════════════════════════ texnologik xarita ══════════════════════════ */

export type MapPart = {
  /** `choraklik` da chorak raqami (1..4), `yillik` da 0. */
  quarter: number;
  /** Shu bo'lakning birinchi haftasi (1 dan boshlanadi). */
  from: number;
  count: number;
};

export function mapUserPrompt(ctx: TeacherContext, part: MapPart, already: readonly string[]): string {
  const i = ctx.input;
  const to = part.from + part.count - 1;
  const lines = [
    "Fill in the calendar-thematic plan rows. Return ONLY this JSON:",
    '{"intro":"","weeks":[{"n":0,"topic":"","method":"","resources":"","result":"","control":""}]}',
    `Exactly ${part.count} rows, for weeks ${part.from}–${to}${part.quarter ? ` (quarter ${part.quarter} of 4)` : ""}.`,
    `Subject: ${i.subject}${i.grade > 0 ? `, grade ${i.grade}` : ""}. Weekly hours: ${i.weeklyHours}. Yearly total: ${i.totalHours} hours.`,
    'n: the week number (an integer from ' + part.from + " to " + to + ").",
    "topic: the real lesson topic for that week — never «Topic 1», «Mavzu 2» or a numbered placeholder.",
    "method: Ma’ruza / Amaliy mashg‘ulot / Laboratoriya / Mustaqil ish / Takror va nazorat — pick the one that fits the topic; vary them.",
    "resources: the teaching aids for that week (textbook section by NAME not page number, map, model, presentation, laboratory kit).",
    "result: 4–8 words specific to that topic — never «Tushuncha shakllanadi» or another all-purpose phrase.",
    i.controlLink === "bsb-chsb"
      ? "control: the assessment for that week, aligned with the BSB/ChSB rhythm — a BSB-style check at the end of each thematic block and a ChSB-style summary in the last week of the quarter; ordinary weeks get an oral or written check."
      : "control: the assessment for that week (Og‘zaki so‘rov / Yozma topshiriq / Amaliy ish / Test) — it must MATCH the topic and the method, not alternate mechanically.",
    "intro: one sentence introducing the plan (only for the first chunk; may be empty otherwise).",
    already.length ? `TOPICS ALREADY PLANNED — do NOT repeat them:\n${already.join("; ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/* ══════════════════════════ glossariy ══════════════════════════ */

export function glossaryUserPrompt(ctx: TeacherContext, count: number, already: readonly string[]): string {
  const i = ctx.input;
  const tri = i.translationLangs.length > 0;
  const lines = [
    "Write the glossary entries. Return ONLY this JSON:",
    `{"intro":"","terms":[{"term":"","def":""${i.includeExample ? ',"example":""' : ""}${tri ? ',"ru":"","en":""' : ""}}]}`,
    `${count} terms of «${i.topic}»${i.subject && i.subject !== i.topic ? ` (subject: ${i.subject})` : ""}${i.grade > 0 ? `, explained at grade ${i.grade} level` : ""}.`,
    `def: ${TEACHER_LIMITS.defCharsMin}–${TEACHER_LIMITS.defCharsMax} characters, one or two complete sentences saying what the thing IS and what distinguishes it. NEVER restate the term as its own explanation («Photosynthesis is a photosynthesis process» is rejected automatically).`,
    i.includeExample ? "example: one short sentence using the term in a real subject context — not a paraphrase of the definition." : "",
    tri ? `ru / en: the ESTABLISHED equivalent term used in this field's literature (single terms, not sentences). If a term genuinely has no accepted equivalent, leave the field empty rather than inventing one.` : "",
    "FORBIDDEN as entries (unless they are genuine technical terms of THIS subject): kompetensiya, mezon, metod, tahlil, sintez, innovatsiya, refleksiya, differensiatsiya, integratsiya, indikator, resurs.",
    "Do not cite dictionaries, standards or page numbers — you do not know them.",
    "intro: one or two sentences naming the scope of the glossary (only for the first chunk).",
    already.length ? `TERMS ALREADY WRITTEN — do NOT repeat them:\n${already.join(", ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/* ══════════════════════════ keys ══════════════════════════ */

export function keysUserPrompt(ctx: TeacherContext, count: number, already: readonly string[]): string {
  const i = ctx.input;
  const lines = [
    "Write the case-study tasks. Return ONLY this JSON:",
    '{"intro":"","cases":[{"title":"","situation":"","questions":[""],"solution":"","rubric":[{"criterion":"","points":0}]}]}',
    `${count} different cases about «${i.topic}», for ${i.audience === "otm" ? "university students" : "senior school pupils"}.`,
    `situation: ${TEACHER_LIMITS.situationCharsMin}–${TEACHER_LIMITS.situationCharsMax} characters. Give the participants NAMES and ROLES, a concrete setting and, where it helps, concrete numbers. «A company faced a problem» is rejected. The situation is INVENTED for teaching — never present it as a real event, real organisation or real statistic.`,
    `questions: ${TEACHER_LIMITS.caseQuestionsMin}–${TEACHER_LIMITS.caseQuestionsMax} tasks that can only be answered by using THIS situation's facts.`,
    "solution: the model answer — it resolves every task with reasoning, it does not retell the situation.",
    `rubric: ${TEACHER_LIMITS.rubricMin}–${TEACHER_LIMITS.rubricMax} criteria SPECIFIC to this case (never generic «correctness»/«clarity»); the points must add up to ${TEACHER_LIMITS.rubricTotal}.`,
    "intro: one or two sentences on how to run these cases in class (only for the first chunk).",
    already.length ? `CASE TITLES ALREADY WRITTEN — do NOT repeat them:\n${already.join("; ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/* ══════════════════════════ qayta yozish (sayqal) ══════════════════════════ */

/**
 * Sayqal/«Tuzatish» qayta yozish prompti — bo'limning HOZIRGI matni +
 * bitta ko'rsatma. Tuzilma (bosqich soni, daqiqa yig'indisi, ustunlar)
 * saqlanishi SHART: qayta yozilgan bo'lim boshqa bo'limlar bilan mos
 * qolishi kerak.
 */
export function teacherRewritePrompt(ctx: TeacherContext, title: string, current: string, instruction: string): string {
  return [
    `Rewrite the section «${title}» of this ${KIND_NOUN[ctx.kind]}.`,
    `INSTRUCTION: ${instruction}`,
    "Keep the same structure and the same number of items; change only what the instruction asks for. Do not add textbook pages, curriculum clause numbers or invented sources.",
    'Return ONLY this JSON: {"blocks":[{"kind":"p","text":""}]}  (allowed kinds: "p", "h3", "li").',
    "--- CURRENT TEXT ---",
    current,
    "--- END ---",
  ].join("\n");
}

/** Jadval qayta yozish — qatorlar soni va ustun soni O'ZGARMAYDI. */
export function teacherTableRewritePrompt(ctx: TeacherContext, headers: readonly string[], rows: readonly string[][], instruction: string): string {
  return [
    `Rewrite the table of this ${KIND_NOUN[ctx.kind]}.`,
    `INSTRUCTION: ${instruction}`,
    `Return EXACTLY ${rows.length} rows with EXACTLY ${headers.length} cells each — the row count and the column order must not change.`,
    `Columns: ${headers.join(" | ")}.`,
    'Return ONLY this JSON: {"rows":[["",""]]}',
    "--- CURRENT ROWS ---",
    rows.map((r) => r.join(" | ")).join("\n"),
    "--- END ---",
  ].join("\n");
}
