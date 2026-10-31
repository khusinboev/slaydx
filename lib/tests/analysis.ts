/**
 * «Test ishlash» -- the AI analysis of the wrong answers (owner 2026-10-31): the prompt, the response schema and the
 * parser. Pure (no I/O); `lib/server/test-analysis.ts` makes the call, caches and serves the result.
 *
 * One model call per question and answer key explains the correct option AND every other option, so one cached row
 * answers every user whatever they chose.
 */
import { LETTERS, letterOf } from "./rules";

/** Longest explanation kept (the model is asked for 2-4 sentences; a runaway answer is clipped at a word boundary). */
export const ANALYSIS_TEXT_MAX = 1200;
export const ANALYSIS_WHY_MAX = 600;

export const ANALYSIS_SYSTEM = [
  "Sen O‘zbekistondagi abituriyent testlari (DTM / BMB) bo‘yicha tajribali o‘qituvchisan.",
  "Senga test savoli (rasm yoki matn) va uning TO‘G‘RI javobi beriladi. To‘g‘ri javobni o‘zgartirma va unga shubha bildirma.",
  "Vazifang: o‘quvchiga qisqa va tushunarli tushuntirish yozish.",
  "1) `correct`: to‘g‘ri javob nega to‘g‘ri — 2-4 gap, asosiy qoida yoki yechim qadamlari bilan (matematikada hisob-kitobni qisqa ko‘rsat).",
  "2) `options`: to‘g‘ri javobdan BOSHQA har bir variant (harfi bilan) nega noto‘g‘ri — har biri 1-2 gap, odatiy xatoni nomla.",
  "Variantlar rasm ichida bo‘lsa, ularni rasmdan o‘qi. Formulalarni oddiy matnda yoz (masalan x^2, √3, 1/2), LaTeX va Markdown ishlatma.",
  "Faqat o‘zbek tilida (lotin yozuvi), faqat JSON qaytar.",
].join("\n");

/** Gemini `responseSchema` (OpenAPI subset). */
export const ANALYSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    correct: { type: "STRING" },
    options: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { letter: { type: "STRING", enum: [...LETTERS] }, why: { type: "STRING" } },
        required: ["letter", "why"],
      },
    },
  },
  required: ["correct", "options"],
} as const;

export type AnalysisStem = { subject: string; text: string | null; options: string[] | null; hasImage: boolean };

/** The user part of the prompt (the image, when there is one, is sent next to it inline). */
export function analysisUser(stem: AnalysisStem, correct: number): string {
  const lines = [`Fan: ${stem.subject}`];
  if (stem.hasImage) lines.push("Savol rasmda berilgan (variantlar ham rasmda bo‘lishi mumkin).");
  if (stem.text) lines.push(`Savol: ${stem.text}`);
  if (stem.options) stem.options.forEach((o, i) => lines.push(`${letterOf(i)}) ${o}`));
  lines.push(`To‘g‘ri javob: ${letterOf(correct)}.`);
  const others = LETTERS.filter((_, i) => i !== correct).join(", ");
  lines.push(`Har bir boshqa variant (${others}) nega noto‘g‘ri ekanini ham yoz.`);
  return lines.join("\n");
}

export type ParsedAnalysis = { explanation: string; wrong: Record<string, string> };

function clip(s: string, max: number): string {
  const v = s.replace(/[ \t]+/g, " ").trim();
  if (v.length <= max) return v;
  const cut = v.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/**
 * The model's JSON -> the stored shape, or `null` when it is unusable: the explanation must be there and EVERY option
 * other than the correct one must have its reason (the row is shared by all users, whatever they chose).
 */
export function parseAnalysis(raw: unknown, correct: number): ParsedAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { correct?: unknown; options?: unknown };
  if (typeof r.correct !== "string" || !r.correct.trim()) return null;
  const wrong: Record<string, string> = {};
  if (Array.isArray(r.options)) {
    for (const o of r.options) {
      if (!o || typeof o !== "object") continue;
      const { letter, why } = o as { letter?: unknown; why?: unknown };
      const i = typeof letter === "string" ? LETTERS.indexOf(letter.trim().toUpperCase() as (typeof LETTERS)[number]) : -1;
      if (i < 0 || i === correct || typeof why !== "string" || !why.trim()) continue;
      wrong[String(i)] ??= clip(why, ANALYSIS_WHY_MAX);
    }
  }
  for (let i = 0; i < LETTERS.length; i++) if (i !== correct && !wrong[String(i)]) return null;
  return { explanation: clip(r.correct, ANALYSIS_TEXT_MAX), wrong };
}
