import { titulLabels, type TitulLabels } from "../i18n";
import type { TitulInput, TitulModel, TitulWorkType } from "./types";

/**
 * `planTitlePage` — the ONE layout of the «Titul» page ("ko'rdim = oldim").
 *
 * The result is format-neutral: millimetres, points and plain runs. The DOCX
 * renderer (`render-docx.ts`) and the viewer (`components/viewers/titul/`)
 * both draw exactly this list and decide nothing themselves.
 *
 * Vertical placement uses ZONES of a fixed height (top / middle / bottom),
 * each with its own vertical alignment, followed by a TAIL (the city–year
 * line). In Word the zones are the rows of one borderless table (row height
 * «at least», cell vertical alignment), the tail is the paragraph after it —
 * a table can never end a Word document anyway. The zone heights plus the
 * tail fill the page minus a small slack, so the page cannot spill onto a
 * second sheet as long as every zone's content fits its height; `fitZone`
 * shrinks a zone's type (deterministically, from the text length) until its
 * estimated height fits. Both renderers therefore get the same sizes.
 *
 * Every visible piece of text is a RUN with a stable id. In-place edits
 * (`edit.ts`) store `overrides[id]`; the plan uses that text verbatim. An
 * optional field that is empty produces no run at all (no dangling label),
 * except the names on signature positions, which stay as a blank line to
 * sign by hand.
 */

export type TitulAlign = "left" | "center" | "right";

export type TitulRun = { id: string; text: string; bold?: boolean; italic?: boolean };

/** A paragraph. `sep` is put between its non-empty runs. */
export type TitulPara = {
  k: "p";
  runs: TitulRun[];
  sep: string;
  align: TitulAlign;
  sizePt: number;
  /** Line spacing as a multiple of single (Word «multiple», `lineRule` auto). */
  line: number;
  /** Letter spacing (pt). */
  spacingPt: number;
  beforePt: number;
  afterPt: number;
  /** Left indent from the content edge (mm). */
  indentMm: number;
};

/** A label + text on an underline spanning the row, with an optional small note under the line. */
export type TitulLineRow = {
  k: "line";
  label: TitulRun | null;
  labelSizePt: number;
  value: TitulRun;
  valueSizePt: number;
  valueAlign: "left" | "center";
  note: TitulRun | null;
  noteSizePt: number;
  /** Width of the label column (mm). */
  labelMm: number;
  /** Width of the whole row (mm) and its left offset from the content edge (mm). */
  widthMm: number;
  offsetMm: number;
  beforePt: number;
  afterPt: number;
};

export type TitulItem = TitulPara | TitulLineRow;

export type TitulZone = {
  id: "top" | "middle" | "bottom";
  heightMm: number;
  valign: "top" | "center" | "bottom";
  items: TitulItem[];
};

export type TitulPlan = {
  font: string;
  page: { widthMm: number; heightMm: number; margin: { top: number; right: number; bottom: number; left: number } };
  /** Double-line page border: distance from the page edge and the width of ONE line (pt). */
  border: { offsetPt: number; linePt: number } | null;
  zones: TitulZone[];
  tail: TitulPara[];
};

/* ────────────────────────── metrics ────────────────────────── */

export const TITUL_FONT = "Times New Roman";
export const PT_PER_MM = 72 / 25.4;
/** Word «single» line of Times New Roman / Tinos / Liberation Serif, as a multiple of the font size. */
export const SINGLE_LINE = 1.15;
/** Height (pt) of the tiny paragraph Word needs after a nested table in a cell (1 pt type, single line). */
export const SPACER_PT = 1 * SINGLE_LINE;
/** What the zones leave free under the tail (mm): rounding in Word / LibreOffice must not push the tail to page 2. */
const SLACK_MM = 3;
/** Gap between an underline and the small note under it (pt). */
export const NOTE_GAP_PT = 6;

const PAGE = { widthMm: 210, heightMm: 297 };
const MARGIN_CLASSIC = { top: 20, right: 22, bottom: 18, left: 22 };
const MARGIN_OTM = { top: 20, right: 15, bottom: 20, left: 30 };
const BORDER = { offsetPt: 14, linePt: 0.75 };

/* ────────────────────────── builders ────────────────────────── */

type Ctx = { input: TitulInput; overrides: Record<string, string>; L: TitulLabels };

