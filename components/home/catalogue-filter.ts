import type { ToolConfig, ToolGroup } from "@/lib/types";

/** Group chip id: a tool group or «all». */
export type CatalogueGroup = ToolGroup | "all";

/** Lower-case and unify the apostrophe look-alikes used in Uzbek copy (ʻ ’ ‘ `). */
export function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/[ʻ’‘`´]/g, "'").replace(/\s+/g, " ").trim();
}

/**
 * Tools shown on `/uz/create` for a group chip and a search string: a tool
 * matches when its title or description contains EVERY word of the query
 * (apostrophe-insensitive) and belongs to the chosen group. Tool ids,
 * routes and prices are never touched here.
 */
export function filterCatalogue(
  tools: readonly ToolConfig[],
  group: CatalogueGroup,
  query: string,
): ToolConfig[] {
  const words = normalizeQuery(query).split(" ").filter(Boolean);
  return tools.filter((t) => {
    if (group !== "all" && t.group !== group) return false;
    if (!words.length) return true;
    const hay = normalizeQuery(`${t.title} ${t.description}`);
    return words.every((w) => hay.includes(w));
  });
}
