import type { PromptLimit } from "../../media/enhance";
import type { CatalogEntry } from "../../studio-core";

/** The `prompt` param's limits; an entry without one takes nothing, so nothing fits. */
export function promptLimitOf(entry: Pick<CatalogEntry, "params">): PromptLimit {
  const p = entry.params.find((x) => x.name === "prompt");
  return p?.type === "text" ? { min: p.min, max: p.max, ...(p.maxBytes === undefined ? {} : { maxBytes: p.maxBytes }) } : { min: 0, max: 0 };
}
