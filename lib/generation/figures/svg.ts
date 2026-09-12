/**
 * Maqola 2 (AUDIT-17) WP3 — `FigureLayout` → SVG satri.
 *
 * Xavfsizlik: HAR matn/atribut `xmlEscape` orqali (model bergan yorliqda
 * `<`/`&` bo'lishi mumkin). Fon oq (`<rect>` — PNG'da shaffoflik yo'q),
 * chiziqlar 1.2 px qora, o'q uchi `<marker>`, matn `text-anchor: middle`.
 *
 * Vertikal markazlash `dominant-baseline` BILAN EMAS — librsvg (sharp) uni
 * to'liq qo'llamaydi; baza chizig'i qo'lda: markaz + 0.35×shrift (serif
 * x-balandligi ≈ 0.45em, katta harf 0.66em — o'rtacha). Shu bilan brauzer,
 * librsvg va Word'da bir xil.
 *
 * Oq-qora chop: `<pattern>` shtrixlar (chart) — `PatternDef` dan.
 */
import { xmlEscape } from "../xml";
import { FONT_FAMILY, FONT_PX, LINE_K, PAD_X, arcSpan, ellipsePt, skewOf, textWidth, type FigureLayout, type LayoutNode, type LayoutText, type PatternDef, type Prim } from "./model";

export type SvgOpts = {
  /** Shrift ro'yxati (standart: TNR → Liberation Serif → Noto Serif → serif). */
  font?: string;
  /** Asosiy shrift pt (standart 11) — maketga nisbatan masshtab. */
  fontSize?: number;
};

const STROKE = "#000";
const STROKE_W = 1.2;
const HATCH = "#1f2933";

function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** Baza chizig'i: markazdan pastga 0.35×shrift. */
function baseline(cy: number, size: number): number {
  return cy + size * 0.35;
}

function patternDef(p: PatternDef): string {
  const id = xmlEscape(p.id);
  const base = xmlEscape(p.base);
  switch (p.kind) {
    case "diag":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="${base}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${HATCH}" stroke-width="1.4"/></pattern>`;
    case "dots":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="6" height="6"><rect width="6" height="6" fill="${base}"/><circle cx="3" cy="3" r="1.2" fill="${HATCH}"/></pattern>`;
    case "cross":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="7" height="7"><rect width="7" height="7" fill="${base}"/><line x1="0" y1="3.5" x2="7" y2="3.5" stroke="${HATCH}" stroke-width="0.9"/><line x1="3.5" y1="0" x2="3.5" y2="7" stroke="${HATCH}" stroke-width="0.9"/></pattern>`;
    case "horiz":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="6" height="6"><rect width="6" height="6" fill="${base}"/><line x1="0" y1="3" x2="6" y2="3" stroke="${HATCH}" stroke-width="1.3"/></pattern>`;
    case "vert":
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="6" height="6"><rect width="6" height="6" fill="${base}"/><line x1="3" y1="0" x2="3" y2="6" stroke="${HATCH}" stroke-width="1.3"/></pattern>`;
    default:
      return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="4" height="4"><rect width="4" height="4" fill="${base}"/></pattern>`;
  }
}

function fillAttr(p: { fill?: string; pattern?: string }): string {
  if (p.pattern) return `fill="url(#${xmlEscape(p.pattern)})"`;
  return `fill="${xmlEscape(p.fill ?? "none")}"`;
}

