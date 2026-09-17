/**
 * BALL SERVER TOMONDA (AUDIT-22 R0) — `scoreAnswers`.
 *
 * O'yinchi tomoni (`components/game/Player.tsx`) FAQAT tanlovni
 * yuboradi; to'g'ri javob unga hech qachon yuborilmaydi
 * (`publicGameView`), ya'ni ballni ham u hisoblay olmaydi va hisoblamaydi.
 * Aks holda «100 %» yozilgan har qanday so'rov o'qituvchining natijalar
 * jadvaliga tushardi.
 *
 * Variantlar ochiq ko'rinishda ARALASHTIRILGAN (`publicOptionOrder`), va
 * bu yerda AYNI tartib qayta quriladi — sessiyada hech narsa saqlanmaydi,
 * chunki tartib element id sining funksiyasi (sof, deterministik).
 *
 * IZOMORF: server importi YO'Q — testda ham, route'da ham bir xil kod.
 */
import type { AcademicDoc } from "../generation/types";
import { PUBLIC_QUIZ_KINDS, publicItemId, publicOptionOrder, type PublicGameKind } from "./public";

/** O'yinchi yuborgan javoblar: element id → tanlov (shakl turga bog'liq). */
export type PlayerAnswers = Record<string, unknown>;

export type ScoreResult = {
  /** To'g'ri bajarilgan elementlar soni. */
  score: number;
  /** Jami elementlar (`publicGameView(...).total` bilan AYNI son). */
  total: number;
  /** Element id → to'g'rimi (natija ekrani va `answers_json` uchun). */
  results: Record<string, boolean>;
};

const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Krossvord javobini solishtirish uchun normallashtirish.
 *
 * Apostroflar (`ʻ`, `ʼ`, `'`, `’`) va registr e'tiborga olinmaydi: o'zbek
 * lotinida `oʻ` ni klaviaturadan turlicha yozish mumkin va o'quvchini
 * shu farq uchun jazolash noto'g'ri bo'lardi.
 */
function normWord(s: string): string {
  return clean(s).toUpperCase().replace(/[ʻʼ'’`]/g, "").replace(/\s+/g, "");
}

const asIndex = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

const sameSet = (a: readonly number[], b: readonly number[]): boolean => {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((v) => s.has(v));
};

/**
 * Ball hisobi — hujjat + o'yin turi + o'yinchi javoblari.
 *
 * Javob yo'q yoki noto'g'ri shaklda bo'lsa — shunchaki XATO (istisno
 * tashlanmaydi): ochiq endpointga har qanday JSON kelishi mumkin va
 * bitta buzuq maydon butun natijani yo'qotmasligi kerak.
 */
export function scoreAnswers(doc: AcademicDoc, kind: PublicGameKind, answers: PlayerAnswers): ScoreResult {
  const a = answers && typeof answers === "object" ? answers : {};
  const results: Record<string, boolean> = {};

  if (kind === "quiz") {
    const questions = (doc.teacher?.test?.questions ?? []).filter((q) => (PUBLIC_QUIZ_KINDS as readonly string[]).includes(q.kind));
    for (const q of questions) {
      const id = clean(q.id) || publicItemId(q.stem);
      const given = a[id];
      if (q.kind === "truefalse") {
        results[id] = typeof given === "boolean" && given === q.answer;
        continue;
      }
      const order = publicOptionOrder(id, q.options.length);
      if (q.kind === "single") {
        const i = asIndex(given);
        results[id] = i !== null && i < order.length && order[i] === q.answer;
        continue;
      }
      // `multi`: ochiq indekslar → model indekslari; TO'PLAM sifatida solishtiriladi.
      const picked = Array.isArray(given) ? given.map(asIndex) : [];
      const valid = picked.filter((i): i is number => i !== null && i < order.length).map((i) => order[i]);
      const want = Array.isArray(q.answer) ? (q.answer as number[]) : [];
      results[id] = picked.length > 0 && valid.length === picked.length && sameSet(valid, want);
    }
    return finish(results, questions.length);
  }

  if (kind === "crossword") {
    const words = doc.game?.crossword?.words ?? [];
    for (const w of words) {
      results[w.id] = normWord(String(a[w.id] ?? "")) === normWord(w.answer.join(""));
    }
    return finish(results, words.length);
  }

  if (kind === "flashcards") {
    /*
     * Kartalar — O'ZINI tekshirish mashqi: to'g'ri javob orqa yuzda
     * turibdi va uni server tekshira olmaydi. Shuning uchun ball —
     * o'yinchi «bildim» deb belgilagan kartalar soni.
     *
     * Bu HALOL o'lchov emas va shunday bo'lib qoladi: o'qituvchi
     * natijalar jadvalida buni «takrorlash» ustuni sifatida ko'radi
     * (kim nechta kartani ko'rib chiqdi), imtihon bahosi sifatida emas.
     */
    const cards = doc.game?.cards?.cards ?? [];
    for (const c of cards) results[c.id] = a[c.id] === true;
    return finish(results, cards.length);
  }

  if (kind === "sorting") {
    const categories = doc.game?.sorting?.categories ?? [];
    let total = 0;
    for (const c of categories) {
      const catId = clean(c.id) || publicItemId(c.name);
      for (const raw of c.items) {
        const text = clean(raw);
        const id = publicItemId(text);
        total++;
        results[id] = clean(a[id]) === catId;
      }
    }
    return finish(results, total);
  }

  const items = doc.game?.listening?.items ?? [];
  for (const it of items) {
    const id = clean(it.id) || publicItemId(it.text);
    const order = publicOptionOrder(id, it.options.length);
    const i = asIndex(a[id]);
    results[id] = i !== null && i < order.length && order[i] === it.answer;
  }
  return finish(results, items.length);
}

function finish(results: Record<string, boolean>, total: number): ScoreResult {
  const score = Object.values(results).filter(Boolean).length;
  return { score, total, results };
}

/** Foiz (0–100) — natijalar jadvali va CSV shu yerdan (bitta yaxlitlash qoidasi). */
export function scorePercent(r: { score: number; total: number }): number {
  if (!r.total) return 0;
  return Math.round((r.score / r.total) * 100);
}
