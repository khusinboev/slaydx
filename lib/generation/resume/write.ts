/**
 * Rezyume DVIGATELI (Rezyume 2, AUDIT-15) — LLM chaqiruvi va birlashtirish.
 *
 * Bo'linish ataylab uch qismga:
 *   `resumeSystemPrompt` / `resumeUserPrompt` — nima so'raladi;
 *   `parseResumeLlm`                          — javob shakli;
 *   `mergeLlm`                                — nima QABUL qilinadi.
 * Uchalasi ham sof funksiya, ya'ni tarmoqsiz sinaladi; ilgari hammasi
 * `writeResumeWithLlm` ichida bir uyum bo'lib turar va faqat jonli
 * chaqiruv bilan tekshirilardi.
 *
 * Ko'rsatmalar INGLIZCHA (tarjima dvigateli bilan bir xil qaror,
 * `translate/prompts.ts`): tuzilma qoidalarini — id mosligi, JSON
 * sxemasi, VERBATIM ro'yxati — model inglizcha ko'rsatmada ancha
 * ishonchli bajaradi. Chiqish tilini birinchi qator, `languageDirective`,
 * qat'iy belgilaydi.
 */
import { llmComplete, llmEnabled } from "../llm";
import { parseLlmObject } from "../json";
import { languageDirective } from "../i18n";
import { remainingMs } from "../quality";
import type { AcademicDoc, DocMeta } from "../types";
import type { FormValues } from "../../types";
import {
  RESUME_LIMITS,
  docFromResume,
  hasCodeLabels,
  resumeLabels,
  sanitizeLabels,
  type ResumeBullet,
  type ResumeModel,
  type ResumeSkill,
} from "./model";
import { draftModel, resumeInputFromValues, type ResumeInput, type ResumePhotoInput, type ResumeTone } from "./input";
import { AI_BULLETS_PER_JOB, AI_SKILLS_MAX, guardResume, type GuardReport, type ResumeLlmOut } from "./guard";

/**
 * Uslub qatorlari — `prompts.ts` dan KO'CHIRILDI va inglizchaga
 * o'girildi. Ilgari o'zbekcha edi va o'zbekcha bo'lmagan chiqishda
 * modelni ikki tilga tortardi.
 */
export const RESUME_TONE: Record<ResumeTone, string> = {
  professional: "Tone: formal, confident, precise — standard corporate résumé register.",
  qisqa: "Tone: extremely terse — one idea per sentence, no adjectives, no filler openers.",
  ijodiy: "Tone: lively and distinctive while staying professional — avoid template phrases.",
};

/** Model qaytaradigan JSON sxemasi — promptda ham, testda ham bitta manba. */
export const RESUME_JSON_SCHEMA =
  '{"summary":"","headline":"","labels":{"summary":"","experience":"","education":"","certificates":"","languages":"","skills":"","links":"","contact":"","present":"","resume":""},' +
  '"experience":[{"id":"","role":"","bullets":[{"text":"","ai":false}]}],"education":[{"id":"","degree":""}],"skills":[{"text":"","ai":false}]}';

/**
 * QO'RIQCHIDAN KEYINGI qisqacha uzunligi shundan past bo'lsa javob
 * yaroqsiz — bir marta qat'iy qayta so'raladi.
 *
 * Darvoza ataylab qo'riqchidan KEYIN (jonli sinov, uz→en): model 240
 * belgi yozgan, qo'riqchi uydirma yilli bitta jumlani tashlagan va
 * natija 173 belgiga tushgan edi — eski darvoza (parse'dan keyin, 150)
 * buni umuman ko'rmasdi. Promptdagi pastki chegara ham shu sababdan
 * 250: model odatda pastki chegaraga yaqin yozadi, bitta jumla
 * tashlansa ham 220 dan yuqori qolishi kerak.
 */
export const MIN_SUMMARY_CHARS = 200;

/* ────────────────────────── promptlar ────────────────────────── */

