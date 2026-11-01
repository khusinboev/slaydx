import { normalize, validate, type ClientEntry, type ParamSchema } from "@/lib/studio-core";

/**
 * Form state of the Studio is a bag of RAW values keyed by the model's param names (`prompt` is the text exactly as
 * typed). What goes out — price, request, displayed settings — is always `normalize(entry.params, raw)` of the chosen
 * model, so a value the model does not accept can never be sent or priced (docs/studio/P0-SPEC.md §3.2).
 */
export type RawValues = Record<string, unknown>;

/** The one text param the prompt box draws. Any other text param of a model gets its own row. */
export const PROMPT_PARAM = "prompt";

export function promptParam(entry: ClientEntry): Extract<ParamSchema, { type: "text" }> | null {
  const p = entry.params.find((x) => x.name === PROMPT_PARAM);
  return p && p.type === "text" ? p : null;
}

/** Longest prompt the model takes (the schema's `max`); the box and its counter use it. */
export function promptLimit(entry: ClientEntry): number {
  return promptParam(entry)?.max ?? 2000;
}

export function promptMin(entry: ClientEntry): number {
  return promptParam(entry)?.min ?? 1;
}

/**
 * The values to keep when the user switches to another model: every value the new model still accepts. The prompt
 * always stays (cut to the new limit); a setting the new model does not know, or accepts differently (a ratio it
 * lacks), falls back to the new model's default instead of being carried over.
 */
export function carryOver(to: ClientEntry, prev: RawValues): RawValues {
  const next: RawValues = {};
  for (const p of to.params) {
    if (!(p.name in prev)) continue;
    const v = prev[p.name];
    if (p.type === "text") next[p.name] = typeof v === "string" ? v.slice(0, p.max) : v;
    else if (validate([p], { [p.name]: v }) === null) next[p.name] = v;
  }
  return next;
}

/** What the user sees and what is priced: the model's normalized values of the raw state. */
export function effective(entry: ClientEntry, raw: RawValues): Record<string, unknown> {
  return { ...normalize(entry.params, raw) };
}

/**
 * The request values: exactly `{ modelId }` + the chosen model's ParamSchema (contract, docs/studio/P1-SPEC.md).
 * `prompt` goes out normalized (whitespace runs collapsed, trimmed), as the server will read it anyway.
 */
export function requestValues(entry: ClientEntry, raw: RawValues): Record<string, unknown> {
  return { modelId: entry.id, ...normalize(entry.params, raw) };
}

/** The text of the prompt the server will read (what the minimum length is judged on). */
export function normalizedPrompt(entry: ClientEntry, raw: RawValues): string {
  const p = effective(entry, raw)[PROMPT_PARAM];
  return typeof p === "string" ? p : "";
}
