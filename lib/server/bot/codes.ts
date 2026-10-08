import { BOT_LANGUAGES, isProfileField, type BotLanguage, type FieldStepId, type ProfileField } from "../../profile/fields";

/**
 * Callback codes of the bot's inline buttons (≤ 64 bytes each — Telegram's
 * `callback_data` limit; the longest here is `p:e:organization`, 16 bytes).
 * Short and positional; `parseCallback` is the only reader, and anything it
 * does not recognise is `{ kind: "unknown" }` (answered «eskirgan»).
 *
 *   p:h               Profilim card
 *   p:s:<step>        a section (shaxsiy | oqish | ish)
 *   p:e:<field>       ask for a field's value
 *   p:x               cancel the pending input
 *   f:<page>          Ishlarim page (0-based, ≤ FILES_MAX_PAGE)
 *   w:h | w:r         Hamyon card | its referral view
 *   r:n               referral as a NEW message (from the /start card, which keeps its login button)
 *   y:h               Yordam card
 *   l:m:<o>           language menu; o = where it came from (p profile, y help, n none)
 *   l:s:<lang>:<o>    set the language, then show screen `o`
 *   n                 no-op (a label-only button)
 */

export const SECTIONS = ["shaxsiy", "oqish", "ish"] as const satisfies readonly FieldStepId[];
export type Origin = "p" | "y" | "n";

/** Ishlarim pages: 5 files each, the listing reads at most 100 rows (`jobs.ts LIST_LIMIT_MAX`). */
export const FILES_PAGE_SIZE = 5;
export const FILES_MAX_PAGE = 19;

export const cb = {
  profile: () => "p:h",
  section: (step: FieldStepId) => `p:s:${step}`,
  edit: (field: ProfileField) => `p:e:${field}`,
  cancel: () => "p:x",
  files: (page: number) => `f:${page}`,
  wallet: () => "w:h",
  walletInvite: () => "w:r",
  invite: () => "r:n",
  help: () => "y:h",
  langMenu: (origin: Origin) => `l:m:${origin}`,
  langSet: (lang: BotLanguage, origin: Origin) => `l:s:${lang}:${origin}`,
  noop: () => "n",
};

export type Callback =
  | { kind: "profile" }
  | { kind: "section"; step: FieldStepId }
  | { kind: "edit"; field: ProfileField }
  | { kind: "cancel" }
  | { kind: "files"; page: number }
  | { kind: "wallet" }
  | { kind: "walletInvite" }
  | { kind: "invite" }
  | { kind: "help" }
  | { kind: "langMenu"; origin: Origin }
  | { kind: "langSet"; lang: BotLanguage; origin: Origin }
  | { kind: "noop" }
  | { kind: "unknown" };

const isOrigin = (v: string | undefined): v is Origin => v === "p" || v === "y" || v === "n";

export function parseCallback(data: string | undefined | null): Callback {
  const parts = String(data ?? "").split(":");
  const [a, b, c, d] = parts;
  switch (a) {
    case "p":
      if (b === "h" && parts.length === 2) return { kind: "profile" };
      if (b === "x" && parts.length === 2) return { kind: "cancel" };
      if (b === "s" && parts.length === 3 && (SECTIONS as readonly string[]).includes(c ?? "")) return { kind: "section", step: c as FieldStepId };
      if (b === "e" && parts.length === 3 && isProfileField(c)) return { kind: "edit", field: c };
      break;
    case "f":
      if (parts.length === 2 && /^\d{1,2}$/.test(b ?? "")) {
        const page = Number(b);
        if (page <= FILES_MAX_PAGE) return { kind: "files", page };
      }
      break;
    case "w":
      if (parts.length === 2 && b === "h") return { kind: "wallet" };
      if (parts.length === 2 && b === "r") return { kind: "walletInvite" };
      break;
    case "r":
      if (parts.length === 2 && b === "n") return { kind: "invite" };
      break;
    case "y":
      if (parts.length === 2 && b === "h") return { kind: "help" };
      break;
    case "l":
      if (b === "m" && parts.length === 3 && isOrigin(c)) return { kind: "langMenu", origin: c };
      if (b === "s" && parts.length === 4 && (BOT_LANGUAGES as readonly string[]).includes(c ?? "") && isOrigin(d)) {
        return { kind: "langSet", lang: c as BotLanguage, origin: d };
      }
      break;
    case "n":
      if (parts.length === 1) return { kind: "noop" };
      break;
  }
  return { kind: "unknown" };
}
