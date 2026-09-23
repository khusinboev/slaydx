/**
 * Provayder bo'yicha BIR VAQTDAGI so'rovlar chegarasi — audit C28
 * (EXT-09, SCALE-06).
 *
 * Muammo: parallellik faqat BITTA ish ichida cheklangan edi
 * (`mapPool(3)`, rasm yo'laklari 3–5). Worker'da bir necha ish birga
 * yursa (2 jarayon × 4 slot × 3–5 yo'lak) bitta provayderga o'nlab so'rov
 * bir paytda ketadi; kvota to'lganda Gemini 429 qaytaradi va qisqa
 * qayta urinishlardan keyin paragraf/rasm bo'sh qoladi → ish FAILED +
 * pul qaytarish. Bu yerdagi semafor ortiqcha so'rovni QISQA NAVBATGA
 * qo'yadi: hamma ish biroz sekinlashadi, lekin yiqilmaydi.
 *
 * Chegara JARAYON ichida (DB/Redis'siz). Qiymatlar — konstanta, bitta
 * joyda; ikki worker jarayoni bo'lgani uchun provayderga jami bosim
 * taxminan ikki barobar.
 */

/** Provayder → bir jarayondagi eng ko'p parallel so'rov. */
export const PROVIDER_MAX_INFLIGHT: Record<string, number> = {
  gemini: 10,
  "gemini-image": 6,
  anthropic: 4,
  openrouter: 6,
  xai: 6,
  openai: 6,
};

/** Jadvalda yo'q provayder uchun. */
export const DEFAULT_MAX_INFLIGHT = 6;

type Waiter = { grant: (release: () => void) => void; timer?: ReturnType<typeof setTimeout> };

export class Semaphore {
  readonly max: number;
  private used = 0;
  private readonly queue: Waiter[] = [];

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max));
  }

  get active(): number {
    return this.used;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Slot olish. Qaytgan funksiya slotni bo'shatadi (ikkinchi chaqiruv
   * hech narsa qilmaydi). `maxWaitMs` o'tsa `null` — chaqiruvchi bu
   * urinishni «vaqt yetmadi» deb hisoblaydi (provayder nosozligi EMAS).
   */
  acquire(maxWaitMs?: number): Promise<(() => void) | null> {
    if (this.used < this.max) {
      this.used += 1;
      return Promise.resolve(this.releaser());
    }
    if (maxWaitMs !== undefined && maxWaitMs <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter: Waiter = { grant: (release) => resolve(release) };
      if (maxWaitMs !== undefined) {
        waiter.timer = setTimeout(() => {
          const i = this.queue.indexOf(waiter);
          if (i >= 0) this.queue.splice(i, 1);
          resolve(null);
        }, maxWaitMs);
      }
      this.queue.push(waiter);
    });
  }

  private releaser(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.queue.shift();
      if (next) {
        // Slot bo'shamaydi — to'g'ridan-to'g'ri navbatdagiga o'tadi.
        if (next.timer) clearTimeout(next.timer);
        next.grant(this.releaser());
      } else {
        this.used -= 1;
      }
    };
  }
}

const REGISTRY = new Map<string, Semaphore>();

/** Provayder bo'yicha jarayondagi YAGONA semafor. */
export function limiterFor(name: string): Semaphore {
  let s = REGISTRY.get(name);
  if (!s) {
    s = new Semaphore(PROVIDER_MAX_INFLIGHT[name] ?? DEFAULT_MAX_INFLIGHT);
    REGISTRY.set(name, s);
  }
  return s;
}

/** Testlar uchun: semaforlarni unutadi (keyingi `limiterFor` jadvaldan qayta o'qiydi). */
export function resetLimiters(): void {
  REGISTRY.clear();
}
