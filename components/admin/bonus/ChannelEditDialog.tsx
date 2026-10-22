"use client";

import { useId, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, ConfirmDialog, toast } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { adminErrorMessage, AdminReauthCancelledError, isAbortError } from "@/lib/admin-api/core";
import { refreshBonusChannel, updateBonusChannel, type BonusChannel, type BonusChannelPatch } from "@/lib/admin-api/bonus";
import { AmountFields, FIELD } from "./AmountFields";
import { InviteLinkField } from "./InviteLinkField";
import { MandatoryField } from "./MandatoryField";
import { amountsDraft, bonusText, checkAmounts, checkIntText, checkInviteText, checkTitle, checkUsernameText, MAX_SORT, type AmountsDraft } from "./format";

export type ChannelEditDialogProps = {
  /** The channel being edited; `null` keeps the dialog closed. */
  item: BonusChannel | null;
  onClose: () => void;
  onSaved: (item: BonusChannel) => void;
  /** «Telegramdan yangilash» stored a new username: the list and this dialog take the fresh row (the dialog stays open). */
  onRefreshed: (item: BonusChannel) => void;
};

/**
 * Edits title, username, amounts, stay days, order and active. Only the changed fields are sent
 * (and audited); the reason is optional. The step-up code is asked by the admin API core when the
 * server needs it. A new username (the channel owner renamed the channel) is checked by the server
 * to be the SAME Telegram chat; «Telegramdan yangilash» takes Telegram's current username at once.
 */
export function ChannelEditDialog(props: ChannelEditDialogProps) {
  if (!props.item) return null;
  return <Body key={props.item.id} {...props} item={props.item} />;
}

const usernameText = (u: string | null) => (u ? `@${u}` : "");

function Body({ item, onClose, onSaved, onRefreshed }: ChannelEditDialogProps & { item: BonusChannel }) {
  const ids = useId();
  const [title, setTitle] = useState(item.title);
  const [username, setUsername] = useState(usernameText(item.username));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<{ text: string; warning: string | null } | null>(null);
  const [invite, setInvite] = useState(item.inviteLink ?? "");
  const [amounts, setAmounts] = useState<AmountsDraft>(() => amountsDraft(item));
  const [sort, setSort] = useState(String(item.sort));
  const [active, setActive] = useState(item.active);
  const [mandatory, setMandatory] = useState(item.mandatory);

  const titleCheck = checkTitle(title);
  const usernameCheck = checkUsernameText(username);
  const inviteCheck = checkInviteText(invite);
  const amountsCheck = checkAmounts(amounts, mandatory);
  const sortCheck = checkIntText(sort, -MAX_SORT, MAX_SORT, "Tartib");

  const patch: BonusChannelPatch = {};
  if (titleCheck.ok && titleCheck.value !== item.title) patch.title = titleCheck.value;
  // Case only is no change (Telegram usernames are case-insensitive; the server says the same).
  if (usernameCheck.ok && (usernameCheck.value?.toLowerCase() ?? null) !== (item.username?.toLowerCase() ?? null)) patch.username = usernameCheck.value;
  if (inviteCheck.ok && inviteCheck.value !== item.inviteLink) patch.inviteLink = inviteCheck.value;
  if (amountsCheck.ok) {
    if (amountsCheck.value.joinBonus !== item.joinBonus) patch.joinBonus = amountsCheck.value.joinBonus;
    if (amountsCheck.value.stayBonus !== item.stayBonus) patch.stayBonus = amountsCheck.value.stayBonus;
    if (amountsCheck.value.stayDays !== item.stayDays) patch.stayDays = amountsCheck.value.stayDays;
  }
  if (sortCheck.ok && sortCheck.value !== item.sort) patch.sort = sortCheck.value;
  if (active !== item.active) patch.active = active;
  if (mandatory !== item.mandatory) patch.mandatory = mandatory;
  // A private channel (no username) is reachable only through its invite link: clearing the username needs one.
  const privateNoLink = usernameCheck.ok && usernameCheck.value === null && item.username !== null && inviteCheck.ok && inviteCheck.value === null;
  const valid = titleCheck.ok && usernameCheck.ok && !privateNoLink && inviteCheck.ok && amountsCheck.ok && sortCheck.ok;

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const r = await refreshBonusChannel(item.id);
      setUsername(usernameText(r.item.username));
      const where = r.item.username ? `@${r.item.username}` : "yopiq kanal";
      const head = r.changed ? `Username yangilandi: ${where}.` : `O'zgarish yo'q — Telegramdagi bilan bir xil (${where}).`;
      setRefreshNote({ text: `${head} Telegramdagi nomi: «${r.telegramTitle}».`, warning: r.warning });
      toast(r.changed ? `Username yangilandi: ${where}` : "O'zgarish yo'q — Telegramdagi bilan bir xil");
      if (r.warning) toast(r.warning, { tone: "error" });
      if (r.changed) onRefreshed(r.item);
    } catch (e) {
      if (!isAbortError(e) && !(e instanceof AdminReauthCancelledError)) toast(adminErrorMessage(e), { tone: "error" });
    } finally {
      setRefreshing(false);
    }
  }
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

      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <label htmlFor={`${ids}-username`} className="font-semibold">
          Username
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={`${ids}-username`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="yopiq kanal"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!usernameCheck.ok || privateNoLink}
            aria-describedby={`${ids}-username-hint`}
            className={cn(FIELD, "min-w-0 flex-1")}
          />
          <Button onClick={() => void refresh()} loading={refreshing} icon={<RefreshCw className="size-4" aria-hidden="true" />} className="h-10">
            Telegramdan yangilash
          </Button>
        </div>
        <span id={`${ids}-username-hint`} className={cn("text-xs", usernameCheck.ok && !privateNoLink ? "text-muted-foreground" : "text-destructive")}>
          {!usernameCheck.ok
            ? usernameCheck.error
            : privateNoLink
              ? "Yopiq kanal uchun avval taklif havolasini kiriting — aks holda foydalanuvchilar obuna bo'la olmaydi"
              : "Kanal egasi username'ni o'zgartirsa, yangisini kiriting yoki «Telegramdan yangilash»ni bosing. Bonus olganlar ro'yxati saqlanadi."}
        </span>
        {refreshNote ? (
          <p role="status" data-refresh-note className="text-xs">
            {refreshNote.text}
            {refreshNote.warning ? <span className="text-badge-warning-text block font-medium">{refreshNote.warning}</span> : null}
          </p>
        ) : null}
      </div>

      <InviteLinkField value={invite} onChange={setInvite} chatRef={item.username ? `@${item.username}` : item.chatId} needed={!item.username || (usernameCheck.ok && usernameCheck.value === null)} />

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
