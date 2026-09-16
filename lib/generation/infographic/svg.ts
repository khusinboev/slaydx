/**
 * INFOGRAFIKA SVG (AUDIT-21 WP-C) — `renderInfographic(layout, palette)`.
 *
 * Nega `figures/svg.ts` ISHLATILMAYDI (tadqiqot §6 ochiq savoli 4):
 * u MONOXROM chizuvchi — `STROKE = "#000"` va `STROKE_W = 1.2` qattiq
 * yozilgan, chunki maqola sxemalari oq-qora chop uchun. Plakat esa
 * rangli va uning butun ma'nosi rangda (dominant tasma, aksent badge,
 * ikon halqasi). O'sha faylni parametrlash 12 ta chaqiruv joyini
 * o'zgartirardi va maqola sxemalarining chop ko'rinishini xavf ostiga
 * qo'yardi. Shuning uchun ALOHIDA fayl — `figures/svg.ts` O'ZGARMAYDI.
 *
 * Rang MAKETDA emas, shu yerda: maket rolni («badge», «iconRing»)
 * aytadi, jadval (`FILL`/`INK`) rolni palitra JUFTLIGIGA bog'laydi.
 * Juftliklar `types.ts` da WCAG bo'yicha qulflangan (`onDominant` faqat
 * `dominant` ustida, `accentInk` faqat `surface` ustida) — shuning
 * uchun bu jadval o'sha shartnomaning yagona ijrochisi.
 *
 * Birlik — MILLIMETR: `viewBox="0 0 210 297"`. `figurePng` zichlikni
 * `viewBox` kengligi va `widthMm` dan hisoblaydi, ya'ni mm li viewBox
 * bilan A4 @300 dpi AYNAN 2480 px chiqadi.
 *
 * Shrift: Liberation Sans → Noto Sans (worker Dockerfile: `ttf-liberation`
 * + `font-noto`, `tests/dockerfile-fonts` qulflaydi). SANS — plakat
 * matni yirik va uzoqdan o'qiladi; `figures/*` dagi serif ro'yxati
 * (TNR → Liberation Serif) hujjat ichidagi sxema uchun.
 *
 * Vertikal markazlash `dominant-baseline` BILAN EMAS (librsvg uni
 * to'liq qo'llamaydi) — baza chizig'i maketda hisoblangan, `figures/
 * svg.ts` dagi bilan bir xil qaror.
 */
import { xmlEscape } from "../xml";
import { ICON_GRID, ICON_STROKE, iconPaths } from "./icons";
import type { InfographicLayout, InfographicShape, InfographicText, ShapeRole, TextRole } from "./layout";
import { LINE_K } from "./layout";
import type { Palette } from "./types";

export const INFOGRAPHIC_FONT = "Liberation Sans, Noto Sans, DejaVu Sans, Arial, Helvetica, sans-serif";

/* ────────────────────────── rang jadvali ────────────────────────── */

/** Shaklning TO'LDIRISH rangi (`null` — to'ldirilmaydi, faqat chiziq). */
export function fillOf(role: ShapeRole, p: Palette): string | null {
  switch (role) {
    case "page":
      return p.surface;
    case "header":
    case "columnHead":
    case "root":
      return p.dominant;
    case "card":
      return "#FFFFFF";
    case "cardTint":
    case "columnTint":
      // Aksent FONI emas — kartochka ustidagi matn `text` bilan yoziladi,
      // shuning uchun tint DOIM oq bilan aralashtirilgan yengil qatlam.
      return mix(p.dominant, "#FFFFFF", 0.07);
    case "badge":
    case "iconRing":
    case "columnHeadAlt":
      return p.accent;
    case "dot":
      return p.accent;
    default:
      return null;
  }
}

/** Shaklning CHIZIQ rangi. */
function strokeOf(role: ShapeRole, p: Palette): string | null {
  switch (role) {
    case "card":
    case "cardTint":
    case "columnTint":
      return mix(p.dominant, "#FFFFFF", 0.22);
    case "rail":
    case "connector":
      return p.dominant;
    case "dot":
      return p.dominant;
    case "flow":
      return p.accentInk;
    case "divider":
    case "rule":
      return mix(p.text, "#FFFFFF", 0.35);
    default:
      return null;
  }
}

/** Matn ROLI → siyoh. Juftliklar `types.ts` izohida qulflangan. */
export function inkOf(role: TextRole, p: Palette): string {
  switch (role) {
    case "title":
    case "subtitle":
    case "root":
      return p.onDominant;
    case "columnHead":
      return p.onDominant;
    case "columnHeadAlt":
      // Ikkinchi ustun tasmasi `accent` FONIDA — `types.ts` da aynan shu
      // juftlik (`accent` + `onAccent`) qulflangan.
      return p.onAccent;
    case "badge":
      return p.onAccent;
    case "heading":
      return p.dominant;
    case "stat":
    case "when":
      return p.accentInk;
    case "source":
    case "statLabel":
      // Ikkilamchi siyoh — asosiy matnning 62 % i. Ko'z sinovida 28 %
      // deyarli ko'rinmasdi (`stat` namunasidagi «kitob» yorlig'i).
      return mix(p.text, p.surface, 0.62);
    default:
      return p.text;
  }
}

/* ────────────────────────── yordamchilar ────────────────────────── */

const n = (v: number): string => String(Math.round(v * 1000) / 1000);

