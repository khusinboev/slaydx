"use client";

import { useId, useState } from "react";
import { createAdmin, type AdminAccountItem } from "@/lib/admin-api/admins";
import type { AdminRole } from "@/lib/admin-api/auth";
import type { AdminUserRow } from "@/lib/admin-api/users";
import { Button, ConfirmDialog, Segmented, toast } from "@/components/admin/ui";
import { roleLabel } from "@/components/admin/shell";
import { UserPicker, type PickedUser } from "@/components/admin/users/UserPicker";
import type { EnrollLinkView } from "./EnrollLinkDialog";
import { ID_INPUT_RE, assignableRoles } from "./shared";

type IdKind = "telegramId" | "userId";

const ID_KINDS: ReadonlyArray<{ value: IdKind; label: string }> = [
  { value: "telegramId", label: "Telegram ID" },
  { value: "userId", label: "Foydalanuvchi ID" },
];

/** Simple mode (2FA switch off): there is no link to show, only this hint. */
export const ADMIN_ADDED_TOAST = "Admin qo'shildi — u saytdagi «Admin panel» tugmasi orqali kiradi";

/** Why a listed user cannot be made an admin (mirrors the server's 409 `already_admin`). */
export const ALREADY_ADMIN = "Allaqachon admin";
/** The server does not refuse a blocked user, but a blocked user cannot sign in to use the panel. */
export const BLOCKED_USER = "Bloklangan foydalanuvchini admin qilib bo'lmaydi — avval blokdan chiqaring.";

export type CreatedAdmin = { admin: AdminAccountItem; link: EnrollLinkView | null };

/** A user already chosen by the caller (the user page): the dialog then asks only for the role and reason. */
export type CreateAdminTarget = { id: string; name: string; username: string | null };

export type CreateAdminProps = {
  open: boolean;
  onClose: () => void;
  actorRole: string;
  /** The server's 2FA switch: with it off there is no enrollment link (`link` is `null`). */
  twoFactor: boolean;
  /** Fixed target; without it the dialog offers the user picker (and the "ID bo'yicha" fallback). */
  target?: CreateAdminTarget;
  onCreated: (created: CreatedAdmin) => void;
};

/**
 * What both screens do after a create: the one-time enrollment link (2FA on)
 * goes to the caller's `EnrollLinkDialog`, otherwise a toast with the hint.
 */
export function announceCreated(created: CreatedAdmin, showLink: (link: EnrollLinkView) => void): void {
  if (created.link) showLink(created.link);
  else toast(ADMIN_ADDED_TOAST);
}

/** Rows of `GET /api/admin/users` that cannot become admins. */
export function pickRule(row: AdminUserRow): string | null {
  if (row.isAdmin) return ALREADY_ADMIN;
  if (row.isBlocked) return BLOCKED_USER;
  return null;
}

/**
 * Creating an admin account (`POST /api/admin/admins`, plan §6.13), shared by
 * `/admin/admins` ("Admin qo'shish": pick the person from the users list, or
 * fall back to a Telegram ID / user ID) and the user page ("Admin qilish":
 * the target is fixed). Role options are the roles strictly below the actor's
 * rank (an owner may add owners); a reason is required. The body is mounted
 * only while open (ConfirmDialog), so every open starts empty. The server's
 * 404 / 409 `already_admin` / 403 `rank` messages stay inline.
 */
export function CreateAdminDialog({ open, ...rest }: CreateAdminProps) {
  if (!open) return null;
  return <Body {...rest} />;
}

function Body({ onClose, actorRole, twoFactor, target, onCreated }: Omit<CreateAdminProps, "open">) {
  const uid = useId();
  const roles = assignableRoles(actorRole);
  const [mode, setMode] = useState<"pick" | "id">("pick");
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [kind, setKind] = useState<IdKind>("telegramId");
  const [idText, setIdText] = useState("");
  const [role, setRole] = useState<AdminRole | "">("");
  const [send, setSend] = useState(false);
  const idOk = ID_INPUT_RE.test(idText.trim());
  const who: { userId: string } | { telegramId: string } | null = target
    ? { userId: target.id }
    : mode === "pick"
      ? picked
        ? { userId: picked.id }
        : null
      : idOk
        ? kind === "telegramId"
          ? { telegramId: idText.trim() }
          : { userId: idText.trim() }
        : null;

  const title = target ? "Admin qilish" : "Admin qo'shish";
  const activation = twoFactor
    ? "Hisob «kutilmoqda» holatida yaratiladi va ikki bosqichli himoyani o'zi sozlaydi."
    : "Hisob darhol faol bo'ladi: u saytdagi «Admin panel» tugmasi orqali kiradi.";

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={title}
      description={target ? activation : `Shaxs saytga kamida bir marta Telegram orqali kirgan bo'lishi kerak. ${activation}`}
      target={
        target ? (
          <span className="break-words">
            {target.name || `#${target.id}`}
            <span className="text-muted-foreground font-normal">
              {" "}
              · {target.username ? `@${target.username} · ` : ""}#{target.id}
            </span>
          </span>
        ) : undefined
      }
      reason={{ label: "Sabab (audit jurnaliga yoziladi)" }}
      confirmLabel={title}
      confirmDisabled={who === null || role === ""}
      onConfirm={async (ctx) => {
        if (!who || role === "") return;
        const res = await createAdmin({ ...who, role, reason: ctx.reason, ...(send ? { sendViaTelegram: true } : {}) });
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
      {target ? null : mode === "pick" ? (
        <div className="flex flex-col gap-1">
          <UserPicker label="Foydalanuvchini toping" value={picked} onChange={setPicked} unavailable={pickRule} />
          <div>
            <Button size="sm" variant="ghost" onClick={() => setMode("id")}>
              ID bo&apos;yicha kiritish
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 text-[12.5px]">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">ID bo&apos;yicha</span>
            <Button size="sm" variant="ghost" onClick={() => setMode("pick")}>
              Ro&apos;yxatdan tanlash
            </Button>
          </span>
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
      )}

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
        <span className="text-muted-foreground text-xs">
          O&apos;zingizning darajangizdan past rollarni berish mumkin{actorRole === "owner" ? " (ega boshqa egani ham qo'sha oladi)" : ""}.
        </span>
      </div>

      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} className="accent-primary mt-0.5 size-4" />
        <span>{twoFactor ? "Havolani Telegram orqali ham yuborish" : "Telegram orqali xabar yuborish"}</span>
      </label>
    </ConfirmDialog>
  );
}
