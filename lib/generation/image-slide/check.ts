/**
 * AI slide proofreading (docs/ai-slide/SPEC.md «Engine» 3): the text model reads each drawn slide and lists the text
 * items that came out wrong, so a garbled word can be redrawn once.
 *
 * Why: the first live deck (2026-11-12) drew 5 slides with one wrong cell («Ksiorodli» for «Kislorodli»). A picture is
 * the product, so one bad word is a visible defect. The check is cheap (one small vision call, ≈ $0.001) next to a
 * redraw (≈ $0.07), and it never blocks delivery: any failure of the check counts as «nothing found».
 */
import { getProviderKey } from "../../server/providers/resolve";
import { recordLlmUsage } from "../job-cost";
import { parseLlmJson } from "../json";
import { llmModel } from "../llm";
import type { PictureSlide } from "./write";

export const CHECK_TIMEOUT_MS = 30_000;

/** `expected` empty = text that should not be on the slide at all (`seen` holds it). */
export type TextIssue = { expected: string; seen: string };

/** Every text item the picture must show, in reading order. */
export function expectedTexts(s: PictureSlide, index: number, total: number): string[] {
  return [
    s.title,
    ...(s.subtitle ? [s.subtitle] : []),
    ...s.points,
    ...s.formulas,
    ...(s.table ? [...s.table.headers, ...s.table.rows.flat()] : []),
    ...(s.kind !== "title" ? [`${index + 1} / ${total}`] : []),
  ].filter(Boolean);
}

export const CHECK_SYSTEM = [
  "You proofread one presentation slide image against the list of text items it must show.",
  "Report an item only when it is misspelled, garbled (wrong, missing or extra letters), cut off, or missing from the image.",
  'Also report any other visible text that is NOT in the list — such as badges, slide counters, "print-ready", "16:9", invented captions — as {"expected":"","seen":"<that text>"}. Short labels inside the illustration that reuse words from the list are fine.',
  "Ignore fonts, colours, layout, line breaks, letter case of headings, bullet symbols and the illustration.",
  "Treat ʻ ʼ ’ ‘ ' ` as the same character, and treat a subscript or superscript digit as equal to the plain digit.",
  'Return JSON only: {"issues":[{"expected":"<item as listed>","seen":"<what the image shows, or empty>"}]}. An empty list means the text is right.',
].join("\n");

/** Issues from the model's answer; only items that are in the expected list (a hallucinated item is ignored). */
export function parseIssues(raw: string | null, expected: readonly string[]): TextIssue[] {
  const data = raw ? parseLlmJson(raw) : null;
  const list = data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).issues) ? ((data as Record<string, unknown>).issues as unknown[]) : [];
  const known = new Set(expected.map((e) => e.trim()));
  const out: TextIssue[] = [];
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const rec = it as Record<string, unknown>;
    const exp = String(rec.expected ?? "").trim();
    const seen = String(rec.seen ?? "").trim().slice(0, 120);
    // Extra text: kept only when it is not one of the listed items after all.
    if (!exp) {
      if (seen && !known.has(seen)) out.push({ expected: "", seen });
      continue;
    }
    if (!known.has(exp)) continue;
    out.push({ expected: exp, seen });
  }
  return out;
}

/** The issues of one drawn slide; `[]` when the check itself fails (it never blocks a delivery). */
export async function checkSlideText(base64: string, mime: string, expected: readonly string[], deadline: number): Promise<TextIssue[]> {
  const key = getProviderKey("gemini");
  const left = deadline - Date.now();
  if (!key || left < 10_000 || !expected.length) return [];
  const model = llmModel();
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(Math.min(CHECK_TIMEOUT_MS, left - 5_000)),
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: CHECK_SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: mime, data: base64 } },
              { text: `Text items the slide must show, one per line:\n${expected.map((e) => `- ${e}`).join("\n")}` },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: "application/json" },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    if (!res.ok) return [];
    const u = data.usageMetadata;
    if (u) recordLlmUsage({ provider: "gemini", model, inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 });
    const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => p.thought !== true).map((p) => p.text ?? "").join("");
    return parseIssues(text, expected);
  } catch {
    return [];
  }
}

/** The line added to a redraw prompt: the exact spelling of what came out wrong. */
export function fixNote(issues: readonly TextIssue[]): string {
  const wrong = issues.filter((i) => i.expected);
  const extra = issues.filter((i) => !i.expected);
  return [
    "A previous attempt at this slide drew some text wrong.",
    ...(wrong.length ? ["Draw these items EXACTLY, letter by letter:", ...wrong.map((i) => `- «${i.expected}»${i.seen ? ` (not «${i.seen}»)` : ""}`)] : []),
    ...(extra.length ? ["Do NOT draw this text anywhere on the slide:", ...extra.map((i) => `- «${i.seen}»`)] : []),
  ].join("\n");
}
