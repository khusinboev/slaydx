import { languageDirective, slideLabels } from "./i18n";
import { sourceBlock } from "./prompts";
import { parseLlmJson } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { attachSlideImages } from "./slide-images";
import {
  audienceRules,
  expandBeats,
  resolveSlideTemplate,
  type SlideBeat,
  type SlideTemplate,
} from "./slide-templates";
import { getSlideTheme } from "./slide-themes";
import { isSlideLayout, type SlideLayout, type SlideModel, type SlideThemeId } from "./slide-types";
import type { AcademicDoc, DocMeta } from "./types";

/**
 * Slide Law: bir slaydda 3–4 tadan ortiq band bo'lmasin, agenda'da 5 ta.
 *
 * Ilgari 6 ta band × 140 belgi = ~840 belgilik matn devori chiqardi va
 * `shrinkText` uni 11 pt gacha kichraytirardi — proyektorda o'qib
 * bo'lmasdi. Uzun izoh endi slaydga emas, notiq eslatmasiga tushadi.
 *
 * Aniq chegara auditoriyaga bog'liq (`AUDIENCE_RULES`): maktab sinfida
 * 3 ta qisqa band, himoyada 4 ta.
 */
const MAX_AGENDA_ITEMS = 5;

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

type BulletRules = { maxBullets: number; bulletChars: number };