/** A run with the user's in-place edit applied. */
function run(c: Ctx, id: string, text: string, style: { bold?: boolean; italic?: boolean } = {}): TitulRun {
  const own = Object.prototype.hasOwnProperty.call(c.overrides, id) ? c.overrides[id]! : text;
  return { id, text: own, ...(style.bold ? { bold: true } : {}), ...(style.italic ? { italic: true } : {}) };
}

type ParaOpts = Partial<Omit<TitulPara, "k" | "runs">>;

function para(runs: TitulRun[], o: ParaOpts): TitulPara {
  return {
    k: "p",
    runs,
    sep: o.sep ?? " ",
    align: o.align ?? "center",
    sizePt: o.sizePt ?? 14,
    line: o.line ?? 1,
    spacingPt: o.spacingPt ?? 0,
    beforePt: o.beforePt ?? 0,
    afterPt: o.afterPt ?? 0,
    indentMm: o.indentMm ?? 0,
  };
}

/**
 * A paragraph of ONE generated text: omitted when the text is empty and the
 * user did not type anything there; omitted as well when the user emptied it.
 */
function textPara(c: Ctx, id: string, text: string, style: { bold?: boolean; italic?: boolean }, o: ParaOpts): TitulPara | null {
  const r = run(c, id, text, style);
  return r.text.trim() ? para([r], o) : null;
}

/** Drops empty runs; drops the paragraph when nothing is left. */
function runsPara(runs: TitulRun[], o: ParaOpts): TitulPara | null {
  const kept = runs.filter((r) => r.text.trim());
  return kept.length ? para(kept, o) : null;
}

const caps = (s: string) => s.toUpperCase();
const keep = <T>(xs: Array<T | null | false | undefined>): T[] => xs.filter((x): x is T => Boolean(x));

/** The blank a hand signature / name goes on when the name is not given. */
export const NAME_BLANK = "____________________";

/** The city in the label language («Toshkent» typed in any script becomes the label's own spelling). */
function cityOf(c: Ctx): string {
  const city = c.input.city.trim();
  return !city || /^(toshkent|тошкент|ташкент)$/i.test(city) ? c.L.city : city;
}

function headingOf(c: Ctx): string {
  const { workType, labKind, labNumber } = c.input;
  if (workType === "lab") {
    const base = labKind === "practical" ? c.L.work.practical : c.L.work.lab;
    return labNumber ? `${base} ${c.L.number(labNumber)}` : base;
  }
  return c.L.work[workType as Exclude<TitulWorkType, "lab">];
}

function ministryParas(c: Ctx, o: ParaOpts, upper = true): TitulPara[] {
  const { ministry, ministryCustom } = c.input;
  if (ministry === "none") return [];
  if (ministry === "custom") {
    const lines = ministryCustom.split("\n").filter(Boolean);
    // An empty «own text» falls back to the official line: the page must not lose its head.
    if (lines.length) return keep(lines.map((l, i) => textPara(c, `ministry.${i}`, upper ? caps(l) : l, { bold: true }, o)));
  }
  const text = ministry === "maktab" ? c.L.ministrySchool : c.L.ministryHigher;
  return keep([textPara(c, "ministry", upper ? caps(text) : text, { bold: true }, o)]);
}

function checkerLabel(c: Ctx): string {
  return c.L.checker[c.input.checkerLabel];
}

/* ────────────────────────── layouts ────────────────────────── */

type Draft = { margin: TitulPlan["page"]["margin"]; zones: Array<Omit<TitulZone, "heightMm"> & { share: number }>; tail: TitulPara[] };

