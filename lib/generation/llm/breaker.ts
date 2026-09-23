/**
 * Provayder SAQLAGICHI (circuit breaker) — audit C28 (EXT-04, EXT-06, EXT-07).
 *
 * Muammo: chaqiruvlar orasida provayder SALOMATLIGI eslab qolinmasdi.
 * Gemini sekinlashganda (javob timeout'gacha osilib qoladi) HAR chaqiruv
 * nosozlikni qaytadan «kashf qilib», to'liq timeout'ni kutib o'tardi —
 * har ish butun byudjetini yeb, keyin FAILED + pul qaytarish bilan
 * tugardi. Stock-foto va manba API larida esa tugagan kvota (429) har
 * slayd/so'rovda qayta-qayta urilardi.
 *
 * Qoida (jarayon ichida, har provayder/manba uchun alohida nusxa):
 *  - `threshold` ta KETMA-KET nosozlik (timeout/5xx) `windowMs` ichida →
 *    OCHIQ: `cooldownMs` davomida `allow()` false — chaqiruvchi shu
 *    provayderni o'tkazib yuborib, keyingi zaxiraga o'tadi (yoki darhol
 *    bo'sh natija bilan degradatsiya qiladi);
 *  - sovish tugagach YARIM-OCHIQ: BITTA sinov so'roviga ruxsat; u
 *    muvaffaqiyatli bo'lsa YOPILADI, yiqilsa yana ochiladi. Sinov natijasi
 *    hech qachon kelmasa (chaqiruvchi yiqildi) — `cooldownMs` o'tgach
 *    yangi sinovga ruxsat beriladi, saqlagich abadiy ochiq qolmaydi;
 *  - `trip(ms)` — DARHOL ochadi (kvota 429: `Retry-After` qancha bo'lsa
 *    shuncha kutiladi, ketma-ketlik shart emas);
 *  - har qanday muvaffaqiyat ketma-ketlikni nollaydi.
 *
 * Holat faqat SHU jarayonda (worker/web alohida) — ko'p jarayonli umumiy
 * hisob ataylab yo'q: u DB/Redis talab qiladi, jarayon ichidagi
 * saqlagich esa sekin provayderni bir necha soniyada «ko'rib» oladi.
 * Ochilish va yopilish jurnalga yoziladi (`[breaker] <nom> → ochildi …`).
 */

export type BreakerState = "closed" | "open" | "half-open";

export type BreakerOpts = {
  /** Nechta ketma-ket nosozlikdan keyin ochiladi. */
  threshold?: number;
  /** Ketma-ketlik shu oynadan eski bo'lsa hisob qaytadan boshlanadi. */
  windowMs?: number;
  /** Ochiq holat davomiyligi (sinovgacha). */
  cooldownMs?: number;
  /** Test: soat seam'i. */
  now?: () => number;
  /** Standart — `console.warn`. */
  log?: (line: string) => void;
};

/** LLM provayderlari uchun standart: 60 s ichida 5 ketma-ket timeout/5xx → 30 s ochiq. */
export const LLM_BREAKER = { threshold: 5, windowMs: 60_000, cooldownMs: 30_000 } as const;

export class CircuitBreaker {
  readonly name: string;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  private failures = 0;
  private firstFailureAt = 0;
  /** 0 — yopiq; aks holda shu paytgacha ochiq. */
  private openUntil = 0;
  /** Yarim-ochiq holatdagi sinov boshlangan payt (0 — sinov yo'q). */
  private probeAt = 0;

  constructor(name: string, opts: BreakerOpts = {}) {
    this.name = name;
    this.threshold = Math.max(1, opts.threshold ?? LLM_BREAKER.threshold);
    this.windowMs = opts.windowMs ?? LLM_BREAKER.windowMs;
    this.cooldownMs = opts.cooldownMs ?? LLM_BREAKER.cooldownMs;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? ((line) => console.warn(line));
  }

  get state(): BreakerState {
    if (this.openUntil === 0) return "closed";
    return this.now() < this.openUntil ? "open" : "half-open";
  }

  /** So'rov yuborish mumkinmi. Yarim-ochiq holatda faqat BITTA sinovga `true`. */
  allow(): boolean {
    if (this.openUntil === 0) return true;
    const now = this.now();
    if (now < this.openUntil) return false;
    // Yarim-ochiq: sinov band bo'lsa kutiladi, lekin osilib qolgan sinov
    // `cooldownMs` dan keyin yangisiga joy beradi.
    if (this.probeAt !== 0 && now - this.probeAt < this.cooldownMs) return false;
    this.probeAt = now;
    return true;
  }

  success(): void {
    if (this.openUntil !== 0) this.log(`[breaker] ${this.name} → yopildi (provayder tiklandi)`);
    this.failures = 0;
    this.firstFailureAt = 0;
    this.openUntil = 0;
    this.probeAt = 0;
  }

  failure(): void {
    const now = this.now();
    if (this.openUntil !== 0) {
      // Yarim-ochiq sinov (yoki ochiq paytdagi kechikkan javob) yiqildi — yana ochiq.
      if (now >= this.openUntil) this.open(now, this.cooldownMs, "sinov yiqildi");
      return;
    }
    if (this.failures === 0 || now - this.firstFailureAt > this.windowMs) {
      this.failures = 0;
      this.firstFailureAt = now;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) this.open(now, this.cooldownMs, `${this.failures} ketma-ket xato`);
  }

  /** Darhol ochish (masalan kvota 429 — `Retry-After` muddatiga). */
  trip(cooldownMs: number = this.cooldownMs, why = "kvota"): void {
    const now = this.now();
    // Uzunroq ochiq muddat allaqachon bo'lsa — qisqartirilmaydi.
    if (this.openUntil !== 0 && this.openUntil >= now + cooldownMs) return;
    this.open(now, cooldownMs, why);
  }

  private open(now: number, ms: number, why: string): void {
    this.openUntil = now + Math.max(1, ms);
    this.probeAt = 0;
    this.failures = 0;
    this.firstFailureAt = 0;
    this.log(`[breaker] ${this.name} → ochildi (${why}), ${Math.round(ms / 1000)} s o'tkazib yuboriladi`);
  }
}

const REGISTRY = new Map<string, CircuitBreaker>();

/**
 * Jarayon bo'yicha YAGONA saqlagich (nom bo'yicha). `opts` faqat birinchi
 * yaratilishda ishlatiladi — bir nomga ikki xil sozlama berilmasin.
 */
export function breakerFor(name: string, opts?: BreakerOpts): CircuitBreaker {
  let b = REGISTRY.get(name);
  if (!b) {
    b = new CircuitBreaker(name, opts);
    REGISTRY.set(name, b);
  }
  return b;
}

/** Testlar uchun: hamma saqlagichni unutadi. */
export function resetBreakers(): void {
  REGISTRY.clear();
}
