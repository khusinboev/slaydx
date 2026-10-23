import { ApiError } from "../api";
import { answer, isQuizEnabled, isQuizOptedOut, setQuizOptOut, startOrGet } from "../daily-quiz";
import { dayNumber, tashkentDay } from "../../daily-quiz/rules";
import type { Callback } from "./codes";
import { answeredScreen, plainScreen, stateScreen, subscriptionScreen } from "./daily-quiz-screens";
import { t, type Lang } from "./i18n";
import { editScreen, sendScreen, type ChatCtx } from "./router";

/**
 * Bot handlers of the daily logic quiz (owner request 16). Thin by design (CLAUDE.md «Bot va web — bitta servis
 * qatlami»): every rule — the day's questions, the first-answer lock, the reward, the cap and the budget — lives in
 * `lib/server/daily-quiz.ts`; this file only calls it, renders `daily-quiz-screens.ts` and maps its refusals.
 */

/** Service refusals the user can act on, as a bot text. Anything else is not ours to hide: the caller rethrows. */
function refusal(lang: Lang, e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const code = String(e.extra.code ?? "");
  if (code === "disabled") return t(lang, "dq.disabled");
  if (code === "stale_day" || code === "out_of_order" || code === "bad_question" || code === "bad_choice") return t(lang, "dq.stale");
  return null;
}

/** `/savol`: today's quiz as a new message (resumes after the last answer; «already answered» once finished). */
export async function sendQuiz(ctx: ChatCtx): Promise<void> {
  if (!(await isQuizEnabled())) {
    await sendScreen(ctx.chatId, plainScreen(ctx.lang, "dq.disabled"));
    return;
  }
  const st = await startOrGet(ctx.user.id, tashkentDay());
  await sendScreen(ctx.chatId, stateScreen(ctx.lang, st));
}

/** `/obuna`: toggles the morning message and says what it is now. */
export async function toggleSubscription(ctx: ChatCtx): Promise<void> {
  const off = await setQuizOptOut(ctx.user.id, !(await isQuizOptedOut(ctx.user.id)));
  await sendScreen(ctx.chatId, subscriptionScreen(ctx.lang, off));
}

/**
 * The quiz callbacks (`dq:*`). The user is the callback's own sender (`router.handleCallback` already checked it is
 * the private chat's owner and not blocked); nothing in the data names a user. Returns the toast.
 */
export async function handleQuizCallback(
  ctx: ChatCtx,
  messageId: number,
  c: Extract<Callback, { kind: "dqStart" | "dqAnswer" | "dqOff" | "dqOn" }>,
): Promise<string | undefined> {
  try {
    switch (c.kind) {
      case "dqOff":
      case "dqOn": {
        const off = await setQuizOptOut(ctx.user.id, c.kind === "dqOff");
        await editScreen(ctx.chatId, messageId, subscriptionScreen(ctx.lang, off));
        return undefined;
      }
      case "dqStart": {
        const st = await startOrGet(ctx.user.id, tashkentDay());
        await editScreen(ctx.chatId, messageId, stateScreen(ctx.lang, st));
        return undefined;
      }
      case "dqAnswer": {
        const day = tashkentDay();
        // A button of an earlier day: the day number in the data is compared with today's, never trusted.
        if (c.day !== dayNumber(day)) return t(ctx.lang, "dq.stale");
        const out = await answer(ctx.user.id, day, c.q, c.choice);
        await editScreen(ctx.chatId, messageId, answeredScreen(ctx.lang, day, out));
        return out.locked ? t(ctx.lang, "dq.toastLocked") : out.correct ? t(ctx.lang, "dq.toastRight") : t(ctx.lang, "dq.toastWrong");
      }
    }
  } catch (e) {
    const msg = refusal(ctx.lang, e);
    if (msg) return msg;
    throw e;
  }
}