/** The owner's sample: framed, caps head, «… FANIDAN», big heading, topic on a line, signature lines. */
function classic(c: Ctx): Draft {
  const { input: inp, L } = c;
  const head: ParaOpts = { sizePt: 17.5, line: 1.1, afterPt: 14 };
  // Both signature rows share one label column, wide enough for the longer label (Russian «Научный руководитель:»).
  const sigLabels = { author: run(c, "author.label", L.doneBy, { bold: true }), supervisor: run(c, "supervisor.label", checkerLabel(c), { bold: true }) };
  const sigLabelMm = labelMmFor([sigLabels.author, sigLabels.supervisor], 11, 23);
  const topicLabel = run(c, "topic.label", L.topic, { bold: true });
  const sig = (id: "author" | "supervisor", name: string, note: string, afterPt: number): TitulLineRow => ({
    k: "line",
    label: sigLabels[id],
    labelSizePt: 11,
    value: run(c, `${id}.value`, name),
    valueSizePt: 12,
    valueAlign: "center",
    note: note ? run(c, `${id}.note`, note, { italic: true }) : null,
    noteSizePt: 7.5,
    labelMm: sigLabelMm,
    widthMm: 110,
    offsetMm: 28,
    beforePt: 0,
    afterPt,
  });
  return {
    margin: MARGIN_CLASSIC,
    zones: [
      {
        id: "top",
        share: 90,
        valign: "top",
        items: keep([
          ...ministryParas(c, head),
          textPara(c, "university", caps(inp.university), { bold: true }, head),
          inp.faculty && textPara(c, "faculty", caps(L.faculty(inp.faculty)), { bold: true }, head),
          inp.department && textPara(c, "department", caps(L.department(inp.department)), { bold: true }, head),
        ]),
      },
      {
        id: "middle",
        share: 76,
        valign: "center",
        items: keep([
          inp.subject && textPara(c, "subject", caps(L.subject(inp.subject)), { bold: true }, { sizePt: 13, afterPt: 36 }),
          textPara(c, "heading", headingOf(c), { bold: true }, { sizePt: 28, spacingPt: 2, afterPt: 38 }),
          {
            k: "line",
            label: topicLabel,
            labelSizePt: 17,
            value: run(c, "topic.value", inp.topic),
            valueSizePt: 17,
            valueAlign: "left",
            note: null,
            noteSizePt: 7.5,
            labelMm: labelMmFor([topicLabel], 17, 22.5),
            widthMm: 152,
            offsetMm: 11,
            beforePt: 0,
            afterPt: 0,
          } satisfies TitulLineRow,
        ]),
      },
      {
        id: "bottom",
        share: 0,
        valign: "bottom",
        items: [
          sig("author", inp.author, L.studentNote(inp.course, inp.group), 22),
          sig("supervisor", inp.supervisor, inp.supervisorRole ? `(${inp.supervisorRole})` : "", 0),
        ],
      },
    ],
    tail: keep([textPara(c, "cityYear", caps(`${cityOf(c)} — ${inp.year}`), { bold: true }, { sizePt: 11, spacingPt: 0.7, beforePt: 46 })]),
  };
}

/** A label column (mm) that holds the widest of `labels` on one line at `sizePt`, never narrower than `minMm`. */
function labelMmFor(labels: TitulRun[], sizePt: number, minMm: number): number {
  const widest = Math.max(0, ...labels.map((r) => textWidthPt([r], "", sizePt, 0)));
  return Math.max(minMm, Math.ceil(widest / PT_PER_MM + 3));
}

/** The common OTM head: ministry and university in bold caps, faculty and department as typed. */
function otmHead(c: Ctx, size = 14): TitulPara[] {
  const { input: inp, L } = c;
  const o: ParaOpts = { sizePt: size, line: 1.1, afterPt: 9 };
  return keep([
    ...ministryParas(c, o),
    textPara(c, "university", caps(inp.university), { bold: true }, o),
    inp.faculty && textPara(c, "faculty", L.faculty(inp.faculty), {}, o),
    inp.department && textPara(c, "department", L.department(inp.department), {}, o),
  ]);
}

/** Topic and its phrase («… mavzusida»; Russian «на тему …» stands before the topic). */
function topicWithPhrase(c: Ctx, phrase: { text: string; before: boolean }, topic: TitulPara | null, phraseOpts: ParaOpts): TitulPara[] {
  const p = textPara(c, "topicPhrase", phrase.text, {}, phraseOpts);
  return keep(phrase.before ? [p, topic] : [topic, p]);
}

/** «"Fan" fanidan» — topic — «mavzusida» — HEADING; «Bajardi: … guruh talabasi Name», «Qabul qildi: Name». */
function mavzusida(c: Ctx): Draft {
  const { input: inp, L } = c;
  const block: ParaOpts = { sizePt: 14, align: "left", indentMm: 85, line: 1.15 };
  return {
    margin: MARGIN_OTM,
    zones: [
      { id: "top", share: 80, valign: "top", items: otmHead(c) },
      {
        id: "middle",
        share: 100,
        valign: "center",
        items: keep([
          inp.subject && textPara(c, "subject", L.subjectQuoted(inp.subject), {}, { sizePt: 14, afterPt: 18 }),
          ...topicWithPhrase(c, L.topicPhrase, textPara(c, "topic", inp.topic, { bold: true }, { sizePt: 18, afterPt: 8 }), { sizePt: 14, afterPt: 8 }),
          textPara(c, "heading", headingOf(c), { bold: true }, { sizePt: 22, spacingPt: 2, beforePt: 14 }),
        ]),
      },
      {
        id: "bottom",
        share: 0,
        valign: "center",
        items: keep([
          runsPara(
            [run(c, "author.label", L.doneBy, { bold: true }), run(c, "author.student", L.student(inp.course, inp.group)), run(c, "author.value", inp.author || NAME_BLANK)],
            { ...block, afterPt: 14 },
          ),
          runsPara(
            [run(c, "supervisor.label", checkerLabel(c), { bold: true }), run(c, "supervisor.role", inp.supervisorRole), run(c, "supervisor.value", inp.supervisor || NAME_BLANK)],
            block,
          ),
        ]),
      },
    ],
    tail: keep([textPara(c, "cityYear", `${cityOf(c)} - ${inp.year}`, { bold: true }, { sizePt: 14 })]),
  };
}

