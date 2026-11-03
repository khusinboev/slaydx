/**
 * Studio P8b (docs/studio/P8-SPEC.md «P8b»): the old «Podkast» and «Tabriknoma» tools as «Tayyor shablonlar» of the
 * Studio «Ovoz» tab while the dark switch `studio.legacy_fold` is on. Navigation and placement only: each template is
 * the EXISTING tool (same tool id, same composer, same engine, same `priceFor`, same result page).
 *
 * Pure and client-safe: the page redirect, the Studio page and the gallery all read these lists.
 */

/** The tools folded into the «Ovoz» tab as templates, in the row's order. */
export const VOICE_TEMPLATE_TOOLS = ["podcast", "greeting"] as const;
export type VoiceTemplateId = (typeof VOICE_TEMPLATE_TOOLS)[number];

export function isVoiceTemplate(v: unknown): v is VoiceTemplateId {
  return typeof v === "string" && (VOICE_TEMPLATE_TOOLS as readonly string[]).includes(v);
}

/** The template a Studio link asks for (`/uz/studio?tab=ovoz&template=podcast`); only on the «Ovoz» tab, else `null`. */
export function voiceTemplateFromSearch(search: string): VoiceTemplateId | null {
  const q = new URLSearchParams(search);
  if (q.get("tab") !== "ovoz") return null;
  const t = q.get("template");
  return isVoiceTemplate(t) ? t : null;
}

/**
 * Where `/uz/podcast` / `/uz/greeting` lead while the switch is on: the «Ovoz» tab with the template open. Every other
 * query parameter of the old link is kept (a bot `?bt=` sign-in, for one); `tab` / `template` are ours.
 */
export function voiceFoldPath(id: VoiceTemplateId, query: Readonly<Record<string, string | string[] | undefined>> = {}): string {
  const out = new URLSearchParams();
  out.set("tab", "ovoz");
  out.set("template", id);
  for (const [k, v] of Object.entries(query)) {
    if (k === "tab" || k === "template" || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) out.append(k, one);
  }
  return `/uz/studio?${out.toString()}`;
}
