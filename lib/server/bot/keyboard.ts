import { env, llmConfigured } from "../env";
import { botAppUrl } from "../bot-link";
import { TOOL_BY_ID, toolBlockedReason, type ToolFeatures } from "../../tools";
import { t, LANGS, type Lang, type TextKey } from "./i18n";
import { keyboardButton, tgEmoji, type IconKey, type KeyboardButton, type Screen } from "./ui";

/**
 * The persistent main reply keyboard (docs/bot/PLAN.md, owner decisions Q1/Q3 +
 * 2026-10-08 scope):
 *
 * Owner layout 2026-10-08 (two buttons per row):
 *   [📊 Slayd (primary)]   [💎 Pro slayd]
 *   [📝 Mustaqil ish]      [📄 Referat]
 *   [🖼 Rasm]              [💼 Rezyume]
 *   [📂 Ishlarim]          [💰 Hamyon / Bonus]
 *   [👤 Profil (success)]  [❓ Yordam]
 *
 * Tools are `web_app` buttons with the user's personal signed link
 * (`botAppUrl` — a reply-keyboard WebApp gets EMPTY initData, so the link token
 * logs the user in). A blocked tool (`toolBlockedReason`) or a deployment
 * without a public URL gets a TEXT button that the bot answers in chat. The
 * other four are TEXT buttons handled in chat (`chat.ts`).
 */

/** What a reply-keyboard text means. */
export type KeyboardAction = "slide" | "pro" | "independent" | "referat" | "image" | "resume" | "files" | "wallet" | "profile" | "help";

/** Tool ids behind the web_app buttons. */
type KeyboardTool = "slide" | "image" | "pro-slide" | "mustaqil-ish" | "referat" | "resume";

/** `legacy`: labels of earlier keyboards still on users' screens (a tap keeps working until the keyboard is refreshed). */
type Spec = { action: KeyboardAction; icon: IconKey; label: TextKey; tool?: KeyboardTool; path?: string; legacy?: readonly string[] };

const toolSpec = (action: KeyboardAction, icon: IconKey, label: TextKey, tool: KeyboardTool): Spec => ({ action, icon, label, tool, path: `/uz/${TOOL_BY_ID[tool].slug}` });

/** Paths from `lib/tools.ts` slugs (slide, pro-slide, mustaqil-ish, referat, rasm, resume). */
const SPECS: Record<KeyboardAction, Spec> = {
  slide: toolSpec("slide", "slide", "kb.slide", "slide"),
  pro: toolSpec("pro", "pro", "kb.pro", "pro-slide"),
  independent: toolSpec("independent", "independent", "kb.independent", "mustaqil-ish"),
  referat: toolSpec("referat", "referat", "kb.referat", "referat"),
  image: toolSpec("image", "image", "kb.image", "image"),
  resume: toolSpec("resume", "resume", "kb.resume", "resume"),
  files: { action: "files", icon: "files", label: "kb.files" },
  wallet: { action: "wallet", icon: "wallet", label: "kb.wallet", legacy: ["Hamyon", "Кошелёк", "Wallet"] },
  profile: { action: "profile", icon: "profile", label: "kb.profile", legacy: ["Profilim", "Мой профиль", "My profile"] },
  help: { action: "help", icon: "help", label: "kb.help" },
};

/** Whether an action opens a tool (web_app) rather than a chat screen. */
export function isToolAction(action: KeyboardAction): boolean {
  return Boolean(SPECS[action].tool);
}

/** Server features, as `/api/auth/session` reports them. */
export function botFeatures(): ToolFeatures {
  return { llm: llmConfigured(), images: Boolean(env.gemini.key) };
}

/** The tool's block reason (`null` = usable). */
export function toolBlocked(action: KeyboardAction, features: ToolFeatures = botFeatures()): string | null {
  const tool = SPECS[action].tool;
  return tool ? toolBlockedReason(TOOL_BY_ID[tool], features) : null;
}

function button(lang: Lang, telegramId: number | string, action: KeyboardAction, features: ToolFeatures): KeyboardButton {
  const s = SPECS[action];
  const style = action === "slide" ? "primary" : action === "profile" ? "success" : undefined;
  const webApp = s.path && !toolBlocked(action, features) ? botAppUrl(telegramId, s.path) : null;
  return keyboardButton(s.icon, t(lang, s.label), { webApp, style });
}

export function mainKeyboard(lang: Lang, telegramId: number | string, features: ToolFeatures = botFeatures()): Record<string, unknown> {
  const b = (a: KeyboardAction) => button(lang, telegramId, a, features);
  return {
    keyboard: [
      [b("slide"), b("pro")],
      [b("independent"), b("referat")],
      [b("image"), b("resume")],
      [b("files"), b("wallet")],
      [b("profile"), b("help")],
    ],
    is_persistent: true,
    resize_keyboard: true,
    input_field_placeholder: t(lang, "kb.placeholder"),
  };
}

/** The message that carries the keyboard (a reply keyboard needs a message of its own). */
export function keyboardMessage(lang: Lang, telegramId: number | string, kind: "note" | "refreshed", features?: ToolFeatures): Screen {
  const text = kind === "note" ? `${tgEmoji("pointDown")} ${t(lang, "kb.note")}` : `${tgEmoji("refresh")} ${t(lang, "kb.refreshed")}`;
  return { text, reply_markup: mainKeyboard(lang, telegramId, features) };
}

const LEADING = /^[\s\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}‍️]+/u;

/**
 * Which keyboard button a message text is — in ANY language (a keyboard sent
 * before a language change still works) and with or without the emoji prefix
 * (premium on puts the emoji in `icon_custom_emoji_id`, so the label is bare).
 */
export function matchKeyboard(text: string): KeyboardAction | null {
  const bare = text.replace(LEADING, "").trim().toLowerCase();
  if (!bare) return null;
  for (const s of Object.values(SPECS)) {
    for (const lang of LANGS) {
      if (t(lang, s.label).toLowerCase() === bare) return s.action;
    }
    if (s.legacy?.some((l) => l.toLowerCase() === bare)) return s.action;
  }
  return null;
}

/** The label of a keyboard action (for «vaqtincha o‘chiq» texts). */
export function actionLabel(lang: Lang, action: KeyboardAction): string {
  return t(lang, SPECS[action].label);
}