/** Head, centred heading and topic, the author block on the RIGHT without lines. */
function rightBlock(c: Ctx): Draft {
  const { input: inp, L } = c;
  const r: ParaOpts = { sizePt: 14, align: "right" };
  return {
    margin: MARGIN_OTM,
    zones: [
      { id: "top", share: 80, valign: "top", items: otmHead(c) },
      {
        id: "middle",
        share: 90,
        valign: "center",
        items: keep([
          inp.subject && textPara(c, "subject", L.subjectQuoted(inp.subject), {}, { sizePt: 14, afterPt: 14 }),
          textPara(c, "heading", headingOf(c), { bold: true }, { sizePt: 24, spacingPt: 2, afterPt: 18 }),
          runsPara([run(c, "topic.label", L.topic, { bold: true }), run(c, "topic.value", inp.topic, { bold: true })], { sizePt: 16 }),
        ]),
      },
      {
        id: "bottom",
        share: 0,
        valign: "center",
        items: keep([
          textPara(c, "author.label", L.doneBy, { bold: true }, r),
          inp.direction && textPara(c, "author.direction", L.direction(inp.directionCode, inp.direction), {}, r),
          textPara(c, "author.student", L.student(inp.course, inp.group), {}, r),
          textPara(c, "author.value", inp.author || NAME_BLANK, { bold: true }, { ...r, afterPt: 16 }),
          textPara(c, "supervisor.label", checkerLabel(c), { bold: true }, r),
          textPara(c, "supervisor.role", inp.supervisorRole, {}, r),
          textPara(c, "supervisor.value", inp.supervisor || NAME_BLANK, { bold: true }, r),
        ]),
      },
    ],
    tail: keep([textPara(c, "cityYear", `${cityOf(c)} – ${inp.year}`, { bold: true }, { sizePt: 14 })]),
  };
}

/** BMI: head, «Himoyaga ruxsat etilsin» on the right, direction / student / NAME / TOPIC / «mavzusidagi» / heading, supervisor on the right. */
function bmiOfficial(c: Ctx): Draft {
  const { input: inp, L } = c;
  const r: ParaOpts = { sizePt: 13, align: "right" };
  const approverTitle = inp.approverRole === "head" ? L.head(inp.department) : L.dean(inp.faculty);
  return {
    margin: MARGIN_OTM,
    zones: [
      {
        id: "top",
        share: 100,
        valign: "top",
        items: keep([
          ...otmHead(c),
          textPara(c, "approve.label", L.allowDefense, { bold: true }, { ...r, beforePt: 18 }),
          runsPara([run(c, "approve.title", approverTitle), run(c, "approve.sign", "________"), run(c, "approve.value", inp.approver || NAME_BLANK)], r),
          textPara(c, "approve.date", L.dateBlank(inp.year), {}, r),
        ]),
      },
      {
        id: "middle",
        share: 95,
        valign: "center",
        items: keep([
          inp.direction && textPara(c, "author.direction", L.bmiDirection(inp.directionCode, inp.direction), {}, { sizePt: 14, afterPt: 2 }),
          textPara(c, "author.student", L.bmiStudent(inp.course, inp.group), {}, { sizePt: 14, afterPt: 12 }),
          textPara(c, "author.value", caps(inp.author), { bold: true }, { sizePt: 16, afterPt: 14 }),
          ...topicWithPhrase(c, L.bmiTopicPhrase, textPara(c, "topic", caps(inp.topic), { bold: true }, { sizePt: 16, afterPt: 6 }), { sizePt: 14, afterPt: 6 }),
          textPara(c, "heading", headingOf(c), { bold: true }, { sizePt: 20, spacingPt: 2, beforePt: 10 }),
        ]),
      },
      {
        id: "bottom",
        share: 0,
        valign: "center",
        items: keep([
          runsPara(
            [
              run(c, "supervisor.label", L.checker.supervisor, { bold: true }),
              run(c, "supervisor.role", inp.supervisorRole),
              run(c, "supervisor.sign", "________"),
              run(c, "supervisor.value", inp.supervisor || NAME_BLANK),
            ],
            { ...r, sizePt: 14, afterPt: 8 },
          ),
          inp.reviewer ? runsPara([run(c, "reviewer.label", L.reviewer, { bold: true }), run(c, "reviewer.value", inp.reviewer)], { ...r, sizePt: 14 }) : null,
        ]),
      },
    ],
    tail: keep([textPara(c, "cityYear", `${cityOf(c)} – ${inp.year}`, { bold: true }, { sizePt: 14 })]),
  };
}

