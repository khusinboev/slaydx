/**
 * AUDIO AVTO-SAYQALI (AUDIT-22 WP-A) — `report/polish-core.ts` yadrosida.
 *
 *   planAudioPolish(review, doc) → tuzatiladigan bandlar → ≤1 fix
 *   runAudioPolish(doc, review)  → plan → qayta so'rov → qayta hisobot
 *                                  → ball `acceptDelta` (+1) dan ko'p
 *                                    OSHSA qabul
 *
 * NISHON BITTA (`script`) — `infographic/polish.ts` bilan ayni sabab:
 * suhbatdagi replikalar bir-biriga bog'liq (savol → javob → ko'prik) va
 * bittasini alohida qayta yozish keyingisini javobsiz qoldirardi.
 *
 * ⚠ AUDIODA QO'SHIMCHA XARAJAT BOR. Sayqal ssenariyni o'zgartirsa,
 * fayl QAYTA SINTEZ qilinishi kerak — ya'ni sayqal TTS pulini ikki
 * barobar qiladi. Shuning uchun sayqal dvigatelda SINTEZDAN OLDIN
 * chaqiriladi (`engine.ts` bosqichlari): matn tayyor bo'lgach bir marta
 * yaxshilanadi, so'ng BIR MARTA aytiladi. Bu `infographic` dan farqli
 * tartib va u ataylab shunday.
 *
 * Halollik chegarasi (Q-2) o'zgarmaydi: `needsUserData` filtri +
 * promptdagi taqiq — sayqal o'ylab topilgan raqam yoki shaxsiy
 * tafsilot QO'SHMAYDI.
 */
import type { AcademicDoc } from "../types";
import type { DocReview, ReviewGuardInput } from "../report/types";
import {
  POLISH_JUDGE_NOTE,
  POLISH_MAX_FIXES,
  POLISH_SKIP,
  REWRITE_TIMEOUT_MS,
  RewriteError,
  needsUserData,
  runPolishWith,
  type ApplyOpsResult,
  type Fix,
  type PolishPlan,
  type PolishSkip,
  type RunPolishResult,
} from "../report/polish-core";
import { parseLlmObject } from "../json";
import { remainingMs } from "../quality";
import type { LlmUsage } from "../llm-roles";
import type { CompleteFn } from "../research/pipeline";
import { AUDIO_LIMITS, type AudioLine } from "./types";
import { audioTypeOf } from "./registry";
import { audioCtx, audioRewritePrompt, audioSystemPrompt } from "./prompts";
import { audioInputFromValues, encodeAudioValues, normalizeScript, type AudioInput } from "./input";
import { SCRIPT_TARGET, audioJudgeChecks, neutralAudioJudge, recipientOf, reviewAudio, scoreAudioReview, type AudioJudgeResult, type AudioReviewOpts } from "./review";

export { POLISH_SKIP, RewriteError };
export type { PolishPlan, PolishSkip };

/** Q-3 qabul chegarasi — `infographic` bilan bir xil (+1): ssenariy qisqa. */
export const AUDIO_ACCEPT_DELTA = 1;

const RETRY_MSG = "Model javob bermadi — qayta urinib ko‘ring";

/** Sayqal op i: butun ssenariyni ALMASHTIRISH. */
export type AudioOp = { op: "setScript"; script: AudioLine[] };

/* ────────────────────────── kontekst ────────────────────────── */

/**
 * Dvigatel konteksti HUJJATDAN (forma qiymatlari endi yo'q) —
 * `infographicContextOf` naqshi.
 *
 * Daqiqa hujjatda YO'Q (`AudioModel` da `seconds` bor, lekin u
 * O'LCHANGAN uzunlik, va'da emas) — u `seconds` dan TIKLANADI. Nega
 * shunday: `durationWords` bandi sayqaldan keyin ham AYNI byudjetga
 * qarashi kerak, aks holda sayqal ballni qoida o'zgarishi hisobiga
 * «yaxshilab», hech nima tuzatmasdan qabul qilinardi.
 */
export function audioContextOf(doc: AcademicDoc, minutes?: number): { input: AudioInput; script: AudioLine[] } | null {
  const model = doc.audio;
  if (!model?.script?.length) return null;
  const mins = minutes ?? minutesOf(doc);
  const input = audioInputFromValues(model.kind, doc.meta, {
    topic: doc.meta.topic,
    language: model.language,
    durationMin: mins,
    extra: doc.meta.extra ?? "",
    ...(model.kind === "podcast" ? { podcastType: model.type, mode: "topic" } : { occasion: model.type, recipient: recipientOf(doc) }),
  });
  return { input, script: model.script };
}

/** Hujjatdagi VA'DA qilingan daqiqa — o'lchangan uzunlikdan yaxlitlanadi. */
export function minutesOf(doc: AcademicDoc): number {
  const model = doc.audio;
  if (!model) return 1;
  const list = model.kind === "podcast" ? AUDIO_LIMITS.podcastMinutes : AUDIO_LIMITS.greetingMinutes;
  const guess = model.seconds ? Math.round(model.seconds / 60) : Math.round(model.script.reduce((n, l) => n + l.text.split(/\s+/).length, 0) / AUDIO_LIMITS.wordsPerMinute);
  return list.includes(guess) ? guess : (list.find((m) => m >= guess) ?? list[list.length - 1]);
}

