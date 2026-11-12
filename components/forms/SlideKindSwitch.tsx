"use client";

import Link from "next/link";
import { useAppStore } from "@/lib/store";

/**
 * «Pro slayd · AI slayd» (docs/ai-slide/SPEC.md «Placement»): the two per-slide deck kinds share one page. The AI slide
 * tool is not listed on its own, so this switch on top of both forms is its door. Hidden while the server says the
 * AI slide cannot be ordered (`features.imageSlide`).
 */
export function SlideKindSwitch({ current }: { current: "pro" | "ai" }) {
  const features = useAppStore((s) => s.features);
  const offered = features ? (features.imageSlide ?? features.images) !== false : true;
  if (!offered && current === "pro") return null;
  const item = (id: "pro" | "ai", href: string, label: string, hint: string) => {
    const on = id === current;
    return (
      <Link
        href={href}
        replace
        role="tab"
        aria-selected={on}
        data-slide-kind={id}
        className={`flex min-h-11 flex-1 flex-col justify-center rounded-[10px] px-3 py-1.5 text-center transition-colors ${on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
      >
        <span className="text-[14.5px] font-semibold">{label}</span>
        <span className="text-[13px] leading-tight opacity-80">{hint}</span>
      </Link>
    );
  };
  return (
    <div role="tablist" aria-label="Slayd turi" className="bg-muted/70 mb-3 flex gap-1 rounded-[14px] p-1">
      {item("pro", "/uz/pro-slide", "Pro slayd", "Tahrirlanadigan maket + AI rasmlar")}
      {item("ai", "/uz/ai-slayd", "AI slayd", "Har slayd — AI chizgan tiniq rasm")}
    </div>
  );
}
