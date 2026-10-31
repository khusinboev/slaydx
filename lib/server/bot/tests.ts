import { formatPoints } from "../../referral";
import { overview } from "../paid-tests";
import { t } from "./i18n";
import { sendScreen, type ChatCtx } from "./router";
import { appUrl, inlineButton, rows, type Screen } from "./ui";

/**
 * Bot side of the paid tests (owner request 7). Thin, like `bot/domla.ts`: the rules (switch, price, free first
 * attempt, charging, scoring) live in `lib/server/paid-tests.ts` and the attempt itself runs on the Mini App page
 * `/uz/tests`, so the bot only says what it costs and opens the page (a WebApp button). The results and the AI analysis
 * of the wrong answers are shown on that page: the latest finished attempt gets its own button (`/uz/tests?attempt=<id>`).
 */

/** The `/test` screen: a short intro with the server's prices per mode and a button that opens `/uz/tests`. */
export async function entryScreen(ctx: ChatCtx): Promise<Screen> {
  const { lang, user } = ctx;
  const ov = await overview(user.id);
  if (!ov.enabled) return { text: t(lang, "tests.disabled") };
  const som = (n: number) => t(lang, "unit.som", { n: formatPoints(n) });
  const url = appUrl("/uz/tests");
  const lastFinished = ov.history.find((h) => h.status === "finished");
  const resultUrl = lastFinished ? appUrl(`/uz/tests?attempt=${encodeURIComponent(lastFinished.id)}`) : null;
  return {
    text: t(lang, ov.firstFree ? "tests.introFree" : "tests.intro", { subject: som(ov.prices.subject), all: som(ov.prices.all) }),
    reply_markup: rows(
      [url ? inlineButton(null, t(lang, "tests.openBtn"), { web_app: { url } }, "primary") : null],
      [resultUrl ? inlineButton(null, t(lang, "tests.lastResultBtn"), { web_app: { url: resultUrl } }) : null],
    ),
  };
}

export async function sendEntry(ctx: ChatCtx): Promise<void> {
  await sendScreen(ctx.chatId, await entryScreen(ctx));
}