function normalizeSlide(raw: unknown, i: number, footer: string, rules: BulletRules): SlideModel | null {
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
    notes: o.notes ? clip(String(o.notes), 700) : undefined,
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
  if (layout === "table") {
    const src = (o.table ?? o) as Record<string, unknown>;
    const headers = arr(src.headers, 5, 28);
    const rows = Array.isArray(src.rows)
      ? src.rows
          .map((r) => arr(r, Math.max(1, headers.length), 60))
          .filter((r) => r.some(Boolean))
          .slice(0, 6)
      : [];
    // Jadvalsiz «table» slayd — bo'sh ramka. Bunday holda bandlarga qaytamiz.
    if (headers.length < 2 || rows.length < 2) {
      return { ...base, layout: "bullets", bullets: arr(o.bullets, rules.maxBullets, rules.bulletChars) };
    }
    return { ...base, table: { headers, rows } };
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
  const limit = layout === "agenda" ? MAX_AGENDA_ITEMS : rules.maxBullets;
  return { ...base, bullets: arr(o.bullets, limit, rules.bulletChars) };
}

/**
 * Slaydni shablon talab qilgan layoutga KELTIRADI (majburan bosib yozmaydi).
 *
 * Ilgari `s.layout = beats[i].layout` deb yozib yuborilardi: model `quote`
 * yozgan bo'lsa-yu beat `stats` talab qilsa, iqtibos yo'qolib, `stats[]`
 * bo'sh qolardi va slaydda «—» chiqardi. Endi:
 *   — kerakli ma'lumot bor bo'lsa, shunchaki layout qo'yiladi;
 *   — yo'qotishsiz o'girish mumkin bo'lsa, o'giriladi;
 *   — o'girish uydirma raqam talab qilsa (stats), model layouti saqlanadi.
 */
export function coerceLayout(s: SlideModel, want: SlideLayout, maxBullets = 4): SlideModel {
  if (s.layout === want) return s;
  const pool = (s.bullets?.length ? s.bullets : [s.subtitle, s.quote].filter(Boolean) as string[]).filter(Boolean);

  if (want === "stats") {
    // Raqamsiz stats — uydirma bo'lardi. Model nima yozgan bo'lsa shu qoladi.
    return s.stats?.length ? { ...s, layout: want } : s;
  }
  if (want === "table") {
    // Jadvalni bandlardan «yasash» ustunlarni o'ylab topishni talab qiladi.
    return s.table?.rows.length ? { ...s, layout: want } : s;
  }
  if (want === "process") {
    if (s.steps?.length) return { ...s, layout: want };
    if (pool.length < 2) return s;
    return {
      ...s,
      layout: want,
      steps: pool.slice(0, 4).map((b, i) => {
        const [head, ...rest] = b.split(/\s+[—–:-]\s+/);
        return {
          n: String(i + 1),
          title: clip(head, 40),
          text: clip(rest.join(" — ") || b, 90),
        };
      }),
    };
  }
  if (want === "twoCol" || want === "compare") {
    if (s.left?.length && s.right?.length) return { ...s, layout: want };
    if (pool.length < 2) return s;
    const mid = Math.ceil(pool.length / 2);
    return { ...s, layout: want, left: pool.slice(0, mid), right: pool.slice(mid) };
  }
  if (want === "quote") {
    const quote = s.quote || pool[0];
    return quote ? { ...s, layout: want, quote: clip(quote, 220) } : s;
  }
  if (want === "section" || want === "closing" || want === "title") {
    return { ...s, layout: want, subtitle: s.subtitle || pool[0] };
  }
  // bullets / agenda
  return { ...s, layout: want, bullets: pool.length ? pool.slice(0, maxBullets) : s.bullets };
}

function parseDeckJson(raw: string, footer: string, want: number, rules: BulletRules): SlideModel[] {
  const data = parseLlmJson(raw) as { slides?: unknown } | null;
  if (!Array.isArray(data?.slides)) return [];
  return data.slides
    .map((s, i) => normalizeSlide(s, i, footer, rules))
    .filter((s): s is SlideModel => Boolean(s))
    .slice(0, Math.max(6, Math.min(24, want + 2)));
}

function beatToSlide(beat: { layout: SlideLayout; role: string }, i: number, meta: DocMeta, footer: string): SlideModel {
  const t = meta.topic;
  const L = slideLabels(meta.language);
  const base: SlideModel = { id: `s${i}`, layout: beat.layout, title: beat.role, footer };
  if (beat.layout === "title") {
    return { ...base, title: t, subtitle: beat.role, kicker: meta.subject || L.presentation };
  }
  if (beat.layout === "closing") {
    return { ...base, title: L.conclusion, subtitle: beat.role || L.questions };
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
      leftTitle: "A",
      left: [`${t}: birinchi tomon`],
      rightTitle: "B",
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

export function fallbackSlides(meta: DocMeta, tpl?: SlideTemplate, beats?: SlideBeat[]): SlideModel[] {
  const footer = [meta.author, meta.university].filter(Boolean).join(" · ");
  const template = tpl ?? resolveSlideTemplate(meta.slideTemplate, meta.topic, meta.extra);
  const base = beats ?? (template.beats.length ? template.beats : resolveSlideTemplate("lecture", meta.topic).beats);
  const seq = meta.titleSlide === false ? base.filter((b) => b.layout !== "title") : base;
  return seq.map((b, i) => beatToSlide(b, i, meta, footer));
}

/**
 * Sifat paketi nechta slayd va'da qiladi.
 * `meta.targetPages` — formadagi paket (standart 10, uzun 14, premium 12,
 * premium uzun 16). Shablon beats'i bundan kam bo'lsa kengaytiriladi.
 */
export function wantSlides(meta: DocMeta, tpl: SlideTemplate): number {
  const pack = Math.max(8, Math.min(20, meta.targetPages || 10));
  return Math.max(tpl.beats.length || 8, pack);
}

function slideSystem(meta: DocMeta, tpl: SlideTemplate) {
  const rules = audienceRules(meta.slideAudience, tpl.id);
  const audienceLine: Record<string, string> = {
    defense: `AUDITORIYA — himoya komissiyasi. Bir slaydda tadqiqot savoli AYNAN savol shaklida bo‘lsin. Har da'vo ortida asos ko‘rinsin. Shior yo‘q.`,
    lecture: `AUDITORIYA — talabalar. Har tushuncha ta'rif + misol bilan. Yangi atama kiritilsa darhol izohlansin.`,
    school: `AUDITORIYA — maktab o‘quvchilari. Sodda gap, kundalik misol. Bir slaydda sinf 2 daqiqada bajaradigan mashq bo‘lsin.`,
    pitch: `AUDITORIYA — investor. Bitta slayd — bitta fikr. Muammo, yechim va keyingi qadam aniq. Uydirma bozor raqami YO‘Q.`,
  };
  return [
    languageDirective(meta.language),
    `Siz professional taqdimot muallifisiz.`,
    `Auditoriyasi: talaba / o‘qituvchi / himoya komissiyasi.`,
    `Mavzu: «${meta.topic}». Fan: ${meta.subject || "—"}.`,
    `Faqat JSON qaytaring. Matn qisqa, aniq, slaydga sig‘adigan.`,
    `QAT’IY TAQIQLANADI: umumiy pedagogika shablonlari (kompetensiya, auditoriya, UNESCO, differensiatsiya, «tashxis-baholash» sikli), mavzuga tegishli bo‘lmagan soha (masalan, dvigatel yoki «milliy ta’lim»).`,
    `YOZING: shu mavzuning o‘zi — ta’rif, tuzilish/jarayon, turlari, misol, ahamiyat, cheklov.`,
    `Har slaydda ENG KO‘PI ${rules.maxBullets} ta bullet (agenda'da 5). Har bullet 1 gap, ${Math.round(rules.bulletChars / 8)} so‘zdan oshmasin.`,
    audienceLine[meta.slideAudience && meta.slideAudience !== "auto" ? meta.slideAudience : ""] ??
      `${rules.note}`,
    `Sarlavha to‘liq fikr, 6–10 so‘z. Uzun izohni bulletga emas, notes ga yozing.`,
    `Har slaydda imageHint: 12–20 so‘z, ANIQ vizual (inglizcha yoki o‘zbekcha), shu slayd mazmunidagi narsa/joy/asbob. Mavzudan chiqib ketmasin.`,
    `Har slaydda notes: notiq OG‘ZAKI aytadigan matn, 40–80 so‘z. Slayddagi bandlarni takrorlamang — misol, izoh yoki savol qo‘shing.`,
    `title slaydning title maydoni foydalanuvchi mavzusini saqlasin.`,
    `kicker qisqa (2–4 so‘z), masalan «Biologiya» yoki «Taqdimot». Qo‘shimcha talabni kicker qilmang.`,
    `stats ga uydirma milliard/tonna/foiz YOZILMASIN. Formula, bosqich soni, ma’lum birlik (masalan C6H12O6, 2 bosqich) mumkin.`,
    `table layout: 2–4 ustun, 2–5 qator. Katak matni qisqa (2–5 so‘z). Uydirma raqam emas — tasnif, qiyos yoki bosqich xossalari.`,
    meta.extra ? `Qo‘shimcha talab: ${meta.extra}` : "",
    sourceBlock(meta),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function writeSlidesWithLlm(
  meta: DocMeta,
  tpl: SlideTemplate,
  beats: SlideBeat[] = tpl.beats,
): Promise<SlideModel[] | null> {
  if (!llmEnabled()) return null;
  const rules = audienceRules(meta.slideAudience, tpl.id);
  const plan = meta.titleSlide === false ? beats.filter((b) => b.layout !== "title") : beats;
  const want = plan.length || Math.max(8, Math.min(20, meta.targetPages || 10));
  const footer = [meta.author, meta.university].filter(Boolean).join(" · ");
  const seq = plan.map((b, i) => `${i + 1}) layout=${b.layout} — ${b.role}`).join("\n");
  const user = [
    `«${meta.topic}» bo‘yicha shablon: ${tpl.nameUz} (${tpl.blurb}).`,
    `AYNAN ${want} ta slayd. QAT’IY shu tartibda (layout ni o‘zgartirmang):`,
    seq,
    `Har slayd mazmuni shu rolga mos, mavzudan chiqmasin. Slaydlar bir-birini takrorlamasin.`,
    `JSON sxema: {"slides":[{"layout":"title|agenda|section|bullets|twoCol|compare|quote|stats|process|closing","kicker":"","title":"","subtitle":"","imageHint":"","notes":"","bullets":[""],"leftTitle":"","left":[""],"rightTitle":"","right":[""],"quote":"","quoteBy":"","stats":[{"value":"","label":""}],"steps":[{"n":"1","title":"","text":""}],"table":{"headers":["",""],"rows":[["",""]]}}]}`,
  ].join("\n");
  // Token byudjeti slaydlar soniga bog‘liq: 16 slayd + notes 5 000 tokenga
  // sig‘masdi va oxirgi slaydlar kesilib ketardi.
  const maxTokens = Math.min(9_000, 2_000 + want * 420);
  const raw = await llmComplete(slideSystem(meta, tpl), user, maxTokens, { json: true, timeoutMs: 90_000 });
  if (!raw) return null;
  const slides = parseDeckJson(raw, footer, want, rules);
  // Va’da qilingan hajmning 75% i — quyi chegara. Bundan kam bo‘lsa deck
  // paketga mos kelmaydi; `null` qaytarib, chaqiruvchi pulni qaytaradi.
  const floor = Math.max(6, Math.ceil(want * 0.75));
  if (slides.length < floor) {
    console.warn("[slide-write] too few slides", slides.length, "want", want);
    return null;
  }
  for (let i = 0; i < slides.length; i++) {
    if (plan[i]) slides[i] = coerceLayout(slides[i], plan[i].layout, rules.maxBullets);
  }
  const L = slideLabels(meta.language);
  if (meta.titleSlide === false) {
    // Foydalanuvchi titul slaydini xohlamadi — model baribir yozgan bo‘lsa olib tashlaymiz.
    while (slides.length > 1 && slides[0].layout === "title") slides.shift();
  } else if (slides[0].layout !== "title") {
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
  // Interfeys matnlari MODELDA to'ldiriladi, layoutda emas: `planSlide`
  // tilni bilmaydi va ilgari u yerda o'zbekcha «Savollar va muhokama» /
  // «Taqdimot» qattiq yozilgan edi — ruscha taqdimot aralash chiqardi.
  const last = slides[slides.length - 1];
  if (last.layout === "closing" && !last.subtitle) last.subtitle = L.questions;
  if (slides[0].layout === "title" && !slides[0].kicker) slides[0].kicker = L.presentation;
  return slides;
}

export async function buildSlideAcademicDoc(meta: DocMeta, deadline?: number): Promise<AcademicDoc> {
  const themeId = (meta.slideTheme || "atlas") as SlideThemeId;
  getSlideTheme(themeId);
  const tpl = resolveSlideTemplate(meta.slideTemplate, meta.topic, meta.extra);
  // Sifat paketi shu yerda haqiqiy slaydlar soniga aylanadi.
  const beats = expandBeats(tpl, wantSlides(meta, tpl));
  const written = await writeSlidesWithLlm(meta, tpl, beats);
  // Kalit bor, lekin matn yozilmadi — shablon deck bermaymiz. `beatToSlide`
  // «Fotosintez: kirish / Asosiy qism / Amaliyot» kabi bo'sh slaydlar
  // yaratadi va foydalanuvchi buni to'lagan ishi deb oladi. Xato bo'lsa
  // worker kreditni qaytaradi.
  if (!written && llmEnabled()) {
    throw new Error("Taqdimot matni yozilmadi. Kredit qaytariladi — qayta urinib ko‘ring.");
  }
  const slides = written ?? fallbackSlides(meta, tpl, beats);
  // Matn tayyor — qolgan vaqtni rasmga beramiz, lekin PPTX yig'ish uchun
  // kamida ~12 soniya qoldiramiz.
  const budget = deadline ? Math.max(0, deadline - Date.now() - 12_000) : 60_000;
  await attachSlideImages(slides, meta.topic, tpl.visual, budget, { premium: meta.premiumVisuals });
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
