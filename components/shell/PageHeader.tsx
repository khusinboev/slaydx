"use client";

import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { BackLink } from "@/components/nav/BackLink";
import { cn } from "@/lib/cn";

/**
 * Icon button for page headers (redesign F0): 44 × 44 px target, 14 px radius,
 * visible keyboard ring. Use it in `PageHeader actions` (search, bell, theme…).
 */
export const HEADER_ICON_CLASS =
  "text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center rounded-[14px] outline-none transition-colors focus-visible:ring-2";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  /** Accessible name (Uzbek); also the tooltip unless `title` is given. */
  label: string;
};

export const HeaderIconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function HeaderIconButton(
  { label, className, title, type, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={title ?? label}
      className={cn(HEADER_ICON_CLASS, className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export type PageHeaderProps = {
  /** Large page title (24 px, -0.02em). Rendered as the page's `<h1>`. */
  title: ReactNode;
  subtitle?: ReactNode;
  /**
   * Show «←» (steps, sub pages). Tab roots have none. It is a `BackLink`:
   * back when the previous entry is in-app, else REPLACE with `backFallback`
   * (default: the route's parent from `lib/nav/parents.ts`).
   */
  back?: boolean;
  backFallback?: string;
  /** Right-hand slot: `HeaderIconButton`s, a chip … */
  actions?: ReactNode;
  /** Content width of the header row; match the page body (default `max-w-3xl`). */
  contentClassName?: string;
  className?: string;
};

/** `#main` scrolled past this many px: the sticky header gets its background. */
const SCROLLED_PX = 4;

/**
 * Page header of the bottom-tab shell (docs/redesign/PLAN.md, F0).
 *
 * Sticky at the top of `<main id="main">`. The shell already keeps the page
 * below the notch / Telegram header (its top strip is `--shell-topbar-h` =
 * `TOP_INSET`), so the header adds no inset of its own. Transparent at the top
 * of the page; once `#main` scrolls it gets a translucent page background,
 * a blur and a hairline (`data-scrolled`).
 */
export function PageHeader({
  title,
  subtitle,
  back,
  backFallback,
  actions,
  contentClassName = "max-w-3xl",
  className,
}: PageHeaderProps) {
  const scrolled = useMainScrolled();
  return (
    <header
      data-page-header
      data-scrolled={scrolled ? "" : undefined}
      className={cn(
        "sticky top-0 z-20 shrink-0 border-b border-transparent transition-[background-color,border-color] duration-200 motion-reduce:transition-none",
        scrolled && "border-border/70 bg-[var(--page-bg)]/90 backdrop-blur-md",
        className,
      )}
    >
      <div className={cn("mx-auto flex min-h-16 w-full items-center gap-2 px-4 py-2.5", contentClassName)}>
        {back ? (
          <BackLink
            fallback={backFallback}
            data-page-header-back
            className={cn(HEADER_ICON_CLASS, "-ml-2")}
          >
            <ArrowLeft className="size-5" aria-hidden />
          </BackLink>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="text-foreground truncate text-[24px] leading-tight font-bold tracking-[-0.02em]">{title}</h1>
          {subtitle ? <p className="text-muted-foreground mt-0.5 truncate text-[13.5px] leading-snug">{subtitle}</p> : null}
        </div>
        {actions ? (
          <div data-page-header-actions className="-mr-1.5 flex shrink-0 items-center gap-1">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** `true` once the page scroller (`#main`) is scrolled down a little. */
function useMainScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const read = () => setScrolled(main.scrollTop > SCROLLED_PX);
    read();
    main.addEventListener("scroll", read, { passive: true });
    return () => main.removeEventListener("scroll", read);
  }, []);
  return scrolled;
}
