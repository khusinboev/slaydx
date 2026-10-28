"use client";

import { Row, Segmented } from "./compact";
import { Field } from "./shared";
import {
  HAND_COVERS,
  HAND_COVER_LABELS,
  HAND_CELLS,
  HAND_CELLS_LABELS,
  HAND_DEFAULTS,
  HAND_FONTS,
  HAND_FONT_LIST,
  HAND_FORMATS,
  HAND_FORMAT_LABELS,
  HAND_HEADINGS,
  HAND_HEADINGS_LABELS,
  HAND_INKS,
  HAND_INK_LABELS,
  HAND_LIVELY_LABELS,
  HAND_LIVELY_VALUES,
  HAND_MARGINS,
  HAND_MARGIN_LABELS,
  HAND_PAPERS,
  HAND_PAPER_LABELS,
  HAND_PAPER_SPECS,
  HAND_UNDERLINES,
  HAND_UNDERLINE_LABELS,
  handBaselinePx,
  handCssVars,
  handGeometry,
  handJitterCss,
  handStyleOf,
  handWordJitter,
  handWordPieces,
  normalizeHand,
  restrictHand,
  type HandCellsValue,
  type HandCoverValue,
  type HandFontId,
  type HandFormatValue,
  type HandHeadingsValue,
  type HandInk,
  type HandLivelyValue,
  type HandMarginValue,
  type HandPaper,
  type HandParamId,
  type HandUnderlineValue,
  type WorkHand,
} from "@/lib/generation/work/handwriting";

/**
 * The handwriting choices of a form, shared by every service that offers them (`HAND_SERVICE_CAPS`).
 * A row renders only when the service exposes its parameter AND it can work with the other choices
 * (cells need cell paper, the margin line needs ruled paper, a cover title needs a font with one) —
 * a control that cannot take effect must not exist. Field ids are the registry ids (`HAND_FIELD_OF`).
 */
export type HandForm = {
  ink: HandInk;
  paper: HandPaper;
  font: HandFontId;
  lively: HandLivelyValue;
  headings: HandHeadingsValue;
  cover: HandCoverValue;
  underline: HandUnderlineValue;
  format: HandFormatValue;
  margin: HandMarginValue;
  cells: HandCellsValue;
};