/* ────────────────────────── reja ────────────────────────── */

/**
 * Avtomatik TUZATILMAYDI:
 *   `addresseeNamed` (sariq) — «Kimga?» BO'SH bo'lsa, ismni sayqal
 *      o'ylab topolmaydi: bu FOYDALANUVCHI ma'lumoti (Q-2);
 *   `lineLength` — replika uzunligi `normalizeScript` da allaqachon
 *      jumla chegarasida bo'lingan; qolgan holat modelning javobi
 *      emas, hujjatning eski shakli.
 */
const NOT_FIXABLE = new Set(["lineLength"]);

export function planAudioPolish(review: DocReview, doc: AcademicDoc): PolishPlan {
  const skipped: PolishSkip[] = [];
  if (!doc.audio?.script?.length) return { fixes: [], skipped: [{ id: "legacy", reason: "manual" }] };

  const instructions: string[] = [];
  const add = (s: string) => {
    if (s && !instructions.includes(s)) instructions.push(s);
  };

  const rules = review.checks.filter((c) => !c.id.startsWith("judge:") && c.level !== "green");
  // Qizil avval — halollik va davomiylik bandlari birinchi navbatda.
  rules.sort((a, b) => (a.level === "red" ? 0 : 1) - (b.level === "red" ? 0 : 1));
  for (const c of rules) {
    if (NOT_FIXABLE.has(c.id)) {
      skipped.push({ id: c.id, reason: "manual" });
      continue;
    }
    if (!c.fix) {
      // Fix'siz sariq band — odatda FOYDALANUVCHI ma'lumoti yetishmasligi
      // («Kimga?» bo'sh, ovoz tasdiqlanmagan): sayqal uni yopa olmaydi.
      skipped.push({ id: c.id, reason: "user" });
      continue;
    }
    add(c.fix.instruction);
  }

  for (const c of review.checks) {
    if (!c.id.startsWith("judge:fix:") || !c.fix) continue;
    if (needsUserData(c.fix.instruction)) {
      skipped.push({ id: c.id, reason: "user" });
      continue;
    }
    add(c.fix.instruction);
  }

  if (!instructions.length) return { fixes: [], skipped };
  if (instructions.length > POLISH_MAX_FIXES) {
    skipped.push({ id: "extra", reason: "limit" });
    instructions.length = POLISH_MAX_FIXES;
  }
  // BITTA nishon = BITTA fix: ssenariy bo'linmaydi (fayl boshidagi izoh).
  return { fixes: [{ op: "rewrite", target: SCRIPT_TARGET, instruction: instructions.map((s, i) => `(${i + 1}) ${s}`).join(" ") }], skipped };
}

/* ────────────────────────── qayta yozish ────────────────────────── */

export type AudioRewriteDeps = { complete: CompleteFn; deadline?: number; onUsage?: (u: LlmUsage) => void; minutes?: number };

export async function rewriteAudioFix(doc: AcademicDoc, fix: Fix, deps: AudioRewriteDeps): Promise<AudioOp[]> {
  const ctx = audioContextOf(doc, deps.minutes);
  if (!ctx) throw new RewriteError("Eski hujjatda «Tuzatish» yo'q — qaytadan yarating", 409, "legacy");
  if (fix.target !== SCRIPT_TARGET) throw new RewriteError(`Nishon topilmadi: ${fix.target}`, 422, "target");

  const c = audioCtx(audioTypeOf(ctx.input.kind, ctx.input.type), ctx.input);
  const timeoutMs = Math.max(1, Math.min(REWRITE_TIMEOUT_MS, remainingMs(deps.deadline)));
  const r = await deps
    .complete("writer", audioSystemPrompt(c), audioRewritePrompt(c, ctx.script, [fix.instruction]), { json: true, maxTokens: 3000, timeoutMs })
    .catch(() => null);
  if (r?.usage) deps.onUsage?.(r.usage);
  const raw = parseLlmObject<Record<string, unknown>>(r?.text ?? "");
  if (!raw) throw new RewriteError(RETRY_MSG, 422, "llm");
  const next = normalizeScript(raw, ctx.input);
  if (!next) throw new RewriteError(RETRY_MSG, 422, "llm");
  /*
   * Ikki ovozli formatda ikkala rol ham QOLISHI shart: aks holda
   * qayta hisoblangan `speakerBalance` qizarib, sayqal hech qachon
   * qabul qilinmasdi — ya'ni chaqiruv puli behuda ketardi.
   */
  if (ctx.input.speakers >= 2 && new Set(next.map((l) => l.speaker)).size < 2) throw new RewriteError(RETRY_MSG, 422, "llm");
  return [{ op: "setScript", script: next }];
}

/* ────────────────────────── qo'llash ────────────────────────── */

