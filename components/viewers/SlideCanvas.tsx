import type { CSSProperties } from "react";
import type { SlideVisual } from "@/lib/generation/slide-templates";
import type { SlideModel, SlideTheme } from "@/lib/generation/slide-types";
import {
  boxStyle,
  cssColor,
  planSlide,
  ptToPx,
  SLIDE_FONT,
  SLIDE_IN,
  type SlideLayer,
} from "@/lib/generation/slide-layout";
import { SLIDE } from "@/lib/viewers/metrics";

export function SlideCanvas({
  slide,
  theme,
  visual = "classic",
  index,
  total,
}: {
  slide: SlideModel;
  theme: SlideTheme;
  visual?: SlideVisual;
  index: number;
  total: number;
}) {
  const plan = planSlide(slide, theme, visual, index, total);
  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: SLIDE.w,
        height: SLIDE.h,
        background: plan.bg,
        fontFamily: SLIDE_FONT,
      }}
    >
      {plan.layers.map((layer, i) => (
        <LayerView key={i} layer={layer} />
      ))}
    </div>
  );
}

function LayerView({ layer }: { layer: SlideLayer }) {
  const box = boxStyle(layer.box);
  if (layer.t === "rect") {
    return (
      <div
        className="absolute"
        style={{
          ...box,
          background: layer.fill ? cssColor(layer.fill.color, layer.fill.alpha) : "transparent",
          borderRadius: layer.radius ? layer.radius * 96 : 0,
          border: layer.line ? `${layer.line.width}px solid ${layer.line.color}` : undefined,
        }}
      />
    );
  }
  if (layer.t === "image") {
    return (
      <div className="absolute overflow-hidden bg-neutral-900" style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={layer.url}
          alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }}
        />
      </div>
    );
  }
  const align = layer.align === "center" ? "center" : layer.align === "right" ? "flex-end" : "flex-start";
  const valign = layer.valign === "middle" ? "center" : layer.valign === "bottom" ? "flex-end" : "flex-start";
  const style: CSSProperties = {
    ...box,
    color: layer.color,
    fontSize: ptToPx(layer.size),
    fontWeight: layer.bold ? 700 : 500,
    fontStyle: layer.italic ? "italic" : "normal",
    letterSpacing: layer.tracking ? layer.tracking * 0.6 : undefined,
    textTransform: layer.uppercase ? "uppercase" : undefined,
    lineHeight: 1.22,
    display: "flex",
    flexDirection: "column",
    alignItems: align,
    justifyContent: valign,
    overflow: "hidden",
    textAlign: layer.align || "left",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };
  if (layer.lines?.length) {
    return (
      <div className="absolute" style={style}>
        <ul
          className={layer.bullets ? "w-full list-disc pl-[1.15em]" : "w-full list-none"}
          style={{ margin: 0, paddingLeft: layer.bullets ? "1.15em" : 0 }}
        >
          {layer.lines.map((line, i) => (
            <li key={`${i}-${line.slice(0, 24)}`} style={{ marginBottom: layer.paraSpace ?? 8 }}>
              {line}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="absolute" style={style}>
      {layer.text}
    </div>
  );
}

export const SLIDE_STAGE = { w: SLIDE.w, h: SLIDE.h, in: SLIDE_IN };
