import { parseLlmJson } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { photoSlot, slotPixels } from "./slide-layout";
import type { SlideVisual } from "./slide-templates";
import type { SlideModel } from "./slide-types";

type FalSize = { width: number; height: number };

function frameLine(size: FalSize) {
  const portrait = size.height > size.width;
  return portrait
    ? `Vertical ${size.width}x${size.height} photograph, subject fills the height, no empty band.`
    : `Wide ${size.width}x${size.height} photograph, scene edge to edge, no empty side panel.`;
}

/** Deterministic fallback when LLM is off or fails. */
export function composeSlideImagePrompt(
  topic: string,
  slide: Pick<SlideModel, "title" | "layout" | "subtitle" | "imageHint" | "quote">,
  size: FalSize,
) {
  const hint = (slide.imageHint || "").trim();
  const moment = hint || [slide.title, slide.subtitle || slide.quote || ""].filter(Boolean).join(" — ");
  const kind =
    slide.layout === "title"
      ? "cinematic establishing shot of the real subject"
      : slide.layout === "quote" || slide.layout === "closing"
        ? "atmospheric wide scene that still shows the subject"
        : "clear educational photograph of one concrete object or place from the topic";
  return [
    "Photorealistic presentation photograph. No illustration unless the topic is abstract art.",
    `TOPIC (must be visible): ${topic}.`,
    `THIS SLIDE: ${moment}.`,
    kind,
    frameLine(size),
    "No text, letters, watermark, logo, UI, collage, or random animals unless the topic names them.",
    "Natural light, sharp, magazine quality, single coherent scene.",
  ].join(" ");
}

export async function writeSlideImagePrompts(
  topic: string,
  slides: SlideModel[],
  visual: SlideVisual,
): Promise<Record<string, string>> {
  const jobs = slides
    .map((s) => {
      const slot = photoSlot(s.layout, visual);
      return slot ? { s, size: slotPixels(slot) } : null;
    })
    .filter((x): x is { s: SlideModel; size: FalSize } => Boolean(x))
    .slice(0, 8);

  const fallback: Record<string, string> = {};
  for (const { s, size } of jobs) {
    fallback[s.id] = composeSlideImagePrompt(topic, s, size);
  }
  if (!jobs.length || !llmEnabled()) return fallback;

  const list = jobs
    .map(
      ({ s, size }, i) =>
        `${i + 1}) id=${s.id} layout=${s.layout} ${size.width}x${size.height} title=«${s.title}» hint=«${s.imageHint || ""}»`,
    )
    .join("\n");

  const raw = await llmComplete(
    [
      "You write English Flux image prompts for academic slides.",
      "The topic may be Uzbek or Russian. Translate meaning. Never ignore it.",
      "Each prompt: 1–2 sentences, concrete nouns (objects, places, materials, era).",
      "If topic is cars — engines, chassis, assembly, historic automobiles. Not animals.",
      "If topic is a person — period clothing, manuscripts, architecture of that era. Not generic nature.",
      "If topic is a process — the actual tools or substances of that process.",
      "No text in the image. No logos. No collage.",
      "JSON only: {\"prompts\":[{\"id\":\"s0\",\"scene\":\"...\"}]}",
    ].join(" "),
    `Deck topic: «${topic}».\nWrite one scene per slide:\n${list}`,
    1800,
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
      "Photorealistic presentation photograph.",
      scene,
      frameLine(job.size),
      `Must depict the topic «${topic}», not a substitute subject.`,
      "No text, letters, watermark, logo, UI.",
    ].join(" ");
  }
  return out;
}
