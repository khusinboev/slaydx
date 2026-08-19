import { languageDirective, slideLabels } from "./i18n";
import { sourceBlock } from "./prompts";
import { parseLlmJson } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { attachSlideImages } from "./slide-images";
import { resolveSlideTemplate, type SlideTemplate } from "./slide-templates";
import { getSlideTheme } from "./slide-themes";
import { isSlideLayout, type SlideLayout, type SlideModel, type SlideThemeId } from "./slide-types";
import type { AcademicDoc, DocMeta } from "./types";

const MAX_BULLETS = 6;

function clip(text: string, n: number) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

function arr(v: unknown, n: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => clip(String(x ?? ""), maxLen))
    .filter(Boolean)
    .slice(0, n);
}

function asLayout(v: unknown, fallback: SlideLayout): SlideLayout {
  return typeof v === "string" && isSlideLayout(v) ? v : fallback;
}

function normalizeSlide(raw: unknown, i: number, footer: string): SlideModel | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const layout = asLayout(o.layout, "bullets");
  const title = clip(String(o.title ?? ""), 80);
  if (!title && layout !== "closing") return null;
  const base: SlideModel = {
    id: `s${i}`,
    layout,
    title: title || "Slayd",
    kicker: o.kicker ? clip(String(o.kicker), 40) : undefined,
    subtitle: o.subtitle ? clip(String(o.subtitle), 140) : undefined,
    footer,
    imageHint: o.imageHint ? clip(String(o.imageHint), 180) : undefined,
  };
  if (layout === "twoCol" || layout === "compare") {
    return {
      ...base,
      leftTitle: clip(String(o.leftTitle ?? (layout === "compare" ? "Birinchi" : "")), 40),
      left: arr(o.left, 5, 110),
      rightTitle: clip(String(o.rightTitle ?? (layout === "compare" ? "Ikkinchi" : "")), 40),
      right: arr(o.right, 5, 110),
    };
  }
  if (layout === "quote") {
    return {
      ...base,
      quote: clip(String(o.quote ?? o.subtitle ?? title), 220),
      quoteBy: o.quoteBy ? clip(String(o.quoteBy), 60) : undefined,
    };
  }
  if (layout === "stats") {
    const stats = Array.isArray(o.stats)
      ? o.stats
          .map((s) => {
            if (!s || typeof s !== "object") return null;
            const x = s as Record<string, unknown>;
            const value = clip(String(x.value ?? ""), 24);
            const label = clip(String(x.label ?? ""), 60);
            return value ? { value, label } : null;
          })
          .filter((x): x is { value: string; label: string } => Boolean(x))
          .slice(0, 4)
      : [];
    return { ...base, stats: stats.length ? stats : [{ value: "—", label: title }] };
  }
  if (layout === "process") {
    const steps = Array.isArray(o.steps)
      ? o.steps
          .map((s, n) => {
            if (!s || typeof s !== "object") return null;
            const x = s as Record<string, unknown>;
            const t = clip(String(x.title ?? ""), 40);
            if (!t) return null;
            return { n: String(x.n ?? n + 1), title: t, text: clip(String(x.text ?? ""), 90) };
          })
          .filter((x): x is { n: string; title: string; text: string } => Boolean(x))
          .slice(0, 5)
      : [];
    return { ...base, steps };
  }
  return { ...base, bullets: arr(o.bullets, MAX_BULLETS, 140) };
}

function parseDeckJson(raw: string, footer: string, want: number): SlideModel[] {
  const data = parseLlmJson(raw) as { slides?: unknown } | null;
  if (!Array.isArray(data?.slides)) return [];
  return data.slides
    .map((s, i) => normalizeSlide(s, i, footer))
    .filter((s): s is SlideModel => Boolean(s))
    .slice(0, Math.max(8, Math.min(18, want + 2)));
}

