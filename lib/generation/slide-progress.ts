import type { SlideThemeId, SlideModel } from "./slide-types";
import type { SlideTemplateId } from "./slide-templates";
import type { AcademicDoc, DocMeta } from "./types";

/**
 * Jonli generatsiya bosqichlari — natija sahifasi va bosh sahifa
 * kartochkasi shu qiymatga qarab matn tanlaydi (`liveStep`).
 *
 * Dvigatel (`lib/generation/`) DB/HTTP BILMAYDI: bu fayl faqat
 * `SlideProgressEvent` chiqarish/yig'ish uchun sof tiplar va reduktor.
 * Klient ham xuddi shu faylni import qiladi (`server-only` YO'Q).
 */
export type LiveStage = "plan" | "research" | "text" | "images" | "assembly" | "done";

/**
 * Hodisalar INDEKS asosida, hammasi NUSXA (mutatsiya emas).
 *
 * `attachSlideImages` joyida mutatsiya qiladi, `title-fix`/`end-fix`
 * kabi id'lar viewerda qayta raqamlanadi — shuning uchun `index`
 * barqaror ko'rsatkich, `id` emas.
 */
export type SlideProgressEvent =
  | { type: "plan"; slides: SlideModel[]; roles: string[]; meta: DocMeta; theme: SlideThemeId; template: SlideTemplateId; logo?: string }
  | { type: "stage"; stage: LiveStage }
  | { type: "research"; sources: number }
  | { type: "slide"; index: number; slide: SlideModel }
  | { type: "deck"; slides: SlideModel[] }
  | { type: "images"; wait: number[] }
  | { type: "image"; index: number; url: string }
  | { type: "done" };

/** Dvigatel `onProgress` sifatida qabul qiladigan chaqiruvchi. */
export type SlideProgressSink = (ev: SlideProgressEvent) => void;

export type LiveDeck = {
  stage: LiveStage;
  /** 0..99 — haqiqiy, `progressTicker` egri chizig'i emas. Faqat O'SADI. */
  progress: number;
  /** O'zbekcha, ≤200 belgi — `HomeFiles.tsx`/natija sahifasi to'g'ridan-to'g'ri ko'rsatadi. */
  step: string;
  meta: DocMeta;
  theme: SlideThemeId;
  template: SlideTemplateId;
  logo?: string;
  roles: string[];
  slides: SlideModel[];
  /** Matni tayyor bo'lgan slaydlar indekslari (dublikatsiz). */
  written: number[];
  /** `deck` hodisasi kelganmi — shundan keyin matn qayta "yozilmaydi". */
  final: boolean;
  /** Rasm kutilayotgan slaydlar indekslari. */
  imageWait: number[];
  images: { got: number; want: number };
  research?: { sources: number };
};

function cloneSlide(s: SlideModel): SlideModel {
  return { ...s };
}

/**
 * Sof reduktor: `state` va `ev` MUTATSIYA QILINMAYDI, har doim yangi
 * `LiveDeck` qaytadi.
 *
 * `state` boshlang'ich chaqiruvda `undefined` bo'lishi mumkin — `plan`
 * hodisasi skeletni undan mustaqil quradi (Redux'dagi kabi standart
 * holat naqshi).
 */
