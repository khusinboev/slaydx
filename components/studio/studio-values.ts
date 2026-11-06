import { normalize, normalizeText, validate, type ClientEntry, type ParamSchema } from "@/lib/studio-core";
import { isAvatarModel } from "@/lib/media/catalog-video";

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

/** A prompt over a model's `maxBytes` (the provider counts UTF-8 bytes): what the box says before the click. */
export type PromptBytes = { used: number; max: number };

/**
 * The first of `entries` whose byte limit the prompt breaks, as the server will read it (normalized), `null` when it fits. The
 * same rule as `validate`, so the form and the server's 400 agree. Compare mode passes every ticked model.
 */
export function promptBytes(entries: readonly ClientEntry[], text: string): PromptBytes | null {
  for (const entry of entries) {
    const max = promptParam(entry)?.maxBytes;
    if (max === undefined) continue;
    const used = new TextEncoder().encode(normalizeText(text, promptLimit(entry))).length;
    if (used > max) return { used, max };
  }
  return null;
}

/** The refusal of a prompt over its byte limit (the note under the box, the submit's error). */
export const PROMPT_BYTES_MESSAGE = "Matn bu model uchun juda uzun — qisqartiring";

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

/** One setting a model switch could not keep: the new model lacks it (`to: null`) or takes another value (`to`). */
export type SwitchChange = { name: string; label: string; from: string; to: string | null };

/** A value as the notice names it: the option's label, «ha» / «yo‘q», the number. */
function shownValue(p: ParamSchema, v: unknown): string {
  switch (p.type) {
    case "enum":
      return p.options.find((o) => o.value === v)?.label ?? String(v);
    case "bool":
      return v === true || v === "true" ? "ha" : "yo‘q";
    default:
      return String(v);
  }
}

/** Lengths the server measures from the source: never a setting, so a notice never names them. */
const SERVER_SET_PARAMS: ReadonlySet<string> = new Set(["inputSeconds", "sourceSeconds"]);

/**
 * What a switch from `from` to `to` changes (docs/studio/P11-SPEC.md §D), by the EFFECTIVE values on both sides: a setting
 * both models have whose value differs after the switch, touched or not (one model's default of 5 s is another's 4 s, and
 * that changes the clip and its price); a setting `to` lacks, when it stood away from `from`'s default. The prompt, images
 * and voices are not settings of this kind (the tabs keep or re-ask them themselves).
 */
export function switchChanges(from: ClientEntry, to: ClientEntry, prev: RawValues): SwitchChange[] {
  const out: SwitchChange[] = [];
  const before = effective(from, prev);
  const after = effective(to, carryOver(to, prev));
  // An avatar's length follows its script or speech: no row of the form sets it.
  const avatar = isAvatarModel(from.id) || isAvatarModel(to.id);
  for (const p of from.params) {
    if (p.type === "text" || p.type === "image" || p.type === "voice" || SERVER_SET_PARAMS.has(p.name) || (avatar && p.name === "seconds")) continue;
    const v = before[p.name];
    const q = to.params.find((x) => x.name === p.name);
    if (!q) {
      // At the old model's default nothing the user chose is lost.
      if (v !== p.default) out.push({ name: p.name, label: p.label, from: shownValue(p, v), to: null });
      continue;
    }
    if (q.type === "text" || q.type === "image" || q.type === "voice") continue;
    if (String(v) !== String(after[q.name])) out.push({ name: p.name, label: p.label, from: shownValue(p, v), to: shownValue(q, after[q.name]) });
  }
  return out;
}

/** Each change as the notice words it: «Sifat 1080p → 720p», «Sifat: 1080p (Full HD) — bu modelda yo‘q». */
export function switchParts(from: ClientEntry, to: ClientEntry, prev: RawValues): string[] {
  return switchChanges(from, to, prev).map((c) => (c.to === null ? `${c.label}: ${c.from} — bu modelda yo‘q` : `${c.label} ${c.from} → ${c.to}`));
}

/** The one line of `parts` for a switch to `to`: «Kling 4.0 Flash: Sifat 1080p → 720p · …»; `null` with nothing to say. */
export function noticeLine(to: Pick<ClientEntry, "label">, parts: readonly string[]): string | null {
  return parts.length ? `${to.label}: ${parts.join(" · ")}` : null;
}

/** The one line the tab shows after a switch; `null` when the new model keeps every setting. */
export function switchNotice(from: ClientEntry, to: ClientEntry, prev: RawValues): string | null {
  return noticeLine(to, switchParts(from, to, prev));
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
  const out: Record<string, unknown> = { modelId: entry.id };
  // Form values travel as scalars (`lib/server/validate.ts sanitizeValues`): a list of asset ids (an `image` param, P2b)
  // goes out comma-separated, the form the ParamSchema reads back (`studio-core/params.ts idsOf`).
  for (const [k, v] of Object.entries(normalize(entry.params, raw))) out[k] = Array.isArray(v) ? v.join(",") : v;
  return out;
}

/** The text of the prompt the server will read (what the minimum length is judged on). */
export function normalizedPrompt(entry: ClientEntry, raw: RawValues): string {
  const p = effective(entry, raw)[PROMPT_PARAM];
  return typeof p === "string" ? p : "";
}
