"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

// Static class strings so Tailwind's scanner sees every one of them.
const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success-text",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-info/15 text-info",
  primary: "bg-primary/20 text-foreground",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  primary: "bg-primary",
};

/** Small coloured pill for statuses, roles and flags. */
export function Badge({
  tone = "neutral",
  dot = false,
  children,
  title,
}: {
  tone?: Tone;
  /** Leading dot, so the tone is not conveyed by colour alone. */
  dot?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] leading-snug font-semibold whitespace-nowrap",
        TONE[tone],
      )}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", DOT[tone])} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** Alias used where the pill represents a status (generation state, order state, ...). */
export const StatusPill = Badge;