/** Master's dissertation: university, «"KAFEDRA" KAFEDRASI», manuscript note + UDK, NAME, TOPIC, purpose, DISSERTATSIYA, supervisor. */
function dissertation(c: Ctx): Draft {
  const { input: inp, L } = c;
  const head: ParaOpts = { sizePt: 14, afterPt: 6 };
  const r: ParaOpts = { sizePt: 14, align: "right" };
  return {
    margin: MARGIN_OTM,
    zones: [
      {
        id: "top",
        share: 90,
        valign: "top",
        items: keep([
          ...ministryParas(c, head),
          textPara(c, "university", caps(inp.university), { bold: true }, head),
          inp.department && textPara(c, "department", caps(L.departmentQuoted(inp.department)), { bold: true }, head),
          textPara(c, "manuscript", L.manuscript, {}, { ...r, beforePt: 22 }),
          inp.udk ? runsPara([run(c, "udk.label", L.udk), run(c, "udk.value", inp.udk)], r) : null,
        ]),
      },
      {
        id: "middle",
        share: 100,
        valign: "center",
        items: keep([
          textPara(c, "author.value", caps(inp.author), { bold: true }, { sizePt: 16, afterPt: 18 }),
          textPara(c, "topic", caps(inp.topic), { bold: true }, { sizePt: 16, afterPt: 18 }),
          inp.speciality && textPara(c, "purpose", L.purpose(inp.specialityCode, inp.speciality), {}, { sizePt: 14, afterPt: 22 }),
          textPara(c, "heading", L.dissertation, { bold: true }, { sizePt: 22, spacingPt: 3 }),
        ]),
      },
      {
        id: "bottom",
        share: 0,
        valign: "center",
        items: keep([
          runsPara([run(c, "supervisor.label", L.checker.supervisor, { bold: true }), run(c, "supervisor.role", inp.supervisorRole), run(c, "supervisor.value", inp.supervisor || NAME_BLANK)], r),
        ]),
      },
    ],
    tail: keep([textPara(c, "cityYear", caps(`${cityOf(c)} – ${inp.year}`), { bold: true }, { sizePt: 14 })]),
  };
}

const LAYOUTS: Record<TitulInput["layout"], (c: Ctx) => Draft> = {
  classic,
  mavzusida,
  "right-block": rightBlock,
  "bmi-official": bmiOfficial,
  dissertation,
};

/* ────────────────────────── fitting ────────────────────────── */

/** Advance of one character in em — a deliberately GENEROUS Times New Roman estimate (it decides only when to shrink). */
function charEm(ch: string, bold: boolean): number {
  if (ch === " ") return 0.25;
  if (/[0-9]/.test(ch)) return 0.5;
  if (/\p{Lu}/u.test(ch)) return bold ? 0.74 : 0.7;
  if (/\p{L}/u.test(ch)) return bold ? 0.53 : 0.49;
  return 0.36;
}

function textWidthPt(runs: TitulRun[], sep: string, sizePt: number, spacingPt: number): number {
  let w = 0;
  const parts = runs.filter((r) => r.text);
  parts.forEach((r, i) => {
    const text = i ? sep + r.text : r.text;
    for (const ch of text) w += charEm(ch, Boolean(r.bold)) * sizePt + spacingPt;
  });
  return w;
}

/** Estimated line count: the wrap loses part of a line at every break. */
function lineCount(widthPt: number, availPt: number): number {
  if (widthPt <= 0) return 1;
  return Math.max(1, Math.ceil((widthPt * 1.08) / Math.max(availPt, 1)));
}

