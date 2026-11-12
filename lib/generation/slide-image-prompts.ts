import type { ImageSize } from "./image-provider";
import { imageStyleById, withGrounding } from "./image-studio";
import { parseLlmJson } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { photoSlot, slotPixels } from "./slide-layout";
import type { SlideVisual } from "./slide-templates";
import type { SlideModel } from "./slide-types";
import type { DocMeta } from "./types";
import { groundUzbekScene } from "./uz-gazetteer";

/**
 * Rasm promptiga ta'sir qiladigan meta maydonlari.
 *
 * `DocMeta` ning O'ZI emas, chunki bu yerga faqat ikkita maydon kerak
 * va tor tur `plannedImageSlots`/testlarda soxta meta yasashni
 * osonlashtiradi. Ikkalasi ham `slide-params.ts` reyestrida
 * `impacts: ["images"]` bilan e'lon qilingan — ya'ni bu yerdagi ta'sir
 * SHARTNOMA, bezak emas.
 */
export type SlideImageMeta = Pick<DocMeta, "slideImageStyle" | "localExamples">;

/**
 * Tanlangan uslubning VOSITA (medium) ko'rsatmasi.
 *
 * Ilgari bu yerda qat'iy `"Photorealistic presentation photograph."`
 * turardi — ya'ni forma «Doska» yoki «Illustratsiya» deb yozilgan
 * bo'lsa ham slayd rasmi HAR DOIM foto so'rardi va uslub maydoni
 * jimgina bezakka aylanardi. Endi matn `image-studio.ts` `IMAGE_STYLES`
 * dan keladi: mustaqil «Rasm» vositasi bilan bitta manba, bitta lug'at.
 */
function styleSuffix(meta?: SlideImageMeta): string {
  return imageStyleById(meta?.slideImageStyle ?? "photo").suffix;
}

/**
 * «O'zbekiston konteksti» yoqilganda promptga tushadigan qator.
 *
 * Ikki qatlam: (1) HAR DOIM qo'shiladigan umumiy ko'rsatma — shunda
 * bayroq gazetteer mavzuni tanimagan holatda ham haqiqiy ta'sir
 * qiladi; (2) `groundUzbekScene` tanigan mavzu bo'lsa uning ANIQ
 * vizual faktlari (mustaqil «Rasm» vositasi bilan bir xil manba).
 * Ikkinchisisiz «Registon» yoki bayroq kabi mavzular modelning
 * xayolidagi umumiy «sharqona» rasmga aylanib ketardi.
 */
function localLine(meta: SlideImageMeta | undefined, scene: string): string {
  if (!meta?.localExamples) return "";
  const base =
    "Set the scene in Uzbekistan: local people, clothing, architecture, landscape and everyday objects of Uzbekistan.";
  return withGrounding(base, groundUzbekScene(scene));
}

/**
 * Kadr ko'rsatmasi.
 *
 * «photograph» emas, «composition»: uslub foto bo'lmasligi mumkin
 * (doska, illyustratsiya) va kadr so'zining o'zi past qadamli modelni
 * fotorealizmga qaytarib turardi.
 */
function frameLine(size: ImageSize) {
  const portrait = size.height > size.width;
  return portrait
    ? `Vertical ${size.width}x${size.height} composition, subject fills the height, no empty band.`
    : `Wide ${size.width}x${size.height} composition, scene edge to edge, no empty side panel.`;
}

