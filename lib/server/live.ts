import "server-only";
import { applyLiveEvent, liveProgress, liveStep } from "../generation/slide-progress";
import type { LiveDeck, SlideProgressEvent, SlideProgressSink } from "../generation/slide-progress";
import type { SlideModel } from "../generation/slide-types";
import { assetFromDataUrl, assetUrl, putAssets } from "./assets";
import { setLive } from "./jobs";

/**
 * `LiveReporter` — dvigatel (`lib/generation/`) chiqargan `SlideProgressEvent`
 * hodisalarini bazaga (`generations.live_json`) yozadi.
 *
 * Dvigatel DB/HTTP BILMAYDI (`slide-progress.ts` izohi) — shu bo'shliqni
 * shu fayl to'ldiradi: `sink` `BuildOptions.onProgress` sifatida uzatiladi
 * (`worker.ts`), reduktor (`applyLiveEvent`) orqali holatni yig'adi va
 * koalessiya qilingan `setLive` chaqiruvlari bilan yozadi.
 *
 * `data:` rasm/logotip JSONB'ga tushmasin deb (1.5 MB limitga tez
 * urilardi) — alohida promise-navbat orqali aktivga aylantirilib,
 * REDUKTOR HOLATIGA qaytadan almashtiriladi.
 */

/** Koalessiya oynasi — bundan tez-tez `setLive` chaqirilmaydi. */
const FLUSH_MS = 400;

/** `live_json` shu hajmdan katta bo'lsa avval `notes` tashlanadi, keyin ham katta bo'lsa yozilmaydi. */
export const LIVE_MAX_BYTES = 1_572_864; // 1.5 MB

function byteSize(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v) ?? "null", "utf8");
}

/** `notes`siz slaydlar — birinchi qisqartirish qadami. */
function withoutNotes(state: LiveDeck): LiveDeck {
  return {
    ...state,
    slides: state.slides.map((s: SlideModel) => {
      const { notes: _notes, ...rest } = s;
      return rest;
    }),
  };
}

export class LiveReporter {
  /** `buildArtifact({ onProgress })` ga to'g'ridan-to'g'ri uzatiladi. */
  readonly sink: SlideProgressSink;

  /**
   * Kamida bitta hodisa kelgan — worker shu bayroqqa qarab progress
   * manbasini soxta egri chiziqdan (`progressTicker`) haqiqiy qiymatga
   * (`setLive` yozgan `progress`/`step`) almashtiradi.
   */
  started = false;

  /**
   * `setLive` qulf boshqada ekanini bildirdi (`null` qaytardi) — ish
   * qayta navbatga tushgan yoki bekor qilingan. Shu paytdan keyin YANGI
   * yozuv yuborilmaydi (begona ishga yozib qo'yish xavfi).
   */
  lost = false;

  private state: LiveDeck | undefined;
  private dirty = false;
  private stopped = false;

  /** Throttle holati — leading+trailing koalessiya (pastga qarang). */
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = -Infinity;

  /**
   * Aktiv (`data:` → `putAssets`) almashtirishlar KETMA-KET bajarilishi
   * uchun bitta promise-navbat — parallel `INSERT`lar bir-birini
   * kutmasin (`ON CONFLICT DO NOTHING` bor, lekin tartib muhim emas,
   * shunchaki bitta ulanish yetarli).
   */
  private assetQueue: Promise<void> = Promise.resolve();

