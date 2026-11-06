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

/**
 * What `carryOver(to, prev)` silently drops or changes when the user switches from `from` to `to` (docs/studio/P11-SPEC.md
 * §D): every setting the user had set away from `from`'s default that `to` lacks, or does not accept (then it takes `to`'s
 * default). The prompt, images and voices are not settings of this kind (the tabs keep or re-ask them themselves).
 */
export function switchChanges(from: ClientEntry, to: ClientEntry, prev: RawValues): SwitchChange[] {
  const out: SwitchChange[] = [];
  for (const p of from.params) {
    if (p.type === "text" || p.type === "image" || p.type === "voice") continue;
    if (!(p.name in prev)) continue;
    const v = prev[p.name];
    // Untouched (still the old model's default): nothing the user chose is lost.
    if (v === undefined || v === null || v === "" || normalize([p], { [p.name]: v })[p.name] === p.default) continue;
    const q = to.params.find((x) => x.name === p.name);
    if (!q) {
      out.push({ name: p.name, label: p.label, from: shownValue(p, v), to: null });
      continue;
    }
    if (q.type === "text" || q.type === "image" || q.type === "voice") continue;
    if (validate([q], { [q.name]: v }) !== null) out.push({ name: p.name, label: p.label, from: shownValue(p, v), to: shownValue(q, q.default) });
  }
  return out;
}

/** Each change as the notice words it: «Sifat 1080p → 720p», «Oxirgi kadr (…) bu modelda yo‘q». */
export function switchParts(from: ClientEntry, to: ClientEntry, prev: RawValues): string[] {
  return switchChanges(from, to, prev).map((c) => (c.to === null ? `${c.label} (${c.from}) bu modelda yo‘q` : `${c.label} ${c.from} → ${c.to}`));
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