export function HandRows({ caps, value, onChange }: { caps: ReadonlySet<HandParamId>; value: HandForm; onChange: <K extends keyof HandForm>(key: K, v: HandForm[K]) => void }) {
  const has = (id: HandParamId) => caps.has(id);
  const effPaper = has("paper") ? value.paper : HAND_DEFAULTS.paper;
  const effFont = has("font") ? value.font : HAND_DEFAULTS.font;
  return (
    <>
        {has("ink") ? (
          <Row label="Siyoh rangi">
            <Field id="handInk">
              <Segmented ariaLabel="Siyoh rangi" options={HAND_INKS.map((v) => ({ value: v, label: HAND_INK_LABELS[v] }))} value={value.ink} onChange={(v) => onChange("ink", v as HandInk)} />
            </Field>
          </Row>
        ) : null}
        {has("paper") ? (
          <Row label="Qog‘oz">
            <Field id="handPaper">
              <Segmented ariaLabel="Qog‘oz" options={HAND_PAPERS.map((v) => ({ value: v, label: HAND_PAPER_LABELS[v] }))} value={value.paper} onChange={(v) => onChange("paper", v as HandPaper)} />
            </Field>
          </Row>
        ) : null}
        {has("format") ? (
          <Row label="Format" hint="A5 × 2 — bitta A4 yuziga ikkita A5 sahifa; 100 % o‘lchamda chop eting, katak va qatorlar o‘zgarmaydi" wide>
            <Field id="handFormat">
              <Segmented ariaLabel="Format" options={HAND_FORMATS.map((v) => ({ value: v, label: HAND_FORMAT_LABELS[v] }))} value={value.format} onChange={(v) => onChange("format", v as HandFormatValue)} />
            </Field>
          </Row>
        ) : null}
        {has("cells") && effPaper !== "lined" ? (
          <Row label="Qator oralig‘i" hint="Katakli daftarda bir qator necha katak">
            <Field id="handCells">
              <Segmented ariaLabel="Qator oralig‘i" options={HAND_CELLS.map((v) => ({ value: v, label: HAND_CELLS_LABELS[v] }))} value={value.cells} onChange={(v) => onChange("cells", v as HandCellsValue)} />
            </Field>
          </Row>
        ) : null}
        {has("margin") && HAND_PAPER_SPECS[effPaper].ruled ? (
          <Row label="Qizil chiziq" hint="Navbatma-navbat — toq varaqda chapda, juft varaqda o‘ngda">
            <Field id="handMargin">
              <Segmented ariaLabel="Qizil chiziq" options={HAND_MARGINS.map((v) => ({ value: v, label: HAND_MARGIN_LABELS[v] }))} value={value.margin} onChange={(v) => onChange("margin", v as HandMarginValue)} />
            </Field>
          </Row>
        ) : null}
        {has("font") ? (
          <Row label="Shrift">
            <Field id="handFont">
              <Segmented ariaLabel="Shrift" options={HAND_FONT_LIST.map((f) => ({ value: f.id, label: f.label }))} value={value.font} onChange={(v) => onChange("font", v as HandFontId)} />
            </Field>
          </Row>
        ) : null}
        {has("lively") ? (
          <Row label="Yozuv" hint="Jonli — har so‘z biroz boshqacha: balandligi va siyoh to‘qligi, haqiqiy qo‘lda yozilgandek">
            <Field id="handLively">
              <Segmented ariaLabel="Yozuv" options={HAND_LIVELY_VALUES.map((v) => ({ value: v, label: HAND_LIVELY_LABELS[v] }))} value={value.lively} onChange={(v) => onChange("lively", v as HandLivelyValue)} />
            </Field>
          </Row>
        ) : null}
        {has("headings") ? (
          <Row label="Sarlavhalar" hint="Oddiy — «Kirish», «1-bob. …» (daftarda shunday yoziladi); BOSH HARFLI — «KIRISH», «1-BOB. …»">
            <Field id="handHeadings">
              <Segmented ariaLabel="Sarlavhalar" options={HAND_HEADINGS.map((v) => ({ value: v, label: HAND_HEADINGS_LABELS[v] }))} value={value.headings} onChange={(v) => onChange("headings", v as HandHeadingsValue)} />
            </Field>
          </Row>
        ) : null}
        {has("underline") ? (
          <Row label="Sarlavha tagi chizig‘i">
            <Field id="handUnderline">
              <Segmented ariaLabel="Sarlavha tagi chizig‘i" options={HAND_UNDERLINES.map((v) => ({ value: v, label: HAND_UNDERLINE_LABELS[v] }))} value={value.underline} onChange={(v) => onChange("underline", v as HandUnderlineValue)} />
            </Field>
          </Row>
        ) : null}
        {has("cover") && HAND_FONTS[effFont].title ? (
          <Row label="Muqova sarlavhasi" hint="Kalligrafik — «Mustaqil ish» bezakli yozuvda">
            <Field id="handCover">
              <Segmented ariaLabel="Muqova sarlavhasi" options={HAND_COVERS.map((v) => ({ value: v, label: HAND_COVER_LABELS[v] }))} value={value.cover} onChange={(v) => onChange("cover", v as HandCoverValue)} />
            </Field>
          </Row>
        ) : null}
        <HandPreview hand={restrictHand(normalizeHand(value), caps)} />
    </>
  );
}

/** Qo'lyozma tanlovining kichik namunasi — ko'ruvchi bilan BIR XIL o'zgaruvchi va chiziq qoidasi (`.hand-preview`). */
export function HandPreview({ hand }: { hand: WorkHand }) {
  const style = handStyleOf(hand);
  const vars = handCssVars(style);
  const g = handGeometry(hand.paper, hand.font, hand);
  const cell = Number.parseFloat(vars["--hand-cell"]!);
  const phase = handBaselinePx(HAND_FONTS[hand.font], g.sizePt, g.pitchPx) % cell;
  const lively = Boolean(hand.lively);
  return (
    <div
      className={`hand-preview hand-preview--${hand.paper}`}
      data-hand-preview
      aria-hidden
      style={{ ...vars, "--hand-phase": `${phase}px`, "--hand-vphase": "0px" } as React.CSSProperties}
    >
      <PreviewLine text="Mustaqil ish — qo‘lyozma namuna" lively={lively} />
      <PreviewLine text="O‘zbekiston, ўқув, 2026" lively={lively} />
    </div>
  );
}

/** Namuna qatori: jonli rejimda so'zlar ko'ruvchidagi qoida bilan siljiydi (`handWordJitter`). */
function PreviewLine({ text, lively }: { text: string; lively: boolean }) {
  if (!lively) return <div>{text}</div>;
  return (
    <div>
      {handWordPieces(text).map((w, i) => {
        const j = handWordJitter(i, w);
        return (
          <span key={i} style={handJitterCss({ dy: j.dyHalfPt, t: j.tonePct })}>
            {w}
          </span>
        );
      })}
    </div>
  );
}

