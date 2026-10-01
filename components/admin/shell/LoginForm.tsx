"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { isAbortError } from "@/lib/admin-api/core";
import { login, loginWithRecovery } from "@/lib/admin-api/auth";
import { Button } from "@/components/admin/ui";
import { AuthCard, CODE_INPUT_CLASS, FormError, LockoutNotice, authFailure, type AuthFailure } from "./auth-common";
import { sanitizeAdminNext } from "./nav-registry";

const TOTP_LENGTH = 6;
// Recovery codes look like `XXXX-XXXX-XX`; the server normalises case and dashes.
const RECOVERY_MAX = 16;
const RECOVERY_SYMBOLS = 10;

type Mode = "totp" | "recovery";
type Lockout = { seconds: number; startedAt: number };

/**
 * S1 `/admin/login`: the second factor. The visitor is already signed in to
 * the site (factor 1); here they enter a 6-digit authenticator code or,
 * via the toggle, a one-time recovery code. On success the browser goes to
 * the sanitised `next` path.
 */
export function LoginForm({ next, userName }: { next: string; userName: string }) {
  const router = useRouter();
  const formId = useId();
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockout, setLockout] = useState<Lockout | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    input.current?.focus();
  }, [mode]);

  const clearLockout = useCallback(() => setLockout(null), []);

  const ready = mode === "totp" ? code.length === TOTP_LENGTH : code.replace(/[^0-9A-Z]/g, "").length === RECOVERY_SYMBOLS;

  function switchMode() {
    setMode((m) => (m === "totp" ? "recovery" : "totp"));
    setCode("");
    setError(null);
  }

  function fail(f: AuthFailure) {
    if (f.kind === "locked") {
      setError(null);
      setLockout({ seconds: f.seconds, startedAt: Date.now() });
    } else {
      setError(f.text);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy || lockout) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "totp") await login(code);
      else await loginWithRecovery(code.trim());
      if (!mounted.current) return;
      // The (panel) layout is server-rendered against the new cookie on arrival.
      router.replace(sanitizeAdminNext(next));
      router.refresh();
    } catch (err) {
      if (!mounted.current || isAbortError(err)) return;
      fail(authFailure(err));
      setCode("");
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <AuthCard subtitle="Ikki bosqichli kirish">
      <p className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-[13px]">
        1-qadam bajarilgan: siz Telegram orqali <b className="text-foreground">{userName}</b> sifatida kirgansiz.
      </p>
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          {mode === "totp" ? "2-qadam: authenticator ilovasidagi 6 xonali kod" : "Tiklash kodi"}
          {mode === "totp" ? (
            <input
              ref={input}
              key="totp"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, TOTP_LENGTH))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={TOTP_LENGTH}
              disabled={busy}
              placeholder="000000"
              aria-invalid={error ? true : undefined}
              className={CODE_INPUT_CLASS}
            />
          ) : (
            <input
              ref={input}
              key="recovery"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, "").slice(0, RECOVERY_MAX))}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={RECOVERY_MAX}
              disabled={busy}
              placeholder="XXXX-XXXX-XX"
              aria-invalid={error ? true : undefined}
              className="border-input bg-card focus:ring-ring h-12 w-full rounded-lg border px-3 text-center font-mono text-lg tracking-[0.15em] outline-none focus:ring-2 disabled:opacity-60"
            />
          )}
        </label>
        {lockout ? (
          <LockoutNotice seconds={lockout.seconds} startedAt={lockout.startedAt} onDone={clearLockout} />
        ) : error ? (
          <FormError>{error}</FormError>
        ) : null}
        <Button type="submit" variant="primary" loading={busy} disabled={!ready || Boolean(lockout)} className="w-full">
          Kirish
        </Button>
      </form>
      <Button variant="ghost" onClick={switchMode} disabled={busy} className="w-full">
        {mode === "totp" ? "Tiklash kodi bilan kirish" : "Authenticator kodi bilan kirish"}
      </Button>
      <p className="text-muted-foreground text-center text-xs">
        5 marta xato kiritilsa, kirish 15 daqiqaga bloklanadi. Har bir kirish haqida Telegram&apos;ga xabar keladi.
      </p>
    </AuthCard>
  );
}