  /**
   * Haqiqiy `setLive` chaqiruvlari HAM ketma-ket — `doFlush` `dirty`ni
   * o'zi tekshiradi, shuning uchun bir vaqtda ikkita yozuv navbatga
   * tushsa ham ikkinchisi darhol qaytadi (hech narsa yozmaydi).
   */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly jobId: string,
    private readonly workerId: string,
  ) {
    this.sink = (ev: SlideProgressEvent) => {
      if (this.stopped) return;
      this.started = true;
      // Dvigatel hodisani keyinroq mutatsiya qilishi mumkin (`slide-progress.ts`
      // izohi: `attachSlideImages` joyida mutatsiya qiladi) — shuning uchun
      // reduktorga NUSXA beriladi, asl obyektga emas.
      const copy = structuredClone(ev);
      this.state = applyLiveEvent(this.state, copy);
      this.scheduleAssetSwap(copy);
      // `done`da yozmaymiz — `completeJob` `live_json`ni o'zi NULL qiladi,
      // qo'shimcha yozuv keraksiz (va oxirgi holat allaqachon yozilgan bo'ladi).
      if (copy.type === "done") return;
      this.dirty = true;
      this.scheduleFlush();
    };
  }

  /**
   * `data:` bo'lgan `image.url`/`plan.logo`ni aktivga aylantiradi va
   * natijani reduktor holatiga qaytadan yozadi (yangi `dirty` + flush).
   */
  private scheduleAssetSwap(ev: SlideProgressEvent): void {
    if (ev.type === "image" && ev.url.startsWith("data:")) {
      const index = ev.index;
      this.assetQueue = this.assetQueue.then(() => this.swapImage(index, ev.url));
    } else if (ev.type === "plan" && ev.logo?.startsWith("data:")) {
      const logo = ev.logo;
      this.assetQueue = this.assetQueue.then(() => this.swapLogo(logo));
    }
  }

  private async swapImage(index: number, dataUrl: string): Promise<void> {
    if (this.lost) return;
    const asset = assetFromDataUrl(dataUrl);
    if (!asset) return;
    await putAssets(this.jobId, [asset]);
    const url = assetUrl(this.jobId, asset.assetId);
    if (!this.state) return;
    const slides = this.state.slides.slice();
    const prev = slides[index];
    if (!prev?.image) return;
    slides[index] = { ...prev, image: { ...prev.image, url } };
    this.state = { ...this.state, slides };
    this.dirty = true;
    this.scheduleFlush();
  }

  private async swapLogo(dataUrl: string): Promise<void> {
    if (this.lost) return;
    const asset = assetFromDataUrl(dataUrl);
    if (!asset) return;
    await putAssets(this.jobId, [asset]);
    const url = assetUrl(this.jobId, asset.assetId);
    if (!this.state) return;
    this.state = { ...this.state, logo: url };
    this.dirty = true;
    this.scheduleFlush();
  }

  /**
   * Leading + trailing koalessiya: burst boshida (oxirgi yozuvdan
   * ≥400 ms o'tgan bo'lsa) darhol yozadi (leading), oyna ichida kelgan
   * qolgan hodisalar esa BITTA trailing yozuvga birlashadi.
   */
  private scheduleFlush(): void {
    if (this.lost) return;
    const now = Date.now();
    const elapsed = now - this.lastFlushAt;
    if (elapsed >= FLUSH_MS && !this.timer) {
      this.lastFlushAt = now;
      this.runFlush();
      return;
    }
    if (this.timer) return;
    const wait = Math.max(0, FLUSH_MS - elapsed);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lastFlushAt = Date.now();
      this.runFlush();
    }, wait);
  }

  private runFlush(): void {
    this.writeChain = this.writeChain.then(() => this.doFlush());
  }

  private async doFlush(): Promise<void> {
    if (this.lost || !this.dirty || !this.state) return;
    this.dirty = false;
    const payload = this.serialize(this.state);
    const progress = liveProgress(this.state);
    const step = liveStep(this.state);
    if (payload === undefined) return;
    const seq = await setLive(this.jobId, this.workerId, payload, progress, step);
    if (seq === null) this.lost = true;
  }

  /**
   * `≥ LIVE_MAX_BYTES` bo'lsa avval `notes` tashlanadi; hali katta bo'lsa
   * `undefined` (yozilmaydi) va `console.warn`.
   */
  private serialize(state: LiveDeck): LiveDeck | undefined {
    if (byteSize(state) < LIVE_MAX_BYTES) return state;
    const trimmed = withoutNotes(state);
    if (byteSize(trimmed) < LIVE_MAX_BYTES) return trimmed;
    console.warn(
      `[live] ${this.jobId}: jonli deka juda katta (${byteSize(trimmed)} bayt) — yozilmadi`,
    );
    return undefined;
  }

  /**
   * Oxirgi holatni kutib yozadi. `runJob`ning `finally`sida chaqiriladi —
   * so'nggi hodisa (masalan oxirgi `image`) trailing oynani kutmasdan
   * ham bazaga yetib borsin.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.assetQueue;
    if (this.dirty) this.runFlush();
    await this.writeChain;
  }
}
