import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function ZoomFrame({
  zoom,
  width,
  height,
  children,
  className,
}: {
  zoom: number;
  width: number;
  height: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative mx-auto", className)} style={{ width: width * zoom, height: height * zoom }}>
      <div
        className="absolute top-0 left-0"
        style={{ width, height, transform: `scale(${zoom})`, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Varaqlar foni (kulrang «stol»). Viewer redesign V1: bu quti endi
 * SCROLL QUTISI EMAS — varaqlar natija sahifasining yagona scroll'ida
 * (AppShell `<main>`) oqadi. Ilgari `overflow-auto h-full` edi va
 * `min-h-[70vh]` ildiz bilan birga hujjat oxirini kesardi (R1 §1).
 *
 * Diqqat: `overflow-x: auto` YOLG'IZ ham qutini vertikal scroll
 * konteyneriga aylantiradi (CSS overflow qoidasi) — shuning uchun bu
 * yerda hech qanday `overflow-*` yo'q; keng zoom uchun gorizontal
 * scroll faqat bitta varaq qatorida ({@link PageRow}).
 */
export const Workspace = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(
  function Workspace({ children, className }, ref) {
    return (
      <div ref={ref} className={cn("viewer-workspace bg-[#525659] px-3 py-8 sm:px-6", className)}>
        {children}
      </div>
    );
  },
);

/**
 * Bitta varaq qatori.
 *
 * - `wide` — qo'lda tanlangan zoom varaqni ustundan kengaytirganda:
 *   gorizontal scroll SHU qatorda, barcha varaqlar ajdodida emas (aks
 *   holda aylantirgich hujjat oxirida qolardi). Qator balandligi varaq
 *   balandligiga teng — vertikal g'ildirak sahifaga o'tadi, tuzoq yo'q.
 *   Sig'dirilgan zoomda qator oddiy blok, scroll konteyneri emas.
 * - `scroll-mt` — «keyingi sahifa» bosilganda varaq yopishqoq sarlavha
 *   va toolbar ostida qolib ketmasin.
 */
export function PageRow({ wide, children }: { wide: boolean; children: ReactNode }) {
  return (
    <div
      data-page-row
      className={cn(
        // Bosmada varaq ikki qog'ozga bo'linmasin.
        "max-w-full scroll-mt-[calc(var(--result-header-h,0px)+3rem)] print:break-inside-avoid",
        wide && "overflow-x-auto overscroll-x-contain",
      )}
    >
      {children}
    </div>
  );
}
