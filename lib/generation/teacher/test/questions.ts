/**
 * TEST SAVOLLARI — NORMALIZATSIYA, VARIANTLAR, KALIT, BALL (AUDIT-20 WP-B).
 *
 * Bu modul LLM ga ham, tarmoqqa ham TEGMAYDI: kirish — model qaytargan
 * xom JSON, chiqish — `TestQuestion[]`, `TestVariant[]`, `key` va
 * `TestScoring`. Shuning uchun u to'liq deterministik va testdan
 * o'tkazsa bo'ladi (`tests/teacher-test-questions.test.mts`).
 *
 * Nega normalizatsiya dvigatelda emas, alohida modulda: xuddi shu
 * qoidalar uch joyda kerak — generatsiyada, «Tuzatish» (rewrite) dan
 * keyin va tahrirdan keyin hisobot qayta hisoblanganda. Ular bitta
 * joyda bo'lmasa, o'qituvchi savolni tahrir qilgach kalit bilan matn
 * ajralib ketardi.
 *
 * QOIDALAR (R3 §3.3–3.5, `docs/research/test.md`):
 *   — variant soni SINFGA bog'liq: 1–4 → 3, 5–11 → 4 (S-19/S-10);
 *   — «hammasi to'g'ri / yuqoridagilarning barchasi / hech biri»
 *     TAQIQ (S-18 Haladyna) — bunday variant o'chiriladi;
 *   — o'zaklari 0,8 dan yaqin savollar DUBLIKAT (trigram Jaccard);
 *   — variantlar bitta savol ichida takrorlanmaydi;
 *   — `evaluate`/`create` faqat `open` savolda (MCQ bilan o'lchanmaydi);
 *   — ball yig'indisi e'lon qilingan jamiga (bsb 50, chsb 40) TENG.
 *
 * VARIANTLAR (A/B/C/D) — YANGI savol EMAS, faqat TARTIB (R3 §3.4):
 * bitta savol bazasi + seeded Fisher–Yates. Shu qaror tufayli qiyinlik
 * pariteti kafolatlanadi (`variantParity` qoidasi buni tekshiradi) va
 * o'qituvchi bitta matnni tekshiradi.
 */
import { QUIZ_LETTERS } from "../../slide-quiz";
import { trigrams, jaccard } from "../../report/score";
import {
  BLOOM_LEVELS,
  BLOOM_OPEN_ONLY,
  TEACHER_LIMITS,
  TEST_DIFFICULTIES,
  TEST_QUESTION_KINDS,
  TEST_VARIANT_IDS,
  optionCountForGrade,
  type BloomLevel,
  type GradeBand,
  type TestAnswer,
  type TestDifficulty,
  type TestMatchPair,
  type TestQuestion,
  type TestQuestionKind,
  type TestScoring,
  type TestVariant,
} from "../types";

/* ────────────────────────── matn yordamchilari ────────────────────────── */

