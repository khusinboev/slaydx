"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { adminErrorMessage, AdminReauthCancelledError, isAbortError } from "@/lib/admin-api/core";
import { createInviteLink } from "@/lib/admin-api/bonus";
import { FIELD } from "./AmountFields";
import { checkInviteText } from "./format";

/**
 * «Taklif havolasi»: optional `https://t.me/+…` for private channels (the bot's «Obuna bo'lish»
 * button uses it when the channel has no @username). «Havola yaratish» asks Telegram for a new
 * link through the bot (it needs the invite-link admin right) and fills the field.
 */
export function InviteLinkField({
  value,
  onChange,
  chatRef,
  needed,
}: {
  value: string;
  onChange: (next: string) => void;
  /** `@username` or the numeric chat id the bot creates the link for. */
  chatRef: string;
  /** The channel has no public username: without a link users cannot open it. */
  needed: boolean;
}) {
  const ids = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const check = checkInviteText(value);

  async function generate() {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(true);
    setError(null);
    try {
      const r = await createInviteLink(chatRef, { signal: c.signal });
      onChange(r.inviteLink);
    } catch (e) {
      if (isAbortError(e) || c.signal.aborted || e instanceof AdminReauthCancelledError) return;
      setError(adminErrorMessage(e));
    } finally {
      if (ctl.current === c) setBusy(false);
    }
  }

  const hint = !check.ok
    ? check.error
    : needed && !check.value
      ? "Yopiq kanal: havolasiz foydalanuvchi kanalga kira olmaydi"
      : "Ixtiyoriy. Kanalda @username bo'lmasa, bot shu havolani beradi.";

  return (
    <div className="flex flex-col gap-1.5 text-[12.5px]">
      <label htmlFor={`${ids}-invite`} className="font-semibold">
        Taklif havolasi
      </label>
      <div className="flex gap-2">
        <input
          id={`${ids}-invite`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://t.me/+…"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!check.ok}
          aria-describedby={`${ids}-invite-hint`}
          className={cn(FIELD, "flex-1")}
        />
        <Button onClick={() => void generate()} loading={busy} icon={<Link2 className="size-4" aria-hidden="true" />} className="h-10">
          Havola yaratish
        </Button>
      </div>
      <span
        id={`${ids}-invite-hint`}
        className={cn("text-xs", !check.ok ? "text-destructive" : needed && !check.value ? "text-badge-warning-text font-medium" : "text-muted-foreground")}
      >
        {hint}
      </span>
      {error ? (
        <p role="alert" className="text-destructive text-[13px]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
