"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { confirmEnroll, getEnrollInfo, type AdminEnrollInfo } from "@/lib/admin-api/auth";
import { Button, CopyButton, ErrorState, Skeleton } from "@/components/admin/ui";
import {
  ADMIN_DISABLED_TEXT,
  AuthCard,
  CODE_INPUT_CLASS,
  FormError,
  LockoutNotice,
  authFailure,
} from "./auth-common";
import { DEFAULT_ADMIN_PATH, roleLabel } from "./nav-registry";
import { RecoveryCodes } from "./RecoveryCodes";

const LINK_GONE_TEXT = "Havola yaroqsiz yoki muddati o'tgan. Egasidan yangi havola so'rang.";
const TOTP_LENGTH = 6;

type State =
  | { step: "loading" }
  | { step: "fatal"; message: string; retry: boolean }
  | { step: "scan"; info: AdminEnrollInfo }
  | { step: "codes"; codes: string[] };

/** An SVG string as an `<img>` source: rendered as an image, never injected as markup (T7). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** `ABCDEFGH...` -> `ABCD EFGH ...` for reading; the copy button copies the raw secret. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

function loadFailure(e: unknown): { message: string; retry: boolean } {
  if (e instanceof ApiError) {
    if (e.status === 404) return { message: LINK_GONE_TEXT, retry: false };
    if (e.status === 503) return { message: ADMIN_DISABLED_TEXT, retry: true };
  }
  return { message: adminErrorMessage(e), retry: true };
}

/**
 * S2 `/admin/enroll?token=`: scan the QR (or type the secret), confirm the
 * first code, then save the 10 recovery codes. "Davom etish" stays disabled
 * until "Saqladim" is ticked, because the codes are never shown again.
 */
export function EnrollForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<State>(() =>
    token ? { step: "loading" } : { step: "fatal", message: LINK_GONE_TEXT, retry: false },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    const ctl = new AbortController();
    getEnrollInfo(token, { signal: ctl.signal })
      .then((info) => setState({ step: "scan", info }))
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        setState({ step: "fatal", ...loadFailure(e) });
      });
    return () => ctl.abort();
  }, [token, attempt]);

  const retry = useCallback(() => {
    setState({ step: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <AuthCard subtitle="Ikki bosqichli himoyani sozlash">
      {state.step === "loading" ? (
        <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col items-center gap-3 py-2">
          <Skeleton className="size-48" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : state.step === "fatal" ? (
        <ErrorState message={state.message} onRetry={state.retry ? retry : undefined} />
      ) : state.step === "scan" ? (
        <ScanStep
          token={token ?? ""}
          info={state.info}
          onDone={(codes) => setState({ step: "codes", codes })}
          onGone={() => setState({ step: "fatal", message: LINK_GONE_TEXT, retry: false })}
        />
      ) : (
        <RecoveryCodes
          codes={state.codes}
          onContinue={() => {
            router.replace(DEFAULT_ADMIN_PATH);
            router.refresh();
          }}
        />
      )}
    </AuthCard>
  );
}

function ScanStep({
  token,
  info,
  onDone,
  onGone,
}: {
  token: string;
  info: AdminEnrollInfo;
  onDone: (codes: string[]) => void;
  onGone: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockout, setLockout] = useState<{ seconds: number; startedAt: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const clearLockout = useCallback(() => setLockout(null), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== TOTP_LENGTH || busy || lockout) return;
    setBusy(true);
    setError(null);
    try {
      const { recoveryCodes } = await confirmEnroll(token, code);
      if (mounted.current) onDone(recoveryCodes);
    } catch (err) {
      if (!mounted.current || isAbortError(err)) return;
      setBusy(false);
      setCode("");
      // Five wrong codes burn the link (plan §3.3): the server then answers 404.
      if (err instanceof ApiError && err.status === 404) return onGone();
      const f = authFailure(err);
      if (f.kind === "locked") setLockout({ seconds: f.seconds, startedAt: Date.now() });
      else setError(f.text);
      input.current?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px]">
        Rol: <b>{roleLabel(info.account.role)}</b>. Authenticator ilovasida (Google Authenticator, Aegis, 1Password va
        h.k.) QR kodni skanerlang yoki kalitni qo&apos;lda kiriting.
      </p>
      <div className="flex justify-center">
        {/* A data-URI image: the SVG cannot run script or touch the page (no raw HTML injection). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={svgDataUri(info.qrSvg)}
          alt="Authenticator ilovasi uchun QR kod"
          width={192}
          height={192}
          className="size-48 rounded-lg border bg-white p-2"
        />
      </div>
      <div className="bg-muted flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2">
        <span className="text-muted-foreground text-xs">Kalit:</span>
        <code data-secret className="min-w-0 flex-1 font-mono text-[13px] break-all">
          {groupSecret(info.secret)}
        </code>
        <CopyButton value={info.secret} label="Nusxa olish" />
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Ilovadagi 6 xonali kod
          <input
            ref={input}
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
        </label>
        {lockout ? (
          <LockoutNotice seconds={lockout.seconds} startedAt={lockout.startedAt} onDone={clearLockout} />
        ) : error ? (
          <FormError>{error}</FormError>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={code.length !== TOTP_LENGTH || Boolean(lockout)}
          className="w-full"
        >
          Tasdiqlash
        </Button>
      </form>
    </div>
  );
}
