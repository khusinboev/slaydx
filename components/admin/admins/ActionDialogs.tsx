"use client";

import { useId, useState } from "react";
import { resetAdmin2fa, revokeAdminSessions, updateAdmin, type AdminAccountItem } from "@/lib/admin-api/admins";
import type { AdminRole } from "@/lib/admin-api/auth";
import { fmtNumber } from "@/lib/admin-format";
import { ConfirmDialog, toast } from "@/components/admin/ui";
import { roleLabel } from "@/components/admin/shell";
import type { EnrollLinkView } from "./EnrollLinkDialog";
import { STATUS_META, assignableRoles } from "./shared";

/** "Ism (@username)" for dialog targets; the username is data, shown as text only. */
function who(a: AdminAccountItem): string {
  return a.username ? `${a.name} (@${a.username})` : a.name;
}

type Common = {
  admin: AdminAccountItem;
  onClose: () => void;
  /** Called after the server accepted the change, so the list refreshes. */
  onDone: () => void;
};

/** "Rolni o'zgartirish": only roles the actor may assign (strictly lower rank; an owner may assign owner). */
export function RoleDialog({ admin, actorRole, onClose, onDone }: Common & { actorRole: string }) {
  const uid = useId();
  const options = assignableRoles(actorRole).filter((r) => r !== admin.role);
  const [role, setRole] = useState<AdminRole | "">("");
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Rolni o'zgartirish"
      target={who(admin)}
      before={roleLabel(admin.role)}
      after={role ? roleLabel(role) : "—"}
      reason={{ label: "Sabab (audit jurnaliga yoziladi)" }}
      confirmLabel="Rolni o'zgartirish"
      confirmDisabled={role === ""}
      onConfirm={async (ctx) => {
        await updateAdmin(admin.id, { role: role as AdminRole, reason: ctx.reason });
        toast(`${admin.name}: rol «${roleLabel(role)}» ga o'zgartirildi`);
        onDone();
      }}
    >
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <label htmlFor={`${uid}-role`} className="font-semibold">
          Yangi rol
        </label>
        <select
          id={`${uid}-role`}
          value={role}
          onChange={(e) => setRole(e.target.value as AdminRole | "")}
          className="border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 text-[13px] outline-none focus:ring-2"
        >
          <option value="">Rolni tanlang</option>
          {options.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </div>
    </ConfirmDialog>
  );
}

/** "O'chirish" / "Yoqish". Disabling also ends every session of that admin (server, same transaction). */
export function StatusDialog({ admin, to, onClose, onDone }: Common & { to: "active" | "disabled" }) {
  const disabling = to === "disabled";
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={disabling ? "Adminni o'chirish" : "Adminni yoqish"}
      description={
        disabling
          ? "Admin darhol panelga kira olmaydi va barcha faol sessiyalari tugatiladi. Keyin uni qayta yoqish mumkin."
          : admin.totpEnabled
            ? "Admin yana panelga kira oladi (ikki bosqichli himoya saqlangan)."
            : "Ikki bosqichli himoya sozlanmagani uchun hisob «kutilmoqda» holatiga o'tadi: «2FA ni tiklash» orqali yangi havola bering."
      }
      target={who(admin)}
      before={STATUS_META[admin.status].label}
      after={disabling ? STATUS_META.disabled.label : admin.totpEnabled ? STATUS_META.active.label : STATUS_META.pending.label}
      danger={disabling}
      reason={{ label: "Sabab (audit jurnaliga yoziladi)" }}
      confirmLabel={disabling ? "O'chirish" : "Yoqish"}
      onConfirm={async (ctx) => {
        await updateAdmin(admin.id, { status: to, reason: ctx.reason });
        toast(disabling ? `${admin.name} o'chirildi, sessiyalari tugatildi` : `${admin.name} yoqildi`);
        onDone();
      }}
    />
  );
}

/** "2FA ni tiklash": the secret is cleared and sessions end; the new enrollment link is shown once by the parent. */
export function Reset2faDialog({ admin, onClose, onDone, onLink }: Common & { onLink: (link: EnrollLinkView) => void }) {
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="2FA ni tiklash"
      description="Eski ikki bosqichli himoya va tiklash kodlari o'chiriladi, barcha sessiyalar tugatiladi. Admin yangi havola orqali 2FA ni qaytadan sozlaydi."
      target={who(admin)}
      danger
      reason={{ label: "Sabab (audit jurnaliga yoziladi)" }}
      confirmLabel="2FA ni tiklash"
      onConfirm={async (ctx) => {
        const res = await resetAdmin2fa(admin.id, ctx.reason);
        onLink({ title: "2FA tiklandi", adminName: who(admin), enrollUrl: res.enrollUrl, expiresAt: res.expiresAt });
        onDone();
      }}
    />
  );
}

export type RowAction = { kind: "role" | "enable" | "disable" | "reset2fa" | "revoke"; admin: AdminAccountItem };

/** Renders the confirm dialog of the picked action (at most one is open). Each mounts fresh, so every open starts clean. */
export function ActionDialogs({
  action,
  actorRole,
  onClose,
  onDone,
  onLink,
}: {
  action: RowAction | null;
  actorRole: string;
  onClose: () => void;
  onDone: () => void;
  onLink: (link: EnrollLinkView) => void;
}) {
  if (!action) return null;
  const common = { admin: action.admin, onClose, onDone };
  switch (action.kind) {
    case "role":
      return <RoleDialog {...common} actorRole={actorRole} />;
    case "enable":
      return <StatusDialog {...common} to="active" />;
    case "disable":
      return <StatusDialog {...common} to="disabled" />;
    case "reset2fa":
      return <Reset2faDialog {...common} onLink={onLink} />;
    case "revoke":
      return <RevokeDialog {...common} />;
  }
}

/** "Sessiyalarni bekor qilish". */
export function RevokeDialog({ admin, onClose, onDone }: Common) {
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Sessiyalarni bekor qilish"
      description="Adminning barcha faol panel sessiyalari tugatiladi; qayta kirish uchun u 2FA kodini kiritishi kerak."
      target={`${who(admin)} · ${fmtNumber(admin.activeSessions)} ta faol sessiya`}
      danger
      reason={{ label: "Sabab (audit jurnaliga yoziladi)" }}
      confirmLabel="Sessiyalarni tugatish"
      onConfirm={async (ctx) => {
        const res = await revokeAdminSessions(admin.id, ctx.reason);
        toast(`${fmtNumber(res.revoked)} ta sessiya bekor qilindi`);
        onDone();
      }}
    />
  );
}
