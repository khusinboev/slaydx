/**
 * Konspekt form parameter registry — the single list of what the form may send and what the
 * differential probe (`tests/konspekt.test.mts`) must see changing the result. Every id here is
 * rendered by `KonspektComposer` with `data-field={id}` (UI coverage test): no decorative field.
 */
import { HAND_FIELD_OF, handCapsOf, type HandParamId } from "../work/handwriting";

export type KonspektParam = {
  id: string;
  probeA: string;
  probeB: string;
  /** Other values the probe pair needs to make the parameter meaningful (e.g. margin line needs ruled paper). */
  probeWith?: Record<string, string>;
};

export const KONSPEKT_BASE_PARAMS: KonspektParam[] = [
  { id: "topic", probeA: "Davlatchilik tarixi", probeB: "Jadidlar harakati" },
  { id: "sourceText", probeA: "", probeB: "MANBA MATNI" },
  { id: "language", probeA: "uz", probeB: "ru" },
  { id: "pages", probeA: "5-10", probeB: "20-30" },
  { id: "extra", probeA: "", probeB: "faqat sanalar va ismlar" },
];

const HAND_PROBES: Record<HandParamId, [string, string, Record<string, string>?]> = {
  font: ["school", "pen"],
  ink: ["blue", "black"],
  lively: ["on", "off"],
  paper: ["grid", "lined"],
  format: ["a5x2", "a4"],
  margin: ["alternate", "left", { handPaper: "grid" }],
  cells: ["1", "2", { handPaper: "grid" }],
  headings: ["plain", "caps"],
  underline: ["on", "off"],
  cover: ["plain", "calligraphy"],
};

/** Base parameters + the handwriting parameters this service exposes (`HAND_SERVICE_CAPS.konspekt`). */
export const KONSPEKT_PARAMS: KonspektParam[] = [
  ...KONSPEKT_BASE_PARAMS,
  ...[...handCapsOf("konspekt")!].map((cap): KonspektParam => {
    const [probeA, probeB, probeWith] = HAND_PROBES[cap];
    return { id: HAND_FIELD_OF[cap], probeA, probeB, ...(probeWith ? { probeWith } : {}) };
  }),
];

export const KONSPEKT_FORM_FIELDS = KONSPEKT_PARAMS.map((p) => p.id);
