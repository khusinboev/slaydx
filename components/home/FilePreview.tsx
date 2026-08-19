"use client";

import { FileText, Image as ImageIcon, Presentation } from "lucide-react";
import type { ServerGeneration } from "@/lib/api-client";

/**
 * Ro'yxatdagi kartochka ko'rinishi.
 *
 * Ilgari bu komponent butun hujjatni (`gen.doc`) va IndexedDB dagi
 * rasmlarni yuklab, slaydni to'liq render qilardi — bosh sahifada 20 ta
 * kartochka uchun bu og'ir edi. Endi server tayyorlagan kichik `preview`
 * ishlatiladi: bitta rasm havolasi yoki bir necha qator matn.
 */
export function FilePreview({ gen }: { gen: ServerGeneration }) {
  const running = gen.status === "QUEUED" || gen.status === "IN_PROGRESS";

  if (running) {
    return (
      <div className="bg-muted flex h-full items-center justify-center">
        <div className="bg-primary/30 h-1.5 w-2/3 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full transition-all"
            style={{ width: `${Math.max(8, gen.progress)}%` }}
          />
        </div>
      </div>
    );
  }

  if (gen.status !== "COMPLETED") {
    return (
      <div className="bg-muted flex h-full items-center justify-center">
        <FileText className="text-muted-foreground size-8 opacity-50" />
      </div>
    );
  }

  const url = gen.preview?.url;
  if (url) {
    return (
      // Rasm bizning `/api/.../assets` endpointimizdan keladi — `next/image`
      // optimizatsiyasi shaxsiy, cookie talab qiladigan manba uchun ishlamaydi.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
    );
  }

  const lines = gen.preview?.lines ?? [];
  if (lines.length) {
    return (
      <div className="h-full overflow-hidden bg-[#f7f4ec] px-3 py-2.5 text-left">
        <div className="mb-1.5 line-clamp-2 text-[11px] leading-tight font-bold text-[#1a2744]">
          {gen.topic}
        </div>
        {lines.map((t, i) => (
          <p key={i} className="mb-1 line-clamp-2 text-[9px] leading-snug text-[#334155]">
            {t}
          </p>
        ))}
      </div>
    );
  }

  const Icon = gen.type === "slide" ? Presentation : gen.type === "image" ? ImageIcon : FileText;
  return (
    <div className="bg-[#eef1f4] flex h-full items-center justify-center">
      <Icon className="text-muted-foreground size-8" />
    </div>
  );
}