export function applyAudioOps(doc: AcademicDoc, ops: AudioOp[]): ApplyOpsResult {
  if (!doc.audio) return { ok: false, error: "audio modeli yo'q" };
  let script = doc.audio.script;
  for (const op of ops) {
    if (op.op !== "setScript") return { ok: false, error: `noma'lum op: ${String((op as { op?: unknown }).op)}` };
    if (!op.script.length) return { ok: false, error: "bo'sh ssenariy" };
    script = op.script;
  }
  /*
   * `seconds` TASHLANADI: eski qiymat ESKI matnning o'lchangan
   * uzunligi edi, yangi matn boshqacha aytiladi. Uni qoldirish
   * `delivered` ni yolg'onga chiqarardi — dvigatel qayta sintezdan
   * keyin yangi qiymatni yozadi.
   */
  const { seconds: _drop, ...rest } = doc.audio;
  void _drop;
  return { ok: true, doc: { ...doc, audio: { ...rest, script } } };
}

/* ────────────────────────── ball ko'chirish ────────────────────────── */

/** Avvalgi hisobotdan baholovchi ballari — `judge:*` bandlaridan. */
export function audioJudgeFromReview(prev: DocReview | undefined, doc: AcademicDoc): AudioJudgeResult | null {
  const model = doc.audio;
  if (!prev || !model) return null;
  const j = neutralAudioJudge(model);
  const criteria = audioTypeOf(model.kind, model.type).judge.criteria as readonly string[];
  let any = false;
  for (const c of criteria) {
    const m = /^(\d)\/3$/.exec(prev.checks.find((x) => x.id === `judge:${c}`)?.detail ?? "");
    if (!m) continue;
    (j as Record<string, unknown>)[c] = Math.max(0, Math.min(3, Number(m[1])));
    any = true;
  }
  if (!any) return null;
  j.notes = prev.judgeNotes.filter((n) => n !== POLISH_JUDGE_NOTE);
  j.fixes = prev.checks.filter((x) => x.id.startsWith("judge:fix:") && x.fix).map((x) => ({ target: x.fix!.target, instruction: x.fix!.instruction }));
  return j;
}

/* ────────────────────────── run ────────────────────────── */

export type AudioPolishDeps = {
  complete: CompleteFn;
  deadline: number;
  now?: Date;
  judge?: boolean;
  guard?: ReviewGuardInput;
  onUsage?: (u: LlmUsage) => void;
  acceptDelta?: number;
  /** Formada so'ralgan daqiqa — hisobot sayqaldan keyin ham SHU byudjetni ko'rsin. */
  minutes?: number;
  /** Foydalanuvchi bergan matn — halollik bandi sayqaldan keyin ham ishlasin. */
  facts?: string;
  recipient?: string;
};

export type AudioPolishResult = RunPolishResult<AudioOp>;

export async function runAudioPolish(doc: AcademicDoc, review: DocReview, deps: AudioPolishDeps): Promise<AudioPolishResult> {
  const judge = deps.judge !== false;
  const now = deps.now ?? new Date();
  const complete: CompleteFn = async (role, system, user, o) => {
    const r = await deps.complete(role, system, user, o);
    if (r?.usage) deps.onUsage?.(r.usage);
    return r;
  };
  const reviewOpts: AudioReviewOpts = {
    complete,
    deadline: deps.deadline,
    judge,
    now,
    ...(deps.minutes !== undefined ? { minutes: deps.minutes } : {}),
    ...(deps.facts !== undefined ? { facts: deps.facts } : {}),
    ...(deps.recipient !== undefined ? { recipient: deps.recipient } : {}),
  };

  return runPolishWith<AudioOp, AudioJudgeResult>(doc, review, {
    deadline: deps.deadline,
    judge,
    now,
    guard: deps.guard,
    acceptDelta: deps.acceptDelta ?? AUDIO_ACCEPT_DELTA,
    plan: planAudioPolish,
    userNeeds: (r) => r.userNeeds ?? [],
    rewrite: async (d, fix, deadline) => ({
      ops: await rewriteAudioFix(d, fix, { complete, deadline, ...(deps.onUsage ? { onUsage: deps.onUsage } : {}), ...(deps.minutes !== undefined ? { minutes: deps.minutes } : {}) }),
      unresolved: [],
      rewrittenSections: [SCRIPT_TARGET],
    }),
    apply: applyAudioOps,
    review: (d) => reviewAudio(d, reviewOpts),
    judgeFromReview: (prev) => audioJudgeFromReview(prev, doc),
    rescore: (fresh, j) => {
      const model = doc.audio;
      if (!model) return fresh;
      const rules = fresh.checks.filter((c) => !c.id.startsWith("judge:"));
      return { ...fresh, score: scoreAudioReview(rules, model, j), checks: [...rules, ...audioJudgeChecks(model, j)], judgeNotes: [...j.notes, POLISH_JUDGE_NOTE] };
    },
  });
}

/** Forma qiymatlari — «Tuzatish» yo'li qoralamani tiklaganda. */
export { encodeAudioValues };
