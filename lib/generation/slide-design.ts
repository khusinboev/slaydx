/**
 * AUTO DESIGN (docs/slide-quality/SPEC.md §A) — which design (visual) and palette an «Avtomatik» deck gets.
 *
 * Before: the form sent `slideTemplate: "auto"` + `slideTheme: "atlas"`, `inferSlideTemplate` fell back to `lecture`
 * for almost every topic, so nearly every default deck was the `academic` design in the `atlas` palette — the
 * owner's «prezentatsiyalar bir xil» complaint.
 *
 * Now the CONTENT template (beats, audience, prompt roles) is still chosen as before (user → purpose → topic
 * inference), but when the user left the design on «Avtomatik»:
 *   1. the topic is scored against subject areas (`SUBJECT_AREAS`, a scored match, not first-regex-wins);
 *   2. the visual is drawn from the content template's pool of compatible designs (`DESIGN_POOL`), weighted by
 *      the areas' design affinity, with a per-generation seed (`DocMeta.slideSeed`);
 *   3. when the palette is «auto» too, it is drawn from the chosen visual's curated palettes (`VISUAL_PALETTES`,
 *      every pair checked on a rendered contact sheet), weighted by the areas' palette affinity, same seed.
 *
 * The result is persisted in the doc (`slideTemplate`, `slideVisual`, `slideTheme`, `meta.slideSeed`), so a
 * rebuild / edit of the same generation never re-rolls it (`buildSlideDeck` reads the pinned values).
 * Without a seed (old calls, tests, previews) the choice is the deterministic legacy one: the content template's
 * own visual and the best palette by affinity.
 *
 * Pure and client-safe: no server imports.
 */
import type { SlideTemplate, SlideTemplateId, SlideVisual } from "./slide-templates";
import { isSlideThemeId, type SlideThemeId } from "./slide-types";

/** Form / API value meaning «pick the palette for me». */
export const AUTO_THEME = "auto";
export type SlideThemeChoice = SlideThemeId | typeof AUTO_THEME;

export function isSlideThemeChoice(v: string): v is SlideThemeChoice {
  return v === AUTO_THEME || isSlideThemeId(v);
}

export type SubjectAreaId =
  | "nature"
  | "medicine"
  | "tech"
  | "economy"
  | "law"
  | "history"
  | "literature"
  | "pedagogy"
  | "art"
  | "sport"
  | "ecology"
  | "math";

type SubjectArea = {
  id: SubjectAreaId;
  /** Each matching stem adds 1 to the area's score (title words are lower-cased, apostrophes unified). */
  stems: RegExp[];
  /** Design affinity: visual → weight (visuals not listed weigh 1 when they are in the template's pool). */
  visuals: Partial<Record<SlideVisual, number>>;
  /** Palette affinity (each listed palette weighs 4 instead of 1). */
  palettes: SlideThemeId[];
};

/*
 * Stems are written for Uzbek Latin (with Russian/English twins for the most common words); `norm` maps every
 * apostrophe variant to «'» first. A stem matches inside a word (`fotosintez` in «fotosintezning»).
 */
