import { slideLabels } from "./i18n";
import type { SlideModel } from "./slide-types";
import type { DocMeta } from "./types";

/**
 * Nazorat testining DEKA darajasidagi qoidalari.
 *
 * Maket (`slide-layout-extra.ts`) bitta slaydni chizadi, bu modul esa
 * test butun deka bo'ylab to'g'ri joylashishini ta'minlaydi:
 *
 *   1) bitta slaydda bir nechta savol bo'lsa — HAR SAVOL alohida
 *      slaydga. To'rt variantli savol slayd balandligining yarmini
 *      egallaydi; ikkitasi sig'sa ham o'qib bo'lmaydigan darajada
 *      mayda chiqardi;
 *   2) to'g'ri javob NOTIQ IZOHIGA yoziladi — slaydda hech qachon
 *      ko'rinmaydi (aks holda savolning ma'nosi qolmaydi);
 *   3) izohlar o'chirilgan bo'lsa (`speakerNotes: false`) javoblar
 *      hech qayerda qolmasdi — shuning uchun deka oxiriga, yakun
 *      slaydidan OLDIN, `answers` slaydi qo'shiladi.
 *
 * Funksiya deterministik: tashqi holat, vaqt yoki tasodif yo'q — bir
 * xil kirishda har doim bir xil natija.
 */

/** Variant harflari — maket ham, javob izohi ham SHU ro'yxatdan oladi. */
export const QUIZ_LETTERS = ["A", "B", "C", "D"] as const;

/** Javob izohining boshi — `finalizeQuiz` ikki marta chaqirilsa takrorlamaslik uchun ham kerak. */
const ANSWER_PREFIX = "Javob:";

function clip(text: string, n: number) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** `answer` maydonini harf indeksiga keltiradi — buzuq qiymat 0 ga tushadi. */
export function answerIndex(answer: unknown, options: string[] = []): number {
  const n = Number(answer);
  if (!Number.isFinite(n)) return 0;
  const max = Math.max(0, Math.min(QUIZ_LETTERS.length, options.length || QUIZ_LETTERS.length) - 1);
  return Math.max(0, Math.min(max, Math.round(n)));
}

/** Savolli slaydlar — `quiz` maketi va kamida bitta savol. */
function quizSlides(slides: SlideModel[]): SlideModel[] {
  return slides.filter((s) => s.layout === "quiz" && (s.quiz?.length ?? 0) > 0);
}

/**
 * Ko'p savolli slaydni savol-ma-savol ajratadi.
 *
 * `title`, `footer` va boshqa maydonlar saqlanadi. Birinchi savol
 * slaydning O'Z `id` sida qoladi; qo'shimchalari `-q2`, `-q3` qo'shimchasi
 * bilan ketadi — takroriy `id` ko'ruvchida React kaliti to'qnashuvini va
 * `slide-images.ts` da prompt almashinuvini beradi (AUDIT-7 da o'lchangan).
 */
function splitQuizSlides(slides: SlideModel[]): void {
  if (!slides.some((s) => s.layout === "quiz" && (s.quiz?.length ?? 0) > 1)) return;
  const next: SlideModel[] = [];
  for (const s of slides) {
    if (s.layout !== "quiz" || !s.quiz?.length) {
      next.push(s);
      continue;
    }
    s.quiz.forEach((q, i) => {
      next.push(i === 0 ? { ...s, quiz: [q] } : { ...s, id: `${s.id}-q${i + 1}`, quiz: [q] });
    });
  }
  slides.length = 0;
  slides.push(...next);
}

/** «Javob: B — Variant matni». Mavjud izohga qo'shiladi, ustiga yozilmaydi. */
function withAnswerNote(s: SlideModel): SlideModel {
  const q = s.quiz?.[0];
  if (!q) return s;
  const i = answerIndex(q.answer, q.options);
  const option = clip(q.options[i] ?? "", 120);
  const line = `${ANSWER_PREFIX} ${QUIZ_LETTERS[i]}${option ? ` — ${option}` : ""}`;
  const written = (s.notes || "").trim();
  if (written.includes(line)) return s;
  return { ...s, notes: written ? `${written}\n${line}` : line };
}

/**
 * Javoblar slaydi — «1 — B», «2 — D».
 *
 * Yakun slaydidan OLDIN turadi: taqdimot «Xulosa» bilan tugashi kerak,
 * kalit varag'i bilan emas.
 */
function insertAnswersSlide(slides: SlideModel[], quizzes: SlideModel[], meta: DocMeta): void {
  const L = slideLabels(meta.language);
  const bullets = quizzes.map((s, i) => {
    const q = s.quiz![0];
    return `${i + 1} — ${QUIZ_LETTERS[answerIndex(q.answer, q.options)]}`;
  });
  const answers: SlideModel = {
    id: "answers-fix",
    layout: "answers",
    title: L.answers,
    bullets,
    footer: quizzes[quizzes.length - 1].footer,
  };
  const last = slides[slides.length - 1];
  if (last && last.layout === "closing") slides.splice(slides.length - 1, 0, answers);
  else slides.push(answers);
}

/**
 * Test slaydlarini deka darajasida yakunlaydi (joyida o'zgartiradi).
 *
 * `slide-write.ts` uni `applyResearchRefs` dan keyin — ya'ni matn
 * to'liq yig'ilgach, titul/yakun tuzatishlaridan oldin — chaqiradi.
 */
export function finalizeQuiz(slides: SlideModel[], meta: DocMeta): void {
  splitQuizSlides(slides);
  if (!quizSlides(slides).length) return;
  // Javob HAR DOIM izohga yoziladi — `speakerNotes` bayrog'i uni faqat
  // KO'RSATISHNI o'chiradi (`slideNotes`), yozishni emas.
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.layout === "quiz" && s.quiz?.length) slides[i] = withAnswerNote(s);
  }
  if (meta.speakerNotes === false) insertAnswersSlide(slides, quizSlides(slides), meta);
}
