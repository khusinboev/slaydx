"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, Presentation, RotateCcw, Trash2, X } from "lucide-react";
import type { AcademicDoc } from "@/lib/generation/types";
import { slideNotes } from "@/lib/generation/slide-layout";
import type { SlideSrc } from "@/lib/generation/slide-types";
import { useSlideEdit } from "../files/useSlideEdit";
import type { EditActionsState } from "../files/EditActions";
import { useConfirmClick } from "../overlays/useConfirmClick";
import { SlideEditor } from "./SlideEditor";
import { SLIDE_TEMPLATE_BY_ID } from "@/lib/generation/slide-templates";
import { getSlideTheme } from "@/lib/generation/slide-themes";
import { buildSlideDeck } from "@/lib/generation/slides";
import { SLIDE } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";
import { ViewerToolbar } from "./toolbar";
import { SlideCanvas } from "./SlideCanvas";
import { SlideRail } from "./SlideRail";
import { SlideStage, type SlideStageOverlayCtx } from "./SlideStage";
import { useSlideKeys } from "./useSlideKeys";
import { useReveal, type LiveView } from "./useReveal";
import { LiveStrip } from "./LiveStrip";
import { totalChars } from "@/lib/viewers/reveal";
import { planSlide } from "@/lib/generation/slide-layout";

export type { LiveView };

/**
 * `live` propi `unknown` bo'lib keladi (transport paketi uni serverdan
 * xom JSON sifatida oladi). Ko'ruvchi ishonchsiz ma'lumotdan chizmasligi
 * uchun shakl SHU YERDA bir marta tekshiriladi: kerakli maydonlardan
 * biri yetishmasa jonli rejim umuman yoqilmaydi va oddiy ko'ruvchi
 * ishlaydi.
 */
export function asLiveView(live: unknown): LiveView | null {
  if (!live || typeof live !== "object") return null;
  const v = live as Partial<LiveView>;
  if (!Array.isArray(v.slides) || v.slides.length === 0) return null;
  if (!Array.isArray(v.written) || !Array.isArray(v.roles) || !Array.isArray(v.imageWait)) return null;
  if (!v.images || typeof v.images.got !== "number" || typeof v.images.want !== "number") return null;
  if (typeof v.progress !== "number" || typeof v.step !== "string") return null;
  // `liveDocOf` shu uchtasisiz hujjat qura olmaydi.
  if (!v.meta || typeof v.meta !== "object" || typeof v.theme !== "string" || typeof v.template !== "string") return null;
  return v as LiveView;
}

/**
 * Yupqa kompozitor: holatni ushlaydi va `SlideRail`, `SlideStage`,
 * `useSlideKeys` bo'laklarini bog'laydi.
 *
 * Asboblar paneli ATAYLAB minimal (Muharrir 2): sahifa/zoom/to'liq ekran
 * va slayd «O‘chirish». Saqlash/bekor qilish sahifa SARLAVHASIDA
 * (`EditActions`, `onEditState` orqali), eslatma paneli yo'q (taqdimotchi
 * rejimida qoladi), maket chiplari, «+ Slayd», ▲/▼ yo'q — matn tahriri
 * to'g'ridan-to'g'ri slaydning o'zida (`SlideEditor`).
 */
