import { slideLabels } from "./i18n";
import type { SlideModel } from "./slide-types";
import type { DocMeta } from "./types";

/**
 * Nazorat testining DEKA darajasidagi qoidalari.
 *
 * Maket (`slide-layout-extra.ts`) bitta slaydni chizadi, bu modul esa
 * test butun deka bo'ylab to'g'ri joylashishini ta'minlaydi:
 *
 *   1) har `quiz` slaydida AYNAN BITTA savol. To'rt variantli savol
 *      slayd balandligining yarmini egallaydi; ikkitasi sig'sa ham
 *      o'qib bo'lmaydigan darajada mayda chiqardi;
 *   2) to'g'ri javob NOTIQ IZOHIGA yoziladi — slaydda hech qachon
 *      ko'rinmaydi (aks holda savolning ma'nosi qolmaydi);
 *   3) izohlar o'chirilgan bo'lsa (`speakerNotes: false`) javoblar
 *      hech qayerda qolmasdi — shuning uchun REJADA yakun slaydidan
 *      oldin `answers` slaydi turadi va bu modul uni TO'LDIRADI.
 *
 * UZUNLIK O'ZGARMAYDI (X-3). Ilgari bu modul savollarni slaydlarga
 * AJRATARDI va `answers` ni QO'SHARDI: 10 slayd so'ragan foydalanuvchi
 * `quizCount: 3` da 13, `quizCount: 10` da 20 slayd olardi. Va'da,
 * narx (2 000 tanga × slayd), rasm byudjeti va `delivered` hisobi —
 * hammasi rejadagi songa bog'langan, ya'ni «ortiqcha slayd» yaxshilik
 * emas, buzilish edi. Endi savol slaydlari va javoblar kaliti
 * `blocksToBeats` REJASIDA tug'iladi (8-qoida), bu modul esa faqat
 * MAVJUD slaydlarni to'ldiradi.
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

/**
 * Deka bo'ylab savollarni YIG'ADI — deka tartibida.
 *
 * Model rejaga rioya qilmasligi mumkin: uchala savolni birinchi
 * slaydga solib, qolgan ikki `quiz` slaydini bo'sh qoldirishi ham,
 * har slaydga uchtadan yozishi ham uchraydi. Ikkala holatda ham
 * manba bitta ro'yxat bo'ladi va u slaydlarga qayta taqsimlanadi.
 */
function collectQuestions(slides: SlideModel[]): NonNullable<SlideModel["quiz"]> {
  const out: NonNullable<SlideModel["quiz"]> = [];
  for (const s of slides) if (s.layout === "quiz" && s.quiz?.length) out.push(...s.quiz);
  return out;
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
 * Javob izohini QAYTA hisoblaydi — ko'ruvchida variant tahrirlangach.
 *
 * `withAnswerNote` faqat QO'SHADI: mavjud «Javob: B — eski matn»
 * qatorini ko'rib turib ikkinchisini yozmaydi, ya'ni foydalanuvchi B
 * variantining matnini o'zgartirsa izohda ESKI matn qolib ketardi va
 * ma'ruzachi slaydda yo'q javobni o'qirdi. Bu funksiya avval `Javob:`
 * bilan boshlanuvchi HAMMA qatorni olib tashlaydi, keyin yangisini
 * yozadi — natija joriy `quiz[0]` ga har doim mos.
 *
 * Sof: kirish slaydini o'zgartirmaydi, nusxa qaytaradi. Test bo'lmagan
 * (yoki savolsiz) slayd o'zgarishsiz qaytadi.
 */
export function refreshAnswerNote(s: SlideModel): SlideModel {
  if (!s.quiz?.length) return s;
  const rest = (s.notes || "")
    .split("\n")
    .filter((line) => !line.trim().startsWith(ANSWER_PREFIX))
    .join("\n")
    .trim();
  return withAnswerNote(rest === (s.notes || "").trim() ? s : { ...s, notes: rest || undefined });
}

/**
 * REJADAGI javoblar slaydini to'ldiradi — «1 — B», «2 — D».
 *
 * Slayd QO'SHILMAYDI: u `blocksToBeats` da `answers` beat sifatida
 * allaqachon rejalashtirilgan va yakun slaydidan oldin turadi
 * (taqdimot «Xulosa» bilan tugashi kerak, kalit varag'i bilan emas).
 * Reja unga joy topmagan bo'lsa (juda qisqa deka) javoblar baribir
 * har savol slaydining IZOHIDA qoladi — ma'lumot yo'qolmaydi.
 */
function fillAnswersSlide(slides: SlideModel[], quizzes: SlideModel[], meta: DocMeta): void {
  const at = slides.findIndex((s) => s.layout === "answers");
  if (at < 0) return;
  const L = slideLabels(meta.language);
  slides[at] = {
    ...slides[at],
    title: L.answers,
    bullets: quizzes.map((s, i) => {
      const q = s.quiz![0];
      return `${i + 1} — ${QUIZ_LETTERS[answerIndex(q.answer, q.options)]}`;
    }),
    footer: quizzes[quizzes.length - 1].footer ?? slides[at].footer,
  };
}

/**
 * Test slaydlarini deka darajasida yakunlaydi (joyida o'zgartiradi).
 *
 * `slide-write.ts` uni `applyResearchRefs` dan keyin — ya'ni matn
 * to'liq yig'ilgach, titul/yakun tuzatishlaridan oldin — chaqiradi.
 *
 * SLAYD SONI O'ZGARMAYDI: na qo'shiladi, na o'chiriladi. Model
 * kutilganidan KO'P savol qaytarsa ortiqchasi tashlanadi, KAM
 * qaytarsa ortgan `quiz` slaydlari o'z holicha qoladi (bo'sh savolli
 * slayd `normalizeSlide` da allaqachon bandlarga tushgan bo'ladi).
 */
export function finalizeQuiz(slides: SlideModel[], meta: DocMeta): void {
  const at: number[] = [];
  for (let i = 0; i < slides.length; i++) if (slides[i].layout === "quiz") at.push(i);
  const pool = collectQuestions(slides);
  if (!at.length || !pool.length) return;
  /*
   * Har slaydga BITTADAN savol, deka tartibida. `pool` rejadagi savol
   * slaydlaridan uzun bo'lsa ortiqchasi TASHLANADI: uzunlik shartnomasi
   * savollar sonidan ustun turadi (X-3) — foydalanuvchi slaydga to'lagan.
   */
  at.forEach((i, k) => {
    const q = pool[k];
    if (!q) return;
    // Javob HAR DOIM izohga yoziladi — `speakerNotes` bayrog'i uni faqat
    // KO'RSATISHNI o'chiradi (`slideNotes`), yozishni emas.
    slides[i] = withAnswerNote({ ...slides[i], quiz: [q] });
  });
  const quizzes = at.map((i) => slides[i]).filter((s) => s.quiz?.length);
  if (quizzes.length) fillAnswersSlide(slides, quizzes, meta);
}