export const SUBJECT_AREAS: readonly SubjectArea[] = [
  {
    id: "nature",
    stems: [/biolog/, /kimyo/, /fizika/, /fotosintez/, /hujayra/, /atom/, /molekul/, /o'simlik/, /hayvon/, /genetik/, /evolyutsiya/, /astronom/, /koinot/, /sayyora/, /quyosh/, /geograf/, /tabiat/, /modda/, /energiya/, /elektr/, /химия|биолог|физик/],
    visuals: { academic: 3, grid: 2, split: 1, story: 1 },
    palettes: ["grove", "lumen", "clinic", "graphite"],
  },
  {
    id: "medicine",
    stems: [/tibbiy/, /kasallik/, /salomatlik/, /sog'liq/, /shifokor/, /vitamin/, /yurak/, /qon\b/, /immun/, /virus/, /gigiyena/, /farmak/, /dori/, /anatomiya/, /медицин|здоров/],
    visuals: { academic: 3, grid: 2, conference: 2 },
    palettes: ["clinic", "slate", "grove"],
  },
  {
    id: "tech",
    stems: [/kompyuter/, /dastur/, /sun'iy intellekt/, /\bai\b/, /internet/, /robot/, /texnolog/, /raqamli/, /axborot/, /tarmoq/, /ma'lumotlar bazasi/, /kiber/, /muhandis/, /dvigatel/, /avtomobil/, /mobil/, /web|веб|программ|информат/],
    visuals: { grid: 3, split: 2, bold: 2, dashboard: 1, academic: 1 },
    palettes: ["aurora", "slate", "graphite", "orbit", "summit"],
  },
  {
    id: "economy",
    stems: [/iqtisod/, /biznes/, /moliya/, /bank/, /bozor/, /marketing/, /menejment/, /soliq/, /investitsiya/, /startap/, /savdo/, /tadbirkor/, /eksport/, /inflyatsiya/, /pul\b/, /экономик|бизнес|финанс/],
    visuals: { dashboard: 3, bold: 2, grid: 2, split: 1, academic: 1 },
    palettes: ["summit", "slate", "orbit", "atlas"],
  },
  {
    id: "law",
    stems: [/huquq/, /qonun/, /konstitutsiya/, /sud\b/, /jinoyat/, /fuqaro/, /davlat boshqaruvi/, /korrupsiya/, /право|закон/],
    visuals: { academic: 3, conference: 2, grid: 1 },
    palettes: ["legal", "atlas", "slate"],
  },
  {
    id: "history",
    stems: [/tarix/, /temur/, /sulola/, /xonlig/, /qadimgi/, /o'rta asr/, /urush/, /saltanat/, /imperiya/, /mustaqillik/, /ipak yo'li/, /arxeolog/, /история/],
    visuals: { rail: 3, story: 3, academic: 1, grid: 1 },
    palettes: ["parchment", "forge", "atlas", "ink"],
  },
  {
    id: "literature",
    stems: [/adabiyot/, /she'r/, /roman\b/, /doston/, /navoiy/, /bobur/, /yozuvchi/, /shoir/, /asar/, /ijodi/, /til\b/, /tilshunos/, /grammatika/, /литератур/],
    visuals: { story: 3, academic: 2, rail: 1 },
    palettes: ["parchment", "sakura", "ink", "atlas"],
  },
  {
    id: "pedagogy",
    stems: [/pedagog/, /ta'lim/, /o'qitish/, /metodika/, /tarbiya/, /maktab/, /o'quvchi/, /psixolog/, /педагог|образован/],
    visuals: { academic: 2, grid: 2, conference: 1 },
    palettes: ["lumen", "grove", "clinic", "summit"],
  },
  {
    id: "art",
    stems: [/san'at/, /musiqa/, /rassom/, /me'morchilik/, /teatr/, /kino/, /raqs/, /hunarmand/, /dizayn/, /madaniyat/, /искусств/],
    visuals: { story: 3, grid: 2, split: 1 },
    palettes: ["sakura", "ink", "parchment"],
  },
  {
    id: "sport",
    stems: [/sport/, /futbol/, /olimpiada/, /jismoniy tarbiya/, /sog'lom turmush/, /musobaqa/, /спорт/],
    visuals: { bold: 3, grid: 2, story: 1 },
    palettes: ["forge", "orbit", "aurora", "summit"],
  },
  {
    id: "ecology",
    stems: [/ekolog/, /atrof-muhit/, /iqlim/, /orol/, /chiqindi/, /o'rmon/, /suv resurs/, /ifloslan/, /биоразнообраз|эколог/],
    visuals: { story: 2, academic: 2, grid: 2 },
    palettes: ["grove", "lumen", "clinic"],
  },
  {
    id: "math",
    stems: [/matematika/, /algebra/, /geometriya/, /tenglama/, /funksiya/, /hosila/, /integral/, /kasr/, /statistika/, /ehtimollik/, /математ/],
    visuals: { academic: 3, grid: 2, split: 1 },
    palettes: ["graphite", "slate", "atlas", "clinic"],
  },
];

/**
 * Designs an «Avtomatik» deck may get, per CONTENT template. Only visuals that carry a picture on `bullets` and on
 * the cover are listed for the general-purpose templates (`lecture`, `science`, …): `circle`, `notebook`,
 * `editorial` and `formal` have no `bullets` photo slot, so a default 10-slide deck in them would carry at most two
 * content pictures (measured, `photoSlot`). The template's own visual stays in its pool (lesson/defense keep their
 * look when the purpose chose them).
 */
export const DESIGN_POOL: Record<Exclude<SlideTemplateId, "auto">, readonly SlideVisual[]> = {
  lecture: ["academic", "grid", "story", "rail", "split", "conference", "dashboard"],
  science: ["notebook", "academic", "grid"],
  story: ["story", "rail", "academic", "grid"],
  timeline: ["rail", "story", "academic", "grid"],
  compare: ["split", "grid", "academic"],
  case: ["editorial", "story", "grid"],
  pitch: ["bold", "dashboard", "grid"],
  report: ["dashboard", "grid", "bold"],
  lesson: ["circle", "grid", "academic"],
  defense: ["formal", "conference", "academic"],
  conference: ["conference", "academic", "grid"],
  grid: ["grid"],
};

/**
 * Palettes that read well on each visual — the curated list auto draws from. Built by rendering one sample deck
 * per pair and looking at it (scratchpad contact sheets, docs/slide-quality/SPEC.md «Palette check»); a pair that
 * failed (low contrast, muddy title band) is simply absent.
 */
export const VISUAL_PALETTES: Record<SlideVisual, readonly SlideThemeId[]> = {
  academic: ["atlas", "slate", "clinic", "grove", "parchment", "summit", "legal"],
  grid: ["clinic", "ink", "slate", "summit", "grove", "aurora"],
  story: ["ink", "parchment", "forge", "grove", "atlas"],
  rail: ["forge", "slate", "parchment", "atlas", "summit"],
  split: ["orbit", "slate", "summit", "ink", "clinic"],
  conference: ["summit", "slate", "atlas", "clinic", "legal"],
  dashboard: ["slate", "summit", "clinic", "aurora"],
  bold: ["aurora", "orbit", "summit", "forge"],
  notebook: ["graphite", "lumen", "grove", "clinic"],
  circle: ["lumen", "grove", "sakura", "clinic"],
  editorial: ["sakura", "ink", "parchment", "summit"],
  formal: ["legal", "atlas", "parchment", "slate"],
  // Legacy families are never chosen by auto; a pinned old deck keeps its own palette.
  classic: ["atlas"],
  "hero-split": ["atlas"],
  cards: ["atlas"],
  lab: ["graphite"],
  timeline: ["forge"],
  magazine: ["ink"],
  dense: ["atlas"],
};

/** Lower-case and unify apostrophes (ʻ ’ ` ‘ → ') so stems match whatever keyboard the user had. */
function norm(text: string): string {
  return text.toLowerCase().replace(/[ʻʼ’‘`]/g, "'");
}

/** Score of every subject area for a topic (+ extra wish + subject field), best first; zero scores dropped. */
export function subjectScores(topic: string, extra = "", subject = ""): { id: SubjectAreaId; score: number }[] {
  // The topic counts twice: it is what the deck is about; the subject field and the wish only hint.
  const head = norm(topic);
  const tail = norm(`${subject} ${extra}`);
  return SUBJECT_AREAS.map((a) => ({
    id: a.id,
    score: a.stems.reduce((n, re) => n + (re.test(head) ? 2 : 0) + (re.test(tail) ? 1 : 0), 0),
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

const AREA_BY_ID = Object.fromEntries(SUBJECT_AREAS.map((a) => [a.id, a])) as Record<SubjectAreaId, SubjectArea>;

/** Deterministic 32-bit mix of a seed and a salt (FNV-1a over the salt, then xorshift). */
export function seedHash(seed: number, salt: string): number {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (const ch of salt) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h << 13;
  h >>>= 0;
  h ^= h >>> 17;
  h ^= h << 5;
  return h >>> 0;
}

/** Weighted pick by a seed; `undefined` seed → the heaviest (first on ties) — the legacy, deterministic choice. */
export function weightedPick<T>(items: readonly T[], weight: (x: T) => number, seed: number | undefined, salt: string): T {
  if (seed === undefined) {
    let best = items[0];
    for (const x of items) if (weight(x) > weight(best)) best = x;
    return best;
  }
  const total = items.reduce((n, x) => n + Math.max(0, weight(x)), 0);
  let r = (seedHash(seed, salt) / 2 ** 32) * total;
  for (const x of items) {
    r -= Math.max(0, weight(x));
    if (r < 0) return x;
  }
  return items[items.length - 1];
}

export type DesignInput = {
  topic: string;
  extra?: string;
  subject?: string;
  /** The form's template choice (`auto` = the user did not pick a design). */
  slideTemplate?: string;
  slideTheme?: string;
  slideSeed?: number;
  /** Only the plain «Slayd» tool gets the auto design/palette (review M2); every other tool resolves as on main. */
  toolId?: string;
};

export type DeckDesign = { visual: SlideVisual; theme: SlideThemeId; areas: SubjectAreaId[] };

/**
 * Design of a deck. `content` is the already-resolved content template (`resolveDeckTemplate`).
 *
 *   - template chosen by the user → its own visual; palette: the user's, or (auto) the visual's curated best;
 *   - template «auto» → visual from `DESIGN_POOL[content]` by subject affinity + seed;
 *   - palette «auto» (or missing) → `VISUAL_PALETTES[visual]` by subject affinity + seed; an explicit id wins.
 */
export function chooseDeckDesign(input: DesignInput, content: SlideTemplate): DeckDesign {
  const areas = subjectScores(input.topic, input.extra, input.subject);
  const weightOf = (pick: (a: SubjectArea) => number) => (seedWeight: number) =>
    areas.reduce((n, a, i) => n + pick(AREA_BY_ID[a.id]) * (i === 0 ? 2 : 1), seedWeight);
  const plain = input.toolId === "slide";
  const autoTemplate = plain && (!input.slideTemplate || input.slideTemplate === "auto");
  // No seed = legacy call (old doc, preview, probe): the content template's own visual, never a re-roll.
  const pool = autoTemplate && content.id !== "auto" && input.slideSeed !== undefined ? DESIGN_POOL[content.id] : [content.visual];
  const visual = weightedPick(
    pool,
    (v) => weightOf((a) => (a.visuals[v] ?? 0) * 2)(v === content.visual ? 2 : 1),
    input.slideSeed,
    "visual",
  );
  const explicit = input.slideTheme && input.slideTheme !== AUTO_THEME && isSlideThemeId(input.slideTheme) ? input.slideTheme : plain ? null : "atlas";
  const palettes = VISUAL_PALETTES[visual];
  const theme =
    explicit ??
    weightedPick(
      palettes,
      (p) => weightOf((a) => (a.palettes.includes(p) ? 3 : 0))(palettes[0] === p ? 1.5 : 1),
      input.slideSeed,
      `palette:${visual}`,
    );
  return { visual, theme, areas: areas.map((a) => a.id) };
}

/** The design seed of a generation: derived from its id, so a worker retry (and the live preview) gets the same design. */
export function seedFromId(id: string): number {
  return seedHash(0, id) & 0x7fffffff;
}

/** A fresh per-generation seed (31 bits; JSON-safe) — only when there is no generation id (scripts, tests). */
export function newSlideSeed(rand: () => number = Math.random): number {
  return Math.floor(rand() * 0x7fffffff);
}