function beatToSlide(beat: { layout: SlideLayout; role: string }, i: number, meta: DocMeta, footer: string): SlideModel {
  const t = meta.topic;
  const L = slideLabels(meta.language);
  const base: SlideModel = { id: `s${i}`, layout: beat.layout, title: beat.role, footer };
  if (beat.layout === "title") {
    return { ...base, title: t, subtitle: beat.role, kicker: meta.subject || meta.workLabel };
  }
  if (beat.layout === "closing") {
    return { ...base, title: L.conclusion, subtitle: beat.role };
  }
  if (beat.layout === "agenda") {
    return { ...base, title: beat.role, bullets: [`${t}: kirish`, "Asosiy qism", "Amaliyot", "Xulosa"] };
  }
  if (beat.layout === "section") {
    return { ...base, title: beat.role, subtitle: t };
  }
  if (beat.layout === "compare" || beat.layout === "twoCol") {
    return {
      ...base,
      leftTitle: beat.layout === "compare" ? "A" : "Chap",
      left: [`${t}: birinchi tomon`],
      rightTitle: beat.layout === "compare" ? "B" : "O‘ng",
      right: [`${t}: ikkinchi tomon`],
    };
  }
  if (beat.layout === "process") {
    return {
      ...base,
      steps: [
        { n: "1", title: "Boshlash", text: beat.role },
        { n: "2", title: "O‘zgarish", text: t },
        { n: "3", title: "Natija", text: "Kuzatiladigan yakun" },
      ],
    };
  }
  if (beat.layout === "stats") {
    return { ...base, stats: [{ value: "3", label: "Asosiy nuqta" }, { value: "1", label: beat.role }] };
  }
  if (beat.layout === "quote") {
    return { ...base, quote: `${t} — ${beat.role.toLowerCase()}.` };
  }
  return { ...base, bullets: [`${t}: ${beat.role}.`, "Mavzuga bog‘liq aniq band."] };
}

export function fallbackSlides(meta: DocMeta, tpl?: SlideTemplate): SlideModel[] {
  const footer = [meta.author, meta.university].filter(Boolean).join(" · ");
  const template = tpl ?? resolveSlideTemplate(meta.slideTemplate, meta.topic, meta.extra);
  const beats = template.beats.length ? template.beats : resolveSlideTemplate("lecture", meta.topic).beats;
  return beats.map((b, i) => beatToSlide(b, i, meta, footer));
}