/** Deterministic fallback when LLM is off or fails. */
export function composeSlideImagePrompt(
  topic: string,
  slide: Pick<SlideModel, "title" | "layout" | "subtitle" | "imageHint" | "quote">,
  size: ImageSize,
  meta?: SlideImageMeta,
) {
  const hint = (slide.imageHint || "").trim();
  const moment = hint || [slide.title, slide.subtitle || slide.quote || ""].filter(Boolean).join(" — ");
  /*
   * Kadr TURI vositadan mustaqil bo'lishi kerak — «photograph»/«shot»
   * so'zlari bu yerda ham uslub suffiksiga qarshi ishlardi.
   */
  const kind =
    slide.layout === "title"
      ? "cinematic establishing view of the real subject"
      : slide.layout === "quote" || slide.layout === "closing"
        ? "atmospheric wide scene that still shows the subject"
        : "clear educational depiction of one concrete object or place from the topic";
  return [
    styleSuffix(meta),
    `TOPIC (must be visible): ${topic}.`,
    `THIS SLIDE: ${moment}.`,
    kind,
    frameLine(size),
    localLine(meta, `${topic} ${moment}`),
    "No text, letters, watermark, logo, UI, collage, or random animals unless the topic names them.",
    "Sharp, single coherent scene.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Bitta LLM chaqiruviga so'raladigan eng ko'p sahna.
 *
 * `attachSlideImages` (`slide-images.ts`) buni oldindan cheklaydi:
 * oddiy `slide` da `imageBudget()` (standart dekada <=8), `pro-slide`
 * da esa SHIFT UMUMAN YO'Q — 30 slaydli dekada 30 tagacha slot
 * bo'lishi mumkin (`PRO_SLIDE_MAX`).
 *
 * Ilgari bu yerda qat'iy `8`, keyin `16` turardi va `imageBudget`
 * ORTIDA qolib ketgan edi: chegaradan keyingi slaydlar rasmi
 * `attachSlideImages`dagi `prompts[s.id] || composeSlideImagePrompt(...)`
 * zaxirasi tufayli hech qachon YO'QOLMASDI, lekin doim LLM yozgan sahna
 * o'rniga umumiy shablon promptidan chiqardi — aynan ko'proq to'lagan
 * foydalanuvchi uchun sifat farqi shu yerda jimgina yo'qolardi. Endi
 * chegara `PRO_SLIDE_MAX` bilan bir xil.
 */
const MAX_PROMPT_JOBS = 30;

export async function writeSlideImagePrompts(
  topic: string,
  slides: SlideModel[],
  visual: SlideVisual,
  meta?: SlideImageMeta,
): Promise<Record<string, string>> {
  const jobs = slides
    .map((s) => {
      const slot = photoSlot(s.layout, visual);
      return slot ? { s, size: slotPixels(slot) } : null;
    })
    .filter((x): x is { s: SlideModel; size: ImageSize } => Boolean(x))
    .slice(0, MAX_PROMPT_JOBS);

  const fallback: Record<string, string> = {};
  for (const { s, size } of jobs) {
    fallback[s.id] = composeSlideImagePrompt(topic, s, size, meta);
  }
  if (!jobs.length || !llmEnabled()) return fallback;

  const list = jobs
    .map(
      ({ s, size }, i) =>
        `${i + 1}) id=${s.id} layout=${s.layout} ${size.width}x${size.height} title=«${s.title}» hint=«${s.imageHint || ""}»`,
    )
    .join("\n");

  const style = imageStyleById(meta?.slideImageStyle ?? "photo");
  const raw = await llmComplete(
    [
      "You write English image prompts for academic slides.",
      "The topic may be Uzbek or Russian. Translate meaning. Never ignore it.",
      "Each prompt: 1–2 sentences, concrete nouns (objects, places, materials, era).",
      /*
       * Vosita LLM ga ham aytiladi: sahna «photograph of…» deb
       * boshlansa, keyin qo'shiladigan uslub suffiksi bilan prompt
       * o'zi bilan o'zi urishardi (past qadamli model esa bunday
       * ziddiyatda doim fotoga qaytadi).
       */
      `Every scene will be rendered in one fixed visual medium («${style.id}»), added later. Describe WHAT is in the scene — never the medium, camera, lens or lighting.`,
      "If topic is cars — engines, chassis, assembly, historic automobiles. Not animals.",
      "If topic is a person — period clothing, manuscripts, architecture of that era. Not generic nature.",
      "If topic is a process — the actual tools or substances of that process.",
      meta?.localExamples ? "Prefer Uzbek settings, people and objects when the topic allows it." : "",
      "No text in the image. No logos. No collage.",
      "JSON only: {\"prompts\":[{\"id\":\"s0\",\"scene\":\"...\"}]}",
    ]
      .filter(Boolean)
      .join(" "),
    `Deck topic: «${topic}».\nWrite one scene per slide:\n${list}`,
    // Token byudjeti sahna soniga qarab o'sadi — qat'iy `1800` 8 ta ish
    // uchun sozlangan edi, `MAX_PROMPT_JOBS` 30 ga ko'tarilgach javob
    // chegaraga urilib kesilishi (va shu bilan butun JSON yiqilishi)
    // mumkin edi.
    Math.min(6400, 900 + jobs.length * 180),
    { json: true, timeoutMs: 35_000 },
  );
  if (!raw) return fallback;
  const data = parseLlmJson(raw) as { prompts?: { id?: string; scene?: string }[] } | null;
  if (!Array.isArray(data?.prompts)) return fallback;
  const out = { ...fallback };
  for (const p of data.prompts) {
    const id = String(p.id || "");
    const scene = String(p.scene || "").trim();
    const job = jobs.find((j) => j.s.id === id);
    if (!id || scene.length < 16 || !job) continue;
    out[id] = composeSceneImagePrompt(topic, scene, job.size, meta);
  }
  return out;
}

/**
 * The AI prompt for one LLM-written scene — the Pro slayd wording, shared so the plain-deck AI fallback draws the
 * same way (docs/slide-quality/SPEC.md §B). Byte-identical to what `writeSlideImagePrompts` always produced.
 */
export function composeSceneImagePrompt(topic: string, scene: string, size: ImageSize, meta?: SlideImageMeta): string {
  return [
    styleSuffix(meta),
    scene,
    frameLine(size),
    `Must depict the topic «${topic}», not a substitute subject.`,
    localLine(meta, `${topic} ${scene}`),
    "No text, letters, watermark, logo, UI.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * What the plain «Slayd» picture stage needs per slot (docs/slide-quality/SPEC.md §B): an English stock query a photo
 * site understands, a broader fallback query and a one-sentence scene for the AI fallback.
 */
export type StockPlan = { query: string; altQuery: string; scene: string };

const QUERY_WORDS = { min: 1, max: 5 } as const;
/** Abstract words a stock site cannot depict — a query made only of them is useless. */
const ABSTRACT = /\b(concept|importance|significance|role|impact|overview|introduction|conclusion|abstract|idea|ideas|essence|definition|meaning|process|system|development|analysis)\b/gi;

/** A stock query as the model wrote it -> safe, short English words, or "" when nothing usable is left. */
export function cleanStockQuery(raw: unknown): string {
  const words = String(raw ?? "")
    .replace(ABSTRACT, " ")
    .replace(/[^A-Za-z0-9' -]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, QUERY_WORDS.max);
  return words.length >= QUERY_WORDS.min ? words.join(" ").toLowerCase() : "";
}

/** The `{ "plans": [...] }` answer -> plans by slide id; unknown ids, empty queries and short scenes are dropped. */
export function parseStockPlans(raw: string | null, ids: readonly string[]): Record<string, StockPlan> {
  const data = raw ? (parseLlmJson(raw) as { plans?: unknown } | null) : null;
  const out: Record<string, StockPlan> = {};
  if (!data || !Array.isArray(data.plans)) return out;
  const known = new Set(ids);
  for (const item of data.plans) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "");
    if (!known.has(id) || out[id]) continue;
    const query = cleanStockQuery(o.query);
    if (!query) continue;
    const scene = String(o.scene ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    out[id] = { query, altQuery: cleanStockQuery(o.altQuery) || query, scene: scene.length >= 16 ? scene : "" };
  }
  return out;
}

/**
 * One LLM call -> stock query + fallback query + AI scene per picture slot of a plain deck. Replaces the uz->en
 * `WORD_MAP` path (`searchQueryFor`), which left unmapped Uzbek words in the query and made Pexels/Pixabay return
 * random pictures; `searchQueryFor` stays as the no-LLM / bad-answer fallback per slot (the caller fills gaps).
 * Never throws: no key, a failed call or a broken answer give `{}`.
 */
export async function writeStockPlans(
  topic: string,
  jobs: readonly { s: SlideModel; size: ImageSize }[],
  meta?: SlideImageMeta,
): Promise<Record<string, StockPlan>> {
  if (!jobs.length || !llmEnabled()) return {};
  const list = jobs
    .map(({ s, size }, i) => {
      const gist = [s.subtitle, ...(s.bullets ?? []).slice(0, 2), s.quote].filter(Boolean).join(" / ").slice(0, 220);
      return `${i + 1}) id=${s.id} layout=${s.layout} ${size.width > size.height ? "landscape" : "portrait"} title=«${s.title}» gist=«${gist}» hint=«${s.imageHint || ""}»`;
    })
    .join("\n");
  try {
    const raw = await llmComplete(
      [
        "You choose photographs for presentation slides. The slides may be in Uzbek or Russian: translate the meaning.",
        "For every slide return:",
        "- query: 2-4 concrete English nouns a stock photo site (Pexels, Pixabay) can find, showing the slide's ACTUAL subject: an object, place, organism, tool, building, person type or activity. No abstract words (concept, importance, role, impact, process), no verbs, no text-in-image requests.",
        "- altQuery: a broader 1-3 word English query for the same subject in case the first finds nothing.",
        "- scene: one English sentence describing a realistic photograph of that subject, for an AI image model. Describe WHAT is in the frame, not the camera.",
        "History or a person: things of that era and region (architecture, manuscripts, artefacts), never a modern statue unless the slide is about it. Science: the real organism, substance or apparatus.",
        meta?.localExamples ? "Prefer Uzbekistan settings when the topic allows it." : "",
        'JSON only: {"plans":[{"id":"s0","query":"","altQuery":"","scene":""}]}',
      ]
        .filter(Boolean)
        .join("\n"),
      `Deck topic: «${topic}».\nSlides:\n${list}`,
      Math.min(4000, 400 + jobs.length * 140),
      { json: true, timeoutMs: 30_000, noTimeoutRetry: true },
    );
    return parseStockPlans(raw, jobs.map((j) => j.s.id));
  } catch (e) {
    console.warn("[rasm] stok so'rovlari yozilmadi:", e instanceof Error ? e.message : e);
    return {};
  }
}