export function resumeSystemPrompt(meta: DocMeta, input: ResumeInput): string {
  const headline = input.identity.headline || meta.topic || "the target role";
  const enrich = meta.enrich !== false;
  const wantLabels = !hasCodeLabels(meta.language);
  return [
    languageDirective(meta.language),
    `You are a senior résumé (CV) editor preparing a one-page, ATS-friendly résumé.`,
    `Target role: «${headline}».`,
    `Rules:`,
    `1. NEVER invent an employer, job title, date, degree, institution, certificate or language. Use ONLY the facts given below, keyed by "id", and keep them in the given id order.`,
    `2. VERBATIM — copy unchanged: the person's name, phone number, e-mail, URLs, every year and month, and organisation names written in the Latin script. Do not translate, expand or abbreviate them. Everything else — job titles, academic degrees, bullet text, skills, the summary — MUST be written in the output language, even when the facts below are given in another language.`,
    `3. Every bullet = action verb + scope + measurable result. Remove duplicates and merge overlapping bullets. At most ${RESUME_LIMITS.bullets} bullets per job, each at most ${RESUME_LIMITS.bulletChars} characters.`,
    `4. "summary" — between 250 and 700 characters, written for the target role «${headline}»; no first-person pronouns, no clichés like "hard-working team player".`,
    enrich
      ? `5. ENRICHMENT IS ON: for each job you MAY ADD at most ${AI_BULLETS_PER_JOB} extra bullets describing duties or outcomes that are typical for that exact job title, and at most ${AI_SKILLS_MAX} extra profession-relevant skills. Mark every added item with "ai": true. An added item must contain NO number, NO client or company name and NO date — it describes a typical responsibility, never a measured achievement.`
      : `5. ENRICHMENT IS OFF: add NOTHING. You may only rewrite, merge, shorten and reorder what the user wrote. Never output "ai": true.`,
    `6. Do not reorder the experience or education arrays by date — the application sorts them.`,
    wantLabels
      ? `7. "labels" — translate these section headings into the output language: summary, experience, education, certificates, languages, skills, links, contact, present, resume. Each at most 40 characters.`
      : `7. Do NOT return "labels" — the application already has them for this language.`,
    RESUME_TONE[input.tone] ?? RESUME_TONE.professional,
    input.extra ? `Extra request from the user: ${input.extra}` : "",
    `Return ONLY JSON: ${RESUME_JSON_SCHEMA}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Faktlar bloki — model ko'radigan YAGONA ma'lumot manbasi. */
function factsJson(input: ResumeInput): string {
  return JSON.stringify({
    identity: input.identity,
    contact: input.contact,
    about: input.about,
    experience: input.experience.map((e) => ({
      id: e.id,
      company: e.company,
      role: e.role,
      period: [e.start, e.end].filter(Boolean).join(" → "),
      bullets: e.bullets.map((b) => b.text),
    })),
    education: input.education.map((e) => ({ id: e.id, institution: e.institution, degree: e.degree, period: [e.start, e.end].filter(Boolean).join(" → ") })),
    certificates: input.certificates.map((c) => ({ id: c.id, name: c.name, issuer: c.issuer, year: c.year })),
    languages: input.languages.map((l) => ({ id: l.id, language: l.language, level: l.level })),
    skills: input.skills,
    links: input.links.map((k) => k.url),
  });
}

export function resumeUserPrompt(meta: DocMeta, input: ResumeInput): string {
  const expIds = input.experience.map((e) => e.id);
  const eduIds = input.education.map((e) => e.id);
  return [
    `Facts (JSON) — the only source of truth:`,
    factsJson(input),
    expIds.length ? `Return one experience entry for EACH of these ids, in this order: ${expIds.join(", ")}.` : `There is no work experience — return "experience": [].`,
    eduIds.length ? `Return one education entry for EACH of these ids, in this order: ${eduIds.join(", ")}.` : `There is no education — return "education": [].`,
    `Rewrite "role" only for wording; the company, the period, the institution, the certificate and the language rows are NOT yours to change and are not part of your answer.`,
    `Return ONLY JSON: ${RESUME_JSON_SCHEMA}`,
  ].join("\n");
}

/** Qayta urinishdagi qat'iyroq ko'rsatma (tarjima dvigatelidagi naqsh). */
export const RESUME_STRICT_SUFFIX =
  `\nThe previous answer was rejected: it was not valid JSON, or "summary" was shorter than ${MIN_SUMMARY_CHARS} characters` +
  ` once sentences with invented years or invented organisation names had been removed.` +
  ` Answer again with ONLY the JSON object, no prose, no markdown fence. "summary" must be at least 250 characters and must not` +
  ` mention any year or organisation that is absent from the facts.`;

/* ────────────────────────── javobni o'qish ────────────────────────── */

const s = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Model javobini `ResumeLlmOut` ga keltiradi.
 *
 * `input` va `meta` kerak, chunki javob bo'sh maydonlarni tashlab
 * ketishi odatiy: id lar kirishdan, sarlavha metadan to'ldiriladi.
 * `null` — javobda umuman obyekt yo'q (qayta urinish sababi).
 */
export function parseResumeLlm(raw: string | null | undefined, input: ResumeInput, meta: DocMeta): ResumeLlmOut | null {
  const data = parseLlmObject<Record<string, unknown>>(raw);
  if (!data) return null;
  const arr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x)) : [];

  const bullets = (v: unknown): { text: string; ai?: boolean }[] => {
    const out: { text: string; ai?: boolean }[] = [];
    if (!Array.isArray(v)) return out;
    for (const b of v) {
      if (typeof b === "string") {
        const t = s(b, RESUME_LIMITS.bulletChars);
        if (t) out.push({ text: t });
        continue;
      }
      const o = b && typeof b === "object" ? (b as Record<string, unknown>) : null;
      const t = s(o?.text, RESUME_LIMITS.bulletChars);
      if (t) out.push(o?.ai === true ? { text: t, ai: true } : { text: t });
    }
    return out;
  };

  const skills: { text: string; ai?: boolean }[] = [];
  if (Array.isArray(data.skills)) {
    for (const k of data.skills) {
      if (typeof k === "string") {
        const t = s(k, RESUME_LIMITS.skillChars);
        if (t) skills.push({ text: t });
        continue;
      }
      const o = k && typeof k === "object" ? (k as Record<string, unknown>) : null;
      const t = s(o?.text, RESUME_LIMITS.skillChars);
      if (t) skills.push(o?.ai === true ? { text: t, ai: true } : { text: t });
    }
  }

  return {
    summary: s(data.summary, RESUME_LIMITS.summaryChars),
    headline: s(data.headline, RESUME_LIMITS.headlineChars) || input.identity.headline || meta.topic || "",
    ...(data.labels && typeof data.labels === "object" && !Array.isArray(data.labels)
      ? { labels: data.labels as ResumeLlmOut["labels"] }
      : {}),
    experience: arr(data.experience).map((e, i) => ({
      id: s(e.id, 16) || input.experience[i]?.id || "",
      role: s(e.role, RESUME_LIMITS.fieldChars),
      bullets: bullets(e.bullets),
    })),
    education: arr(data.education).map((e, i) => ({
      id: s(e.id, 16) || input.education[i]?.id || "",
      degree: s(e.degree, RESUME_LIMITS.fieldChars),
    })),
    skills,
  };
}

/* ────────────────────────── birlashtirish ────────────────────────── */

/**
 * FAKT — kirishdan, MATN — modeldan.
 *
 * Kompaniya, sana, muassasa, sertifikat, til, havola, ism va kontakt
 * model javobiga UMUMAN qaramaydi: ular `draftModel` orqali kirishdan
 * keladi. Modeldan faqat `summary`, `headline` (kirish bo'sh bo'lsa),
 * id bo'yicha `role`, `bullets`, `skills` va yorliqlar olinadi.
 *
 * Tartiblash SHU YERDA (`sortDesc`) — model tartiblamaydi (prompt
 * 6-qoida), aks holda «hozir» ishlayotgan joy o'rtada qolib ketardi.
 */
export function mergeLlm(input: ResumeInput, out: ResumeLlmOut, meta: DocMeta, photo?: ResumePhotoInput): ResumeModel {
  const base = draftModel(meta, input, photo);
  const language = base.language;
  const roleById = new Map(out.experience.map((e) => [e.id, e]));
  const degreeById = new Map(out.education.map((e) => [e.id, e]));

  /*
   * Tartiblash BU YERDA EMAS — `draftModel` da (`sortDesc`), bitta
   * joyda. Model javobi sanaga TEGMAYDI (kompaniya va davr kirishdan),
   * shuning uchun birlashtirishdan keyin tartib o'zgara olmaydi va
   * ikkinchi `sortDesc` faqat o'lik kod bo'lardi: uni buzsa ham hech
   * bir test qizarmasdi (mutatsiya tekshiruvida aniqlandi).
   */
  let enriched = false;
  base.experience = base.experience.map((e) => {
    const row = roleById.get(e.id);
    if (!row) return e;
    const bullets: ResumeBullet[] = row.bullets.map((b) => (b.ai === true ? { text: b.text, ai: true } : { text: b.text }));
    if (bullets.some((b) => b.ai)) enriched = true;
    return { ...e, role: row.role || e.role, bullets: bullets.length ? bullets : e.bullets };
  });
  base.education = base.education.map((e) => ({ ...e, degree: degreeById.get(e.id)?.degree || e.degree }));

  if (out.summary) base.summary = out.summary;
  if (!input.identity.headline && out.headline) base.identity = { ...base.identity, headline: out.headline };
  if (out.skills.length) {
    base.skills = out.skills.map((k): ResumeSkill => (k.ai === true ? { text: k.text, ai: true } : { text: k.text }));
    if (base.skills.some((k) => k.ai)) enriched = true;
  }
  // uz/ru/en — kod yorliqlari (`resumeLabels`); boshqa til — modeldan,
  // yetishmagani inglizcha bilan to'ldiriladi (`sanitizeLabels`).
  base.labels = hasCodeLabels(language) ? resumeLabels(language) : sanitizeLabels(out.labels, language);
  base.enriched = enriched;
  return base;
}

/* ────────────────────────── chaqiruv ────────────────────────── */

export type ResumeBuildOpts = { photo?: ResumePhotoInput; deadline: number };
/** Testda LLM ni almashtirish uchun (tarjima dvigatelidagi naqsh). */
export type ResumeDeps = { complete?: typeof llmComplete; onReport?: (r: GuardReport) => void };

/** Chaqiruvga shundan kam vaqt qolsa umuman urinilmaydi — zaxira yo'li tezroq. */
const MIN_BUDGET_MS = 12_000;

/**
 * `values` → LLM → tekshirilgan model → `AcademicDoc`.
 *
 * `null` qaytishi XATO EMAS: chaqiruvchi (`write-llm.ts` → `index.ts`)
 * zaxira yo'liga (`content.ts` `resumeDoc` = `draftModel`) o'tadi.
 * Rezyumeda bu ayniqsa muhim — foydalanuvchi faktlarni O'ZI kiritgan,
 * ya'ni modelsiz ham to'liq hujjat chiqadi.
 */
export async function buildResumeDoc(
  meta: DocMeta,
  values: FormValues,
  opts: ResumeBuildOpts,
  deps: ResumeDeps = {},
): Promise<AcademicDoc | null> {
  const complete = deps.complete ?? llmComplete;
  if (!deps.complete && !llmEnabled()) return null;
  const input = resumeInputFromValues(values);
  const system = resumeSystemPrompt(meta, input);
  const user = resumeUserPrompt(meta, input);

  const budget = () => remainingMs(opts.deadline);
  if (budget() < MIN_BUDGET_MS) {
    console.warn("[resume] deadline yetmadi — zaxira modelga o'tildi");
    return null;
  }

  const ask = (u: string) => complete(system, u, 3200, { json: true, timeoutMs: Math.min(70_000, budget()) });
  const check = (raw: string | null) => {
    const parsed = parseResumeLlm(raw, input, meta);
    if (!parsed) return null;
    return { parsed, guarded: guardResume(input, parsed, { enrich: meta.enrich !== false, language: meta.language }) };
  };

  /*
   * Uzunlik darvozasi QO'RIQCHIDAN KEYIN o'lchanadi — u qisqachani
   * qisqartirishi mumkin (uydirma yilli jumla tashlanadi), ya'ni
   * parse'dan keyingi o'lchov haqiqiy natijani ko'rsatmaydi.
   */
  let best = check(await ask(user));
  if ((!best || best.guarded.out.summary.length < MIN_SUMMARY_CHARS) && budget() >= MIN_BUDGET_MS) {
    const why = !best
      ? "JSON buzuq"
      : `qisqacha ${best.guarded.out.summary.length} belgi (kerak ${MIN_SUMMARY_CHARS}); tashlangan jumlalar: ` +
        (best.guarded.report.summaryDrops.map((d) => `${d.reason} — «${d.text}»`).join(" | ") || "yo'q");
    console.warn(`[resume] javob yaroqsiz (${why}) — qat'iy qayta so'rov`);
    const retry = check(await ask(user + RESUME_STRICT_SUFFIX));
    if (retry && (!best || retry.guarded.out.summary.length > best.guarded.out.summary.length)) best = retry;
  }
  if (!best) return null;

  const guarded = best.guarded;
  deps.onReport?.(guarded.report);
  const r = guarded.report;
  if (r.unknownRows || r.revertedFields || r.droppedSentences || r.droppedBullets || r.strippedYears) {
    console.warn(
      `[resume] qo'riqchi: noma'lum qator ${r.unknownRows}, tiklangan ${r.restoredRows}, qaytarilgan maydon ${r.revertedFields}, ` +
        `yil tozalangan ${r.strippedYears}, band ${r.droppedBullets}, ko'nikma ${r.droppedSkills}, jumla ${r.droppedSentences}`,
    );
    for (const d of r.summaryDrops) console.warn(`[resume] qisqachadan tashlandi (${d.reason}): «${d.text}»`);
  }

  const model = mergeLlm(input, guarded.out, meta, opts.photo);
  // Qisqacha butunlay qirqilib ketgan bo'lsa (hamma jumla uydirma) —
  // deterministik matn xom bo'shliqdan yaxshiroq.
  if (!model.summary) model.summary = draftModel(meta, input, opts.photo).summary;
  return docFromResume(model, meta);
}
