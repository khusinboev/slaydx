/**
 * Pure part of the Bosh hub (docs/redesign/PLAN.md «Xizmatlar panjarasi»): the
 * greeting name, the promo banner's slides, the eight service cells, the
 * «Davom ettirish» rows and their status pill. No React, no store — unit-testable as is.
 */
import type { Features, ServerGeneration, ServerUser } from "@/lib/api-client";
import { SERVICE_BY_ID, serviceVisible, type ServiceConfig } from "@/lib/services";
import { listedTools, TOOL_BY_ID, TOOL_GROUPS, toolBlockedReason } from "@/lib/tools";
import type { ToolGroup, ToolId } from "@/lib/types";
import { toolHref } from "@/lib/media/legacy-fold";
import { STUDIO_ENTRY } from "@/components/studio/studio-entry";
import { catalogueHref } from "../catalogue-filter";

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

/** One cell of the home service grid. `tc` null = the neutral «Barchasi» tile. */
export type HomeCell = {
  /** Tool or service id, or `studio` / `games` / `all`. */
  id: string;
  href: string;
  label: string;
  /** Key of `TOOL_ICONS`. */
  icon: string;
  tc: string | null;
  /** Why the tool cannot be sold right now (`toolBlockedReason`): the cell stays, disabled. */
  blocked: string | null;
  /** The cell depends on a session switch: while the session is unknown a skeleton stands in its place. */
  flagged?: boolean;
};

/** The catalogue group the «O'yinlar» cell opens (`CreateGrid` reads `?group=`). */
const GAMES_GROUP: ToolGroup = "oyinlar";
/** Takes the «AI yordamchi» cell while that service is off: the grid never has a hole. */
const CHAT_SUBSTITUTE: ToolId = "coursework";

type SessionFeatures = Features | null | undefined;

function toolCell(id: ToolId, features: SessionFeatures): HomeCell {
  const tool = TOOL_BY_ID[id];
  return {
    id,
    href: toolHref(tool, features?.legacyFold),
    label: tool.title,
    icon: tool.icon,
    tc: tool.tc,
    blocked: toolBlockedReason(tool, features),
  };
}

function serviceCell({ id, href, title, icon, tc }: ServiceConfig): HomeCell {
  return { id, href, label: title, icon, tc, blocked: null };
}

function gamesCell(): HomeCell {
  const label = TOOL_GROUPS.find((g) => g.id === GAMES_GROUP)!.label;
  const first = listedTools().find((t) => t.group === GAMES_GROUP)!;
  return { id: "games", href: catalogueHref(GAMES_GROUP), label, icon: first.icon, tc: first.tc, blocked: null };
}

/**
 * The eight cells of the home grid, always eight, in the owner's order
 * (2026-11-06; 73 % of the work is slides, 91 % slide + mustaqil ish + referat).
 * A service behind a switch is replaced by a tool while the switch is off; a
 * tool without its provider key stays in place, disabled, as in the catalogue.
 */
export function homeCells(features: SessionFeatures): HomeCell[] {
  const chat = SERVICE_BY_ID.chat;
  return [
    toolCell("slide", features),
    toolCell("mustaqil-ish", features),
    toolCell("referat", features),
    toolCell("essay", features),
    { id: STUDIO_ENTRY.id, href: STUDIO_ENTRY.href, label: STUDIO_ENTRY.title, icon: STUDIO_ENTRY.icon, tc: STUDIO_ENTRY.tc, blocked: null },
    { ...(serviceVisible(chat, features) ? serviceCell(chat) : toolCell(CHAT_SUBSTITUTE, features)), flagged: true },
    gamesCell(),
    { id: "all", href: "/uz/create", label: "Barchasi", icon: "layout-grid", tc: null, blocked: null },
  ];
}

/** One slide of the home promo banner. */
export type HomeSlide = { id: string; href: string; title: string; promise: string; cta: string; icon: string };

/**
 * The banner's slides. `marketOn` = `useMarketOn()`, the rule of the market's
 * own pages and rail; Studio has no switch, so the banner is never empty.
 */
export function homeSlides(features: SessionFeatures, marketOn: boolean): HomeSlide[] {
  const { market, chat, domla } = SERVICE_BY_ID;
  const slides: (HomeSlide | false)[] = [
    marketOn && { id: market.id, href: market.href, icon: market.icon, title: "Ishlar bozori ochildi", promise: "Tayyor ishlar asl narxdan arzon", cta: "Bozorni ochish" },
    { id: STUDIO_ENTRY.id, href: STUDIO_ENTRY.href, icon: STUDIO_ENTRY.icon, title: STUDIO_ENTRY.title, promise: "Eng kuchli modellar bilan rasm yarating", cta: "Studiyani ochish" },
    serviceVisible(chat, features) && { id: chat.id, href: chat.href, icon: chat.icon, title: chat.title, promise: "Savol bering yoki hujjat buyuring · kuniga 10 ta tekin", cta: "Suhbatni boshlash" },
    serviceVisible(domla, features) && { id: domla.id, href: domla.href, icon: domla.icon, title: domla.title, promise: domla.description, cta: "Boshlash" },
  ];
  return slides.filter((s): s is HomeSlide => s !== false);
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
