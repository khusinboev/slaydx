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

/**
 * The «AI yaxshilash» switch in the request values (docs/studio/P11-SPEC.md «G»), beside the model's ParamSchema: it changes no
 * price. Absent = a job from before the switch or from another client, which keeps its old prompt path.
 */
export const AI_IMPROVE_PARAM = "aiImprove";

export function aiImproveOf(values: Readonly<Record<string, unknown>>): boolean | null {
  const v = values[AI_IMPROVE_PARAM];
  return typeof v === "boolean" ? v : null;
}

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
  const out = clipWords(value.replace(/\s+/g, " ").trim(), ENHANCE_OUTPUT_MAX[kind]);
  return out.length >= ENHANCE_MIN ? out : null;
}

/** At most `max` characters, cut at a word end. */
function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).trimEnd();
}

/** A model's prompt limits, as its ParamSchema states them. */
export type PromptLimit = { min: number; max: number; maxBytes?: number };

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/**
 * A rewrite within the chosen model's limits, cut at a word end. A cut that loses text the user quoted, or leaves too little,
 * gives the user's own prompt back: the route already accepted that one for this model.
 */
export function fitPrompt(rewrite: string, own: string, limit: PromptLimit): string {
  let out = clipWords(rewrite, limit.max);
  if (limit.maxBytes !== undefined) {
    while (utf8Bytes(out) > limit.maxBytes) {
      const end = out.lastIndexOf(" ");
      if (end < 1) return own;
      out = out.slice(0, end).trimEnd();
    }
  }
  if (out.length < Math.max(limit.min, ENHANCE_MIN)) return own;
  return quotedTexts(own).every((q) => out.includes(q)) ? out : own;
}

/**
 * A music prompt that carries the song's words: section tags, or a label in front of them. There is no lyrics field, so users
 * paste them into the box, and lyrics are never rewritten.
 */
export function looksLikeLyrics(prompt: string): boolean {
  return /\[\s*(verse|chorus|bridge|hook|intro|outro|naqorat|naqarot|band|куплет|припев)[^\]]*\]/i.test(prompt) || /(lyrics|so[''ʻ‘]?zlari|qo[''ʻ‘]?shiq matni|текст песни|слова песни)\s*:/i.test(prompt);
}

/** The user's quoted text, in straight, curly or guillemet quotes. */
export function quotedTexts(prompt: string): string[] {
  return [...prompt.matchAll(/"([^"]+)"|“([^”]+)”|«([^»]+)»/g)].map((m) => (m[1] ?? m[2] ?? m[3])!.trim()).filter(Boolean);
}

/**
 * The model is told to keep quoted text verbatim; this makes it certain. Quoted text the rewrite lost or translated is
 * put back at its end, the rewrite giving way to it. A quote that cannot fit leaves the rewrite as it is.
 */
export function restoreQuoted(input: string, output: string, kind: EnhanceKind = "image"): string {
  const missing = quotedTexts(input).filter((q) => !output.includes(q));
  if (missing.length === 0) return output;
  const tail = missing.map((q) => `"${q}"`).join(" ");
  const room = ENHANCE_OUTPUT_MAX[kind] - tail.length - 1;
  if (room < ENHANCE_MIN) return output;
  return `${clipWords(output, room)} ${tail}`;
}
