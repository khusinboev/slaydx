"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ApiError, adminErrorMessage } from "@/lib/admin-api/core";
import { BRAND_NAME } from "@/lib/brand";

/** Centered card used by the login and enrollment pages (no panel shell, no nav). */
export function AuthCard({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <main id="main" className="bg-background text-foreground grid min-h-dvh place-items-center px-4 py-8">
      <div className="bg-card flex w-full max-w-[420px] flex-col gap-4 rounded-2xl border px-5 py-6 shadow-sm sm:px-6">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold"
          >
            {BRAND_NAME.charAt(0)}
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <h1 className="text-[15px] font-semibold">{BRAND_NAME} Admin</h1>
            <p className="text-muted-foreground text-xs">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

/** Generic "wrong code" text: the server never says which part was wrong (plan §3.3). */
export const BAD_CODE_TEXT = "Kod noto'g'ri";
export const NOT_ENROLLED_TEXT =
  "Ikki bosqichli himoya hali sozlanmagan. Egasidan ro'yxatdan o'tish havolasini so'rang.";
export const ADMIN_DISABLED_TEXT = "Admin panelga kirish vaqtincha o'chirilgan. Birozdan keyin urinib ko'ring.";

export type AuthFailure =
  | { kind: "message"; text: string }
  /** 429: wait `seconds` before the next attempt. */
  | { kind: "locked"; seconds: number };

/** Maps an auth API error to what the form shows (never the raw text of unexpected errors). */
export function authFailure(e: unknown): AuthFailure {
  if (e instanceof ApiError) {
    const code = typeof e.data.code === "string" ? e.data.code : undefined;
    if (e.status === 429) return { kind: "locked", seconds: e.retryAfterSec ?? 60 };
    if (e.status === 401 && code === "bad_code") return { kind: "message", text: BAD_CODE_TEXT };
    if (e.status === 409 && code === "not_enrolled") return { kind: "message", text: NOT_ENROLLED_TEXT };
    if (e.status === 503 && code === "admin_disabled") return { kind: "message", text: ADMIN_DISABLED_TEXT };
  }
  return { kind: "message", text: adminErrorMessage(e) };
}

/** Seconds left of a lockout, ticking down once per second; 0 when there is none. */
export function useCountdown(seconds: number, startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((startedAt + seconds * 1000 - now) / 1000));
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left]);
  return left;
}

/** `mm:ss` for a countdown. */
export function fmtCountdown(sec: number): string {
  const s = Math.max(0, Math.trunc(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The 429 message with a live countdown; calls `onDone` once it reaches zero. */
export function LockoutNotice({ seconds, startedAt, onDone }: { seconds: number; startedAt: number; onDone: () => void }) {
  const left = useCountdown(seconds, startedAt);
  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);
  return (
    <p role="alert" className="text-destructive text-[13px]">
      Juda ko&apos;p noto&apos;g&apos;ri urinish. Qayta urinish{" "}
      <span className="font-semibold tabular-nums" data-countdown>
        {fmtCountdown(left)}
      </span>{" "}
      dan keyin mumkin.
    </p>
  );
}

/** Inline error under a code input. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-destructive text-[13px]">
      {children}
    </p>
  );
}

export const CODE_INPUT_CLASS =
  "border-input bg-card focus:ring-ring h-12 w-full rounded-lg border px-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:ring-2 disabled:opacity-60";
