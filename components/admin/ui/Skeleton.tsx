"use client";

import { cn } from "@/lib/cn";

/** Placeholder block. Decorative: the loading state is announced by the container (`aria-busy`). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("bg-muted animate-pulse rounded-md", className)} />;
}
