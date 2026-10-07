"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, LogIn, UserRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUi } from "@/lib/ui";

/*
 * Shared pieces of the profile screens (redesign W4, variant A «Iliq»):
 * 20 px groups of 54 px rows, an icon chip per row, a value hint on the
 * right. Colours come from the theme tokens; `--accent-soft` (F0) has a
 * literal fallback per theme so the chips look right before it lands.
 */

/** Soft amber tint (icon chips, avatar ring, selected option). */
export const ACCENT_SOFT = "bg-[var(--accent-soft,#fdecc8)] dark:bg-[var(--accent-soft,rgba(245,158,11,0.16))]";
/** Ink on the soft tint: #8a5300 is 5.9:1 on #fdecc8; #fbbf24 on the dark tint 8:1. */
export const ACCENT_INK = "text-[#8a5300] dark:text-[#fbbf24]";

export const ROW_CLASS =
  "flex min-h-[54px] w-full items-center gap-3 px-3.5 py-2 text-left outline-none transition-colors duration-150 hover:bg-muted/60 active:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary motion-reduce:transition-none";

export const PRIMARY_BUTTON =
  "bg-primary text-primary-foreground inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] px-5 text-[16px] font-semibold outline-none transition-[filter,transform] duration-150 hover:brightness-105 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100";

export function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-muted-foreground mx-0.5 mt-6 mb-2.5 text-[13px] font-semibold tracking-[0.06em] uppercase">
      {children}
    </h2>
  );
}

export function Group({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="bg-card divide-border divide-y overflow-hidden rounded-[20px] border">
      {children}
    </ul>
  );
}

export function IconChip({ icon: Icon, tone = "accent" }: { icon: LucideIcon; tone?: "accent" | "danger" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[10px]",
        tone === "danger" ? "bg-destructive/10 text-destructive" : cn(ACCENT_SOFT, ACCENT_INK),
      )}
    >
      <Icon className="size-[17px]" strokeWidth={2.1} />
    </span>
  );
}

function RowInner({ icon, label, hint, tone }: { icon: LucideIcon; label: string; hint?: string; tone?: "accent" | "danger" }) {
  return (
    <>
      <IconChip icon={icon} tone={tone} />
      <span className={cn("min-w-0 flex-1 truncate text-[15.5px] font-medium", tone === "danger" && "text-destructive")}>{label}</span>
      {hint ? (
        <span data-row-hint className="text-muted-foreground max-w-[45%] shrink-0 truncate text-[14px]">
          {hint}
        </span>
      ) : null}
      <ChevronRight aria-hidden className="text-muted-foreground/70 size-[18px] shrink-0" />
    </>
  );
}

type RowProps = {
  id: string;
  icon: LucideIcon;
  label: string;
  hint?: string;
  href: string;
  tone?: "accent" | "danger";
  /** Plain click handler; call `preventDefault()` to navigate yourself. */
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
};

/**
 * One row of a group. Always a real link (open in a new tab, prefetch); a
 * plain click may be taken over by `onClick` (profile steps via `onNavigate`).
 */
export function RowLink({ id, icon, label, hint, href, tone, onClick }: RowProps) {
  return (
    <li>
      <Link
        href={href}
        data-profile-row={id}
        aria-label={hint ? `${label}: ${hint}` : label}
        className={ROW_CLASS}
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          onClick?.(e);
        }}
      >
        <RowInner icon={icon} label={label} hint={hint} tone={tone} />
      </Link>
    </li>
  );
}

/** Avatar: the Telegram photo when it loads, else the initial on amber. */
export function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [broken, setBroken] = useState<string | null>(null);
  const initial = name.trim().slice(0, 1).toUpperCase();
  const showPhoto = !!photoUrl && broken !== photoUrl;
  return (
    <span
      data-profile-avatar
      className="bg-primary text-primary-foreground flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[22px] text-[26px] font-bold"
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" onError={() => setBroken(photoUrl)} />
      ) : initial ? (
        <span aria-hidden>{initial}</span>
      ) : (
        <UserRound aria-hidden className="size-7" />
      )}
    </span>
  );
}

/** 4-segment progress of the «Sozlamalar» flow; segments up to the current step are filled. */
export function StepProgress({ index, total }: { index: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Sozlash bosqichi"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={index + 1}
      aria-valuetext={`${index + 1}-qadam, jami ${total}`}
      className="mb-5 flex gap-1.5"
    >
      {Array.from({ length: total }, (_, i) => (
        <i
          key={i}
          data-on={i <= index ? "" : undefined}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none",
            i <= index ? "bg-primary" : "bg-border",
          )}
        />
      ))}
    </div>
  );
}

/** Signed out: a friendly card with «Kirish» (login returns to `returnTo`). */
export function SignedOutCard({ returnTo }: { returnTo: string }) {
  const open = useUi((s) => s.open);
  return (
    <section data-profile-signed-out className="bg-card mt-2 rounded-[20px] border px-5 py-8 text-center">
      <span className={cn("mx-auto mb-4 flex size-16 items-center justify-center rounded-[22px]", ACCENT_SOFT, ACCENT_INK)}>
        <UserRound aria-hidden className="size-8" />
      </span>
      <h2 className="text-[19px] font-semibold">Hisobingizga kiring</h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-[34ch] text-[15px] leading-relaxed">
        Kirganingizdan keyin ismingiz, o&apos;qish va ish joyingiz har yangi ishga o&apos;zi qo&apos;yiladi.
      </p>
      <button type="button" onClick={() => open("login", { returnTo })} className={cn(PRIMARY_BUTTON, "mt-6 w-auto min-w-44")}>
        <LogIn aria-hidden className="size-[18px]" />
        Kirish
      </button>
    </section>
  );
}

export function ProfileSkeleton() {
  return (
    <div role="status" aria-label="Yuklanmoqda" className="animate-pulse motion-reduce:animate-none">
      <div className="flex items-center gap-3.5 py-2">
        <span className="bg-muted size-16 rounded-[22px]" />
        <span className="flex flex-col gap-2">
          <span className="bg-muted h-5 w-36 rounded-md" />
          <span className="bg-muted h-4 w-24 rounded-md" />
        </span>
      </div>
      <div className="bg-card mt-8 h-[218px] rounded-[20px] border" />
    </div>
  );
}
