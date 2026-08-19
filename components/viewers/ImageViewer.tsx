"use client";

import { useMemo, useState } from "react";
import { Download, Maximize2, X } from "lucide-react";
import type { AcademicDoc, GenImage } from "@/lib/generation/types";
import { imageRatioById, imageStyleById } from "@/lib/generation/image-studio";
import { cn } from "@/lib/cn";

export function ImageViewer({ doc }: { doc: AcademicDoc }) {
  // Rasm havolalari hujjat bilan birga keladi (`/api/.../assets/...`).
  const images: GenImage[] = doc.images ?? [];
  const [open, setOpen] = useState<number | null>(null);
  const style = imageStyleById(doc.imageStyle || "photo");
  const ratio = imageRatioById(doc.imageRatio || "1:1");

  const cols = useMemo(() => (images.length <= 1 ? 1 : images.length === 2 ? 2 : 2), [images.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#111]">
      <div className="no-print flex h-10 shrink-0 items-center gap-3 border-b border-white/10 px-4 text-[13px] text-white/80">
        <span className="truncate font-medium">{doc.imagePrompt || doc.meta.topic}</span>
        <span className="text-white/40">
          {style.name} · {ratio.label} · {images.length} rasm
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {images.length === 0 ? (
          <p className="text-center text-sm text-white/60">Rasm topilmadi. Qayta generate qiling.</p>
        ) : (
          <div className={cn("mx-auto grid max-w-6xl gap-3", cols === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
            {images.map((im, i) => (
              <figure key={im.id} className="group relative overflow-hidden rounded-xl bg-black">
                <button type="button" className="block w-full" onClick={() => setOpen(i)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={im.url}
                    alt={im.alt || ""}
                    className="h-auto w-full object-cover"
                    style={{ aspectRatio: `${im.w} / ${im.h}` }}
                  />
                </button>
                <div className="absolute right-2 bottom-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    className="rounded-lg bg-black/70 p-2 text-white"
                    onClick={() => setOpen(i)}
                    aria-label="Kattalashtirish"
                  >
                    <Maximize2 className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-black/70 p-2 text-white"
                    onClick={() => downloadImage(im, i)}
                    aria-label="Yuklab olish"
                  >
                    <Download className="size-4" />
                  </button>
                </div>
              </figure>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <button type="button" className="absolute inset-0" aria-label="Yopish" onClick={() => setOpen(null)} />
          <div className="relative z-10 max-h-[92vh] max-w-[92vw]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={images[open].url} alt="" className="max-h-[86vh] max-w-[92vw] object-contain" />
            <div className="absolute top-2 right-2 flex gap-1">
              <button type="button" className="rounded-lg bg-black/70 p-2 text-white" onClick={() => downloadImage(images[open], open)}>
                <Download className="size-4" />
              </button>
              <button type="button" className="rounded-lg bg-black/70 p-2 text-white" onClick={() => setOpen(null)}>
                <X className="size-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function downloadImage(im: GenImage, i: number) {
  const a = document.createElement("a");
  a.href = im.url;
  a.download = `rasm-${i + 1}.jpg`;
  a.click();
}
