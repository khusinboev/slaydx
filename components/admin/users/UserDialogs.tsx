"use client";

import { useId, useState, type ReactNode } from "react";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { ConfirmDialog, toast } from "@/components/admin/ui";
import { fmtNumber } from "@/lib/admin-format";
import { MESSAGE_MAX, messageUser, revokeUserSessions, setUserBlocked, type BlockSideEffects } from "@/lib/admin-api/users";

/** Who a dialog acts on, plus the counts the block dialog shows next to its options. */
export type UserTarget = {
  id: string;
  name: string;
  username: string | null;
  isBlocked: boolean;
  activeSessions: number;
  queuedJobs: number;
  activeGameLinks: number;
};

function TargetLine({ user }: { user: UserTarget }) {
  return (
    <span>
      {user.name || `#${user.id}`}
      <span className="text-muted-foreground">
        {user.username ? ` · @${user.username}` : ""} · #{user.id}
      </span>
    </span>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 text-[13px]">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary mt-0.5 size-4 shrink-0"
      />
      <label htmlFor={id} className="min-w-0">
        {children}
      </label>
    </div>
  );
}

function effectsText(e: BlockSideEffects): string {
  const parts = [
    e.sessionsRevoked ? `${fmtNumber(e.sessionsRevoked)} ta sessiya bekor qilindi` : "",
    e.jobsCancelled ? `${fmtNumber(e.jobsCancelled)} ta ish bekor qilindi (${fmtNumber(e.refunds)} tasining puli qaytarildi)` : "",
    e.linksRevoked ? `${fmtNumber(e.linksRevoked)} ta havola o'chirildi` : "",
  ].filter(Boolean);
  return parts.length ? `Bloklandi: ${parts.join(", ")}` : "Bloklandi";
}

/**
 * Block (with optional side effects, one server transaction) or unblock (the
 * flag only). The server re-checks self and admin targets.
 */
export function BlockDialog({ open, onClose, user, onDone }: { open: boolean; onClose: () => void; user: UserTarget; onDone: () => void }) {
  if (!open) return null;
  return user.isBlocked ? <UnblockBody onClose={onClose} user={user} onDone={onDone} /> : <BlockBody onClose={onClose} user={user} onDone={onDone} />;
}

function BlockBody({ onClose, user, onDone }: { onClose: () => void; user: UserTarget; onDone: () => void }) {
  const [revokeSessions, setRevokeSessions] = useState(true);
  const [cancelQueued, setCancelQueued] = useState(false);
  const [revokeLinks, setRevokeLinks] = useState(false);
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Foydalanuvchini bloklash"
      description="Foydalanuvchi keyingi so'rovidanoq tizimdan chiqariladi. Tanlangan amallar bloklash bilan bitta tranzaksiyada bajariladi."
      target={<TargetLine user={user} />}
      before="Faol"
      after="Bloklangan"
      danger
      confirmLabel="Bloklash"
      reason={{}}
      onConfirm={async ({ reason }) => {
        const res = await setUserBlocked(user.id, { blocked: true, reason, revokeSessions, cancelQueued, revokeLinks });
        toast(effectsText(res.sideEffects));
        onDone();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12.5px] font-semibold">Qo&apos;shimcha amallar</legend>
        <Check checked={revokeSessions} onChange={setRevokeSessions}>
          Barcha sessiyalarni bekor qilish <span className="text-muted-foreground tabular-nums">({fmtNumber(user.activeSessions)} ta faol)</span>
        </Check>
        <Check checked={cancelQueued} onChange={setCancelQueued}>
          Navbatdagi ishlarni bekor qilish va pulini qaytarish{" "}
          <span className="text-muted-foreground tabular-nums">({fmtNumber(user.queuedJobs)} ta)</span>
        </Check>
        <Check checked={revokeLinks} onChange={setRevokeLinks}>
          Ommaviy o&apos;yin havolalarini o&apos;chirish <span className="text-muted-foreground tabular-nums">({fmtNumber(user.activeGameLinks)} ta faol)</span>
        </Check>
      </fieldset>
    </ConfirmDialog>
  );
}

function UnblockBody({ onClose, user, onDone }: { onClose: () => void; user: UserTarget; onDone: () => void }) {
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Blokdan chiqarish"
      description="Foydalanuvchi yana tizimga kira oladi. Bekor qilingan sessiyalar, ishlar va havolalar qaytmaydi."
      target={<TargetLine user={user} />}
      before="Bloklangan"
      after="Faol"
      confirmLabel="Blokdan chiqarish"
      reason={{}}
      onConfirm={async ({ reason }) => {
        await setUserBlocked(user.id, { blocked: false, reason });
        toast("Blokdan chiqarildi");
        onDone();
      }}
    />
  );
}

/** Revokes every live session of the user (they are signed out everywhere). */
export function RevokeSessionsDialog({ open, onClose, user, onDone }: { open: boolean; onClose: () => void; user: UserTarget; onDone: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Sessiyalarni bekor qilish"
      description={`Foydalanuvchi barcha qurilmalardan chiqariladi (${fmtNumber(user.activeSessions)} ta faol sessiya).`}
      target={<TargetLine user={user} />}
      danger
      confirmLabel="Bekor qilish"
      cancelLabel="Yopish"
      reason={{}}
      onConfirm={async ({ reason }) => {
        const res = await revokeUserSessions(user.id, reason);
        toast(`${fmtNumber(res.revoked)} ta sessiya bekor qilindi`);
        onDone();
      }}
    />
  );
}

/** A direct Telegram message from the bot; the server escapes HTML and audits only the length. */
export function MessageDialog({ open, onClose, user }: { open: boolean; onClose: () => void; user: UserTarget }) {
  if (!open) return null;
  return <MessageBody onClose={onClose} user={user} />;
}

function MessageBody({ onClose, user }: { onClose: () => void; user: UserTarget }) {
  const id = useId();
  const [text, setText] = useState("");
  const trimmed = text.trim();
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Telegram orqali xabar"
      description="Bot nomidan yuboriladi. HTML belgilar xavfsiz holatga keltiriladi; audit jurnaliga faqat xabar uzunligi yoziladi."
      target={<TargetLine user={user} />}
      confirmLabel="Yuborish"
      confirmDisabled={trimmed.length < 1 || trimmed.length > MESSAGE_MAX}
      onConfirm={async () => {
        const res = await messageUser(user.id, trimmed);
        if (res.sent) toast("Xabar yuborildi");
        else toast("Xabar yetkazilmadi: foydalanuvchi botni bloklagan yoki bot sozlanmagan", { tone: "error" });
      }}
    >
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <label htmlFor={id} className="font-semibold">
          Xabar
        </label>
        <AutoTextarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          minRows={4}
          maxRows={12}
          maxLength={MESSAGE_MAX}
          className="border-input bg-card focus:ring-ring w-full rounded-lg border px-2.5 py-2 text-[13px] outline-none focus:ring-2"
        />
        <span className="text-muted-foreground text-xs tabular-nums">
          {fmtNumber(trimmed.length)} / {fmtNumber(MESSAGE_MAX)}
        </span>
      </div>
    </ConfirmDialog>
  );
}
