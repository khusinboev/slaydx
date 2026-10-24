import { formatPoints } from "../../referral";
import { overview } from "../paid-tests";
import { t } from "./i18n";
import { sendScreen, type ChatCtx } from "./router";
import { appUrl, inlineButton, rows, type Screen } from "./ui";

/**
 * Bot side of the paid tests (owner request 7). Thin, like `bot/domla.ts`: the rules (switch, price, free first
 * attempt, charging, scoring) live in `lib/server/paid-tests.ts` and the attempt itself runs on the Mini App page
 * `/uz/tests`, so the bot only says what it costs and opens the page (a WebApp button).
 */

/** The `/test` screen: a short intro with the server's price and a button that opens `/uz/tests`. */
export async function entryScreen(ctx: ChatCtx): Promise<Screen> {
  const { lang, user } = ctx;
  const ov = await overview(user.id);
  if (!ov.enabled) return { text: t(lang, "tests.disabled") };
  const price = t(lang, "unit.som", { n: formatPoints(ov.price) });
  const url = appUrl("/uz/tests");
  return {
    text: t(lang, ov.firstFree ? "tests.introFree" : "tests.intro", { price }),
    reply_markup: rows([url ? inlineButton(null, t(lang, "tests.openBtn"), { web_app: { url } }, "primary") : null]),
  };
}

export async function sendEntry(ctx: ChatCtx): Promise<void> {
  await sendScreen(ctx.chatId, await entryScreen(ctx));
}