export function applyLiveEvent(state: LiveDeck | undefined, ev: SlideProgressEvent): LiveDeck {
  let next: LiveDeck;
  switch (ev.type) {
    case "plan": {
      next = {
        stage: "plan",
        progress: 0,
        step: "",
        meta: ev.meta,
        theme: ev.theme,
        template: ev.template,
        logo: ev.logo,
        roles: [...ev.roles],
        slides: ev.slides.map(cloneSlide),
        written: [],
        final: false,
        imageWait: [],
        images: { got: 0, want: 0 },
        research: undefined,
      };
      break;
    }
    case "stage": {
      if (!state) throw new Error("slide-progress: plan hodisasidan oldin stage kelmasligi kerak");
      next = { ...state, stage: ev.stage };
      break;
    }
    case "research": {
      if (!state) throw new Error("slide-progress: plan hodisasidan oldin research kelmasligi kerak");
      next = { ...state, research: { sources: ev.sources } };
      break;
    }
    case "slide": {
      if (!state) throw new Error("slide-progress: plan hodisasidan oldin slide kelmasligi kerak");
      const slides = state.slides.slice();
      slides[ev.index] = cloneSlide(ev.slide);
      const written = state.written.includes(ev.index) ? state.written : [...state.written, ev.index];
      next = { ...state, slides, written };
      break;
    }
    case "deck": {
      if (!state) throw new Error("slide-progress: plan hodisasidan oldin deck kelmasligi kerak");
      next = {
        ...state,
        slides: ev.slides.map(cloneSlide),
        final: true,
        imageWait: [],
      };
      break;
    }
    case "images": {
      if (!state) throw new Error("slide-progress: plan hodisasidan oldin images kelmasligi kerak");
      next = {
        ...state,
        imageWait: [...ev.wait],
        images: { ...state.images, want: ev.wait.length },
      };
      break;
    }
    case "image": {
      if (!state) throw new Error("slide-progress: plan hodisasidan oldin image kelmasligi kerak");
      const slides = state.slides.slice();
      const prev = slides[ev.index];
      if (prev) slides[ev.index] = { ...prev, image: { url: ev.url } };
      next = {
        ...state,
        slides,
        imageWait: state.imageWait.filter((i) => i !== ev.index),
        images: { ...state.images, got: state.images.got + 1 },
      };
      break;
    }
    case "done": {
      if (!state) throw new Error("slide-progress: plan hodisasidan oldin done kelmasligi kerak");
      next = { ...state, stage: "done" };
      break;
    }
    default: {
      // Hech qachon yetib bormaydi — TypeScript to'liqlikni tekshiradi.
      const _exhaustive: never = ev;
      throw new Error(`slide-progress: noma'lum hodisa turi ${JSON.stringify(_exhaustive)}`);
    }
  }
  // `progress` HECH QACHON orqaga qaytmaydi — polling ba'zan eski
  // hodisani keyin yetkazishi mumkin (koalessiya, tarmoq tartibsizligi).
  const prevProgress = state?.progress ?? 0;
  next.progress = Math.max(prevProgress, liveProgress(next));
  next.step = liveStep(next);
  return next;
}

/**
 * Haqiqiy foiz (0..99) — `progressTicker`ning soxta `1 − e^(−t/T)` egri
 * chizig'i o'rniga. 100 hech qachon berilmaydi: yakuniy holatni faqat
 * `status='COMPLETED'` bildiradi (`AUDIT` da bir necha marta ko'rilgan
 * naqsh — 100% "tugadi" degani emas, tasdiqlangani degani).
 */
export function liveProgress(s: LiveDeck): number {
  const total = Math.max(1, s.slides.length);
  switch (s.stage) {
    case "plan":
      return 2;
    case "research":
      return s.research && s.research.sources > 0 ? 10 : 5;
    case "text": {
      const frac = Math.min(1, s.written.length / total);
      return Math.round(10 + frac * 50);
    }
    case "images": {
      const want = Math.max(1, s.images.want);
      const frac = Math.min(1, s.images.got / want);
      return Math.round(60 + frac * 32);
    }
    case "assembly":
      return 95;
    case "done":
      return 99;
    default:
      return 0;
  }
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** O'zbekcha bosqich matni, ≤200 belgi — `HomeFiles.tsx`/natija sahifasi to'g'ridan-to'g'ri ko'rsatadi. */
export function liveStep(s: LiveDeck): string {
  const total = s.slides.length;
  let text: string;
  switch (s.stage) {
    case "plan":
      text = `Reja tuzildi · ${total} slayd`;
      break;
    case "research":
      text = s.research ? `Internetdan izlandi · ${s.research.sources} manba` : "Internetdan izlanmoqda…";
      break;
    case "text":
      text = `Matn yozilmoqda · ${s.written.length}/${total} slayd`;
      break;
    case "images":
      text = `Rasmlar · ${s.images.got}/${s.images.want}`;
      break;
    case "assembly":
      text = "Yig'ilmoqda…";
      break;
    case "done":
      text = `Tayyor · ${total} slayd`;
      break;
    default:
      text = "";
  }
  return clip(text, 200);
}

/**
 * `LiveDeck` → `AcademicDoc` — `SlideViewer` boshqa hech narsa bilmasdan
 * to'g'ridan-to'g'ri chizadigan shakl. `titlePage`/`toc` — jonli
 * ko'rinishda yo'q (faqat slaydlar), `sections` — bo'sh (matn
 * hujjatlariga tegishli, PPTX/slaydga emas).
 */
export function liveDocOf(s: LiveDeck): AcademicDoc {
  return {
    meta: s.meta,
    titlePage: false,
    toc: false,
    sections: [],
    slides: s.slides.map(cloneSlide),
    slideTheme: s.theme,
    slideTemplate: s.template,
    slideLogo: s.logo ? { url: s.logo } : undefined,
  };
}
