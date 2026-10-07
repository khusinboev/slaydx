"use client";

import { LogIn } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";

/**
 * Signed-out Bosh: a friendly login card instead of «Davom ettirish». The
 * tools above and below stay browsable (their links open the login over the
 * tool with `returnTo`); this button opens the plain login.
 */
export function SignedOutCard({ onLogin }: { onLogin: () => void }) {
  return (
    <div
      data-hub-signed-out
      className="text-hero-foreground relative overflow-hidden rounded-[var(--radius-card)] bg-[image:var(--hero)] p-5 shadow-[var(--shadow-card)]"
    >
      <p className="text-[18px] leading-snug font-bold">{BRAND_NAME}’ga xush kelibsiz</p>
      <p className="mt-1 text-[14.5px] leading-snug opacity-85">
        Kiring — slayd, referat, insho va boshqa ishlaringiz shu yerda saqlanadi va istalgan qurilmada ochiladi.
      </p>
      <button
        type="button"
        data-hub-login
        onClick={onLogin}
        className="bg-[var(--page-bg)] text-foreground focus-visible:ring-ring mt-4 inline-flex h-12 items-center gap-2 rounded-2xl px-5 text-[15.5px] font-semibold shadow-sm outline-none hover:opacity-95 focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        <LogIn className="size-[18px]" aria-hidden />
        Kirish
      </button>
    </div>
  );
}