function shapeSvg(nd: LayoutNode): string {
  const { x, y, w, h } = nd;
  const fill = xmlEscape(nd.fill ?? "#fff");
  const common = `fill="${fill}" stroke="${STROKE}" stroke-width="${STROKE_W}"`;
  switch (nd.shape) {
    case "none":
      // Shaklsiz matn bloki — `fill` berilsa fon to'rtburchagi (chegarasiz), aks holda hech narsa.
      return nd.fill ? `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>` : "";
    case "rounded":
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(nd.rx ?? h / 2)}" ${common}/>`;
    case "diamond":
      return `<polygon points="${n(x + w / 2)},${n(y)} ${n(x + w)},${n(y + h / 2)} ${n(x + w / 2)},${n(y + h)} ${n(x)},${n(y + h / 2)}" ${common}/>`;
    case "parallelogram": {
      const k = skewOf(h);
      return `<polygon points="${n(x + k)},${n(y)} ${n(x + w)},${n(y)} ${n(x + w - k)},${n(y + h)} ${n(x)},${n(y + h)}" ${common}/>`;
    }
    case "ellipse":
      return `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${common}/>`;
    default:
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${common}/>`;
  }
}

/**
 * Ko'p qatorli markazlangan matn (`tspan`); `anchor: "start"` — chapdan
 * (`cx` = matn boshi), `indent` — davom qatorlari chekinishi (NBSP bilan
 * chekinish ishlamaydi: librsvg qator boshidagi bo'shliqni yutadi).
 */
function linesSvg(cx: number, cy: number, lines: string[], size: number, bold?: boolean, anchor: "middle" | "start" = "middle", indent = 0): string {
  const lineH = size * LINE_K;
  const first = baseline(cy - ((lines.length - 1) * lineH) / 2, size);
  const weight = bold ? ` font-weight="bold"` : "";
  const spans = lines.map((l, i) => (i === 0 ? `<tspan x="${n(cx)}" y="${n(first)}">${xmlEscape(l)}</tspan>` : `<tspan x="${n(cx + indent)}" dy="${n(lineH)}">${xmlEscape(l)}</tspan>`)).join("");
  return `<text text-anchor="${anchor}" font-size="${n(size)}"${weight}>${spans}</text>`;
}

function textSvg(t: LayoutText, size: number): string {
  const anchor = t.anchor ?? "middle";
  const attrs = [`x="${n(t.x)}"`, `y="${n(baseline(t.y, size))}"`, `text-anchor="${anchor}"`, `font-size="${n(size)}"`];
  if (t.bold) attrs.push(`font-weight="bold"`);
  if (t.italic) attrs.push(`font-style="italic"`);
  if (t.fill) attrs.push(`fill="${xmlEscape(t.fill)}"`);
  if (t.rotate) attrs.push(`transform="rotate(${n(t.rotate)} ${n(t.x)} ${n(t.y)})"`);
  let halo = "";
  if (t.halo) {
    const w = textWidth(t.text, size) + 4;
    const x = anchor === "middle" ? t.x - w / 2 : anchor === "end" ? t.x - w : t.x;
    halo = `<rect x="${n(x - 1)}" y="${n(t.y - size * 0.6)}" width="${n(w + 2)}" height="${n(size * 1.2)}" fill="#fff" fill-opacity="0.85"/>`;
  }
  return `${halo}<text ${attrs.join(" ")}>${xmlEscape(t.text)}</text>`;
}

function primSvg(p: Prim): string {
  switch (p.k) {
    case "rect":
      return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}"${p.rx ? ` rx="${n(p.rx)}"` : ""} ${fillAttr(p)}${p.stroke ? ` stroke="${xmlEscape(p.stroke)}" stroke-width="1"` : ""}/>`;
    case "line":
      return `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" stroke="${xmlEscape(p.stroke ?? STROKE)}" stroke-width="${n(p.width ?? STROKE_W)}"${p.dash ? ` stroke-dasharray="${xmlEscape(p.dash)}"` : ""}${p.arrow ? ` marker-end="url(#arrow)"` : ""}/>`;
    case "polyline":
      return `<polyline points="${p.points.map((q) => `${n(q.x)},${n(q.y)}`).join(" ")}" fill="none" stroke="${xmlEscape(p.stroke ?? STROKE)}" stroke-width="${n(p.width ?? STROKE_W)}" stroke-linejoin="round"${p.dash ? ` stroke-dasharray="${xmlEscape(p.dash)}"` : ""}/>`;
    case "path":
      return `<path d="${xmlEscape(p.d)}" ${fillAttr(p)}${p.stroke ? ` stroke="${xmlEscape(p.stroke)}" stroke-width="1"` : ""}/>`;
    case "dot":
      return `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.r)}" fill="${xmlEscape(p.fill ?? "#fff")}" stroke="${STROKE}" stroke-width="${STROKE_W}"/>`;
    case "arc": {
      // Yoy: boshlang'ich/oxirgi nuqta ellipsdan; large-arc 0 (yoy < 180°), sweep — bayroq.
      const a = ellipsePt(p.cx, p.cy, p.rx, p.ry, p.a0);
      const b = ellipsePt(p.cx, p.cy, p.rx, p.ry, p.a1);
      const large = Math.abs(arcSpan(p)) > 180 ? 1 : 0;
      return `<path d="M${n(a.x)},${n(a.y)} A${n(p.rx)},${n(p.ry)} 0 ${large} ${p.sweep} ${n(b.x)},${n(b.y)}" fill="none" stroke="${STROKE}" stroke-width="${STROKE_W}"${p.arrow ? ` marker-end="url(#arrow)"` : ""}/>`;
    }
    case "marker": {
      const r = p.r ?? 3.6;
      const fill = xmlEscape(p.fill ?? STROKE);
      const { x, y } = p;
      switch (p.shape) {
        case "square":
          return `<rect x="${n(x - r)}" y="${n(y - r)}" width="${n(2 * r)}" height="${n(2 * r)}" fill="${fill}" stroke="#fff" stroke-width="0.8"/>`;
        case "triangle":
          return `<polygon points="${n(x)},${n(y - r * 1.2)} ${n(x + r * 1.15)},${n(y + r * 0.8)} ${n(x - r * 1.15)},${n(y + r * 0.8)}" fill="${fill}" stroke="#fff" stroke-width="0.8"/>`;
        case "diamond":
          return `<polygon points="${n(x)},${n(y - r * 1.3)} ${n(x + r * 1.3)},${n(y)} ${n(x)},${n(y + r * 1.3)} ${n(x - r * 1.3)},${n(y)}" fill="${fill}" stroke="#fff" stroke-width="0.8"/>`;
        default:
          return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" stroke="#fff" stroke-width="0.8"/>`;
      }
    }
  }
}

