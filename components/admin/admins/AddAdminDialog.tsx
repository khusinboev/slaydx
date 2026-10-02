"use client";

import { useId, useState } from "react";
import { createAdmin, type AdminAccountItem } from "@/lib/admin-api/admins";
import type { AdminRole } from "@/lib/admin-api/auth";
import { ConfirmDialog, Segmented } from "@/components/admin/ui";
import { roleLabel } from "@/components/admin/shell";
import type { EnrollLinkView } from "./EnrollLinkDialog";
import { ID_INPUT_RE, assignableRoles } from "./shared";

type IdKind = "telegramId" | "userId";

const ID_KINDS: ReadonlyArray<{ value: IdKind; label: string }> = [
  { value: "telegramId", label: "Telegram ID" },
  { value: "userId", label: "Foydalanuvchi ID" },
];

export type AddAdminProps = {
  open: boolean;
  onClose: () => void;
  actorRole: string;
  /** The server's 2FA switch: with it off there is no enrollment link (`link` is `null`). */
  twoFactor: boolean;
  onCreated: (created: { admin: AdminAccountItem; link: EnrollLinkView | null }) => void;
};

/**
 * "Admin qo'shish": a person who has already signed in to the site once (by
 * Telegram ID or user ID), a role strictly below the actor's rank (an owner may
 * add owners), a reason and an optional Telegram DM. The body is mounted only
 * while open (ConfirmDialog), so every open starts empty. The enrollment link is
 * handed to the parent through `onCreated` and shown once there; in simple mode
 * (2FA switch off) the account is active at once and `link` is `null`.
 */
export function AddAdminDialog({ open, ...rest }: AddAdminProps) {
  if (!open) return null;
  return <Body {...rest} />;
}

function Body({ onClose, actorRole, twoFactor, onCreated }: Omit<AddAdminProps, "open">) {
  const uid = useId();
  const roles = assignableRoles(actorRole);
  const [kind, setKind] = useState<IdKind>("telegramId");
  const [idText, setIdText] = useState("");
  const [role, setRole] = useState<AdminRole | "">("");
  const [send, setSend] = useState(false);
  const idOk = ID_INPUT_RE.test(idText.trim());

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Admin qo'shish"
      description={
        twoFactor
          ? "Shaxs saytga kamida bir marta Telegram orqali kirgan bo'lishi kerak. Hisob «kutilmoqda» holatida yaratiladi va ikki bosqichli himoyani o'zi sozlaydi."
          : "Shaxs saytga kamida bir marta Telegram orqali kirgan bo'lishi kerak. Hisob darhol faol bo'ladi: u saytdagi «Admin panel» tugmasi orqali kiradi."
      }
      reason={{ label: "Sabab (audit jurnaliga yoziladi)" }}
      confirmLabel="Admin qo'shish"
      confirmDisabled={!idOk || role === ""}
      onConfirm={async (ctx) => {
        const base = { role: role as AdminRole, reason: ctx.reason, ...(send ? { sendViaTelegram: true } : {}) };
        const body = kind === "telegramId" ? { telegramId: idText.trim(), ...base } : { userId: idText.trim(), ...base };
        const res = await createAdmin(body);
        onCreated({
          admin: res.admin,
          link:
            res.enrollUrl && res.expiresAt
              ? {
                  title: "Admin qo'shildi",
                  adminName: res.admin.name,
                  enrollUrl: res.enrollUrl,
                  expiresAt: res.expiresAt,
                  sentViaTelegram: send,
                }
              : null,
        });
      }}
    >
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <span className="font-semibold">Foydalanuvchini toping</span>
        <Segmented ariaLabel="Identifikator turi" options={ID_KINDS} value={kind} onChange={(v) => setKind(v as IdKind)} />
        <label htmlFor={`${uid}-id`} className="sr-only">
          {kind === "telegramId" ? "Telegram ID" : "Foydalanuvchi ID"}
        </label>
        <input
          id={`${uid}-id`}
          value={idText}
          onChange={(e) => setIdText(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          placeholder={kind === "telegramId" ? "Telegram ID, masalan 123456789" : "Foydalanuvchi ID, masalan 42"}
          aria-invalid={idText !== "" && !idOk}
          className="border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 font-mono text-[13px] outline-none focus:ring-2"
        />
        {idText !== "" && !idOk ? <span className="text-destructive text-xs">Faqat raqamlar kiriting (0 dan boshlanmasin).</span> : null}
      </div>

      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <label htmlFor={`${uid}-role`} className="font-semibold">
          Rol
        </label>
        <select
          id={`${uid}-role`}
          value={role}
          onChange={(e) => setRole(e.target.value as AdminRole | "")}
          className="border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 text-[13px] outline-none focus:ring-2"
        >
          <option value="">Rolni tanlang</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground text-xs">O&apos;zingizning darajangizdan past rollarni berish mumkin{actorRole === "owner" ? " (ega boshqa egani ham qo'sha oladi)" : ""}.</span>
      </div>

      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} className="accent-primary mt-0.5 size-4" />
        <span>{twoFactor ? "Havolani Telegram orqali ham yuborish" : "Telegram orqali xabar yuborish"}</span>
      </label>
    </ConfirmDialog>
  );
}
