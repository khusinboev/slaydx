/**
 * Studio's entry points outside its own page (docs/studio/P1-SPEC.md «Entry»): the home banner slide and grid cell.
 * Plain data, no React: the hub and its tests read it.
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
