/**
 * Studio's entry points outside its own page (docs/studio/P1-SPEC.md «Entry»): the large card on the home hub and the
 * first place in the Media group. Plain data, no React: the hub, the catalogue and their tests read it.
 */
export const STUDIO_ENTRY = {
  id: "studio",
  href: "/uz/studio",
  title: "Studio",
  /** Key of `TOOL_ICONS`. */
  icon: "sparkles",
  /** `r g b` tint, as `ToolConfig.tc`. */
  tc: "234 88 12", // = the studio-image tool tint (lib/tools.ts)
} as const;

/** The tool whose route is the Studio page. */
export const STUDIO_TOOL_SLUG = "studio";

/** A group's tools with Studio first (a stable move: the others keep their order). */
export function studioFirst<T extends { slug: string }>(tools: readonly T[]): T[] {
  return [...tools.filter((t) => t.slug === STUDIO_TOOL_SLUG), ...tools.filter((t) => t.slug !== STUDIO_TOOL_SLUG)];
}
