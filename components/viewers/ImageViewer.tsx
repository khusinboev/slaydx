"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ImageOff, Maximize2, Minimize2, X } from "lucide-react";
import type { AcademicDoc, GenImage } from "@/lib/generation/types";
import { imageExt } from "@/lib/viewers/kind";
import { imageRatioById, imageStyleById } from "@/lib/generation/image-studio-options";
import { cn } from "@/lib/cn";
import { useDialog } from "../overlays/useDialog";

/**
 * Rasm / infografika ko'ruvchisi.
 *
 * Viewer redesign V4: `flow` ramka — bu ko'ruvchida ICHKI vertikal scroll
 * qutisi yo'q, sahifa scroll bo'ladi (infografika plakati 1600+ px balandlikda,
 * u ham sahifa oqimida to'liq yetib boriladi). Sarlavha qatori
 * `sticky top-[var(--result-header-h)]`: natija sarlavhasi ostida turadi.
 *
 * Tasvir ustidagi amallar (kattalashtirish, yuklash) DOIM ko'rinadi — ilgari
 * `opacity-0 group-hover` edi va sensorli ekranda umuman topilmasdi.
 * Lightbox: `useDialog` (Esc, fokus tuzog'i, yopilganda fokus ochgan tugmaga
 * qaytadi) + ←/→ almashtirish; «To'liq o'lcham» — rasm tabiiy o'lchamida,
 * lightbox ichida scroll qilinadi (plakatni o'qish uchun).
 */
