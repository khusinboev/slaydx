import { cn } from "@/lib/cn";
import type { ProgressKind } from "@/lib/progress-stages";

/**
 * Small looping illustration of what the tool is doing right now. Pure CSS (`slx-art-*` in
 * `app/globals.css`, switched off under `prefers-reduced-motion`): decorative only, the
 * percentage and stage list carry the information — hence `aria-hidden`.
 */
export function GenerationArt({ kind, className }: { kind: ProgressKind; className?: string }) {
  return (
    <div
      aria-hidden
      data-art={kind}
      className={cn("bg-primary/10 text-primary relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl sm:size-16", className)}
    >
      <Art kind={kind} />
    </div>
  );
}

function Art({ kind }: { kind: ProgressKind }) {
  switch (kind) {
    case "audio":
      return (
        <div className="flex h-8 items-center gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="slx-art-eq bg-primary block h-full w-1 origin-center rounded-full" style={{ animationDelay: `${i * 0.13}s` }} />
          ))}
        </div>
      );
    case "image":
    case "infographic":
      return (
        <div className="relative size-9 overflow-hidden rounded-md border-2 border-current/40">
          <span className="slx-art-sheen from-transparent via-current/50 to-transparent absolute inset-y-0 -left-full w-full bg-gradient-to-r" />
          <span className="absolute bottom-1 left-1 size-2 rounded-full bg-current/60" />
          <span className="absolute right-1 bottom-1 h-3 w-4 bg-current/40 [clip-path:polygon(0_100%,50%_0,100%_100%)]" />
        </div>
      );
    case "game":
      return (
        <div className="grid grid-cols-3 gap-0.5">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="slx-art-cell block size-2.5 rounded-sm bg-current" style={{ animationDelay: `${((i * 5) % 9) * 0.14}s` }} />
          ))}
        </div>
      );
    case "translation":
      return (
        <div className="flex items-center gap-1.5">
          <Lines widths={["w-4", "w-3", "w-4"]} />
          <span className="slx-art-cell text-sm leading-none font-bold">→</span>
          <Lines widths={["w-3", "w-4", "w-3"]} delay={0.5} />
        </div>
      );
    case "slides":
      return (
        <div className="slx-art-cell w-9 rounded-md border-2 border-current/50 p-1">
          <Lines widths={["w-full", "w-2/3"]} />
        </div>
      );
    default:
      // doc / essay / teacher / resume: text lines being written.
      return <Lines widths={["w-8", "w-6", "w-8", "w-5"]} large />;
  }
}

function Lines({ widths, delay = 0, large = false }: { widths: string[]; delay?: number; large?: boolean }) {
  return (
    <div className={cn("flex flex-col", large ? "gap-1.5" : "gap-1")}>
      {widths.map((w, i) => (
        <span
          key={i}
          className={cn("slx-art-write block origin-left rounded-full bg-current", large ? "h-1.5" : "h-1", w)}
          style={{ animationDelay: `${delay + i * 0.35}s` }}
        />
      ))}
    </div>
  );
}
