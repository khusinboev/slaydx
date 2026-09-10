"use client";

import { useEffect, useRef, useState } from "react";
import { SLIDE } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";

/** 1280×720 canvas → karta kengligiga masshtab (o'lchanadi; SSR uchun taxminiy `scaleHint`). */
export function Thumb({ children, scaleHint, small = false }: { children: React.ReactNode; scaleHint: number; small?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(scaleHint);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setScale(el.getBoundingClientRect().width / SLIDE.w));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <span
      ref={ref}
      data-thumb={small ? "small" : "main"}
      className={cn("relative block w-full overflow-hidden bg-black", small ? "rounded-[3px]" : "rounded-md")}
      style={{ aspectRatio: `${SLIDE.w} / ${SLIDE.h}` }}
    >
      <span className="absolute top-0 left-0" style={{ width: SLIDE.w, height: SLIDE.h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </span>
    </span>
  );
}
