/**
 * Pure part of the Bosh hub (docs/redesign/PLAN.md W1): the greeting name,
 * the «Tez boshlash» tools and their one-line detail, the «Davom ettirish»
 * rows and their status pill. No React, no store — unit-testable as is.
 */
import type { ServerGeneration, ServerUser } from "@/lib/api-client";
import type { ToolConfig, ToolId } from "@/lib/types";

/**
 * A word that can stand after «Salom,». A phone login stores the phone (or the
 * typed identifier) as `name` AND `author` (`lib/server/auth.ts
 * upsertLocalUser`), so anything with a digit or an `@` is a contact, not a
 * name — «Salom, +998901234567» must never be shown.
 */
function nameWord(raw: string | null | undefined): string | null {
  const word = (raw ?? "").trim().split(/\s+/)[0] ?? "";
  if (!word || /[\d@]/.test(word)) return null;
  // Not one letter at all (e.g. «—», «...»): nothing to greet.
  if (!/\p{L}/u.test(word)) return null;
  return word.length > 24 ? `${word.slice(0, 23)}…` : word;
}

/** First name for the greeting: `name`, then `author`; `null` when neither is a real name. */
export function greetingName(user: Pick<ServerUser, "name" | "author"> | null | undefined): string | null {
  if (!user) return null;
  return nameWord(user.name) ?? nameWord(user.author);
}

/** «Salom, Ali» — or «Salom!» when there is no name (never a phone number). */
export function greetingTitle(user: Pick<ServerUser, "name" | "author"> | null | undefined): string {
  const name = greetingName(user);
  return name ? `Salom, ${name}` : "Salom!";
}

/** «Tez boshlash» — the four big cards (variant A mockup), in this order. */
export const QUICK_TOOL_IDS = ["slide", "referat", "essay", "resume"] as const satisfies readonly ToolId[];

const OUTPUT_LABEL: Record<ToolConfig["output"], string> = { pptx: "PPTX", docx: "DOCX", png: "PNG", mp3: "MP3" };

/**
 * One-line card detail from the tool registry only: the output format and the
 * «from» price exactly as the catalogue (`CreateGrid`) shows it — `price` is
 * `clientAdjustedPrice(tool.id, tool.basePrice)`, passed in so admin
 * adjustments apply. Nothing is invented here.
 */
export function quickDetail(tool: Pick<ToolConfig, "output">, price: number): string {
  return `${OUTPUT_LABEL[tool.output]} · ${price.toLocaleString("uz-UZ")} tangadan`;
}

export type FileTone = "ok" | "run" | "error" | "muted";

/** Status pill of a recent file: «Tayyor», «Yozilmoqda N%», «Navbatda», «Xato», «Bekor qilindi». */
export function fileStatus(gen: Pick<ServerGeneration, "status" | "progress">): { label: string; tone: FileTone } {
  switch (gen.status) {
    case "COMPLETED":
      return { label: "Tayyor", tone: "ok" };
    case "IN_PROGRESS": {
      const p = Math.max(0, Math.min(99, Math.round(Number(gen.progress) || 0)));
      return { label: `Yozilmoqda ${p}%`, tone: "run" };
    }
    case "QUEUED":
      return { label: "Navbatda", tone: "run" };
    case "FAILED":
      return { label: "Xato", tone: "error" };
    default:
      return { label: "Bekor qilindi", tone: "muted" };
  }
}

/** The `n` most recently touched files (finished or, while running, created), newest first. */
export function recentFiles<T extends Pick<ServerGeneration, "createdAt" | "finishedAt">>(gens: readonly T[], n = 3): T[] {
  const at = (g: T) => g.finishedAt ?? g.createdAt;
  return [...gens].sort((a, b) => at(b).localeCompare(at(a))).slice(0, n);
}
