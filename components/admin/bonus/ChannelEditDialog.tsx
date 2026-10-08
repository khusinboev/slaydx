"use client";

import { useId, useState } from "react";
import { ConfirmDialog, toast } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { updateBonusChannel, type BonusChannel, type BonusChannelPatch } from "@/lib/admin-api/bonus";
import { AmountFields, FIELD } from "./AmountFields";
import { InviteLinkField } from "./InviteLinkField";
import { MandatoryField } from "./MandatoryField";
import { amountsDraft, bonusText, checkAmounts, checkIntText, checkInviteText, checkTitle, MAX_SORT, type AmountsDraft } from "./format";

export type ChannelEditDialogProps = {
  /** The channel being edited; `null` keeps the dialog closed. */
  item: BonusChannel | null;
  onClose: () => void;
  onSaved: (item: BonusChannel) => void;
};

/**
 * Edits title, amounts, stay days, order and active. Only the changed fields are sent (and
 * audited); the reason is optional. The step-up code is asked by the admin API core when the
 * server needs it.
 */
export function ChannelEditDialog(props: ChannelEditDialogProps) {
  if (!props.item) return null;
  return <Body key={props.item.id} {...props} item={props.item} />;
}

function Body({ item, onClose, onSaved }: ChannelEditDialogProps & { item: BonusChannel }) {
  const ids = useId();
  const [title, setTitle] = useState(item.title);
  const [invite, setInvite] = useState(item.inviteLink ?? "");
  const [amounts, setAmounts] = useState<AmountsDraft>(() => amountsDraft(item));
  const [sort, setSort] = useState(String(item.sort));
  const [active, setActive] = useState(item.active);
  const [mandatory, setMandatory] = useState(item.mandatory);

  const titleCheck = checkTitle(title);
  const inviteCheck = checkInviteText(invite);
  const amountsCheck = checkAmounts(amounts, mandatory);
  const sortCheck = checkIntText(sort, -MAX_SORT, MAX_SORT, "Tartib");

  const patch: BonusChannelPatch = {};
  if (titleCheck.ok && titleCheck.value !== item.title) patch.title = titleCheck.value;
  if (inviteCheck.ok && inviteCheck.value !== item.inviteLink) patch.inviteLink = inviteCheck.value;
  if (amountsCheck.ok) {
    if (amountsCheck.value.joinBonus !== item.joinBonus) patch.joinBonus = amountsCheck.value.joinBonus;
    if (amountsCheck.value.stayBonus !== item.stayBonus) patch.stayBonus = amountsCheck.value.stayBonus;
    if (amountsCheck.value.stayDays !== item.stayDays) patch.stayDays = amountsCheck.value.stayDays;
  }
  if (sortCheck.ok && sortCheck.value !== item.sort) patch.sort = sortCheck.value;
  if (active !== item.active) patch.active = active;
  if (mandatory !== item.mandatory) patch.mandatory = mandatory;
  const valid = titleCheck.ok && inviteCheck.ok && amountsCheck.ok && sortCheck.ok;
  const changed = Object.keys(patch).length > 0;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Kanalni tahrirlash"
      target={
        <span>
          {item.title} <span className="text-muted-foreground text-xs">{item.username ? `@${item.username}` : `ID ${item.chatId}`}</span>
        </span>
      }
      before={bonusText(item)}
      after={amountsCheck.ok ? bonusText(amountsCheck.value) : "—"}
      reason={{ required: false, label: "Sabab (ixtiyoriy)" }}
      confirmLabel="Saqlash"
      confirmDisabled={!valid || !changed}
      onConfirm={async ({ reason }) => {
        if (!valid || !changed) return;
        const { item: saved } = await updateBonusChannel(item.id, { ...patch, ...(reason ? { reason } : {}) });
        toast("Saqlandi");
        onSaved(saved);
      }}
    >
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
        {!titleCheck.ok ? <span className="text-destructive text-xs">{titleCheck.error}</span> : null}
      </div>

      <InviteLinkField value={invite} onChange={setInvite} chatRef={item.username ? `@${item.username}` : item.chatId} needed={!item.username} />

      <MandatoryField value={mandatory} onChange={setMandatory} />

      <AmountFields draft={amounts} onChange={setAmounts} error={amountsCheck.ok ? null : amountsCheck.error} />
      {item.stats.joined > 0 ? (
        <p className="text-muted-foreground text-xs">Yangi miqdor faqat bundan keyingi to&apos;lovlarga ta&apos;sir qiladi; berilgan bonuslar o&apos;zgarmaydi.</p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 text-[12.5px]">
          <label htmlFor={`${ids}-sort`} className="font-semibold">
            Tartib
          </label>
          <input
            id={`${ids}-sort`}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={!sortCheck.ok}
            className={FIELD}
          />
          <span className={cn("text-xs", sortCheck.ok ? "text-muted-foreground" : "text-destructive")}>
            {sortCheck.ok ? "Kichik raqam botda yuqorida turadi" : sortCheck.error}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 text-[12.5px]">
          <span id={`${ids}-active`} className="font-semibold">
            Holat
          </span>
          <div className="flex min-h-10 items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={active}
              aria-labelledby={`${ids}-active`}
              onClick={() => setActive((v) => !v)}
              className={cn(
                "focus-visible:ring-ring relative h-6 w-11 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2",
                active ? "border-primary bg-primary" : "border-input bg-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("bg-card absolute top-0.5 left-0.5 size-4.5 rounded-full shadow transition-transform", active ? "translate-x-5" : "translate-x-0")}
              />
            </button>
            <span className="text-[13px] font-medium">{active ? "Faol — botda ko'rinadi" : "O'chiq — botda ko'rinmaydi"}</span>
          </div>
        </div>
      </div>
    </ConfirmDialog>
  );
}