export function SlideViewer({
  doc,
  live,
  overlay,
  gen,
  onGen,
  onEditState,
}: {
  doc: AcademicDoc;
  /**
   * Jonli generatsiya holati (`LiveDeck` — `lib/generation/slide-progress.ts`).
   * Xom `unknown` keladi va `asLiveView` bilan tekshiriladi; `null`
   * bo'lsa ko'ruvchi tayyor hujjatdagidek ishlaydi.
   */
  live?: unknown;
  /** `SlideStage` ustiga qatlam chizish sloti — berilmasa hech narsa chiqmaydi. */
  overlay?: (ctx: SlideStageOverlayCtx) => ReactNode;
  /**
   * Tayyor generatsiya (`api.GenerationDetail`) — TAHRIR shu bilan
   * yoqiladi. Berilmasa ko'ruvchi passiv (avvalgidek).
   */
  gen?: unknown;
  /** Tahrirdan keyin yangilangan generatsiya — sahifa holatiga qaytariladi. */
  onGen?: (g: unknown) => void;
  /**
   * Tahrir holati sahifa sarlavhasiga (`EditActions`): saqlanmagan soni,
   * saqlash va bekor qilish. «Yuklab olish» yuqorida turadi — sahifa
   * saqlanmagan tahrir borligini bilmasa, foydalanuvchi ekranda ko'rgan
   * slaydni EMAS, eski faylni yuklab ketardi. `null` — tahrir yo'q.
   */
  onEditState?: (s: EditActionsState | null) => void;
}) {
  const ed = useSlideEdit({ gen, onGen });
  /*
   * Ekrandagi hujjat — tahrir qilingan OPTIMISTIK nusxa (bo'lmasa
   * propdagisi). Deka, sahna, eskizlar va PPTX bir xil modeldan
   * chiziladi: «ko'rdim = oldim».
   */
  const docNow = ed.doc ?? doc;
  const deck = useMemo(() => buildSlideDeck(docNow), [docNow]);
  const theme = useMemo(() => getSlideTheme(deck.themeId), [deck.themeId]);
  /**
   * Eski dekalar uchun `id` qayta raqamlanadi.
   *
   * Bo'lakli generatsiya dastlab har bo'lakni `s0` dan boshlar edi, ya'ni
   * 16 slaydli dekada `s0…s7` ikki marta uchrardi. Dvigatelda bu
   * tuzatildi (`renumberSlides`), lekin BAZADAGI eski hujjatlar shundoq
   * qolgan — ularni ochganda React «two children with the same key»
   * xatosini beradi. Ko'ruvchi saqlangan ma'lumotga tayanmasligi kerak.
   */
  const slides = useMemo(
    () => (deck.slides ?? []).map((s, i) => (s.id === `s${i}` ? s : { ...s, id: `s${i}` })),
    [deck.slides],
  );
  const [i, setI] = useState(0);
  const [present, setPresent] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [zoom, setZoom] = useState(75);
  const [fitOn, setFitOn] = useState(true);

  const lv = useMemo(() => asLiveView(live), [live]);
  /**
   * Ko'ruvchi sahifaga BOG'LANGANmi (tayyor generatsiya yoki jonli
   * oqim). Mobil eskiz tasmasi faqat shunda chiziladi — passiv ko'ruvchi
   * (`gen`/`live` siz) eskicha qoladi.
   */
  const connected = gen !== undefined || live !== undefined;

  const go = useCallback(
    (n: number) => setI(Math.max(0, Math.min(slides.length - 1, n))),
    [slides.length],
  );

  /*
   * Oxirgi slaydni o'chirgandan keyin joriy indeks deka tashqarisida
   * qolishi mumkin — sahna bo'sh ko'rinardi.
   */
  useEffect(() => {
    setI((cur) => (cur > slides.length - 1 ? Math.max(0, slides.length - 1) : cur));
  }, [slides.length]);

  /*
   * JONLI shoxlar.
   *
   * `marks` — eskiz paneliga: xaritada YO'Q indeks «hali yozilmagan».
   * `writing` esa navbatdagi (yozilayotgan) BITTA slayd: `written` da
   * yo'q eng kichik indeks. Shu sabab «yozilmoqda» nuqtasi doim bitta
   * joyda turadi va foydalanuvchi qayerda ish ketayotganini ko'radi.
   */
  const marks = useMemo(() => {
    if (!lv) return undefined;
    const done = new Set(lv.written);
    const m: Record<number, "writing" | "done"> = {};
    for (const idx of done) m[idx] = "done";
    if (!lv.final) {
      for (let k = 0; k < slides.length; k++) {
        if (!done.has(k)) {
          m[k] = "writing";
          break;
        }
      }
    }
    return m;
  }, [lv, slides.length]);

  const written = useMemo(() => lv?.written ?? [], [lv]);
  // Sahnada ham FAQAT `done` haqiqiy matn — qolganida skelet.
  const skeleton = Boolean(lv && marks && marks[i] !== "done");
  /*
   * Yozish animatsiyasi uchun matn hajmi — sahnadagi slaydning O'ZI
   * (`planSlide` qatlamlari). Slayd hali yo'q yoki skelet bo'lsa
   * hisoblanmaydi.
   */
  const chars = useMemo(() => {
    const s = slides[i];
    if (!lv || !s || skeleton) return 0;
    return totalChars(planSlide(s, theme, deck.visual, i, slides.length, deck.audience, deck.templateId, { bodyType: deck.bodyType, logo: deck.logo }).layers);
  }, [lv, slides, i, skeleton, theme, deck.visual, deck.audience, deck.templateId, deck.bodyType, deck.logo]);

  const reveal = useReveal({ index: i, written, final: lv?.final ?? true, chars, enabled: Boolean(lv) });

  /*
   * Avtomatik ergashish: yangi slayd yozilganda sahna unga sakraydi.
   * Foydalanuvchi eskizni bosishi bilan to'xtaydi — o'qiyotgan slayd
   * oyoq ostidan tortib olinmasin.
   */
  const [follow, setFollow] = useState(true);
  const lastWritten = written.length ? Math.max(...written) : -1;
  useEffect(() => {
    if (!lv || !follow || lastWritten < 0) return;
    setI((cur) => (lastWritten > cur ? Math.min(lastWritten, slides.length - 1) : cur));
  }, [lv, follow, lastWritten, slides.length]);

  const railGo = useCallback(
    (n: number) => {
      setFollow(false);
      go(n);
    },
    [go],
  );

  /*
   * HAQIQIY to'liq ekran.
   *
   * Ilgari «taqdimot» faqat `fixed inset-0` edi: brauzer manzil satri va
   * yorliqlari ekranda qolardi, proyektorda esa aynan shular ko'rinmasligi
   * kerak. Fullscreen API rad etilishi mumkin (masalan foydalanuvchi
   * harakatisiz chaqirilsa), shuning uchun xato yutiladi — bunday holda
   * eski qoplama rejimi baribir ishlaydi.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (present && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (!present && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    return () => {
      // Komponent taqdimot rejimida yopilsa (brauzer «orqaga», boshqa
      // hujjatga o'tish) fullscreen'da qolib ketmasin.
      if (present && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [present]);

  // Brauzer to'liq ekrandan chiqsa (Esc, F11) — holat mos kelib qolsin.
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) setPresent(false);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Jonli rejimda F/P klavishlari ham taqdimotni ochmasin — tugmalari
  // yashirin bo'lgani holda klaviatura yo'li ochiq qolsa, yarim deka
  // to'liq ekranga chiqib ketardi.
  const noop = useCallback(() => {}, []);

  /*
   * ═══ TAHRIR ═══
   *
   * Tahrir TUGMASI YO'Q — tayyor dekada u DOIM yoqiq: foydalanuvchi matn
   * ustiga ikki marta bosadi va yozadi. Faqat ikki holatda o'chadi:
   * taqdimotda (ekranda tinglovchi bor) va jonli generatsiyada (hujjat
   * hali serverda yozilmoqda — PATCH uni ustidan yozib yuborardi).
   */
  const editOn = ed.editable && !lv;
  const { run: runOps, undo, redo, save, pending, discard, saving, justSaved } = ed;

  const onText = useCallback(
    (src: SlideSrc, value: string) => {
      runOps([{ op: "text", index: i, src, value }]);
    },
    [runOps, i],
  );
  /*
   * Kolontitul DEKA darajasida — `index` YO'Q: `applyDocOps` uni barcha
   * slaydga yozadi. Shuning uchun `onText` dan alohida ilgak (matn
   * operatsiyasi `footer` ni ataylab rad etadi).
   */
  const onFooter = useCallback(
    (value: string) => {
      runOps([{ op: "footer", value }]);
    },
    [runOps],
  );
  /** Test kaliti — javoblar slaydi `applyDocOps` ichida qayta yig'iladi. */
  const onAnswer = useCallback(
    (q: number, answer: number) => {
      runOps([{ op: "answer", index: i, q, answer }]);
    },
    [runOps, i],
  );
  /** Shrift o'lchami — matndan ALOHIDA op (`null` — «Standart»). */
  const onStyle = useCallback(
    (src: SlideSrc, size: number | null) => {
      runOps([{ op: "style", index: i, src, size }]);
    },
    [runOps, i],
  );
  const onSlideImage = useCallback(
    (url: null) => {
      runOps([{ op: "image", index: i, url }]);
    },
    [runOps, i],
  );
  /** «Rasmni qaytarish» — asl AI rasm `imageOrig` dan. */
  const onRestoreImage = useCallback(() => {
    runOps([{ op: "imageRestore", index: i }]);
  }, [runOps, i]);
  const onDeleteSlide = useCallback(() => {
    runOps([{ op: "delete", index: i }]);
  }, [runOps, i]);
  const onReorder = useCallback(
    (order: number[]) => {
      runOps([{ op: "reorder", order }]);
    },
    [runOps],
  );
  /** Mobil tasmadagi ◀/▶ — qo'shni slayd bilan almashish (sudrashning teginish yo'li). */
  const onMove = useCallback(
    (dir: -1 | 1) => {
      const to = i + dir;
      if (to < 0 || to > slides.length - 1) return;
      const order = slides.map((_, k) => k);
      order[i] = to;
      order[to] = i;
      if (runOps([{ op: "reorder", order }])) setI(to);
    },
    [runOps, i, slides],
  );
  // Ikki bosqichli tasdiq — bir bosishda slayd yo'qolmasin (undo bor, lekin baribir).
  const delSlide = useConfirmClick(onDeleteSlide);

  /*
   * Tahrirlanayotgan qatlam kaliti — `SlideCanvas` o'sha qatlamni
   * yashiradi, ustida `SlideEditor` ning tahrir maydoni turadi (ikki
   * matn ustma-ust tushmasin). Slayd almashsa tozalanadi.
   */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  useEffect(() => setEditingKey(null), [i]);

  /*
   * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y. `useSlideKeys` bu ilgakni
   * INPUT/TEXTAREA filtridan KEYIN chaqiradi, ya'ni matn yozayotganda
   * brauzerning o'z bekor qilishi ishlaydi.
   */
  const keysExtra = useCallback(
    (e: KeyboardEvent) => {
      if (!editOn) return false;
      if (!(e.ctrlKey || e.metaKey)) return false;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return true;
      }
      if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
        return true;
      }
      return false;
    },
    [editOn, undo, redo],
  );

  /*
   * Tahrir holati SAHIFAGA (`EditActions`). Ref orqali — har renderda
   * yangi callback berilsa ham effekt qayta ishlamasin. Komponent
   * yopilganda `null` — sarlavhada eskirgan tugma qolmasin.
   */
  const onEditStateRef = useRef(onEditState);
  onEditStateRef.current = onEditState;
  useEffect(() => {
    onEditStateRef.current?.(editOn ? { pending, saving, justSaved, save, discard } : null);
  }, [editOn, pending, saving, justSaved, save, discard]);
  useEffect(() => () => onEditStateRef.current?.(null), []);

  /*
   * Ctrl+S — «Saqlash» ning klaviatura yo'li.
   *
   * `useSlideKeys` dan ALOHIDA tinglanadi, chunki u INPUT/TEXTAREA
   * ichida umuman ishlamaydi: matn yozib turib Ctrl+S bosish esa aynan
   * eng kerakli payt. Brauzerning «sahifani saqlash» oynasi ham
   * to'xtatiladi.
   */
  useEffect(() => {
    if (!editOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (pending > 0) void save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editOn, save, pending]);

  useSlideKeys({
    go,
    i,
    total: slides.length,
    present,
    setPresent: lv ? noop : setPresent,
    setPresenter: lv ? noop : setPresenter,
    extra: keysExtra,
  });

  /*
   * Chiqish taymeri. Taqdimotchi uchun asosiy raqam — «qancha gapirdim»,
   * shuning uchun u soat emas, o'tgan vaqt. Taqdimot boshlanganda o'zi
   * yurib ketadi; to'xtatish va nolga qaytarish qo'lda.
   */
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(true);
  useEffect(() => {
    if (!present) return;
    setElapsed(0);
    setRunning(true);
  }, [present]);
  useEffect(() => {
    if (!present || !running) return;
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [present, running]);
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  /*
   * Keyingi slayd eskizining masshtabi O'LCHANADI.
   *
   * Yon paneldagi kenglik `min(34vw, 460px)` — ya'ni ekranga qarab
   * o'zgaradi. Qat'iy masshtab (yon ustundagi 0.117 kabi) bu yerda
   * noto'g'ri bo'lardi: keng monitorda eskiz ramkadan chiqib ketardi.
   */
  const nextRef = useRef<HTMLSpanElement>(null);
  const [nextScale, setNextScale] = useState(0.2);
  useEffect(() => {
    const el = nextRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNextScale(el.getBoundingClientRect().width / SLIDE.w));
    ro.observe(el);
    return () => ro.disconnect();
  }, [present, presenter, i]);

  const slide = slides[i];
  const next = slides[i + 1];
  // Eslatma FAQAT taqdimotchi paneliga — pastki panel yo'q (Muharrir 2).
  const notes = slide ? slideNotes(slide, deck.speakerNotes) : "";

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", present && "fixed inset-0 z-50 bg-black")}>
      {present ? (
        <div className="no-print absolute top-0 right-0 z-20 flex items-center gap-1 p-3 text-white/80">
          <span className="mr-2 text-sm tabular-nums">
            {i + 1} / {slides.length}
          </span>
          <button
            type="button"
            title="Taqdimotchi rejimi (P)"
            className={cn("hover:bg-white/10 rounded p-1.5", presenter && "bg-white/15")}
            onClick={() => setPresenter((v) => !v)}
          >
            <Presentation className="size-4" />
          </button>
          <button type="button" className="hover:bg-white/10 rounded p-1.5" onClick={() => setPresent(false)}>
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <ViewerToolbar
          zoom={zoom}
          onZoom={(n) => {
            setFitOn(false);
            setZoom(n);
          }}
          page={i + 1}
          pages={slides.length}
          onPage={(n) => go(n - 1)}
          onFit={() => setFitOn(true)}
          /*
           * Jonli generatsiya paytida taqdimot/to'liq ekran YO'Q: deka
           * hali yarim, uni proyektorga chiqarish ma'nosiz.
           */
          onFullscreen={lv ? undefined : () => setPresent(true)}
          extra={
            <>
              {ed.legacy && !lv ? (
                <span className="text-xs text-white/40">
                  Bu deka eski formatda — tahrirlab bo‘lmaydi
                </span>
              ) : null}

              {/* Slayd ustidagi YAGONA amal — o'chirish (ikki bosishda).
                  Qolgan hamma tahrir slaydning o'zida yoki sahifa sarlavhasida. */}
              {editOn && slide ? (
                <button
                  type="button"
                  title={slides.length <= 1 ? "Oxirgi slaydni o‘chirib bo‘lmaydi" : "Slaydni o‘chirish"}
                  disabled={slides.length <= 1}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-40",
                    delSlide.armed ? "bg-red-500/80 text-white" : "hover:bg-white/10",
                  )}
                  onClick={delSlide.trigger}
                >
                  <Trash2 className="size-3.5" />
                  {delSlide.armed ? "Rostdan?" : "O‘chirish"}
                </button>
              ) : null}

              {/* Interfeys o'zbekcha: xom `id` («magazine», «problem») emas,
                  shablonning formada ko'ringan nomi. */}
              <span className="hidden text-xs text-white/50 lg:inline">
                {SLIDE_TEMPLATE_BY_ID[deck.templateId]?.nameUz ?? deck.templateId} · {theme.nameUz}
              </span>
            </>
          }
        />
      )}

      <div className={cn("flex min-h-0 flex-1", present ? "bg-black" : "bg-[#1e1e1e]")}>
        {!present ? (
          <SlideRail
            slides={slides}
            theme={theme}
            visual={deck.visual}
            audience={deck.audience}
            templateId={deck.templateId}
            bodyType={deck.bodyType}
            logo={deck.logo}
            i={i}
            go={lv ? railGo : go}
            roles={lv?.roles}
            marks={marks}
            reorderOn={editOn}
            onReorder={onReorder}
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <SlideStage
            slide={slide}
            theme={theme}
            visual={deck.visual}
            audience={deck.audience}
            templateId={deck.templateId}
            bodyType={deck.bodyType}
            logo={deck.logo}
            index={i}
            total={slides.length}
            present={present}
            zoom={zoom}
            fitOn={fitOn}
            presenter={presenter}
            onAdvance={() => go(i + 1)}
            hideSrc={editOn && !present && editingKey ? editingKey : undefined}
            /*
              Tahrir qatlami — `overlay` slotida. Tashqi `overlay` propi
              (agar berilgan bo'lsa) ustun: uni jonli paket ishlatadi va
              ikkalasi bir vaqtda bo'lmaydi (tahrir jonlida o'chiq).
            */
            overlay={
              overlay ??
              // Taqdimot (`present`) rejimida tahrir qatlami YO'Q — ikki bosish, panel, maydon chiqmaydi.
              (editOn && !present
                ? (ctx) => (
                    <SlideEditor
                      slide={ctx.slide}
                      theme={theme}
                      visual={deck.visual}
                      audience={deck.audience}
                      templateId={deck.templateId}
                      bodyType={deck.bodyType}
                      logo={deck.logo}
                      index={ctx.index}
                      total={slides.length}
                      scale={ctx.scale}
                      busy={ed.saving}
                      onText={onText}
                      onFooter={onFooter}
                      onAnswer={onAnswer}
                      onStyle={onStyle}
                      onImage={onSlideImage}
                      onRestoreImage={onRestoreImage}
                      onUpload={(f) => void ed.uploadImage(ctx.index, f)}
                      onEditing={setEditingKey}
                    />
                  )
                : undefined)
            }
            skeleton={skeleton}
            role={lv?.roles?.[i]}
            imageWait={Boolean(lv?.imageWait.includes(i))}
            reveal={reveal}
          />

          {lv ? <LiveStrip live={lv} /> : null}

          {/*
            MOBIL eskiz tasmasi — yon panel `md:` dan past ekranda
            `hidden`, ya'ni telefonda deka umuman ko'rinmasdi. Shart
            `connected`: passiv ko'ruvchi (`gen`/`live` siz) eskicha
            qoladi. Ishlab turgan IKKALA yo'l ham tasmani oladi:
            `ArtifactViewer` → `gen`, `RunningPanel` → `live`.
          */}
          {!present && connected ? (
            <SlideRail
              variant="strip"
              slides={slides}
              theme={theme}
              visual={deck.visual}
              audience={deck.audience}
              templateId={deck.templateId}
              bodyType={deck.bodyType}
              logo={deck.logo}
              i={i}
              go={lv ? railGo : go}
              roles={lv?.roles}
              marks={marks}
              reorderOn={editOn}
              onMove={onMove}
            />
          ) : null}

          {!present ? (
            <div className="no-print flex h-9 shrink-0 items-center gap-2 border-t border-white/10 bg-[#252525] px-3 text-[12px] text-white/70">
              <button type="button" className="hover:bg-white/10 rounded p-1" onClick={() => go(i - 1)}>
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="tabular-nums">
                Slayd {i + 1} / {slides.length}
              </span>
              <button type="button" className="hover:bg-white/10 rounded p-1" onClick={() => go(i + 1)}>
                <ChevronRight className="size-3.5" />
              </button>
              {/* Holat satri — hujjat saqlanmoqdami yoki PPTX hali eski.
                  Saqlanmagan soni sahifa sarlavhasida (`EditActions`). */}
              {ed.saving ? (
                <span className="ml-3 shrink-0 text-white/50">Saqlanmoqda…</span>
              ) : ed.rebuilding ? (
                <span className="ml-3 shrink-0 text-white/50">Fayl yangilanmoqda…</span>
              ) : null}
              {ed.error ? (
                <span role="alert" className="ml-3 min-w-0 truncate text-amber-300">
                  {ed.error}
                </span>
              ) : null}
              <span className="ml-auto truncate">{deck.topic}</span>
              {lv ? null : (
                <button type="button" className="hover:bg-white/10 ml-2 rounded p-1" onClick={() => setPresent(true)}>
                  {present ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </button>
              )}
            </div>
          ) : null}
        </div>

        {/*
          Taqdimotchi paneli — FAQAT to'liq ekranda.
          Bu ekran tinglovchiga emas, so'zlovchiga qaraydi: nima
          gapirilishi (eslatma), nima kelayotgani (keyingi slayd) va
          qancha vaqt ketgani. Shuning uchun u slayd MAYDONIDAN tashqarida
          turadi — proyektorga ikkinchi ekran uzatilganda faqat chap
          tomondagi slayd ko'chiriladi.
        */}
        {present && presenter ? (
          <aside className="no-print flex w-[min(34vw,460px)] shrink-0 flex-col gap-3 overflow-y-auto border-l border-white/10 bg-[#141414] p-4 text-white">
            <div className="flex items-center gap-2">
              <span className="text-3xl font-semibold tabular-nums">{clock}</span>
              <button
                type="button"
                title={running ? "To‘xtatish" : "Davom ettirish"}
                className="hover:bg-white/10 rounded p-1.5 text-white/70"
                onClick={() => setRunning((v) => !v)}
              >
                {running ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <button
                type="button"
                title="Noldan"
                className="hover:bg-white/10 rounded p-1.5 text-white/70"
                onClick={() => setElapsed(0)}
              >
                <RotateCcw className="size-4" />
              </button>
              <span className="ml-auto text-sm text-white/50 tabular-nums">
                {i + 1} / {slides.length}
              </span>
            </div>

            <div>
              <div className="mb-1 text-[11px] font-medium tracking-wide text-white/45 uppercase">Keyingi slayd</div>
              {next ? (
                <span
                  ref={nextRef}
                  className="relative block overflow-hidden rounded bg-black"
                  style={{ aspectRatio: `${SLIDE.w} / ${SLIDE.h}` }}
                >
                  <span
                    className="absolute top-0 left-0 origin-top-left"
                    style={{ width: SLIDE.w, height: SLIDE.h, transform: `scale(${nextScale})` }}
                  >
                    <SlideCanvas
                      slide={next}
                      theme={theme}
                      visual={deck.visual}
                      audience={deck.audience}
                      templateId={deck.templateId} bodyType={deck.bodyType} logo={deck.logo}
                      index={i + 1}
                      total={slides.length}
                    />
                  </span>
                </span>
              ) : (
                <p className="text-sm text-white/50">Bu oxirgi slayd.</p>
              )}
            </div>

            <div className="min-h-0 flex-1">
              <div className="mb-1 text-[11px] font-medium tracking-wide text-white/45 uppercase">Eslatma</div>
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/85">
                {notes || "Bu slayd uchun eslatma yo‘q."}
              </p>
            </div>

            <p className="text-[11px] text-white/35">
              Strelka — slayd almashtirish · P — bu panel · Esc — chiqish
            </p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