/** Maket → SVG. `width`/`height` px (96 dpi) + `viewBox` — `png.ts` zichlikni shundan hisoblaydi. */
export function figureSvg(layout: FigureLayout, opts: SvgOpts = {}): string {
  const font = xmlEscape(opts.font ?? FONT_FAMILY);
  const k = opts.fontSize ? (opts.fontSize * 96) / 72 / FONT_PX : 1;
  const base = layout.fontSize * k;
  const W = Math.max(1, Math.round(layout.w));
  const H = Math.max(1, Math.round(layout.h));
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}" font-size="${n(base)}" fill="#000">`);
  // `arrow-rev` — ikki tomonlama o'q boshi (`marker-start`): `orient="auto-start-reverse"`
  // librsvg eski versiyalarida yo'q, shuning uchun teskari uch alohida marker.
  parts.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${STROKE}"/></marker>` +
      `<marker id="arrow-rev" viewBox="0 0 10 10" refX="0" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M10,0 L0,5 L10,10 z" fill="${STROKE}"/></marker>` +
      `${layout.patterns.map(patternDef).join("")}</defs>`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  if (layout.prims.length) parts.push(`<g>${layout.prims.map(primSvg).join("")}</g>`);
  if (layout.edges.length) {
    const es = layout.edges.map((e) => {
      const pts = e.points.map((p) => `${n(p.x)},${n(p.y)}`).join(" ");
      let s = `<polyline points="${pts}" fill="none" stroke="${STROKE}" stroke-width="${STROKE_W}" stroke-linejoin="round"${e.arrow ? ` marker-end="url(#arrow)"` : ""}${e.arrowStart ? ` marker-start="url(#arrow-rev)"` : ""}/>`;
      if (e.label && e.labelAt) s += textSvg({ x: e.labelAt.x, y: e.labelAt.y, text: e.label, anchor: "middle", halo: true }, base * 0.9);
      return s;
    });
    parts.push(`<g>${es.join("")}</g>`);
  }
  if (layout.nodes.length) {
    const ns = layout.nodes.map((nd) => {
      const size = (nd.size ?? layout.fontSize) * k;
      let s = shapeSvg(nd);
      const pad = PAD_X * (size / FONT_PX);
      s += nd.align === "start" ? linesSvg(nd.x + pad, nd.y + nd.h / 2 + (nd.dy ?? 0), nd.lines, size, nd.bold, "start", nd.indent ?? 0) : linesSvg(nd.x + nd.w / 2, nd.y + nd.h / 2 + (nd.dy ?? 0), nd.lines, size, nd.bold);
      if (nd.badge) {
        const r = 12 * (size / FONT_PX);
        s += `<circle cx="${n(nd.x + nd.w / 2)}" cy="${n(nd.y)}" r="${n(r)}" fill="#fff" stroke="${STROKE}" stroke-width="${STROKE_W}"/>`;
        s += linesSvg(nd.x + nd.w / 2, nd.y, [nd.badge], size * 0.95, true);
      }
      return s;
    });
    parts.push(`<g>${ns.join("")}</g>`);
  }
  if (layout.texts.length) parts.push(`<g>${layout.texts.map((t) => textSvg(t, (t.size ?? layout.fontSize) * k)).join("")}</g>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}
