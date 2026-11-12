import type { CSSProperties } from "react";
import {
  NOTE_GAP_PT,
  SINGLE_LINE,
  SPACER_PT,
  contentWidthMm,
  type TitulItem,
  type TitulLineRow,
  type TitulPara,
  type TitulPlan,
  type TitulRun,
} from "@/lib/generation/title-page/layout";

/**
 * The «Titul» sheet — draws `planTitlePage` exactly as the DOCX does
 * (`lib/generation/title-page/render-docx.ts`): the same zones with the same
 * heights and vertical alignment, the same paragraphs (pt sizes, Word «single»
 * line = 1.15 × size, spacing before/after, indents), the same underline rows
 * and the same double page border measured from the page edge. It decides
 * nothing itself. Every run carries `data-path={run.id}` — the editor opens
 * exactly that run, and the parity test reads the same ids in the same order.
 */

const FONT = 'var(--font-doc, "Times New Roman"), "Times New Roman", Times, "Liberation Serif", serif';

const pt = (n: number) => `${n}pt`;
const mm = (n: number) => `${n}mm`;

function Run({ run, sizePt, block }: { run: TitulRun; sizePt?: number; block?: boolean }) {
  const style: CSSProperties = {
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? "italic" : "normal",
    ...(sizePt ? { fontSize: pt(sizePt) } : {}),
    // A blank signature value stays clickable (and one line high, as the Word cell).
    ...(block ? { display: "block", minHeight: `${SINGLE_LINE}em` } : {}),
  };
  return (
    <span data-path={run.id} style={style}>
      {run.text}
    </span>
  );
}

function Para({ p }: { p: TitulPara }) {
  const style: CSSProperties = {
    textAlign: p.align,
    fontSize: pt(p.sizePt),
    lineHeight: SINGLE_LINE * p.line,
    letterSpacing: p.spacingPt ? pt(p.spacingPt) : undefined,
    paddingTop: pt(p.beforePt),
    paddingBottom: pt(p.afterPt),
    paddingLeft: p.indentMm ? mm(p.indentMm) : undefined,
    margin: 0,
    overflowWrap: "break-word",
  };
  return (
    <p style={style} data-titul-p>
      {p.runs.map((r, i) => (
        <span key={r.id}>
          {i && p.sep ? p.sep : null}
          <Run run={r} />
        </span>
      ))}
    </p>
  );
}

function LineRow({ it }: { it: TitulLineRow }) {
  const grid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `${mm(it.labelMm)} ${mm(it.widthMm - it.labelMm)}`,
    alignItems: "end",
    lineHeight: SINGLE_LINE,
  };
  return (
    <div data-titul-line style={{ marginLeft: mm(it.offsetMm), width: mm(it.widthMm), paddingTop: pt(it.beforePt), paddingBottom: pt(Math.max(it.afterPt, SPACER_PT)) }}>
      <div style={grid}>
        <div style={{ fontSize: pt(it.labelSizePt) }}>{it.label ? <Run run={it.label} /> : null}</div>
        <div style={{ fontSize: pt(it.valueSizePt), textAlign: it.valueAlign, borderBottom: "0.75pt solid #000", overflowWrap: "break-word" }}>
          <Run run={it.value} block />
        </div>
        {it.note ? (
          <>
            <div />
            <div style={{ fontSize: pt(it.noteSizePt), textAlign: "center", paddingTop: pt(NOTE_GAP_PT) }}>
              <Run run={it.note} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Item({ it }: { it: TitulItem }) {
  return it.k === "p" ? <Para p={it} /> : <LineRow it={it} />;
}

const JUSTIFY = { top: "flex-start", center: "center", bottom: "flex-end" } as const;

export function TitulPage({ plan }: { plan: TitulPlan }) {
  const m = plan.page.margin;
  const b = plan.border;
  return (
    <div
      data-titul-sheet
      style={{
        position: "relative",
        width: mm(plan.page.widthMm),
        height: mm(plan.page.heightMm),
        background: "#fff",
        color: "#000",
        overflow: "hidden",
        boxSizing: "border-box",
        padding: `${mm(m.top)} ${mm(m.right)} ${mm(m.bottom)} ${mm(m.left)}`,
        fontFamily: FONT,
      }}
    >
      {b ? (
        <div
          data-titul-border
          aria-hidden
          style={{ position: "absolute", inset: pt(b.offsetPt), border: `${pt(b.linePt * 3)} double #000`, pointerEvents: "none" }}
        />
      ) : null}
      <div style={{ width: mm(contentWidthMm(plan)) }}>
        {plan.zones.map((z) => (
          <div key={z.id} data-titul-zone={z.id} style={{ minHeight: mm(z.heightMm), display: "flex", flexDirection: "column", justifyContent: JUSTIFY[z.valign] }}>
            {z.items.map((it, i) => (
              <Item key={i} it={it} />
            ))}
          </div>
        ))}
        {plan.tail.map((p, i) => (
          <Para key={i} p={p} />
        ))}
      </div>
    </div>
  );
}