function hex(c: string): [number, number, number] {
  const s = c.replace("#", "");
  const f = s.length === 3 ? s.split("").map((x) => x + x).join("") : s;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}

/** `a` ning `t` ulushi + `b` ning qolgani (0 → sof `b`). */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  const m = (x: number, y: number) => Math.round(x * t + y * (1 - t));
  return `#${[m(r1, r2), m(g1, g2), m(b1, b2)].map((v) => v.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

/* ────────────────────────── chizish ────────────────────────── */

const ARROW_ID = "ig-arrow";

function shapeSvg(sh: InfographicShape, p: Palette, k: number): string {
  if (sh.k === "icon") {
    const scale = sh.size / ICON_GRID;
    const d = iconPaths(sh.name)
      .map((path) => `<path d="${xmlEscape(path)}"/>`)
      .join("");
    return `<g transform="translate(${n(sh.x)} ${n(sh.y)}) scale(${n(scale)})" fill="none" stroke="${xmlEscape(p.onAccent)}" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;
  }
  const fill = fillOf(sh.role, p);
  const stroke = strokeOf(sh.role, p);
  if (sh.k === "rect") {
    const attrs = [
      `x="${n(sh.x)}"`,
      `y="${n(sh.y)}"`,
      `width="${n(sh.w)}"`,
      `height="${n(sh.h)}"`,
      sh.rx === undefined ? "" : `rx="${n(sh.rx)}"`,
      `fill="${xmlEscape(fill ?? "none")}"`,
      stroke ? `stroke="${xmlEscape(stroke)}" stroke-width="${n(k * 0.25)}"` : "",
    ].filter(Boolean);
    return `<rect ${attrs.join(" ")}/>`;
  }
  if (sh.k === "circle") {
    const attrs = [
      `cx="${n(sh.cx)}"`,
      `cy="${n(sh.cy)}"`,
      `r="${n(sh.r)}"`,
      `fill="${xmlEscape(fill ?? "none")}"`,
      stroke ? `stroke="${xmlEscape(stroke)}" stroke-width="${n(k * 0.4)}"` : "",
    ].filter(Boolean);
    return `<circle ${attrs.join(" ")}/>`;
  }
  const attrs = [
    `x1="${n(sh.x1)}"`,
    `y1="${n(sh.y1)}"`,
    `x2="${n(sh.x2)}"`,
    `y2="${n(sh.y2)}"`,
    `stroke="${xmlEscape(stroke ?? p.text)}"`,
    `stroke-width="${n(sh.w)}"`,
    `stroke-linecap="round"`,
    sh.dash ? `stroke-dasharray="${n(k * 1.4)} ${n(k * 1.4)}"` : "",
    sh.arrow ? `marker-end="url(#${ARROW_ID})"` : "",
  ].filter(Boolean);
  return `<line ${attrs.join(" ")}/>`;
}

function textSvg(t: InfographicText, p: Palette): string {
  const ink = inkOf(t.role, p);
  const anchor = t.anchor ?? "middle";
  const spans = t.lines
    .map((line, i) => `<tspan x="${n(t.x)}"${i ? ` dy="${n(t.lh)}"` : ""}>${xmlEscape(line)}</tspan>`)
    .join("");
  return `<text x="${n(t.x)}" y="${n(t.y)}" font-size="${n(t.size)}" fill="${xmlEscape(ink)}" text-anchor="${anchor}"${t.bold ? ` font-weight="700"` : ""}>${spans}</text>`;
}

/**
 * Maket + palitra → SVG satri.
 *
 * `font` — testlar va kelgusi shrift almashtirishi uchun; standart
 * `INFOGRAPHIC_FONT`. HAR matn/atribut `xmlEscape` dan o'tadi (model
 * bergan sarlavhada `<`/`&` bo'lishi mumkin).
 */
export function renderInfographic(layout: InfographicLayout, palette: Palette, opts: { font?: string } = {}): string {
  const { w, h } = layout.mm;
  const k = w / 210;
  const font = opts.font ?? INFOGRAPHIC_FONT;
  const arrowScale = k * 1.1;
  const defs = `<defs><marker id="${ARROW_ID}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${n(arrowScale * 5)}" markerHeight="${n(arrowScale * 5)}" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${xmlEscape(palette.accentInk)}"/></marker></defs>`;
  const body = [...layout.shapes.map((s) => shapeSvg(s, palette, k)), ...layout.texts.map((t) => textSvg(t, palette))].join("");
  return [
    /*
     * `width`/`height` — BIRLIKSIZ (`210`, `mm` EMAS): `figures/png.ts`
     * zichlikni `viewBox` kengligidan hisoblaydi va librsvg ni «1 user
     * unit = 1/72 dyuym» deb oladi. `210mm` yozilsa librsvg o'lchamni
     * o'zi mm dan px ga o'girar va A4 @300 dpi 2480 o'rniga 7027 px
     * chiqardi (zichlik ikki marta qo'llanardi).
     */
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" font-family="${xmlEscape(font)}">`,
    defs,
    `<rect x="0" y="0" width="${n(w)}" height="${n(h)}" fill="${xmlEscape(palette.surface)}"/>`,
    body,
    `</svg>`,
  ].join("");
}

/** Qator oralig'i ko'paytuvchisi — maket bilan BITTA manbadan. */
export { LINE_K };
