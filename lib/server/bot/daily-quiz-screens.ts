import { DAILY_QUIZ_PER_DAY, dayNumber } from "../../daily-quiz/rules";
import type { AnswerOutcome, PublicQuestion, QuizResult, QuizState } from "../daily-quiz";
import { som } from "./bonus";
import { cb } from "./codes";
import { t, type Lang, type TextKey } from "./i18n";
import { esc, inlineButton, rows, type Screen } from "./ui";

/**
 * Screens of the daily logic quiz (owner request 16): pure values, no I/O and no router import, so the
 * worker's sender (`daily-quiz-send.ts`) can build the morning message without loading the whole bot router.
 * Message shape: ONE message per quiz run — an answer EDITS it to «✅/❌ + explanation» followed by the next
 * question (or the final result).
 */

const LETTERS = ["A", "B", "C", "D"] as const;

/** The morning message (also the sender's `build`): invitation + «Boshlash» / «Obunani o‘chirish». */
export function inviteScreen(lang: Lang, reward: number): Screen {
  const text = reward > 0 ? t(lang, "dq.invite", { n: som(lang, reward) }) : t(lang, "dq.inviteNoReward");
  return {
    text: esc(text),
    reply_markup: rows(
      [inlineButton(null, t(lang, "dq.start"), { callback_data: cb.dqStart() }, "primary")],
      [inlineButton(null, t(lang, "dq.offBtn"), { callback_data: cb.dqOff() })],
    ),
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
  const verdict = o.correct ? t(lang, "dq.right") : t(lang, "dq.wrong", { a: `${LETTERS[o.right]}) ${o.question.options[o.right]}` });
  const done = `${questionBlock(lang, o.question)}\n\n${esc(verdict)}\n💡 ${esc(o.explanation)}`;
  const st = o.state;
  if (st.next) return { text: `${done}\n\n──────────\n\n${questionBlock(lang, st.next)}`, reply_markup: answerButtons(day, st.next) };
  return { text: `${done}\n\n──────────\n\n<b>${esc(resultText(lang, st.result!))}</b>` };
}

export function plainScreen(lang: Lang, key: TextKey, vars: Record<string, string | number> = {}): Screen {
  return { text: esc(t(lang, key, vars)) };
}

/** What `/savol` and «Boshlash» show for a state: the next question, or «already answered». */
export function stateScreen(lang: Lang, st: QuizState): Screen {
  if (st.next) return questionScreen(lang, st.day, st.next);
  return plainScreen(lang, "dq.done", { c: st.correct });
}

/** The `/obuna` confirmation: the current state and the button that flips it. */
export function subscriptionScreen(lang: Lang, off: boolean): Screen {
  return off
    ? { text: esc(t(lang, "dq.offDone")), reply_markup: rows([inlineButton(null, t(lang, "dq.onBtn"), { callback_data: cb.dqOn() })]) }
    : { text: esc(t(lang, "dq.onDone")), reply_markup: rows([inlineButton(null, t(lang, "dq.offBtn"), { callback_data: cb.dqOff() })]) };
}
