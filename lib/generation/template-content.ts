import type { TemplateProfile, TemplateRole } from "./pptx-template";
import type { SlideLayout, SlideModel, SlideSrc } from "./slide-types";

/**
 * «O'z shablonim» — `SlideModel` → namuna ROLI va MATN BLOKLARI.
 *
 * Izomorf (JSZip yo'q): PPTX yozuvchisi (`render-pptx-template.ts`) ham,
 * ko'ruvchi planeri (`slide-custom.ts`) ham SHU xaritadan o'qiydi —
 * «ko'rdim = oldim»: qaysi slayd qaysi layoutga tushishi va unda qaysi
 * matn chiqishi bir joyda hal qilinadi.
 */

export type Para = { text: string; bold?: boolean; lvl?: number; src?: SlideSrc };
export type TemplateContent = {
  title: string;
  sub: string;
  bodies: Para[][];
  table?: { headers: string[]; rows: string[][] };
};

/** `SlideLayout` → namuna roli (mavjud rollarga qarab tushadi). */
export function roleFor(layout: SlideLayout, hasImage: boolean, roles: TemplateProfile["roles"]): TemplateRole {
  if (layout === "title" || layout === "closing") return "cover";
  if (layout === "section") return roles.section ? "section" : "cover";
  if (layout === "twoCol" || layout === "compare") return roles.two ? "two" : "content";
  if (hasImage && roles.picture && (layout === "bullets" || layout === "agenda" || layout === "quote")) return "picture";
  return "content";
}

/** Modeldan matn bloklari: sarlavha, izoh, tana(lar), jadval. `src` — ko'ruvchida tahrir manbasi. */
export function contentOf(s: SlideModel): TemplateContent {
  const lines = (f: "bullets" | "left" | "right", arr?: string[]): Para[] => (arr ?? []).map((t, i) => ({ text: t, src: { f, i } }));
  switch (s.layout) {
    case "title":
    case "closing":
      return { title: s.title, sub: s.subtitle ?? "", bodies: [] };
    case "section":
      return { title: s.title, sub: s.subtitle ?? "", bodies: s.subtitle ? [[{ text: s.subtitle, src: { f: "subtitle" } }]] : [] };
    case "twoCol":
    case "compare":
      return {
        title: s.title,
        sub: "",
        bodies: [
          [...(s.leftTitle ? [{ text: s.leftTitle, bold: true, src: { f: "leftTitle" } as SlideSrc }] : []), ...lines("left", s.left)],
          [...(s.rightTitle ? [{ text: s.rightTitle, bold: true, src: { f: "rightTitle" } as SlideSrc }] : []), ...lines("right", s.right)],
        ],
      };
    case "quote":
      return {
        title: s.title,
        sub: "",
        bodies: [[{ text: `“${s.quote || s.title}”`, src: { f: "quote" } }, ...(s.quoteBy ? [{ text: `— ${s.quoteBy}`, src: { f: "quoteBy" } as SlideSrc }] : [])]],
      };
    case "stats":
      return { title: s.title, sub: "", bodies: [(s.stats ?? []).map((st) => ({ text: `${st.value} — ${st.label}` }))] };
    case "process":
      return { title: s.title, sub: "", bodies: [(s.steps ?? []).map((st) => ({ text: `${st.n}. ${st.title}${st.text ? ` — ${st.text}` : ""}` }))] };
    case "table":
      return { title: s.title, sub: "", bodies: [], table: s.table };
    case "quiz": {
      const q = s.quiz?.[0];
      const letters = ["A", "B", "C", "D"];
      return { title: q?.q ?? s.title, sub: "", bodies: [(q?.options ?? []).map((o, i) => ({ text: `${letters[i] ?? i + 1}) ${o}` }))] };
    }
    case "references":
      return { title: s.title, sub: "", bodies: [(s.refs ?? []).map((r) => ({ text: r.source ? `${r.title} — ${r.source}` : r.title }))] };
    default:
      return { title: s.title, sub: "", bodies: [lines("bullets", s.bullets)] };
  }
}
