import { ApiError } from "../api";
import { answer, isQuizEnabled, isQuizOptedOut, setQuizOptOut, startOrGet, type AnswerOutcome, type PublicQuestion, type QuizResult, type QuizState } from "../daily-quiz";
import { dayNumber, DAILY_QUIZ_PER_DAY, tashkentDay } from "../../daily-quiz/rules";
import { cb, type Callback } from "./codes";
import { som } from "./bonus";
import { t, type Lang } from "./i18n";
import { editScreen, sendScreen, type ChatCtx } from "./router";
import { esc, inlineButton, rows, type Screen } from "./ui";

/**
 * Bot screens and handlers of the daily logic quiz (owner request 16). Thin by design (CLAUDE.md «Bot va web —
 * bitta servis qatlami»): every rule — the day's questions, the first-answer lock, the reward, the cap and the
 * budget — lives in `lib/server/daily-quiz.ts`; this file only renders its results and maps its errors.
 *
 * Message shape: ONE message per quiz run. The «Boshlash» tap (or `/savol`) shows question 1 with A-D buttons;
 * an answer EDITS that message to «✅/❌ + explanation» followed by the next question (or the final result),
 * so a redelivered update re-renders the same text instead of sending a duplicate.
 */

const LETTERS = ["A", "B", "C", "D"] as const;

/* ───────────────────────── Screens ───────────────────────── */

/** The morning message (also the sender's `build`): invitation + «Boshlash» / «Obunani o‘chirish». */
export function inviteScreen(lang: Lang, reward: number): Screen {
  const text = reward > 0 ? t(lang, "dq.invite", { n: `${som(lang, reward)}` }) : t(lang, "dq.inviteNoReward");
  return {
    text: esc(text),
    reply_markup: rows([inlineButton(null, t(lang, "dq.start"), { callback_data: cb.dqStart() }, "primary")], [inlineButton(null, t(lang, "dq.offBtn"), { callback_data: cb.dqOff() })]),
  };
}

function questionBlock(lang: Lang, q: PublicQuestion): string {
  const head = `🧠 <b>${esc(t(lang, "dq.question", { i: q.index + 1, n: DAILY_QUIZ_PER_DAY }))}</b>`;
  const options = q.options.map((o, i) => `${LETTERS[i]}) ${esc(o)}`).join("\n");
  return `${head}\n\n${esc(q.q)}\n\n${options}`;
}

function answerButtons(day: string, q: PublicQuestion) {
  const d = dayNumber(day);
  return rows(LETTERS.map((l, i) => inlineButton(null, l, { callback_data: cb.dqAnswer(d, q.index, i) })));
}

/** The question screen (the first one after «Boshlash», or a resumed run). */
export function questionScreen(lang: Lang, day: string, q: PublicQuestion): Screen {
  return { text: questionBlock(lang, q), reply_markup: answerButtons(day, q) };
}

/** The final line of a finished run: paid / capped / budget / no reward / lost. */
export function resultText(lang: Lang, r: QuizResult): string {
  if (r.correct < DAILY_QUIZ_PER_DAY) return t(lang, "dq.lost", { c: r.correct });
  switch (r.outcome) {
    case "paid":
      return t(lang, "dq.won", { n: som(lang, r.rewarded) });
    case "cap":
      return t(lang, "dq.cap", { n: som(lang, r.monthlyCap ?? 0) });
    case "budget":
      return t(lang, "dq.budget");
    default:
      return t(lang, "dq.none");
  }
}

/** After an answer: the answered question with ✅/❌ + explanation, then the next question or the result. */
export function answeredScreen(lang: Lang, day: string, o: AnswerOutcome): Screen {
  const verdict = o.correct
    ? t(lang, "dq.right")
    : t(lang, "dq.wrong", { a: `${LETTERS[o.right]}) ${o.question.options[o.right]}` });
  const done = `${questionBlock(lang, o.question)}\n\n${esc(verdict)}\n💡 ${esc(o.explanation)}`;
  const st = o.state;
  if (st.next) return { text: `${done}\n\n──────────\n\n${questionBlock(lang, st.next)}`, reply_markup: answerButtons(day, st.next) };
  return { text: `${done}\n\n──────────\n\n<b>${esc(resultText(lang, st.result!))}</b>` };
}

function plainScreen(lang: Lang, key: Parameters<typeof t>[1], vars: Record<string, string | number> = {}): Screen {
  return { text: esc(t(lang, key, vars)) };
}

/** What `/savol` and «Boshlash» show for a state: the next question, or «already answered». */
function stateScreen(lang: Lang, st: QuizState): Screen {
  if (st.next) return questionScreen(lang, st.day, st.next);
  return plainScreen(lang, "dq.done", { c: st.correct });
}

/* ───────────────────────── Handlers ───────────────────────── */

/** Service refusals the user can act on, as a bot text. Anything else is logged by the caller and shown as a generic error. */
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

function subscriptionScreen(lang: Lang, off: boolean): Screen {
  return off
    ? { text: esc(t(lang, "dq.offDone")), reply_markup: rows([inlineButton(null, t(lang, "dq.onBtn"), { callback_data: cb.dqOn() })]) }
    : { text: esc(t(lang, "dq.onDone")), reply_markup: rows([inlineButton(null, t(lang, "dq.offBtn"), { callback_data: cb.dqOff() })]) };
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
