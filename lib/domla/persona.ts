/**
 * The voice of «Qattiqqo'l domla» (owner request 15): what he SAYS (TTS text), what he WRITES under it (HTML
 * captions / reactions) and the final verdict. Uzbek only -- the persona does not change with the bot language.
 * Strict, funny, never insulting. Dynamic text (the student's transcript, the model's verdicts) is HTML-escaped
 * here, once.
 */
import { esc } from "../server/bot/ui";
import { DOMLA_MAX_SCORE, gradeOf, type DomlaAnswer, type DomlaQuestion, type Grade } from "./rules";

const ORDINAL = ["Birinchi", "Ikkinchi", "Uchinchi", "To'rtinchi", "Beshinchi"] as const;
const ordinal = (i: number): string => ORDINAL[i] ?? `${i + 1}-`;

/** The first thing he says: greeting + the rules, then the first question. */
export const GREETING =
  "Assalomu alaykum. Men sizning himoyangizni qabul qilaman. Beshta savol beraman. Har biriga ovozli xabar bilan javob bering. Boshladik.";

/** The text sent to the TTS for question `idx` (0-based). */
export function spokenQuestion(idx: number, q: DomlaQuestion, opts: { greet?: boolean; resume?: boolean } = {}): string {
  const lead = opts.greet ? `${GREETING} ` : opts.resume ? "Davom etamiz. " : "";
  return `${lead}${ordinal(idx)} savol. ${q.text}`;
}

/** The caption of the audio message (also the full text when the voice could not be made). */
export function questionCaption(idx: number, total: number, q: DomlaQuestion): string {
  return `🎓 <b>Savol ${idx + 1}/${total}</b>\n\n${esc(q.text)}\n\n<i>🎙 Ovozli xabar bilan javob bering (yoki matn yozing).</i>`;
}

/** The short reaction to an answer, by score. */
export function reactionLine(score: number): string {
  if (score >= 5) return "Barakalla. To'liq javob.";
  if (score === 4) return "Yaxshi. Deyarli to'liq.";
  if (score === 3) return "Hm… qisman to'g'ri.";
  if (score === 2) return "Zaif. Yana bir oz o'ylash kerak edi.";
  if (score === 1) return "Savolga deyarli to'g'ri kelmadi.";
  return "Bu javob emas. Keyingi savolga o'tamiz.";
}

const clipText = (s: string, n: number): string => (Array.from(s).length <= n ? s : `${Array.from(s).slice(0, n - 1).join("").trimEnd()}…`);

/** The message after an answer: what was heard, the score, one line of verdict. */
export function reactionMessage(a: DomlaAnswer): string {
  const heard = a.transcript ? `<i>«${esc(clipText(a.transcript, 160))}»</i>\n\n` : "<i>(javob eshitilmadi)</i>\n\n";
  const verdict = a.verdict ? `\n${esc(a.verdict)}` : "";
  return `${heard}<b>${a.score}/${DOMLA_MAX_SCORE}</b> — ${esc(reactionLine(a.score))}${verdict}`;
}

/** «Domla senga 4 qo'ydi.» and the joke that goes with the grade. */
const HEADLINE: Record<Grade, string> = {
  5: "Domla senga 5 qo'ydi. Hatto o'zi ham hayron bo'ldi.",
  4: "Domla senga 4 qo'ydi. Yaxshi, lekin 5 ga bir qadam qoldi.",
  3: "Domla senga 3 qo'ydi. O'tding, lekin domla qoshini chimirib qoldi.",
  2: "Domla senga 2 qo'ydi. Xafa bo'lma — jurnalga yozilmaydi, qayta tayyorlanib kel.",
};

export const headline = (g: Grade): string => HEADLINE[g];

/** The final message. Idempotent text: same inputs, same output. */
export function finalMessage(questions: readonly DomlaQuestion[], answers: readonly DomlaAnswer[]): string {
  const scores = questions.map((_, i) => answers.find((a) => a.idx === i)?.score ?? 0);
  const grade = gradeOf(scores, questions.length);
  const total = scores.reduce((a, b) => a + b, 0);
  const lines = questions.map((q, i) => {
    const a = answers.find((x) => x.idx === i);
    const mark = scores[i]! >= 4 ? "✅" : scores[i]! >= 2 ? "➖" : "❌";
    const note = a?.verdict ? ` — ${esc(a.verdict)}` : "";
    return `${mark} <b>${i + 1}.</b> ${esc(clipText(q.text, 90))}\n      ${scores[i]}/${DOMLA_MAX_SCORE}${note}`;
  });
  // The weakest question (the first one on a tie): where the student went wrong, and the right answer.
  let weak = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i]! < scores[weak]!) weak = i;
  const wq = questions[weak]!;
  const wa = answers.find((x) => x.idx === weak);
  const parts = [
    `🎓 <b>${esc(HEADLINE[grade])}</b>`,
    `Jami: <b>${total}/${questions.length * DOMLA_MAX_SCORE}</b>`,
    lines.join("\n"),
  ];
  if (scores[weak]! < DOMLA_MAX_SCORE) {
    const mistake = wa?.mistake ? `\n${esc(wa.mistake)}` : "";
    parts.push(
      `🔎 <b>Mana bu savolda adashding:</b>\n«${esc(wq.text)}»${mistake}\n\n💡 <b>To'g'ri javob:</b> ${esc(wq.ideal)}`,
    );
  } else {
    parts.push("🔎 Adashgan joying yo'q. Domla indamay qoldi.");
  }
  return parts.join("\n\n");
}

export const NOT_FOUND_TEXT = "Domla bu ishni topa olmadi.";
export const DISABLED_TEXT = "Qattiqqo'l domla hozircha dam olyapti. Birozdan keyin qayting.";
export const FAILED_TEXT = "Domla savollarni tuza olmadi. To'lov to'liq qaytarildi — keyinroq qayta urinib ko'ring.";
export const EXPIRED_TEXT = "Domla 30 daqiqa kutdi va ketdi. Himoya tugadi — xohlasangiz /domla bilan qaytadan boshlang.";
export const HEARING_FAILED_TEXT = "Domla javobingizni eshita olmadi. Iltimos, ovozli xabarni qayta yuboring yoki matn yozing.";
export const TOO_BIG_TEXT = "Ovozli xabar juda katta (2 MB dan oshmasin). Qisqaroq qilib qayta yuboring.";
export const TOO_LONG_TEXT = "Ovozli xabar juda uzun (ko'pi bilan 2 daqiqa). Qisqaroq qilib qayta yuboring.";
export const BUSY_TEXT = "Domla oldingi javobingizni hali tinglayapti. Biroz kuting.";
export const NOT_WAITING_TEXT = "Domla hali savolni aytib bo'lmadi. Biroz kuting.";