export function ImageViewer({ doc }: { doc: AcademicDoc }) {
  // Rasm havolalari hujjat bilan birga keladi (`/api/.../assets/...`).
  const images: GenImage[] = doc.images ?? [];
  const [open, setOpen] = useState<number | null>(null);
  // Lightbox rejimi: false — ekranga sig'diriladi, true — tabiiy o'lcham (scroll).
  const [actual, setActual] = useState(false);
  const style = imageStyleById(doc.imageStyle || "photo");
  const ratio = imageRatioById(doc.imageRatio || "1:1");
  /*
   * Infografika (AUDIT-24 WP-D2d) — SHU ko'ruvchidan chiqadi (`viewerKind`
   * "image"), lekin «Foto · 1:1 · N rasm» yorlig'i mazmunsiz edi: plakat
   * uslub/nisbatga ega emas, blok soni esa rasm sonidan muhimroq. Yorliq
   * `doc.infographic` MODELIDAN o'qiladi (`isPoster` — `ResultView.tsx`
   * bilan bitta naqsh), qattiq yozilgan matn emas.
   */
  const poster = doc.infographic;

  const openAt = (i: number, full = false) => {
    setActual(full);
    setOpen(i);
  };
  const close = useCallback(() => setOpen(null), []);
  // Esc, fokus tuzog'i va fokusni ochgan elementga qaytarish — `useDialog` da.
  const dialogRef = useDialog(open != null, close);

  // Lightbox ochiq bo'lganda ←/→ — almashtirish (Esc ni `useDialog` yopadi).
  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setOpen((i) => (i == null ? i : Math.min(images.length - 1, i + 1)));
      else if (e.key === "ArrowLeft") setOpen((i) => (i == null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, images.length]);

  const single = images.length <= 1;
  const act =
    "inline-flex size-10 items-center justify-center rounded-lg bg-black/70 text-white hover:bg-black/85 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:opacity-40";
  const barBtn = "inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-[12.5px] text-white hover:bg-white/20";

  return (
    <div className="flex flex-1 flex-col bg-[#111]" data-image-viewer>
      <div
        className="no-print sticky top-[var(--result-header-h,0px)] z-10 flex min-h-10 shrink-0 items-center gap-3 border-b bg-[#111] px-4 py-1 text-[13px] text-white/80"
        // Global `* { border-color }` (qatlamsiz) utility'ni bosadi — krem chiziq chiqardi; inline qiymat ustun.
        style={{ borderBottomColor: "rgb(255 255 255 / 0.1)" }}
        data-image-bar
      >
        <span className="min-w-0 truncate font-medium">{poster ? poster.spec.title || doc.meta.topic : doc.imagePrompt || doc.meta.topic}</span>
        <span className="hidden shrink-0 text-white/40 sm:inline">
          {poster ? `Infografika · ${poster.spec.size} · ${poster.spec.blocks.length} blok` : `${style.name} · ${ratio.label} · ${images.length} rasm`}
        </span>
        {poster && images[0] ? (
          // Plakat tik va uzun: amallar sticky qatorda — rasm ustidagi tugmalar scroll bilan ketib qoladi.
          <span className="ml-auto flex shrink-0 items-center gap-1" data-poster-actions>
            <button type="button" className={barBtn} onClick={() => openAt(0, true)} data-poster-full>
              <Maximize2 className="size-3.5" />
              To‘liq o‘lcham
            </button>
          </span>
        ) : null}
      </div>
      <div className="flex-1 p-3 sm:p-6" data-image-body>
        {images.length === 0 ? (
          // `delivered` {got:0} bo'lsa worker farqni qaytargan — bu shunchaki
          // xizmat javob bermaganini bildiradi, «qayta generate» adashmaydi.
          <p className="text-center text-sm text-white/60">
            Rasmlar yaratilmadi — farq balansingizga qaytarildi. Qayta urinib ko‘ring.
          </p>
        ) : (
          <div
            className={cn(
              "mx-auto grid gap-3",
              // Plakat — bitta tik rasm: ustun kengligida (o'qiladigan), butun balandligi sahifa scroll'ida.
              poster ? "max-w-3xl grid-cols-1" : single ? "max-w-6xl grid-cols-1" : "max-w-6xl grid-cols-1 sm:grid-cols-2",
            )}
            data-image-grid
          >
            {images.map((im, i) => (
              <ImageTile
                key={im.id}
                im={im}
                poster={!!poster}
                onOpen={() => openAt(i)}
                // Bitta rasm: sarlavhadagi «Yuklab olish» AYNAN shu PNG ni beradi — takror yo'q.
                // Bir nechta rasm: sarlavha ZIP beradi, bu esa BITTA PNG — boshqa fayl, shuning uchun qoladi.
                onDownload={single ? undefined : () => downloadImage(im, i)}
                actClass={act}
              />
            ))}
          </div>
        )}
        {doc.imagePrompt ? (
          <div className="text-white/55 mx-auto mt-6 max-w-6xl space-y-1 text-sm">
            <p>{doc.imagePrompt}</p>
            {doc.imageScene && doc.imageScene !== doc.imagePrompt ? (
              <p className="text-white/35">{doc.imageScene}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {open != null && images[open] ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Rasmni kattalashtirish"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          data-image-lightbox
        >
          <div className="relative flex max-h-full max-w-full flex-col items-center gap-2">
            <div className="flex w-full items-center justify-end gap-1">
              <button type="button" className={act} onClick={close} aria-label="Yopish">
                <X className="size-4" />
              </button>
              {images.length > 1 ? (
                <>
                  <button type="button" className={act} onClick={() => setOpen(Math.max(0, open - 1))} disabled={open === 0} aria-label="Oldingi rasm">
                    <ChevronLeft className="size-4" />
                  </button>
                  <span className="px-1 text-[13px] text-white/70 tabular-nums">
                    {open + 1} / {images.length}
                  </span>
                  <button
                    type="button"
                    className={act}
                    onClick={() => setOpen(Math.min(images.length - 1, open + 1))}
                    disabled={open === images.length - 1}
                    aria-label="Keyingi rasm"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className={act}
                onClick={() => setActual((v) => !v)}
                aria-pressed={actual}
                aria-label={actual ? "Ekranga sig‘dirish" : "To‘liq o‘lcham"}
                data-lightbox-size
              >
                {actual ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
              {single ? null : (
                <button type="button" className={act} onClick={() => downloadImage(images[open], open)} aria-label="Yuklab olish">
                  <Download className="size-4" />
                </button>
              )}
            </div>
            <div className={cn("min-h-0 max-w-full", actual ? "max-h-[calc(100svh-5rem)] overflow-auto" : "")} data-lightbox-stage>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={images[open].url}
                alt={images[open].alt || ""}
                className={actual ? "max-w-none" : "max-h-[calc(100svh-5rem)] max-w-full object-contain"}
                style={actual ? { width: images[open].w } : undefined}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Bitta rasm katagi: yuklanguncha rasm NISBATIDAGI neytral skelet (qora quti
 * emas), yuklangach yumshoq paydo bo'lish, xatoda — xabar va «Qayta urinish».
 * Nisbat `im.w/im.h` dan (yo'q bo'lsa 1:1) — rasm kelganda sahifa sakramaydi.
 */
function ImageTile({
  im,
  poster,
  onOpen,
  onDownload,
  actClass,
}: {
  im: GenImage;
  poster: boolean;
  onOpen: () => void;
  onDownload?: () => void;
  actClass: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLImageElement>(null);
  // Brauzer keshidan darhol kelgan rasmda `load` hodisasi gidratsiyadan OLDIN o'tib ketgan bo'lishi mumkin.
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth > 0) setStatus("loaded");
  }, [attempt]);
  const ratio = im.w > 0 && im.h > 0 ? `${im.w} / ${im.h}` : "1 / 1";
  return (
    <figure
      className={cn("relative overflow-hidden rounded-xl", status === "loaded" ? "bg-black" : "bg-white/[0.06]")}
      data-image-tile
      data-image-state={status}
    >
      <button type="button" className="block w-full cursor-zoom-in" onClick={onOpen} aria-label="Kattalashtirish" disabled={status === "error"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={attempt}
          ref={ref}
          src={im.url}
          alt={im.alt || ""}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={cn(
            "h-auto w-full transition-opacity duration-300",
            poster ? "object-contain" : "object-cover",
            status === "loaded" ? "opacity-100" : "opacity-0",
          )}
          style={{ aspectRatio: ratio }}
        />
      </button>
      {status === "loading" ? (
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-white/[0.04]" role="status" aria-label="Rasm yuklanmoqda" data-image-skeleton />
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white/70" role="alert" data-image-error>
          <ImageOff className="size-6" aria-hidden />
          <p className="text-sm">Rasm yuklanmadi</p>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-lg bg-white/10 px-4 text-sm text-white hover:bg-white/20"
            onClick={() => {
              setStatus("loading");
              setAttempt((n) => n + 1);
            }}
            data-image-retry
          >
            Qayta urinish
          </button>
        </div>
      ) : null}
      {/* Doim ko'rinadi (sensorli ekranda hover yo'q), 40 px tegish maydoni. Xatoda rasm yo'q — amallar ham yo'q. */}
      {status !== "error" ? (
        <div className="absolute right-2 bottom-2 flex gap-1" data-image-actions>
          <button type="button" className={actClass} onClick={onOpen} aria-label="Kattalashtirish">
            <Maximize2 className="size-4" />
          </button>
          {onDownload ? (
            <button type="button" className={actClass} onClick={onDownload} aria-label="Yuklab olish">
              <Download className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </figure>
  );
}

function downloadImage(im: GenImage, i: number) {
  const a = document.createElement("a");
  a.href = im.url;
  // Kengaytma haqiqiy turdan olinadi: PNG rasm `.jpg` nomi bilan
  // yuklanganda ba'zi dasturlar uni ochmasdi.
  a.download = `rasm-${i + 1}.${imageExt(im.mime)}`;
  a.rel = "noopener";
  // Firefox `a.click()` ni faqat element DOM da bo'lsa bajaradi.
  document.body.appendChild(a);
  a.click();
  a.remove();
}
