import { bodyRules } from "./slide-audience";
import { deckFooter } from "./slide-identity";
import { resolveSlideTemplate } from "./slide-templates";
import { getSlideTheme } from "./slide-themes";
import type { SlideDeck, SlideModel, SlideThemeId } from "./slide-types";
import type { AcademicDoc } from "./types";

export type { SlideDeck, SlideLayout, SlideModel, SlideThemeId } from "./slide-types";

export function buildSlideDeck(doc: AcademicDoc): SlideDeck {
  const themeId = (doc.slideTheme || doc.meta.slideTheme || "atlas") as SlideThemeId;
  getSlideTheme(themeId);
  const tpl = resolveSlideTemplate(doc.slideTemplate || doc.meta.slideTemplate, doc.meta.topic, doc.meta.extra);
  /*
   * Deck darajasidagi qiymatlar BIR marta hisoblanadi va ikkala renderer
   * (PPTX, ko'ruvchi) shu obyektdan o'qiydi. Eski `doc_json` da yangi
   * meta maydonlari yo'q — `bodyRules`/`??` standartga tushadi.
   */
  const common = {
    topic: doc.meta.topic,
    author: doc.meta.author,
    workLabel: doc.meta.workLabel,
    themeId,
    templateId: tpl.id,
    visual: tpl.visual,
    audience: doc.meta.slideAudience ?? "auto",
    bodyType: bodyRules(doc.meta, tpl.id),
    logo: doc.slideLogo?.url || undefined,
    custom: doc.customTemplate,
    speakerNotes: doc.meta.speakerNotes !== false,
  };
  if (doc.slides?.length) return { ...common, slides: doc.slides };
  return { ...common, slides: legacyFromSections(doc) };
}

function clip(text: string, n: number) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

function legacyFromSections(doc: AcademicDoc): SlideModel[] {
  const footer = deckFooter(doc.meta);
  const slides: SlideModel[] = [
    {
      id: "title",
      layout: "title",
      title: doc.meta.topic,
      subtitle: doc.meta.workLabel,
      footer,
    },
    {
      id: "agenda",
      layout: "agenda",
      title: "Reja",
      bullets: doc.sections.map((s, i) => `${i + 1}. ${s.title}`),
      footer,
    },
  ];
  for (const s of doc.sections) {
    const bullets = s.blocks
      .filter((b) => b.kind === "p" || b.kind === "li" || b.kind === "h2" || b.kind === "h3")
      .slice(0, 6)
      .map((b) => (b.kind === "h2" || b.kind === "h3" ? b.text : clip(b.text, 180)));
    slides.push({ id: s.id, layout: "bullets", title: s.title, bullets, footer });
  }
  slides.push({
    id: "end",
    layout: "closing",
    title: "Xulosa",
    subtitle: "Savollar va muhokama",
    footer: doc.meta.topic,
  });
  return slides;
}
