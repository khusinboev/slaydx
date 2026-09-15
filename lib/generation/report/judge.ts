/**
 * BAHOLOVCHI (LLM `judge` roli) — NEYTRAL QATLAM (AUDIT-19 R0-A).
 *
 * Mezonlar ro'yxati, ta'riflari va yorliqlari `JudgeSpec` dan keladi:
 * maqola 6 mezon (novelty/chain/methods/comparison/overclaim/style),
 * kurs ishi 5 (logic/depth/style/aimMatch/originality), IELTS insho 4
 * (TR/CC/LR/GRA). Prompt matni, JSON sxemasi, javob tahlili va neytral
 * zaxira — bir marta shu yerda.
 *
 * Halollik chegarasi (AUDIT-18 Q-2) promptning «Fixes must be achievable…»
 * qatorida: baholovchi keltirilmagan tajriba tafsilotini so'ramasin —
 * aks holda qayta yozuvchi uni O'YLAB TOPADI (jonli sinovda shunday bo'ldi).
 */
import { parseLlmObject } from "../json";
import { languageDirective } from "../i18n";
import { check } from "./score";
import type { JudgeResult, JudgeSpec, ReviewCheck } from "./types";

/** Baholovchi javob bermaganda — neytral ball. */
export const JUDGE_NEUTRAL = 2;
/** Baholovchi javob bermaganda hisobot izohi (sayqal shu satrni taniydi). */
export const JUDGE_NO_ANSWER = "Baholovchi javob bermadi";
export const JUDGE_TIMEOUT_MS = 35_000;
/** Chaqiruvga shundan kam vaqt qolsa umuman urinilmaydi. */
export const JUDGE_MIN_MS = 8_000;

export const clampScore = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.round(n))) : JUDGE_NEUTRAL;
};

/** Shu turda BAHOLANADIGAN mezonlar (`spec.skip` chiqarilgan). */
export function judgeCriteriaOf<C extends string>(spec: JudgeSpec<C>): C[] {
  const skip = new Set<string>(spec.skip ?? []);
  return spec.criteria.filter((c) => !skip.has(c));
}

/**
 * Baholovchi tizim prompti. `extraTargets` — bo'lim id laridan tashqari
 * ruxsat etilgan nishonlar (masalan `keywords`); berilmasa faqat bo'limlar.
 */
export function judgeSystemPromptFor<C extends string>(spec: JudgeSpec<C>, sectionIds: string[], extraTargets: string[] = []): string {
  const criteria = judgeCriteriaOf(spec);
  const schema = criteria.map((c) => `"${c}":0-3`).join(",");
  const targets = [...sectionIds, ...extraTargets];
  return [
    `You are ${spec.roleLine ?? "a strict peer reviewer for an academic journal"}. Evaluate the manuscript${spec.typeLabel ? ` (${spec.typeNoun ?? "article type"}: ${spec.typeLabel})` : ""} and return ONLY a JSON object, no prose.`,
    "Score each criterion with an INTEGER 0–3 (3 = fully meets, 2 = mostly, 1 = weak, 0 = absent):",
    ...criteria.map((c) => `- ${c}: ${spec.describe[c]}`),
    "Then give up to 5 short, concrete notes (what exactly to improve, naming the section) and up to 5 fixes as {\"target\": <section id>, \"instruction\": <one-sentence rewrite instruction>}.",
    "Fixes must be achievable from the manuscript's own content and its cited sources: NEVER ask to add unreported experimental details (platform or tool names, statistical tests, p-values, sample parameters, measurements) — the rewriter cannot invent them; instead ask for structure, argument, comparison with cited sources, precision of claims, or an explicit statement of what was not reported.",
    `Allowed target ids: ${targets.join(", ")}.`,
    `JSON schema: {${schema},"notes":["…"],"fixes":[{"target":"…","instruction":"…"}]}`,
    "JSON keys and target ids stay exactly as given (English); the VALUES of notes and instruction follow the language rule below.",
    languageDirective("uz"),
  ].join("\n");
}

/**
 * Model javobi → `JudgeResult`; JSON emas → `null`. Noma'lum `target`
 * tashlanadi; `spec.skip` `skipped` ga ko'chadi (ballga kirmaydi).
 * Ballar BARCHA mezonlar bo'yicha o'qiladi (yo'g'i → neytral).
 */
export function parseJudgeFor<C extends string>(spec: JudgeSpec<C>, raw: string | null | undefined, sectionIds: string[], extraTargets: string[] = []): JudgeResult<C> | null {
  const j = parseLlmObject<Record<string, unknown>>(raw ?? "");
  if (!j) return null;
  const skipped = spec.skip?.length ? [...spec.skip] : undefined;
  const allowed = new Set([...sectionIds, ...extraTargets]);
  const notes = (Array.isArray(j.notes) ? j.notes : [])
    .map((n) => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 5);
  const fixes = (Array.isArray(j.fixes) ? j.fixes : [])
    .map((f) => {
      const o = f as { target?: unknown; instruction?: unknown } | null;
      const target = String(o?.target ?? "").trim();
      const instruction = String(o?.instruction ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      return allowed.has(target) && instruction ? { target, instruction } : null;
    })
    .filter((f): f is { target: string; instruction: string } => Boolean(f))
    .slice(0, 5);
  const scores = Object.fromEntries(spec.criteria.map((c) => [c, clampScore(j[c])])) as Record<C, number>;
  return { ...scores, notes, fixes, ...(skipped ? { skipped } : {}) };
}

/** Baholovchi javob bermadi — hamma mezon neytral. */
export function neutralJudgeFor<C extends string>(spec: JudgeSpec<C>): JudgeResult<C> {
  return { ...(Object.fromEntries(spec.criteria.map((c) => [c, JUDGE_NEUTRAL])) as Record<C, number>), notes: [], fixes: [] };
}

/** Baholovchi mezonlari → `ReviewCheck` (3 yashil, 2 sariq, ≤1 qizil) + tavsiyalar. */
export function judgeChecksFor<C extends string>(spec: JudgeSpec<C>, j: JudgeResult<C>): ReviewCheck[] {
  const skip = new Set<string>(j.skipped ?? []);
  const out: ReviewCheck[] = spec.criteria
    .filter((c) => !skip.has(c))
    .map((c) => check(`judge:${c}`, j[c] >= 3 ? "green" : j[c] === 2 ? "yellow" : "red", spec.labels[c], `${j[c]}/3`));
  j.fixes.forEach((f, i) => out.push(check(`judge:fix:${i + 1}`, "yellow", "Baholovchi tavsiyasi", `${f.target}: ${f.instruction}`, { op: "rewrite", target: f.target, instruction: f.instruction })));
  return out;
}
