"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { adminErrorMessage, isAbortError, newIdempotencyKey } from "@/lib/admin-api/core";
import { Button } from "./Button";
import { Modal } from "./Modal";

export type ConfirmContext = {
  /** Trimmed reason ("" when the dialog has no reason field). */
  reason: string;
  /** Generated once per dialog open; a retry after an error reuses it, so the server can de-duplicate. */
  idempotencyKey: string;
};

export type ReasonConfig = {
  /** Minimum trimmed length (the API requires 5..500). */
  minLength?: number;
  /** `false` makes the field optional (the API row says "reason optional"). Default `true`. */
  required?: boolean;
  label?: string;
};

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** What the action targets (user, order id, ...). */
  target?: ReactNode;
  /** "Before -> after" summary; shown only when both are given. */
  before?: ReactNode;
  after?: ReactNode;
  /** Extra form fields (e.g. the wallet amount) rendered above the reason. */
  children?: ReactNode;
  reason?: false | ReasonConfig;
  /** The user must type exactly this string to enable the confirm button (large money, bulk actions). */
  typedConfirmation?: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Lets the parent veto the button for its own fields. */
  confirmDisabled?: boolean;
  /** Throw to keep the dialog open and show the message inline. */
  onConfirm: (ctx: ConfirmContext) => Promise<void> | void;
};

const REASON_MAX = 500;
const DEFAULT_MIN = 5;

/**
 * Confirmation for every mutating admin action: target, before -> after,
 * reason (audited), optional typed confirmation, in-flight lock, inline error.
 * The body is mounted only while open, so every open starts with fresh state
 * and a fresh idempotency key.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null;
  return <ConfirmBody {...props} />;
}

function ConfirmBody({
  onClose,
  title,
  description,
  target,
  before,
  after,
  children,
  reason: reasonCfg = false,
  typedConfirmation,
  danger = false,
  confirmLabel = "Tasdiqlash",
  cancelLabel = "Bekor qilish",
  confirmDisabled = false,
  onConfirm,
}: ConfirmDialogProps) {
  const formId = useId();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const firstField = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `useDialog` focuses the first button/input after a tick; the reason / typed field is the better target.
  useEffect(() => {
    const t = setTimeout(() => firstField.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const hasReason = reasonCfg !== false;
  const cfg: ReasonConfig = reasonCfg === false ? {} : reasonCfg;
  const minLength = cfg.required === false ? 0 : (cfg.minLength ?? DEFAULT_MIN);
  const trimmed = reason.trim();
  const reasonOk = !hasReason || (trimmed.length >= minLength && trimmed.length <= REASON_MAX);
  const typedOk = typedConfirmation === undefined || typed.trim() === typedConfirmation;
  const ready = reasonOk && typedOk && !confirmDisabled;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reason: hasReason ? trimmed : "", idempotencyKey });
      if (mounted.current) onClose();
    } catch (err) {
      if (!mounted.current || isAbortError(err)) return;
      setError(adminErrorMessage(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const shortBy = minLength - trimmed.length;
  const reasonHint =
    cfg.required === false
      ? "Ixtiyoriy. Audit jurnaliga yoziladi."
      : shortBy > 0
        ? `Audit jurnaliga yoziladi. Yana kamida ${shortBy} belgi kerak.`
        : "Audit jurnaliga yoziladi.";

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={danger ? "danger" : "primary"}
            loading={busy}
            disabled={!ready}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3">
        {target ? <div className="text-[13px] font-medium">{target}</div> : null}
        {before !== undefined && after !== undefined ? (
          <div className="bg-muted flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[13px] tabular-nums">
            <span>
              <span className="sr-only">Oldin: </span>
              {before}
            </span>
            <ArrowRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
            <span className="font-semibold">
              <span className="sr-only">Keyin: </span>
              {after}
            </span>
          </div>
        ) : null}
        {children}
        {hasReason ? (
          <div className="flex flex-col gap-1.5 text-[12.5px]">
            <label htmlFor={`${formId}-reason`} className="font-semibold">
              {cfg.label ?? "Sabab"}
            </label>
            <textarea
              id={`${formId}-reason`}
              ref={(el) => {
                firstField.current = el;
              }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={REASON_MAX}
              disabled={busy}
              aria-describedby={`${formId}-hint`}
              className="border-input bg-card focus:ring-ring w-full resize-y rounded-lg border px-2.5 py-2 text-[13px] outline-none focus:ring-2 disabled:opacity-60"
            />
            <span id={`${formId}-hint`} className="text-muted-foreground text-xs">
              {reasonHint}
            </span>
          </div>
        ) : null}
        {typedConfirmation !== undefined ? (
          <div className="flex flex-col gap-1.5 text-[12.5px]">
            <label htmlFor={`${formId}-typed`} className="font-semibold">
              Tasdiqlash uchun <span className="font-mono">{typedConfirmation}</span> deb yozing
            </label>
            <input
              id={`${formId}-typed`}
              ref={(el) => {
                if (!hasReason) firstField.current = el;
              }}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 font-mono text-[13px] outline-none focus:ring-2 disabled:opacity-60"
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-[13px]">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
