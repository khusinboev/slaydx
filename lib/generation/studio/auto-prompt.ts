/**
 * «AI yaxshilash» at generation time (docs/studio/P11-SPEC.md «G. Templates and automatic prompts»): the prompt of a Studio job
 * is translated to English and improved in the WORKER, right before the provider call, by the same system prompt and quote
 * rule as the «Yaxshilash (AI)» button. A slow LLM holds a job slot, never an HTTP request.
 *
 * The rewrite only ever adds: when the LLM fails, times out or answers nothing usable, the job goes on with the user's own
 * text, no failure and no refund. It is free for the user; its cost lands in the job's `cost_json`. It runs once per job,
 * however many times the job is claimed (`lib/server/media/prompt-rewrites.ts`). `free_llm.disabled` stops it.
 *
 * A provider that refuses the REWRITE on safety gets the user's own words once, on the same purchase: the user never saw the
 * text it refused. The engines do that; a clip only while the provider has not accepted the job (`submitStudioVideoJob`).
 *
 * Who calls it, and who does not: a drawing, a clip with a scene prompt, music and a sound effect. Never an image edit (the
 * improver adds lighting and composition, and an edit must change only what was asked), an avatar script, speech, dialogue,
 * a dub or a transcript: there the words are the product.
 */
import { ENHANCE_INPUT_MAX, ENHANCE_MIN, enhanceSystemPrompt, enhanceUserPrompt, fitPrompt, looksLikeLyrics, parseEnhanced, restoreQuoted, type EnhanceKind, type PromptLimit } from "../../media/enhance";
import { mediaContext } from "../../media/context";
import { complete } from "../llm-roles";

/** One attempt. */
const CALL_TIMEOUT_MS = 20_000;
/** The whole rewrite, fallback providers included: it must end before `REWRITE_WAIT_MS` of the store. */
const BUDGET_MS = 25_000;

export type AutoPromptInput = {
  kind: EnhanceKind;
  /** The user's prompt, normalized. */
  prompt: string;
  /** The chosen model's own limits. */
  limit: PromptLimit;
  /** What this path adds to the system prompt (`workerRewriteRule`). */
  rule?: string | null;
  /** The job, when not running inside a media context (the video submit). */
  generationId?: string;
  deadline?: number;
};

async function rewrite(kind: EnhanceKind, prompt: string, rule: string | null, deadline: number | undefined): Promise<string | null> {
  // The kill switch of the LLM calls nobody pays for separately (`lib/server/spend.ts`). Read here, not before the store: a
  // rewrite already made and paid for is still used by a re-claim.
  const { getSetting } = await import("../../server/settings");
  if (await getSetting("free_llm.disabled")) return null;
  const budget = Date.now() + BUDGET_MS;
  const r = await complete("fast", enhanceSystemPrompt(kind, rule), enhanceUserPrompt(prompt), {
    json: true,
    maxTokens: 600,
    timeoutMs: CALL_TIMEOUT_MS,
    noTimeoutRetry: true,
    deadline: deadline === undefined ? budget : Math.min(deadline, budget),
  });
  const out = parseEnhanced(r?.text, kind);
  return out ? restoreQuoted(prompt, out, kind) : null;
}

/** What the provider receives: the stored rewrite within the model's limits, else the user's own prompt. Never throws. */
export async function autoPrompt({ kind, prompt, limit, rule = null, generationId, deadline }: AutoPromptInput): Promise<string> {
  if (prompt.length < ENHANCE_MIN || prompt.length > ENHANCE_INPUT_MAX[kind]) return prompt;
  // Pasted lyrics are the product, and the box has no field of their own.
  if (kind === "music" && looksLikeLyrics(prompt)) return prompt;
  const id = generationId ?? mediaContext()?.generationId ?? null;
  try {
    const made = id
      ? await (await import("../../server/media/prompt-rewrites")).rewriteOnce(id, kind, () => rewrite(kind, prompt, rule, deadline), deadline === undefined ? {} : { deadline })
      : await rewrite(kind, prompt, rule, deadline);
    return made ? fitPrompt(made, prompt, limit) : prompt;
  } catch (e) {
    console.warn("[studio-prompt] rewrite skipped:", e instanceof Error ? e.message : e);
    return prompt;
  }
}
