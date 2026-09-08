import { imageStyleById, withGrounding } from "./image-studio";
import { parseLlmJson } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { photoSlot, slotPixels } from "./slide-layout";
import type { SlideVisual } from "./slide-templates";
import type { SlideModel } from "./slide-types";
import type { DocMeta } from "./types";
import { groundUzbekScene } from "./uz-gazetteer";

type FalSize = { width: number; height: number };

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
function frameLine(size: FalSize) {
  const portrait = size.height > size.width;
  return portrait
    ? `Vertical ${size.width}x${size.height} composition, subject fills the height, no empty band.`
    : `Wide ${size.width}x${size.height} composition, scene edge to edge, no empty side panel.`;
}

/** Deterministic fallback when LLM is off or fails. */
export function composeSlideImagePrompt(
  topic: string,
  slide: Pick<SlideModel, "title" | "layout" | "subtitle" | "imageHint" | "quote">,
  size: FalSize,
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
    .filter((x): x is { s: SlideModel; size: FalSize } => Boolean(x))
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
    out[id] = [
      styleSuffix(meta),
      scene,
      frameLine(job.size),
      `Must depict the topic «${topic}», not a substitute subject.`,
      localLine(meta, `${topic} ${scene}`),
      "No text, letters, watermark, logo, UI.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return out;
}
