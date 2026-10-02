"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { BROADCAST_TEXT_MAX, createBroadcast, type AudienceKind } from "@/lib/admin-api/broadcasts";
import { fmtNumber } from "@/lib/admin-format";
import { Button, Modal, toast } from "@/components/admin/ui";
import { AudienceCount, AudiencePicker, audienceFrom, useAudienceCount } from "./AudiencePicker";
import { textLength } from "./shared";

/**
 * "Yangi xabar": text with a character counter and the audience with its live
 * recipient count. Saving creates a DRAFT (nothing is sent); the test send and
 * the real send are done from the draft's page, where the saved text is what
 * gets sent. The body mounts only while open, so every open starts empty.
 */
export function BroadcastEditor({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  if (!open) return null;
  return <EditorBody onClose={onClose} onCreated={onCreated} />;
}

function EditorBody({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const formId = useId();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<AudienceKind>("all");
  const [daysText, setDaysText] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const area = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    const t = setTimeout(() => area.current?.focus(), 0);
    return () => {
      mounted.current = false;
      clearTimeout(t);
    };
  }, []);

  const audience = audienceFrom(kind, daysText);
  const count = useAudienceCount(audience);
  const length = textLength(text);
  const tooLong = length > BROADCAST_TEXT_MAX;
  const ready = length >= 1 && !tooLong && audience !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy || !audience) return;
    setBusy(true);
    setError(null);
    try {
      const { broadcast } = await createBroadcast({ text: text.trim(), audience });
      toast("Qoralama saqlandi");
      onCreated(broadcast.id);
      if (mounted.current) onClose();
    } catch (err) {
      if (mounted.current && !isAbortError(err)) setError(adminErrorMessage(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Yangi xabar"
      description="Avval qoralama sifatida saqlanadi. Keyin o'zingizga sinov yuborib, so'ng hammaga jo'natasiz."
      size="lg"
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Bekor qilish
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!ready}>
            Qoralamani saqlash
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-text`} className="flex items-baseline justify-between text-[12.5px] font-semibold">
            <span>Matn</span>
            <span className={tooLong ? "text-destructive font-normal tabular-nums" : "text-muted-foreground font-normal tabular-nums"} aria-live="polite">
              {fmtNumber(length)} / {fmtNumber(BROADCAST_TEXT_MAX)}
            </span>
          </label>
          <textarea
            id={`${formId}-text`}
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            disabled={busy}
            aria-invalid={tooLong}
            aria-describedby={`${formId}-hint`}
            className="border-input bg-card focus:ring-ring w-full resize-y rounded-lg border px-2.5 py-2 text-[13px] outline-none focus:ring-2 disabled:opacity-60"
          />
          <span id={`${formId}-hint`} className="text-muted-foreground text-xs">
            Oddiy matn: &lt; &gt; &amp; belgilari Telegramga xavfsiz yuboriladi, formatlash ishlamaydi.
          </span>
        </div>
        <AudiencePicker kind={kind} daysText={daysText} onKindChange={setKind} onDaysChange={setDaysText} disabled={busy} />
        <AudienceCount state={count} />
        {error ? (
          <p role="alert" className="text-destructive text-[13px]">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
