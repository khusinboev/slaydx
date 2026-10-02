"use client";

import { useCallback, useState } from "react";
import { Check, Minus, UserPlus } from "lucide-react";
import { listAdmins, type AdminAccountItem } from "@/lib/admin-api/admins";
import { fmtDateTime, fmtNumber } from "@/lib/admin-format";
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, Forbidden, Modal, toast, useLoad, type Column } from "@/components/admin/ui";
import { roleLabel, useAdminIdentity, useCan } from "@/components/admin/shell";
import { ActionDialogs, type RowAction } from "./ActionDialogs";
import { AddAdminDialog } from "./AddAdminDialog";
import { EnrollLinkDialog, type EnrollLinkView } from "./EnrollLinkDialog";
import { STATUS_META, rowRules } from "./shared";

/**
 * S18 `/admin/admins`: admin accounts on the F2 API. Management actions are
 * offered only to `admins.manage` and mirror the server's invariants (not
 * yourself, strictly lower rank, last active owner); the server still decides,
 * so its 403 / 409 messages are shown as they come. Enrollment links (new
 * admin, 2FA reset) are displayed once and dropped from state on close.
 */
export function AdminsPage() {
  const identity = useAdminIdentity();
  // 2FA switch off: no enrollment links, no 2FA column, no "2FA ni tiklash" action.
  const twoFactor = identity.twoFactor;
  const canManage = useCan("admins.manage");
  const load = useCallback((signal: AbortSignal) => listAdmins({ signal }), []);
  const [state, reload] = useLoad(load);

  // Own account id (from the server-resolved shell identity), to disable actions on yourself;
  // the server's 409 `self` is still the authority.
  const ownId = identity.adminId;

  const items = state.status === "ready" ? state.data.items : [];
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState<AdminAccountItem | null>(null);
  const [action, setAction] = useState<RowAction | null>(null);
  const [link, setLink] = useState<EnrollLinkView | null>(null);

  const columns: Column<AdminAccountItem>[] = [
    {
      id: "name",
      header: "Admin",
      className: "min-w-[12rem]",
      cell: (a) => (
        <div className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-1.5 font-medium">
            <span className="break-words">{a.name}</span>
            {a.id === ownId ? <Badge tone="info">Siz</Badge> : null}
          </span>
          <span className="text-muted-foreground text-xs break-all">
            {a.username ? `@${a.username} · ` : ""}#{a.userId}
          </span>
        </div>
      ),
    },
    { id: "role", header: "Rol", cell: (a) => <Badge tone="primary">{roleLabel(a.role)}</Badge> },
    {
      id: "status",
      header: "Holat",
      cell: (a) => (
        <Badge tone={STATUS_META[a.status].tone} dot>
          {STATUS_META[a.status].label}
        </Badge>
      ),
    },
    ...(twoFactor
      ? [
          {
            id: "totp",
            header: "2FA",
            align: "center" as const,
            cell: (a: AdminAccountItem) =>
              a.totpEnabled ? (
                <span className="text-success-text inline-flex" title="Ikki bosqichli himoya yoqilgan">
                  <Check className="size-4" aria-hidden="true" />
                  <span className="sr-only">Yoqilgan</span>
                </span>
              ) : (
                <span className="text-muted-foreground inline-flex" title="Hali sozlanmagan">
                  <Minus className="size-4" aria-hidden="true" />
                  <span className="sr-only">Sozlanmagan</span>
                </span>
              ),
          },
        ]
      : []),
    { id: "last", header: "Oxirgi kirish", className: "whitespace-nowrap tabular-nums", cell: (a) => (a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : "—") },
    { id: "sessions", header: "Faol sessiyalar", align: "right", className: "tabular-nums", cell: (a) => fmtNumber(a.activeSessions) },
    ...(canManage
      ? [
          {
            id: "actions",
            header: "Amallar",
            align: "right" as const,
            cell: (a: AdminAccountItem) => (
              <Button size="sm" onClick={() => setManaging(a)} aria-label={`${a.name} — boshqarish`}>
                Boshqarish
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Adminlar</h1>
          <p className="text-muted-foreground text-[13px]">
            {twoFactor
              ? "Har bir admin — mavjud Telegram hisobi va ikki bosqichli himoya (TOTP)."
              : "Har bir admin — mavjud Telegram hisobi; panelga saytdagi «Admin panel» tugmasi orqali kiradi (2FA o'chirilgan)."}
          </p>
        </div>
        {canManage ? (
          <Button variant="primary" onClick={() => setAdding(true)} icon={<UserPlus className="size-4" aria-hidden="true" />}>
            Admin qo&apos;shish
          </Button>
        ) : null}
      </header>

      {state.status === "forbidden" ? (
        <Card>
          <Forbidden />
        </Card>
      ) : state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        </Card>
      ) : (
        <DataTable
          caption="Admin hisoblari"
          columns={columns}
          rows={items}
          rowKey={(a) => a.id}
          loading={state.status === "loading"}
          empty={<EmptyState title="Adminlar yo'q" description="Birinchi egani buyruq satri orqali yarating: npm run admin:create." />}
        />
      )}

      <AddAdminDialog
        open={adding}
        onClose={() => setAdding(false)}
        actorRole={identity.role}
        twoFactor={twoFactor}
        onCreated={(c) => {
          if (c.link) setLink(c.link);
          else toast("Admin qo'shildi — u saytdagi «Admin panel» tugmasi orqali kiradi");
          reload();
        }}
      />

      <ManageModal
        admin={managing}
        items={items}
        ownId={ownId}
        actorRole={identity.role}
        twoFactor={twoFactor}
        onClose={() => setManaging(null)}
        onPick={(kind, admin) => {
          setManaging(null);
          setAction({ kind, admin });
        }}
      />

      <ActionDialogs
        action={action}
        actorRole={identity.role}
        twoFactor={twoFactor}
        onClose={() => setAction(null)}
        onDone={reload}
        onLink={setLink}
      />

      <EnrollLinkDialog link={link} onClose={() => setLink(null)} />
    </div>
  );
}

/**
 * Per-account action list. An unavailable action stays visible with the reason
 * written under it (the server's own wording), so the rank rules are explained
 * instead of silently hidden.
 */
function ManageModal({
  admin,
  items,
  ownId,
  actorRole,
  twoFactor,
  onClose,
  onPick,
}: {
  admin: AdminAccountItem | null;
  items: ReadonlyArray<AdminAccountItem>;
  ownId: string;
  actorRole: string;
  twoFactor: boolean;
  onClose: () => void;
  onPick: (kind: RowAction["kind"], admin: AdminAccountItem) => void;
}) {
  const rules = admin ? rowRules(actorRole, ownId, admin, items) : null;
  const rows: Array<{ kind: RowAction["kind"]; label: string; why: string | null; danger?: boolean }> = admin && rules
    ? [
        { kind: "role", label: "Rolni o'zgartirish", why: rules.role },
        admin.status === "disabled"
          ? { kind: "enable", label: "Yoqish", why: rules.status }
          : { kind: "disable", label: "O'chirish", why: rules.status, danger: true },
        // No second factor to reset in simple mode.
        ...(twoFactor ? [{ kind: "reset2fa" as const, label: "2FA ni tiklash", why: rules.reset2fa, danger: true }] : []),
        { kind: "revoke", label: "Sessiyalarni bekor qilish", why: rules.revoke, danger: true },
      ]
    : [];
  return (
    <Modal
      open={admin !== null}
      onClose={onClose}
      title="Adminni boshqarish"
      description={admin ? `${admin.name} · ${roleLabel(admin.role)} · ${STATUS_META[admin.status].label}` : undefined}
      footer={<Button onClick={onClose}>Yopish</Button>}
    >
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.kind} className="flex flex-col gap-1">
            <Button
              variant={r.danger ? "dangerOutline" : "secondary"}
              disabled={r.why !== null}
              onClick={() => admin && onPick(r.kind, admin)}
              className="w-full justify-start"
              aria-describedby={r.why ? `why-${r.kind}` : undefined}
            >
              {r.label}
            </Button>
            {r.why ? (
              <span id={`why-${r.kind}`} className="text-muted-foreground px-1 text-xs">
                {r.why}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