export function lineHeightPt(sizePt: number, line: number): number {
  return sizePt * SINGLE_LINE * line;
}

/** Estimated height (pt) of one item in a column `contentMm` wide. */
export function itemHeightPt(it: TitulItem, contentMm: number): number {
  if (it.k === "p") {
    const avail = (contentMm - it.indentMm) * PT_PER_MM;
    const lines = lineCount(textWidthPt(it.runs, it.sep, it.sizePt, it.spacingPt), avail);
    return it.beforePt + it.afterPt + lines * lineHeightPt(it.sizePt, it.line);
  }
  const avail = (it.widthMm - it.labelMm) * PT_PER_MM;
  const valueLines = lineCount(textWidthPt([it.value], "", it.valueSizePt, 0), avail);
  const row = Math.max(lineHeightPt(it.labelSizePt, 1), valueLines * lineHeightPt(it.valueSizePt, 1));
  const note = it.note ? NOTE_GAP_PT + lineHeightPt(it.noteSizePt, 1) : 0;
  return it.beforePt + row + note + Math.max(it.afterPt, SPACER_PT);
}

function scaleItem(it: TitulItem, s: number): TitulItem {
  const half = (n: number) => Math.max(1, Math.round(n * s * 2) / 2);
  const soft = (n: number) => Math.round(n * s * 10) / 10;
  if (it.k === "p") return { ...it, sizePt: half(it.sizePt), spacingPt: soft(it.spacingPt), beforePt: soft(it.beforePt), afterPt: soft(it.afterPt) };
  return { ...it, labelSizePt: half(it.labelSizePt), valueSizePt: half(it.valueSizePt), noteSizePt: half(it.noteSizePt), beforePt: soft(it.beforePt), afterPt: soft(it.afterPt) };
}

/** Shrinks a zone's type in 5 % steps (down to 55 %) until its estimated content fits the zone. */
function fitZone(zone: TitulZone, contentMm: number): TitulZone {
  const limit = zone.heightMm * PT_PER_MM * 0.96;
  const height = (items: TitulItem[]) => items.reduce((h, it) => h + itemHeightPt(it, contentMm), 0);
  if (height(zone.items) <= limit) return zone;
  for (let s = 0.95; s >= 0.55; s -= 0.05) {
    const items = zone.items.map((it) => scaleItem(it, s));
    if (height(items) <= limit) return { ...zone, items };
  }
  return { ...zone, items: zone.items.map((it) => scaleItem(it, 0.55)) };
}

/* ────────────────────────── entry ────────────────────────── */

export function tailHeightMm(tail: TitulPara[]): number {
  return tail.reduce((h, p) => h + p.beforePt + p.afterPt + lineHeightPt(p.sizePt, p.line), 0) / PT_PER_MM;
}

export function planTitlePage(model: TitulModel): TitulPlan {
  const c: Ctx = { input: model.input, overrides: model.overrides ?? {}, L: titulLabels(model.input.lang) };
  const draft = LAYOUTS[model.input.layout](c);
  const m = draft.margin;
  const contentMm = PAGE.widthMm - m.left - m.right;
  const free = PAGE.heightMm - m.top - m.bottom - tailHeightMm(draft.tail) - SLACK_MM;
  // Fixed shares first; the zone with share 0 takes the rest.
  const fixed = draft.zones.reduce((s, z) => s + z.share, 0);
  const zones = draft.zones.map(({ share, ...z }) => {
    const heightMm = Math.round((share || Math.max(20, free - fixed)) * 10) / 10;
    return fitZone({ ...z, heightMm }, contentMm);
  });
  return {
    font: TITUL_FONT,
    page: { ...PAGE, margin: m },
    border: model.input.border ? BORDER : null,
    zones,
    tail: draft.tail,
  };
}

/** Every run of a plan, in reading order — the edit contract and the parity tests read this. */
export function titulRuns(plan: TitulPlan): TitulRun[] {
  const out: TitulRun[] = [];
  const items = [...plan.zones.flatMap((z) => z.items), ...plan.tail];
  for (const it of items) {
    if (it.k === "p") out.push(...it.runs);
    else out.push(...keep([it.label, it.value, it.note]));
  }
  return out;
}

/** The content width (mm) of a plan's page. */
export function contentWidthMm(plan: TitulPlan): number {
  return plan.page.widthMm - plan.page.margin.left - plan.page.margin.right;
}