/** Bo'sh joy bitta probel; kesilgan. */
export function clean(s: unknown, max = 600): string {
  return String(s ?? "")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Iqtibosni QIYOSLASH shakliga keltiradi (R3 §3.8).
 *
 * Model manbadan ko'chirganda tipografika o'zgaradi: NBSP probelga,
 * «qo'shtirnoq» boshqa shaklga, tire uzun/qisqa, ba'zan ikki probel.
 * Solishtirish shu farqlarga qarab yiqilmasin — ikkala tomon ham SHU
 * funksiyadan o'tadi, so'ng oddiy `includes` ishlaydi.
 */
export function normalizeQuote(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[   ]/g, " ")
    .replace(/[‘’‚‛`´ʻʼ']/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[–—−‑]/g, "-")
    .replace(/[^\p{L}\p{N}'"\-. ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Iqtibosdagi so'zlar soni (R3: 10–25 so'z). */
export const quoteWords = (s: string): number => normalizeQuote(s).split(" ").filter(Boolean).length;

/**
 * «Blanket» variant — S-18 bo'yicha TAQIQ.
 *
 * Nega ro'yxat regex bilan: model uni o'zbekcha, ruscha va inglizcha
 * shakllarda yozadi, ba'zan «A va B javoblari to'g'ri» ko'rinishida.
 * Bunday variant testni buzadi: u har doim yo eng uzun, yo eng jozibali
 * bo'ladi va o'quvchi mazmunni bilmasdan ham topadi.
 */
const BLANKET_RE = [
  /\b(hammasi|barchasi|yuqoridagilarning\s+(barchasi|hammasi|hech\s*biri))\b/i,
  /\bhech\s*(biri|qaysi\s*biri)\b/i,
  /\bto'?g'?ri\s+javob\s+yo'?q\b/i,
  /\ball\s+of\s+the\s+above\b/i,
  /\bnone\s+of\s+the\s+above\b/i,
  /\bвсе\s+(вышеперечисленн|ответы|варианты)/i,
  /\bни\s+один\s+из\b/i,
  /^[A-DА-Г]\s*(va|и|and)\s*[A-DА-Г]\b/i,
];

export function isBlanketOption(text: string): boolean {
  const t = normalizeQuote(text).replace(/'/g, "'");
  return BLANKET_RE.some((re) => re.test(t) || re.test(text));
}

/** Inkor so'zi BOSH HARFDA ajratilganmi (S-18: «erimAYDI», «EMAS»). */
const NEGATIVE_WORDS = /\b(emas|noto'?g'?ri|bo'?lmagan|not|except|неверн|кроме)\b/i;
/*
 * «eriMAYDI» — inkor SO'Z ICHIDA bosh harfda: shuning uchun qo'shimcha
 * (`MAYDI`) oldidan katta harf talab qilinmaydi, aks holda o'zbekchadagi
 * eng ko'p uchraydigan shakl («suvda eriMAYDI») ushlanmay qolardi.
 */
const NEGATIVE_CAPS = /(EMAS|NOTO'?G'?RI|MAYDI|MAYDIGAN|NOT|EXCEPT|НЕВЕРН|КРОМЕ)/;

export const hasNegation = (stem: string): boolean => NEGATIVE_WORDS.test(stem);
export const negationMarked = (stem: string): boolean => NEGATIVE_CAPS.test(stem);

/* ────────────────────────── seeded tasodif ────────────────────────── */

/** FNV-1a — barqaror, platformadan mustaqil (Math.random ishlatilmaydi). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — kichik, tez va TAKRORLANADIGAN generator. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates; kirish massivi O'ZGARMAYDI. */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ────────────────────────── normalizatsiya ────────────────────────── */

export type TestNormalizeCtx = {
  /** 1–11; variantlar soni shundan (`optionCountForGrade`). */
  grade: number;
  /** So'ralgan savol soni — ortiqchasi KESILADI. */
  count: number;
  /** Ruxsat etilgan savol turlari (reyestr `limits.kinds` ∩ forma). */
  kinds: readonly TestQuestionKind[];
  /** Tur variant sonini qat'iy belgilasa (DTM — 4). */
  optionCountFixed?: number | null;
  /** `mode:"file"` — iqtibos shu matnda topilishi SHART (R3 §3.8). */
  sourceText?: string;
  /** `mode:"curriculum"` — ruxsat etilgan mavzu id lari. */
  topicIds?: readonly string[];
};

export type DropReason = "kind" | "stem" | "options" | "answer" | "duplicate" | "blanket" | "source" | "extra";

export type NormalizeResult = {
  questions: TestQuestion[];
  /** Nega tashlangani — hisobot bandlari shu sondan matn yasaydi. */
  dropped: Record<DropReason, number>;
  /** Variant matni «blanket» bo'lgani uchun OLIB TASHLANGAN variantlar soni. */
  strippedOptions: number;
};

/** O'zaklar shu darajadan yaqin bo'lsa — dublikat (R3 §4.1). */
export const DUPLICATE_JACCARD = 0.8;

const emptyDrops = (): Record<DropReason, number> => ({ kind: 0, stem: 0, options: 0, answer: 0, duplicate: 0, blanket: 0, source: 0, extra: 0 });

const isKind = (v: unknown): v is TestQuestionKind => (TEST_QUESTION_KINDS as readonly string[]).includes(String(v));
const isDifficulty = (v: unknown): v is TestDifficulty => (TEST_DIFFICULTIES as readonly string[]).includes(String(v));
const isBloom = (v: unknown): v is BloomLevel => (BLOOM_LEVELS as readonly string[]).includes(String(v));

/** Savol turi bo'yicha standart Bloom darajasi — model bermasa/xato bersa. */
export function bloomFor(difficulty: TestDifficulty, kind: TestQuestionKind): BloomLevel {
  if (kind === "open") return difficulty === "qiyin" ? "evaluate" : difficulty === "orta" ? "analyze" : "understand";
  return difficulty === "qiyin" ? "analyze" : difficulty === "orta" ? "apply" : "remember";
}

/**
 * Bloom darajasi shu savol turida RUXSATMI (R3 §3.5).
 * `evaluate`/`create` yopiq savolda ishonchli o'lchanmaydi → tushiriladi.
 */
export function bloomAllowed(bloom: BloomLevel, kind: TestQuestionKind): boolean {
  return kind === "open" || !BLOOM_OPEN_ONLY.includes(bloom);
}

/** Shu sinf va turdagi savolning variant soni. */
export function optionCountFor(ctx: Pick<TestNormalizeCtx, "grade" | "optionCountFixed">): number {
  const fixed = Number(ctx.optionCountFixed ?? 0);
  if (fixed === TEACHER_LIMITS.optionsMin || fixed === TEACHER_LIMITS.optionsMax) return fixed;
  return optionCountForGrade(ctx.grade);
}

/** `truefalse` savolning variantlari — A = to'g'ri (OMR shu tartibga tayanadi). */
export const TRUE_FALSE_OPTIONS = ["To'g'ri", "Noto'g'ri"] as const;

type RawQuestion = Record<string, unknown>;

function normalizeAnswer(kind: TestQuestionKind, raw: RawQuestion, options: string[]): TestAnswer | null {
  const a = raw.answer;
  switch (kind) {
    case "single": {
      const n = Number(a);
      if (Number.isFinite(n) && n >= 0 && n < options.length) return Math.round(n);
      // Model harf qaytargan bo'lishi mumkin («B»).
      const letter = QUIZ_LETTERS.indexOf(String(a ?? "").trim().toUpperCase() as (typeof QUIZ_LETTERS)[number]);
      return letter >= 0 && letter < options.length ? letter : null;
    }
    case "truefalse":
      if (typeof a === "boolean") return a;
      if (/^(true|to'?g'?ri|ha|yes|верно)$/i.test(String(a ?? "").trim())) return true;
      if (/^(false|noto'?g'?ri|yo'?q|no|неверно)$/i.test(String(a ?? "").trim())) return false;
      return null;
    case "multi": {
      const list = Array.isArray(a) ? a : [];
      const idx = [...new Set(list.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0 && n < options.length))].sort((x, y) => x - y);
      return idx.length >= TEACHER_LIMITS.multiAnswersMin && idx.length <= TEACHER_LIMITS.multiAnswersMax ? idx : null;
    }
    case "open": {
      const t = clean(a, 600);
      return t.length >= 2 ? t : null;
    }
    case "match": {
      const list = Array.isArray(a) ? a : [];
      const pairs: TestMatchPair[] = [];
      for (const p of list) {
        const o = p as { left?: unknown; right?: unknown };
        const l = Number(o?.left);
        const r = Number(o?.right);
        if (Number.isInteger(l) && Number.isInteger(r) && l >= 0 && r >= 0) pairs.push({ left: l, right: r });
      }
      return pairs.length >= TEACHER_LIMITS.matchPairsMin ? pairs : null;
    }
  }
}

/**
 * Xom savollar ro'yxatini MODELga keltiradi.
 *
 * Qoidaga mos kelmagan savol TUZATILMAYDI, TASHLANADI: yarim to'g'ri
 * savol o'qituvchining vaqtini nazoratda yeydi, yo'q savol esa
 * hisobotda ko'rinadi (`count` bandi) va `delivered` ga tushadi.
 */
export function normalizeQuestions(raw: unknown, ctx: TestNormalizeCtx): NormalizeResult {
  const list = Array.isArray(raw) ? (raw as RawQuestion[]) : [];
  const dropped = emptyDrops();
  let strippedOptions = 0;
  const optionCount = optionCountFor(ctx);
  const allowed = new Set<TestQuestionKind>(ctx.kinds.length ? ctx.kinds : TEST_QUESTION_KINDS);
  const sourceNorm = ctx.sourceText ? normalizeQuote(ctx.sourceText) : "";
  const topics = new Set((ctx.topicIds ?? []).map((t) => String(t)));

  const out: TestQuestion[] = [];
  const grams: Set<string>[] = [];

  for (const r of list) {
    const kind = isKind(r?.kind) ? r.kind : "single";
    if (!allowed.has(kind)) {
      dropped.kind++;
      continue;
    }
    const stem = clean(r?.stem ?? r?.question ?? r?.text, TEACHER_LIMITS.stemCharsMax);
    if (stem.length < TEACHER_LIMITS.stemCharsMin) {
      dropped.stem++;
      continue;
    }

    /* variantlar */
    let options: string[] = [];
    if (kind === "truefalse") options = [...TRUE_FALSE_OPTIONS];
    else if (kind === "open") options = [];
    else {
      const rawOptions = Array.isArray(r?.options) ? r.options : [];
      const seen = new Set<string>();
      for (const o of rawOptions) {
        const t = clean(o, TEACHER_LIMITS.optionChars);
        if (!t) continue;
        if (kind !== "match" && isBlanketOption(t)) {
          strippedOptions++;
          continue;
        }
        const key = normalizeQuote(t);
        if (seen.has(key)) continue;
        seen.add(key);
        options.push(t);
      }
      if (kind === "match") {
        if (options.length < TEACHER_LIMITS.matchPairsMin * 2) {
          dropped.options++;
          continue;
        }
      } else if (options.length < optionCount) {
        // Blanket variant olib tashlangach ro'yxat qisqarib qolsa savol
        // ham tashlanadi: uch variantli savolga to'rtinchisini O'ZIMIZ
        // o'ylab topish — uydirma distraktor bo'lardi.
        dropped[options.length < rawOptions.length ? "blanket" : "options"]++;
        continue;
      } else {
        options = options.slice(0, optionCount);
      }
    }

    /* javob */
    const answer = normalizeAnswer(kind, r, options);
    if (answer === null) {
      dropped.answer++;
      continue;
    }

    /* manba iqtibosi (fayl rejimi) */
    let source: TestQuestion["source"] | undefined;
    const rawQuote = clean((r?.source as RawQuestion | undefined)?.quote ?? r?.quote, 400);
    if (rawQuote) source = { quote: rawQuote, section: clean((r?.source as RawQuestion | undefined)?.section, 120) || undefined };
    if (sourceNorm) {
      if (!rawQuote || !sourceNorm.includes(normalizeQuote(rawQuote))) {
        dropped.source++;
        continue;
      }
    }

    /* dublikat — o'zak yaqinligi */
    const g = trigrams(stem);
    if (grams.some((prev) => jaccard(prev, g) >= DUPLICATE_JACCARD)) {
      dropped.duplicate++;
      continue;
    }

    const difficulty = isDifficulty(r?.difficulty) ? r.difficulty : "orta";
    const bloomRaw = isBloom(r?.bloom) ? r.bloom : bloomFor(difficulty, kind);
    const bloom = bloomAllowed(bloomRaw, kind) ? bloomRaw : bloomFor(difficulty, kind);
    const topicId = clean(r?.topicId, 80);

    out.push({
      id: `q${out.length + 1}`,
      kind,
      stem,
      options,
      answer,
      points: Math.max(1, Math.round(Number(r?.points) || 1)),
      bloom,
      difficulty,
      explanation: clean(r?.explanation, 400),
      ...(topicId && (!topics.size || topics.has(topicId)) ? { topicId } : {}),
      ...(source ? { source } : {}),
    });
    grams.push(g);
    if (out.length >= ctx.count) break;
  }

  dropped.extra = Math.max(0, list.length - out.length - Object.values(dropped).reduce((a, b) => a + b, 0));
  // Id lar uzluksiz bo'lishi uchun qayta raqamlanadi (yuqorida o'chirish bo'lgan).
  return { questions: out.map((q, i) => ({ ...q, id: `q${i + 1}` })), dropped, strippedOptions };
}

/* ────────────────────────── qiyinlik taqsimoti ────────────────────────── */

/**
 * Foizli taqsimotni SAVOL soniga aylantiradi (eng katta qoldiq usuli).
 *
 * Nega eng katta qoldiq: 10 savolga 30/50/20 — 3/5/2 chiqadi, lekin 7
 * savolga 2,1/3,5/1,4 bo'ladi. Oddiy `round` uchalasini yaxlitlab
 * yig'indini 7 dan chiqarib yuborardi (2+4+1 = 7 emas, 2+4+1). Eng katta
 * qoldiq esa yig'indini HAR DOIM `count` ga tenglaydi.
 */
export function difficultyTargets(count: number, mix: Record<TestDifficulty, number>): Record<TestDifficulty, number> {
  const n = Math.max(0, Math.round(count));
  const totalPct = TEST_DIFFICULTIES.reduce((a, d) => a + (Number(mix[d]) || 0), 0) || 100;
  const exact = TEST_DIFFICULTIES.map((d) => ((Number(mix[d]) || 0) / totalPct) * n);
  const base = exact.map((x) => Math.floor(x));
  let rest = n - base.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    base[i]++;
    rest--;
  }
  return Object.fromEntries(TEST_DIFFICULTIES.map((d, i) => [d, base[i]])) as Record<TestDifficulty, number>;
}

/** Hujjatdagi haqiqiy taqsimot. */
export function difficultyCounts(questions: readonly TestQuestion[]): Record<TestDifficulty, number> {
  const out = Object.fromEntries(TEST_DIFFICULTIES.map((d) => [d, 0])) as Record<TestDifficulty, number>;
  for (const q of questions) out[q.difficulty]++;
  return out;
}

/** Qamrab olingan Bloom darajalari. */
export function bloomCoverage(questions: readonly TestQuestion[]): BloomLevel[] {
  return BLOOM_LEVELS.filter((b) => questions.some((q) => q.bloom === b));
}

/* ────────────────────────── variantlar va kalit ────────────────────────── */

/** Savol javob varaqasida harf oladimi (`open`/`match` — yo'q). */
const lettered = (kind: TestQuestionKind) => kind === "single" || kind === "truefalse" || kind === "multi";

/**
 * Bitta variant uchun savol tartibi + har savolning variant tartibi.
 *
 * `order[i]`       — i-o'rinda turadigan savolning `questions` indeksi;
 * `optionOrder[i]` — SHU o'rindagi savolning variantlari tartibi:
 *                    ko'rsatiladigan j-variant = `options[optionOrder[i][j]]`.
 *
 * Ikkalasi ham DISPLEY o'rni bo'yicha indekslanadi — maket, kalit va OMR
 * uchala joyda ham bir xil `i` bilan yuradi.
 *
 * TO'G'RI JAVOB HARFLARI TEKISLANADI (R3 §3.4.3): harflar aylanma
 * ro'yxatdan (seeded aralashtirilgan) navbat bilan olinadi, ya'ni har
 * harf ulushi 25 % ± 1 savol. Tasodifiy aralashtirishda «hammasi C»
 * holati real uchraydi va o'quvchi buni sezadi.
 */
export function buildVariant(questions: readonly TestQuestion[], id: string, seed: number): TestVariant {
  const rand = rng(seed);
  const n = questions.length;
  const order = shuffled(
    Array.from({ length: n }, (_, i) => i),
    rand,
  );
  const optionOrder: number[][] = [];

  // Harf navbati: aralashtirilgan [0..k-1] doirasi bo'ylab aylanish.
  let wheel: number[] = [];
  let wheelAt = 0;
  const nextLetter = (k: number): number => {
    if (!wheel.length || wheel.length !== k || wheelAt >= wheel.length) {
      wheel = shuffled(
        Array.from({ length: k }, (_, i) => i),
        rand,
      );
      wheelAt = 0;
    }
    return wheel[wheelAt++];
  };

  for (const qi of order) {
    const q = questions[qi];
    const k = q.options.length;
    if (k === 0) {
      optionOrder.push([]);
      continue;
    }
    if (q.kind === "truefalse") {
      // A = to'g'ri, B = xato — OMR ko'rsatmasi shunga tayanadi, tartib
      // aralashtirilmaydi (aks holda «A — to'g'ri» izohi yolg'on bo'lardi).
      optionOrder.push(Array.from({ length: k }, (_, i) => i));
      continue;
    }
    if (q.kind === "single" && typeof q.answer === "number") {
      const want = nextLetter(k);
      const rest = shuffled(
        Array.from({ length: k }, (_, i) => i).filter((i) => i !== q.answer),
        rand,
      );
      const perm: number[] = [];
      for (let j = 0, r = 0; j < k; j++) perm.push(j === want ? (q.answer as number) : rest[r++]);
      optionOrder.push(perm);
      continue;
    }
    optionOrder.push(
      shuffled(
        Array.from({ length: k }, (_, i) => i),
        rand,
      ),
    );
  }
  return { id, order, optionOrder };
}

/** `variantCount` ta variant — har biriga o'z urug'i (`seed + id`). */
export function buildVariants(questions: readonly TestQuestion[], variantCount: number, seedKey: string): TestVariant[] {
  const n = Math.max(1, Math.min(TEST_VARIANT_IDS.length, Math.round(variantCount) || 1));
  return TEST_VARIANT_IDS.slice(0, n).map((id) => buildVariant(questions, id, hashSeed(`${seedKey}:${id}`)));
}

/** Ko'rsatiladigan j-variantning ASL indeksi — kalit va maket shundan. */
export const shownOption = (v: TestVariant, i: number, j: number): number => v.optionOrder[i]?.[j] ?? j;

/**
 * Bitta savolning SHU variantdagi javob yozuvi.
 *
 *   single    → «B»
 *   truefalse → «A» (to'g'ri) / «B»
 *   multi     → «A, C»
 *   open      → «—» (ochiq javob kalit jadvalida matn bilan beriladi)
 *   match     → «1-B, 2-A»
 */
export function answerLabel(q: TestQuestion, perm: readonly number[]): string {
  switch (q.kind) {
    case "single": {
      const at = perm.indexOf(Number(q.answer));
      return QUIZ_LETTERS[at >= 0 ? at : 0] ?? "A";
    }
    case "truefalse":
      return q.answer === true ? "A" : "B";
    case "multi": {
      const want = new Set((q.answer as number[]) ?? []);
      const letters: string[] = [];
      perm.forEach((orig, j) => {
        if (want.has(orig)) letters.push(QUIZ_LETTERS[j] ?? "?");
      });
      return letters.join(", ");
    }
    case "match":
      return ((q.answer as TestMatchPair[]) ?? []).map((p) => `${p.left + 1}-${QUIZ_LETTERS[p.right] ?? "?"}`).join(", ");
    default:
      return "—";
  }
}

/** Variant id → javoblar ro'yxati (uzunligi = savol soni, DISPLEY tartibida). */
export function answerKeyFor(questions: readonly TestQuestion[], variants: readonly TestVariant[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const v of variants) out[v.id] = v.order.map((qi, i) => answerLabel(questions[qi], v.optionOrder[i] ?? []));
  return out;
}

/** Harf balansi — faqat harf oladigan savollar bo'yicha (R3 §4.1 `keyBalance`). */
export function letterCounts(questions: readonly TestQuestion[], v: TestVariant): Record<string, number> {
  const out: Record<string, number> = {};
  v.order.forEach((qi, i) => {
    const q = questions[qi];
    if (q.kind !== "single") return;
    const letter = answerLabel(q, v.optionOrder[i] ?? []);
    out[letter] = (out[letter] ?? 0) + 1;
  });
  return out;
}

/* ────────────────────────── ball va baho ────────────────────────── */

/**
 * Ball → baho (MMTV 2023-16-08, 248-son buyruq ilovasi, 23-band).
 * Raqamlar hujjatdan; hisobot `scoreSum` bandi va kalit beti shu jadvaldan.
 */
export const GRADE_SCALE: readonly GradeBand[] = [
  { minPercent: 86, maxPercent: 100, grade: 5 },
  { minPercent: 66, maxPercent: 85, grade: 4 },
  { minPercent: 30, maxPercent: 65, grade: 3 },
  { minPercent: 0, maxPercent: 29, grade: 2 },
];

/** Foizga mos baho (kalit betidagi jadval va jonli sinov uchun). */
export function gradeForPercent(percent: number): number {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  return GRADE_SCALE.find((b) => p >= b.minPercent && p <= b.maxPercent)?.grade ?? 2;
}

/**
 * Ballarni E'LON QILINGAN jamiga TENGLAYDI (bsb 50, chsb 40).
 *
 * `totalPoints: null` bo'lsa har savol 1 ball (joriy nazorat). Aks holda
 * ochiq topshiriqlar yopiqlardan OG'IRROQ bo'lishi kerak (N-1 namunasi:
 * 3–5 ball), shuning uchun taqsimot og'irlik bo'yicha: yopiq — 1, ochiq/
 * moslik — 3. Qoldiq eng og'ir topshiriqqa qo'shiladi, ya'ni yig'indi
 * AYNAN `total` chiqadi — `scoreSum` qoidasi shuni tekshiradi.
 */
export function assignPoints(questions: readonly TestQuestion[], totalPoints: number | null): TestQuestion[] {
  if (!questions.length) return [];
  if (!totalPoints || totalPoints <= 0) return questions.map((q) => ({ ...q, points: 1 }));
  const weight = (q: TestQuestion) => (q.kind === "open" ? 3 : q.kind === "match" ? 2 : 1);
  const sumW = questions.reduce((a, q) => a + weight(q), 0);
  const points = questions.map((q) => Math.max(1, Math.floor((totalPoints * weight(q)) / sumW)));
  let rest = totalPoints - points.reduce((a, b) => a + b, 0);
  // Qoldiqni og'ir topshiriqlardan boshlab bittadan tarqatamiz.
  const byWeight = questions.map((q, i) => ({ i, w: weight(q) })).sort((a, b) => b.w - a.w || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % byWeight.length) {
    points[byWeight[k].i]++;
    rest--;
  }
  for (let k = 0; rest < 0; k = (k + 1) % byWeight.length) {
    const at = byWeight[byWeight.length - 1 - (k % byWeight.length)].i;
    if (points[at] > 1) {
      points[at]--;
      rest++;
    } else if (points.every((p) => p <= 1)) break;
  }
  return questions.map((q, i) => ({ ...q, points: points[i] }));
}

export function buildScoring(questions: readonly TestQuestion[], totalPoints: number | null): TestScoring {
  const total = questions.reduce((a, q) => a + q.points, 0);
  const closed = questions.filter((q) => q.kind !== "open");
  const perQuestion = closed.length ? Math.round((closed.reduce((a, q) => a + q.points, 0) / closed.length) * 10) / 10 : 1;
  return { perQuestion, total: totalPoints && totalPoints > 0 ? totalPoints : total, gradeScale: [...GRADE_SCALE] };
}

/* ────────────────────────── OMR sig'imi ────────────────────────── */

/** OMR ga tushadigan savollar (R3 §3.3: `open`/`match` tushmaydi). */
export const omrQuestions = (questions: readonly TestQuestion[]): TestQuestion[] => questions.filter((q) => lettered(q.kind));

/** Nechta ustun kerak (ustunda 10 savol). */
export function omrColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.max(0, count) / TEACHER_LIMITS.omrPerColumn));
}

/** Javoblar varag'i bir betga sig'adimi (`omrFits` qoidasi). */
export function omrFits(count: number): boolean {
  return count > 0 && omrColumns(count) <= TEACHER_LIMITS.omrColumnsMax;
}
