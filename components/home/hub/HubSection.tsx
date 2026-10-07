import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Entrance stagger step; the last of the hub's 4 sections starts at 150 ms (≤ 200 ms). */
export const HUB_STAGGER_MS = 50;

/**
 * A hub section: 13 px uppercase label (`<h2>`), an optional right-hand link,
 * the body. It fades in on first paint, staggered by `index`
 * (`slx-enter-fade`, the shell's keyframe); `motion-safe:` — nothing moves
 * under reduced motion.
 */
export function HubSection({
  id,
  title,
  action,
  index,
  className,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  index: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`hub-${id}-title`}
      data-hub-section={id}
      className={cn("min-w-0 motion-safe:animate-[slx-enter-fade_240ms_ease-out_backwards]", className)}
      style={{ animationDelay: `${index * HUB_STAGGER_MS}ms` }}
    >
      <div className="mb-2.5 flex min-h-11 items-center gap-2 px-0.5">
        <h2 id={`hub-${id}-title`} className="text-muted-foreground min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[0.06em] uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** «Barchasi →» style link look for a section header (44 px tall target). */
export const SECTION_LINK_CLASS =
  "text-accent-soft-foreground hover:bg-accent-soft focus-visible:ring-ring -mr-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2.5 text-[14.5px] font-semibold outline-none focus-visible:ring-2";
