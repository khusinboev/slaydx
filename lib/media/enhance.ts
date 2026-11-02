/**
 * Studio «Yaxshilash (AI)» (docs/studio/P2B-SPEC.md): ONE cheap LLM call that rewrites the user's picture prompt into a
 * richer one in the SAME language; the result is shown in the prompt box for the user to edit before anything is
 * charged. Free, rate-limited per user (`lib/server/spend.ts` endpoint `enhance`). Pure prompt + parser here; the route
 * is `app/api/media/enhance/route.ts`.
 */

/** Shortest prompt worth rewriting, and the Studio prompt limit (IMAGE_PROMPT_LIMIT). */
export const ENHANCE_MIN = 3;
export const ENHANCE_MAX = 500;

export function enhanceSystemPrompt(): string {
  return [
    "You improve prompts for a text-to-image model.",
    "Rewrite the user's idea as ONE richer prompt in THE SAME LANGUAGE the user wrote (Uzbek stays Uzbek, Russian stays Russian).",
    "Keep the subject and every detail the user named; add concrete visual details: setting, lighting, composition, camera angle, colours, mood.",
    "Keep any text inside quotes exactly as written. Do not add real people's names, brands or logos the user did not ask for.",
    `At most ${ENHANCE_MAX} characters. Output JSON only: {"prompt":"..."}.`,
  ].join(" ");
}

export function enhanceUserPrompt(prompt: string): string {
  return `Prompt: «${prompt}»`;
}

/** The rewritten prompt from the model's answer (whitespace collapsed, clipped), `null` when unusable. */
export function parseEnhanced(text: unknown): string | null {
  if (typeof text !== "string") return null;
  let value: unknown = null;
  try {
    const m = /\{[\s\S]*\}/.exec(text);
    value = m ? (JSON.parse(m[0]) as { prompt?: unknown }).prompt : null;
  } catch {
    value = null;
  }
  if (typeof value !== "string") return null;
  const out = value.replace(/\s+/g, " ").trim().slice(0, ENHANCE_MAX);
  return out.length >= ENHANCE_MIN ? out : null;
}
