import type { CSSProperties } from "react";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "@/lib/generation/slide-templates";
import type { BodyRules } from "@/lib/generation/slide-audience";
import type { SlideModel, SlideTheme } from "@/lib/generation/slide-types";
import { cn } from "@/lib/cn";
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
import { clipLines, revealBudgets, totalChars } from "@/lib/viewers/reveal";

export function SlideCanvas({
  slide,
  theme,
  visual = "classic",
  index,
  total,
  audience = "auto",
  templateId = "lecture",
  bodyType,
  logo,
  reveal,
}: {
  slide: SlideModel;
  theme: SlideTheme;
  visual?: SlideVisual;
  index: number;
  total: number;
  audience?: SlideAudience;
  templateId?: SlideTemplateId;
  /** Deck darajasida (`buildSlideDeck`) — PPTX bilan bir xil qiymat. */
  bodyType?: BodyRules;
  logo?: string;
  /**
   * Jonli «yozilmoqda»: ko'rsatiladigan matn ULUSHI, 0..1.
   *
   * `undefined` — STANDART yo'l: HTML tayyor hujjatdagi bilan AYNAN bir
   * xil chiziladi (`tests/viewer/parity.test.mts` va `live.test.mts`
   * paritet sinovlari shuni qo'riqlaydi). Faqat qiymat berilgandagina
   * matn qatlamlari kumulyativ byudjet bo'yicha qisqartiriladi; rasm va
   * to'rtburchaklar hech qachon qisqarmaydi — sahifa «sakramaydi»,
   * ustiga matn yozilaveradi.
   */
  reveal?: number;
}) {
  const plan = planSlide(slide, theme, visual, index, total, audience, templateId, { bodyType, logo });
  const budgets =
    reveal === undefined ? null : revealBudgets(plan.layers, Math.max(0, Math.min(1, reveal)) * totalChars(plan.layers));
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
        <LayerView key={i} layer={layer} budget={budgets ? budgets[i] : undefined} />
      ))}
    </div>
  );
}

function LayerView({ layer, budget }: { layer: SlideLayer; budget?: number }) {
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
    /*
     * `fit` PPTX `sizing` bilan bir xil. `contain` (logo) uchun qora fon
     * YO'Q: PPTX rasm ortiga hech narsa chizmaydi, ko'ruvchi esa fotoni
     * yuklanguncha to'q fon bilan yopadi — logo ostida bu qora quti bo'lib
     * ko'rinardi va «ko'rdim = oldim» buzilardi.
     */
    const fit = layer.fit ?? "cover";
    return (
      <div className={cn("absolute overflow-hidden", fit === "cover" && "bg-neutral-900")} style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={layer.url}
          alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fit, objectPosition: "center" }}
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
      <div
        className="absolute"
        style={style}
        data-layer="text"
        data-src-list={layer.srcLines ? "1" : undefined}
      >
        <ul
          className={layer.bullets ? "w-full list-disc pl-[1.15em]" : "w-full list-none"}
          style={{ margin: 0, paddingLeft: layer.bullets ? "1.15em" : 0 }}
        >
          {/*
            `budget === undefined` — standart yo'l: massiv AYNAN eskicha
            aylanadi (paritet). Byudjet berilganda esa qisqartirilgan
            qatorlar ro'yxati, lekin `key`/`data-src` uchun ASL indeks
            saqlanadi — yozilib bo'lgan qator qayta «tug'ilmaydi».
          */}
          {(budget === undefined
            ? layer.lines.map((line, i) => ({ line, i }))
            : clipLines(layer.lines, budget)
          ).map(({ line, i }) => {
            const lineSrc = layer.srcLines?.[i];
            return (
              /*
               * `paraSpace` PUNKTDA o'lchanadi — `fitLines` uni `box.h * 72`
               * (punkt) byudjetiga qo'shadi va `render-pptx.ts` uni
               * `paraSpaceAfter` ga punkt sifatida uzatadi. Bu yerda u xom
               * son bo'lib CSS PIKSELIGA tushardi, ya'ni ko'ruvchi bandlar
               * orasini faylga qaraganda ~25% tor chizardi — «ko'rdim =
               * oldim» buzilishi. Yonidagi `fontSize` allaqachon `ptToPx`
               * dan o'tadi.
               */
              <li
                key={`${i}-${line.slice(0, 24)}`}
                style={{ marginBottom: ptToPx(layer.paraSpace ?? 8) }}
                data-src={lineSrc ? JSON.stringify(lineSrc) : undefined}
              >
                {line}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  return (
    <div
      className="absolute"
      style={style}
      data-layer="text"
      data-src={layer.src ? JSON.stringify(layer.src) : undefined}
    >
      {budget === undefined ? layer.text : (layer.text ?? "").slice(0, budget)}
    </div>
  );
}

export const SLIDE_STAGE = { w: SLIDE.w, h: SLIDE.h, in: SLIDE_IN };
