import type { SlideTemplateId, SlideVisual } from "./slide-templates";

export const SLIDE_LAYOUTS = [
  "title",
  "agenda",
  "section",
  "bullets",
  "twoCol",
  "compare",
  "quote",
  "stats",
  "process",
  "closing",
] as const;

export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];

export type SlideStat = { value: string; label: string };
export type SlideStep = { n: string; title: string; text: string };

export type SlideModel = {
  id: string;
  layout: SlideLayout;
  kicker?: string;
  title: string;
  subtitle?: string;
  bullets?: string[];
  leftTitle?: string;
  left?: string[];
  rightTitle?: string;
  right?: string[];
  quote?: string;
  quoteBy?: string;
  stats?: SlideStat[];
  steps?: SlideStep[];
  footer?: string;
  imageHint?: string;
  image?: { url: string; alt?: string };
};

export type SlideDeck = {
  topic: string;
  author: string;
  workLabel: string;
  themeId: SlideThemeId;
  templateId: SlideTemplateId;
  visual: SlideVisual;
  slides: SlideModel[];
};

export const SLIDE_THEME_IDS = [
  "atlas",
  "lumen",
  "graphite",
  "parchment",
  "orbit",
  "clinic",
  "forge",
  "grove",
  "summit",
  "ink",
  "slate",
  "sakura",
  "legal",
  "aurora",
  "chalk",
] as const;

export type SlideThemeId = (typeof SLIDE_THEME_IDS)[number];

export type SlideChrome = "bar-left" | "bar-top" | "split" | "frame" | "block";

export type SlideThemeGroup = "akademik" | "talim" | "stem" | "biznes" | "ijodiy" | "minimal";

export type SlideTheme = {
  id: SlideThemeId;
  name: string;
  nameUz: string;
  group: SlideThemeGroup;
  blurb: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  titleBg: string;
  titleText: string;
  titleMuted: string;
  chrome: SlideChrome;
  darkContent: boolean;
};

export function isSlideThemeId(v: string): v is SlideThemeId {
  return (SLIDE_THEME_IDS as readonly string[]).includes(v);
}

export function isSlideLayout(v: string): v is SlideLayout {
  return (SLIDE_LAYOUTS as readonly string[]).includes(v);
}
