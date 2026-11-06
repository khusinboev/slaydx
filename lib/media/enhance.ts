/**
 * Studio «Yaxshilash (AI)» (docs/studio/P11-SPEC.md §B): ONE cheap LLM call that detects the language of the user's prompt
 * and rewrites it as a richer ENGLISH prompt for the media model; the result is shown in the prompt box for the user to
 * edit before anything is charged. Free, rate-limited per user (`lib/server/spend.ts` endpoint `enhance`). Pure prompt +
 * parser here; the route is `app/api/media/enhance/route.ts`.
 *
 * Speech text, dialogue, lyrics and avatar scripts are never rewritten: there the words themselves are the product.
 */

export const ENHANCE_KINDS = ["image", "video", "music", "sfx"] as const;
export type EnhanceKind = (typeof ENHANCE_KINDS)[number];

export const isEnhanceKind = (v: unknown): v is EnhanceKind => (ENHANCE_KINDS as readonly unknown[]).includes(v);

/** Shortest prompt worth rewriting. */
export const ENHANCE_MIN = 3;
/** Longest prompt of a kind: the tool's own prompt limit. */
export const ENHANCE_INPUT_MAX: Readonly<Record<EnhanceKind, number>> = { image: 500, video: 1000, music: 2000, sfx: 450 };
/** Longest rewrite of a kind, never above the shortest prompt limit of that kind's models. */
export const ENHANCE_OUTPUT_MAX: Readonly<Record<EnhanceKind, number>> = { image: 500, video: 1000, music: 1000, sfx: 300 };

const ROLE: Readonly<Record<EnhanceKind, string>> = {
  image: "You improve prompts for a text-to-image model. Add concrete visual details: setting, lighting, composition, camera angle, colours, mood.",
  video:
    "You improve prompts for a text-to-video model. Describe one continuous shot: the subject's action, camera movement, pacing, setting, lighting, mood.",
  music:
    "You improve prompts for a music generation model. Add genre, tempo, instruments, mood and song structure. If the user's language is not English and the song may have vocals, name that vocal language.",
  sfx: "You improve prompts for a sound effect model. Describe the sound source, the action, the space and acoustics, and the distance. Mention nothing visual.",
};

export function enhanceSystemPrompt(kind: EnhanceKind = "image"): string {
  return [
    ROLE[kind],
    "Detect the language the user wrote in, understand the idea, and write ONE richer prompt in ENGLISH, whatever the input language, even when the input is already good English.",
    "Keep the subject and every detail the user named.",
    "Text meant to be seen or heard stays verbatim in its own language inside double quotes: anything the user put in quotes, and any sign, caption or spoken line the user asked for. Never translate it.",
    "Do not add real people's names, brands or logos the user did not ask for.",
    `At most ${ENHANCE_OUTPUT_MAX[kind]} characters. Output JSON only: {"prompt":"..."}.`,
  ].join(" ");
}

export function enhanceUserPrompt(prompt: string): string {
  return `Prompt: «${prompt}»`;
}

/** The rewritten prompt from the model's answer (whitespace collapsed, clipped), `null` when unusable. */
export function parseEnhanced(text: unknown, kind: EnhanceKind = "image"): string | null {
  if (typeof text !== "string") return null;
  let value: unknown = null;
  try {
    const m = /\{[\s\S]*\}/.exec(text);
    value = m ? (JSON.parse(m[0]) as { prompt?: unknown }).prompt : null;
  } catch {
    value = null;
  }
  if (typeof value !== "string") return null;
  const out = value.replace(/\s+/g, " ").trim().slice(0, ENHANCE_OUTPUT_MAX[kind]);
  return out.length >= ENHANCE_MIN ? out : null;
}