function slideSystem(meta: DocMeta) {
  return [
    languageDirective(meta.language),
    `Siz professional taqdimot muallifisiz.`,
    `Auditoriyasi: talaba / o‘qituvchi / himoya komissiyasi.`,
    `Mavzu: «${meta.topic}». Fan: ${meta.subject || "—"}.`,
    `Faqat JSON qaytaring. Matn qisqa, aniq, slaydga sig‘adigan.`,
    `QAT’IY TAQIQLANADI: umumiy pedagogika shablonlari (kompetensiya, auditoriya, UNESCO, differensiatsiya, «tashxis-baholash» sikli), mavzuga tegishli bo‘lmagan soha (masalan, dvigatel yoki «milliy ta’lim»).`,
    `YOZING: shu mavzuning o‘zi — ta’rif, tuzilish/jarayon, turlari, misol, ahamiyat, cheklov.`,
    `Har bir bullet 1 gap, 140 belgidan oshmasin. Sarlavha 6–8 so‘z.`,
    `Har slaydda imageHint: 12–20 so‘z, ANIQ vizual (inglizcha yoki o‘zbekcha), shu slayd mazmunidagi narsa/joy/asbob. Mavzudan chiqib ketmasin.`,
    `title slaydning title maydoni foydalanuvchi mavzusini saqlasin.`,
    `kicker qisqa (2–4 so‘z), masalan «Biologiya» yoki «Taqdimot». Qo‘shimcha talabni kicker qilmang.`,
    `stats ga uydirma milliard/tonna/foiz YOZILMASIN. Formula, bosqich soni, ma’lum birlik (masalan C6H12O6, 2 bosqich) mumkin.`,
    meta.extra ? `Qo‘shimcha talab: ${meta.extra}` : "",
    sourceBlock(meta),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function writeSlidesWithLlm(meta: DocMeta, tpl: SlideTemplate): Promise<SlideModel[] | null> {
  if (!llmEnabled()) return null;
  const want = tpl.beats.length || Math.max(8, Math.min(16, meta.targetPages || 10));
  const footer = [meta.author, meta.university].filter(Boolean).join(" · ");
  const seq = tpl.beats.map((b, i) => `${i + 1}) layout=${b.layout} — ${b.role}`).join("\n");
  const user = [
    `«${meta.topic}» bo‘yicha shablon: ${tpl.nameUz} (${tpl.blurb}).`,
    `QAT’IY shu tartibdagi slaydlar (layout ni o‘zgartirmang):`,
    seq,
    `Har slayd mazmuni shu rolga mos, mavzudan chiqmasin.`,
    `JSON sxema: {"slides":[{"layout":"title|agenda|section|bullets|twoCol|compare|quote|stats|process|closing","kicker":"","title":"","subtitle":"","imageHint":"","bullets":[""],"leftTitle":"","left":[""],"rightTitle":"","right":[""],"quote":"","quoteBy":"","stats":[{"value":"","label":""}],"steps":[{"n":"1","title":"","text":""}]}]}`,
  ].join("\n");
  const raw = await llmComplete(slideSystem(meta), user, 5000, { json: true, timeoutMs: 90_000 });
  if (!raw) return null;
  const slides = parseDeckJson(raw, footer, want);
  if (slides.length < Math.min(6, tpl.beats.length || 8)) {
    console.warn("[slide-write] too few slides", slides.length);
    return null;
  }
  if (tpl.beats.length) {
    slides.forEach((s, i) => {
      if (tpl.beats[i]) s.layout = tpl.beats[i].layout;
    });
  }
  const L = slideLabels(meta.language);
  if (slides[0].layout !== "title") {
    slides.unshift({
      id: "title-fix",
      layout: "title",
      title: meta.topic,
      subtitle: meta.workLabel,
      kicker: meta.subject && meta.subject !== meta.workLabel ? meta.subject : L.presentation,
      footer,
    });
  } else {
    const kick = clip(slides[0].kicker || meta.subject || L.presentation, 28);
    const same = kick.toLowerCase() === meta.topic.toLowerCase();
    slides[0] = {
      ...slides[0],
      title: meta.topic,
      kicker: same ? clip(meta.subject || meta.workLabel || L.presentation, 28) : kick,
    };
  }
  if (slides[slides.length - 1].layout !== "closing") {
    slides.push({
      id: "end-fix",
      layout: "closing",
      title: L.conclusion,
      subtitle: L.questions,
      footer,
    });
  }
  return slides;
}

export async function buildSlideAcademicDoc(meta: DocMeta, deadline?: number): Promise<AcademicDoc> {
  const themeId = (meta.slideTheme || "atlas") as SlideThemeId;
  getSlideTheme(themeId);
  const tpl = resolveSlideTemplate(meta.slideTemplate, meta.topic, meta.extra);
  const slides = (await writeSlidesWithLlm(meta, tpl)) ?? fallbackSlides(meta, tpl);
  // Matn tayyor — qolgan vaqtni rasmga beramiz, lekin PPTX yig'ish uchun
  // kamida ~12 soniya qoldiramiz.
  const budget = deadline ? Math.max(0, deadline - Date.now() - 12_000) : 60_000;
  await attachSlideImages(slides, meta.topic, tpl.visual, budget);
  const sections = slides
    .filter((s) => s.layout !== "title" && s.layout !== "closing")
    .map((s) => ({
      id: s.id,
      title: s.title,
      blocks: (s.bullets?.length ? s.bullets : [s.subtitle || s.quote || s.title]).map((text) => ({
        kind: "p" as const,
        text,
      })),
    }));
  return {
    meta,
    titlePage: true,
    toc: true,
    sections,
    slideTheme: themeId,
    slideTemplate: tpl.id,
    slides,
  };
}
