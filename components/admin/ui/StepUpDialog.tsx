"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { adminErrorMessage, isAbortError, setStepUpHandler } from "@/lib/admin-api/core";
import { reauth } from "@/lib/admin-api/auth";
import { Button } from "./Button";
import { Modal } from "./Modal";

export const STEP_UP_CODE_LENGTH = 6;

export type StepUpDialogProps = {
  open: boolean;
  /** `confirmed` is true only after `onSubmit` resolved. */
  onClose: (confirmed: boolean) => void;
  /** Verifies the code; throw (an `ApiError`, ...) to show the message inline and keep the dialog open. */
  onSubmit: (code: string) => Promise<unknown>;
  title?: string;
  description?: ReactNode;
};

/** Re-authentication with a fresh 6-digit authenticator code (sensitive actions need one within 10 minutes). */
export function StepUpDialog(props: StepUpDialogProps) {
  if (!props.open) return null;
  return <StepUpBody {...props} />;
}

function StepUpBody({
  onClose,
  onSubmit,
  title = "Qayta tasdiqlash",
  description = "Bu amal muhim. Authenticator ilovasidagi 6 xonali kodni kiriting.",
}: StepUpDialogProps) {
  const formId = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // After `useDialog`'s own first-focus tick.
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const ready = code.length === STEP_UP_CODE_LENGTH;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(code);
      if (mounted.current) onClose(true);
    } catch (err) {
      if (!mounted.current || isAbortError(err)) return;
      setError(adminErrorMessage(err));
      setCode("");
      input.current?.focus();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => onClose(false)}
      title={title}
      description={description}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button onClick={() => onClose(false)} disabled={busy}>
            Bekor qilish
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!ready}>
            Tasdiqlash
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-2">
        <input
          ref={input}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, STEP_UP_CODE_LENGTH))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={STEP_UP_CODE_LENGTH}
          disabled={busy}
          aria-label="Tasdiqlash kodi"
          placeholder="000000"
          className="border-input bg-card focus:ring-ring h-12 w-full rounded-lg border px-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:ring-2 disabled:opacity-60"
        />
        {error ? (
          <p role="alert" className="text-destructive text-[13px]">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

/**
 * Registers the step-up dialog as the API core's `stepUpHandler`: when a request
 * gets 401 `reauth`, the dialog opens, and the request is retried once if the
 * code is accepted. Mount once in the admin layout, above every page.
 */
export function StepUpProvider({
  children,
  submit = reauth,
}: {
  children: ReactNode;
  /** Code verifier; defaults to `POST /api/admin/auth/reauth`. */
  submit?: (code: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    const dispose = setStepUpHandler(
      () =>
        new Promise<boolean>((resolve) => {
          // A second request while one dialog is open (core de-duplicates, but be safe).
          resolver.current?.(false);
          resolver.current = resolve;
          setOpen(true);
        }),
    );
    return () => {
      dispose();
      resolver.current?.(false);
      resolver.current = null;
    };
  }, []);

  const finish = useCallback((confirmed: boolean) => {
    setOpen(false);
    const r = resolver.current;
    resolver.current = null;
    r?.(confirmed);
  }, []);

  return (
    <>
      {children}
      <StepUpDialog open={open} onClose={finish} onSubmit={submit} />
    </>
  );
}
