"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { Button, ConfirmDialog, toast } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { createBonusChannel, resolveBonusChannel, type BonusChannel, type ResolvedChannel } from "@/lib/admin-api/bonus";
import { AmountFields, FIELD } from "./AmountFields";
import { BotBadge } from "./BotBadge";
import { InviteLinkField } from "./InviteLinkField";
import { MandatoryField } from "./MandatoryField";
import { amountsDraft, bonusText, checkAmounts, checkInviteText, checkTitle, defaultPreset, PRESETS, type AmountsDraft, type BotCheck, type PresetId } from "./format";

export type ChannelAddDialogProps = {
  open: boolean;
  /** How many channels exist: the first one defaults to the news-channel amounts. */
  existingCount: number;
  onClose: () => void;
  onCreated: (item: BonusChannel, bot: BotCheck) => void;
};

/**
 * «Kanal qo'shish»: paste `@username` / `t.me/<name>` / `-100…` → «Tekshirish» resolves it
 * through the Bot API (title, type, bot admin status, duplicate) → amounts with the owner's
 * defaults → save. The server resolves the chat again on save; the preview is only a preview.
 */
export function ChannelAddDialog(props: ChannelAddDialogProps) {
  if (!props.open) return null;
  return <Body {...props} />;
}

function Body({ existingCount, onClose, onCreated }: ChannelAddDialogProps) {
  const ids = useId();
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<{ q: string; data: ResolvedChannel } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetId>(() => defaultPreset(existingCount));
  const [amounts, setAmounts] = useState<AmountsDraft>(() => amountsDraft(PRESETS[defaultPreset(existingCount)]));
  const [title, setTitle] = useState("");
  const [invite, setInvite] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => () => ctl.current?.abort(), []);

  const q = input.trim();
  const current = preview && preview.q === q ? preview.data : null;
  const amountsCheck = checkAmounts(amounts, mandatory);
  const titleCheck = checkTitle(title);
  const inviteCheck = checkInviteText(invite);
  const ready = Boolean(current) && !current?.existingId && amountsCheck.ok && titleCheck.ok && inviteCheck.ok && !resolving;

  async function resolve() {
    if (!q || resolving) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setResolving(true);
    setResolveError(null);
    try {
      const data = await resolveBonusChannel(q, { signal: c.signal });
      setPreview({ q, data });
      setTitle(data.title);
    } catch (e) {
      if (isAbortError(e) || c.signal.aborted) return;
      setPreview(null);
      setResolveError(adminErrorMessage(e));
    } finally {
      if (ctl.current === c) setResolving(false);
    }
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void resolve();
    }
  }

  function choosePreset(id: PresetId) {
    setPreset(id);
    setAmounts(amountsDraft(PRESETS[id]));
  }

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Kanal qo'shish"
      description="Avval botni kanalga admin qilib qo'shing, keyin kanal manzilini kiriting."
      reason={{ required: false, label: "Sabab (ixtiyoriy)" }}
      confirmLabel="Qo'shish"
      confirmDisabled={!ready}
      onConfirm={async ({ reason }) => {
        if (!current || !amountsCheck.ok || !titleCheck.ok || !inviteCheck.ok) return;
        const r = await createBonusChannel({
          input: q,
          ...(titleCheck.value !== current.title ? { title: titleCheck.value } : {}),
          ...(inviteCheck.value ? { inviteLink: inviteCheck.value } : {}),
          ...amountsCheck.value,
          mandatory,
          ...(reason ? { reason } : {}),
        });
        toast(`«${r.item.title}» qo'shildi`);
        if (r.warning) toast(r.warning, { tone: "error" });
        onCreated(r.item, { status: r.botAdmin, warning: r.warning });
      }}
    >
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <label htmlFor={`${ids}-input`} className="font-semibold">
          Kanal manzili
        </label>
        <div className="flex gap-2">
          <input
            id={`${ids}-input`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="@kanal yoki https://t.me/kanal"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${ids}-input-hint`}
            className={cn(FIELD, "flex-1")}
          />
          <Button onClick={() => void resolve()} loading={resolving} disabled={!q} icon={<Search className="size-4" aria-hidden="true" />} className="h-10">
            Tekshirish
          </Button>
        </div>
        <span id={`${ids}-input-hint`} className="text-muted-foreground text-xs">
          @username, t.me havolasi yoki yopiq kanal uchun ID raqami (-100…)
        </span>
        {resolveError ? (
          <p role="alert" className="text-destructive text-[13px]">
            {resolveError}
          </p>
        ) : null}
      </div>

      {current ? (
        <div data-preview className="bg-muted/60 flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{current.title}</span>
            <span className="text-muted-foreground text-xs">
              {current.type === "channel" ? "Kanal" : "Superguruh"} · {current.username ? `@${current.username}` : `ID ${current.chatId}`}
            </span>
            <BotBadge check={{ status: current.botAdmin, warning: current.warning }} />
          </div>
          {current.warning ? <p className="text-badge-warning-text text-xs font-medium">{current.warning}</p> : null}
          {current.existingId ? (
            <p role="alert" className="text-destructive text-xs font-medium">
              Bu kanal allaqachon qo&apos;shilgan.
            </p>
          ) : null}
        </div>
      ) : null}

      {current ? (
        <>
          <div className="flex flex-col gap-1.5 text-[12.5px]">
            <label htmlFor={`${ids}-title`} className="font-semibold">
              Sarlavha
            </label>
            <input
              id={`${ids}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoComplete="off"
              aria-invalid={!titleCheck.ok}
              className={FIELD}
            />
            <span className={cn("text-xs", titleCheck.ok ? "text-muted-foreground" : "text-destructive")}>
              {titleCheck.ok ? "Botdagi vazifa nomi. Telegram'dagi nomdan farq qilishi mumkin." : titleCheck.error}
            </span>
          </div>

          <InviteLinkField value={invite} onChange={setInvite} chatRef={current.username ? `@${current.username}` : current.chatId} needed={!current.username} />

          <MandatoryField value={mandatory} onChange={setMandatory} />

          <div role="group" aria-label="Tayyor miqdorlar" className="flex flex-wrap gap-2">
            {(Object.keys(PRESETS) as PresetId[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={preset === id}
                onClick={() => choosePreset(id)}
                className={cn(
                  "focus-visible:ring-ring min-h-9 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-2",
                  preset === id ? "border-primary bg-primary/15 text-foreground" : "border-input text-muted-foreground hover:text-foreground",
                )}
              >
                {PRESETS[id].hint}
              </button>
            ))}
          </div>

          <AmountFields draft={amounts} onChange={setAmounts} error={amountsCheck.ok ? null : amountsCheck.error} />
          {amountsCheck.ok ? (
            <p className="text-muted-foreground text-xs">
              Foydalanuvchi oladi: <span className="text-foreground font-semibold tabular-nums">{bonusText(amountsCheck.value)}</span> ball
            </p>
          ) : null}
        </>
      ) : null}
    </ConfirmDialog>
  );
}
