import type { Features } from "./api-client";
import type { ToolGroup } from "./types";

/**
 * Link-only services: they have their own page but no `ToolId` (no form, price
 * table or generation), so they are not in `TOOLS`. The hub tool grid
 * (`ToolsByGroup`), the «+» sheet and the `/uz/create` catalogue draw them from
 * here next to the real tools, in the group named below. One list, one
 * visibility rule (`serviceVisible`): a service behind an admin switch is
 * hidden while the session does not report that switch as on.
 *
 * Groups: «Umumiy» holds what any user needs (chat, converters); «Talaba» the
 * study aids (defence rehearsal, tests).
 */
export type ServiceId = "chat" | "convert" | "alifbo" | "tests" | "domla";

export type ServiceConfig = {
  id: ServiceId;
  href: string;
  title: string;
  description: string;
  /** Key of `TOOL_ICONS`. */
  icon: string;
  /** `r g b` tint, as `ToolConfig.tc`. */
  tc: string;
  group: ToolGroup;
  /** Short badge on compact tiles and catalogue cards. */
  badge?: string;
  /** Session feature switch that must be on; absent = always listed. */
  flag?: "chat" | "tests" | "domla";
};

export const SERVICES: readonly ServiceConfig[] = [
  {
    id: "chat",
    href: "/uz/chat",
    title: "AI yordamchi",
    description: "Savol bering yoki hujjat buyuring · kuniga 10 ta tekin",
    icon: "message-circle",
    tc: "14 165 233",
    group: "umumiy",
    badge: "Tekin",
    flag: "chat",
  },
  {
    id: "convert",
    href: "/uz/convert",
    title: "Fayl konvertatsiya",
    description: "Word, PowerPoint, PDF va rasmlar · tekin",
    icon: "file-output",
    tc: "16 185 129",
    group: "umumiy",
    badge: "Tekin",
  },
  {
    id: "alifbo",
    href: "/uz/alifbo",
    title: "Alifbo o'giruvchi",
    description: "Kirill, Lotin va yangi Lotin · tekin",
    icon: "arrow-left-right",
    tc: "99 102 241",
    group: "umumiy",
    badge: "Tekin",
  },
  {
    id: "tests",
    href: "/uz/tests",
    title: "Test ishlash",
    description: "Matematika, Ona tili, Tarix · vaqt bilan, oxirida to‘g‘ri javoblar",
    icon: "clipboard-check",
    tc: "245 158 11",
    group: "talaba",
    flag: "tests",
  },
  {
    id: "domla",
    href: "/uz/domla",
    title: "Qattiqqo‘l domla",
    description: "Slaydingizni ovoz bilan himoya qiling",
    icon: "graduation-cap",
    tc: "225 29 72",
    group: "talaba",
    flag: "domla",
  },
];

export const SERVICE_BY_ID = Object.fromEntries(SERVICES.map((s) => [s.id, s])) as Record<ServiceId, ServiceConfig>;

/** Listed now? Ungated services always; a gated one only while the session says its switch is on. */
export function serviceVisible(s: ServiceConfig, features: Pick<Features, "chat" | "tests" | "domla"> | null | undefined): boolean {
  return !s.flag || features?.[s.flag] === true;
}

/** The visible services of a group, in registry order. */
export function servicesOfGroup(group: ToolGroup, features: Parameters<typeof serviceVisible>[1]): ServiceConfig[] {
  return SERVICES.filter((s) => s.group === group && serviceVisible(s, features));
}
