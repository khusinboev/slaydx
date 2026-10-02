"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Eye, LogOut, MessageSquare, ShieldCheck, Wallet } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorState,
  Forbidden,
  KeyValueList,
  MaskedText,
  Skeleton,
  TabPanel,
  Tabs,
  type FilterOption,
  type TabItem,
  toast,
} from "@/components/admin/ui";
import { roleLabel, useCan } from "@/components/admin/shell";
import { WalletAdjustDialog } from "@/components/admin/money";
import { GenerationsTable } from "@/components/admin/generations";
import { OrdersTable, useResource, useUrlFilters } from "@/components/admin/payments";
import { fmtBytes, fmtDate, fmtDateTime, fmtNumber, fmtSoum, fmtTanga } from "@/lib/admin-format";
import { adminErrorMessage } from "@/lib/admin-api/core";
import { PROFILE_FIELDS, getUser, type AdminUserDetailResponse } from "@/lib/admin-api/users";
import { PROFILE_LABEL } from "./labels";
import { BlockDialog, MessageDialog, RevokeSessionsDialog, type UserTarget } from "./UserDialogs";
import { UserLedgerTable } from "./UserLedgerTable";
import { UserSessionsTab } from "./UserSessionsTab";

const USER_ID = /^[1-9]\d{0,18}$/;
const TAB_KEYS = ["tab"] as const;
const TABS_ID = "user-tabs";

type TabId = "overview" | "generations" | "payments" | "ledger" | "sessions" | "links" | "audit";
type Dialog = "wallet" | "block" | "sessions" | "message" | null;

function BackLink() {
  return (
    <Link href="/admin/users" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[12.5px]">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      Foydalanuvchilar
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <div className="bg-card rounded-xl border">{children}</div>
    </div>
  );
}

/**
 * S5 `/admin/users/[id]` (plan §7.1): identity, badges and wallets; actions by
 * permission (wallet adjust with F6's dialog, block / unblock with side
 * effects, revoke sessions, Telegram message, audited PII reveal); tabs for
 * the profile, jobs (WP3), payments (WP4), the user's own ledger, sessions,
 * and links to moderation and the audit log. The server re-checks everything.
 */
export function UserDetail({ id, tools }: { id: string; tools: ReadonlyArray<FilterOption> }) {
  const valid = USER_ID.test(id);
  const [reloadKey, setReloadKey] = useState(0);
  const { state, retry } = useResource<AdminUserDetailResponse>(`${id}:${reloadKey}`, (signal) => getUser(id, { signal }), valid);
  const [revealed, setRevealed] = useState<AdminUserDetailResponse | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const tabStore = useUrlFilters(TAB_KEYS);

  const canWallet = useCan("users.wallet");
  const canBlock = useCan("users.block");
  const canSessions = useCan("users.sessions");
  const canMessage = useCan("users.message");
  const canPii = useCan("users.pii");
  const canManageAdmins = useCan("admins.manage");
  const canJobs = useCan("jobs.view");
  const canPayments = useCan("payments.view");
  const canModeration = useCan("moderation.view");
  const canAudit = useCan("audit.view");

  if (!valid || (state.status === "error" && state.notFound)) {
    return (
      <Shell>
        <EmptyState title="Foydalanuvchi topilmadi" description="Havola noto'g'ri yoki bunday foydalanuvchi yo'q." />
      </Shell>
    );
  }
  if (state.status === "forbidden") {
    return (
      <Shell>
        <Forbidden />
      </Shell>
    );
  }
  if (state.status === "error") {
    return (
      <Shell>
        <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
      </Shell>
    );
  }
  if (!state.data) {
    return (
      <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const data = revealed ?? state.data;
  const { user, stats, flags, counts } = data;
  // An admin target ends that admin's panel access when blocked or signed out:
  // the server requires admins.manage (and rank); the UI mirrors the first part.
  const mayActOnTarget = !flags.self && (!flags.isAdminAccount || canManageAdmins);

  const refresh = () => {
    setRevealed(null);
    setReloadKey((n) => n + 1);
  };
  const reveal = async () => {
    setRevealed(await getUser(id, { reveal: true }));
  };

  const target: UserTarget = {
    id: user.id,
    name: user.name,
    username: user.username,
    isBlocked: user.isBlocked,
    activeSessions: counts.activeSessions,
    queuedJobs: counts.queuedJobs,
    activeGameLinks: counts.activeGameLinks,
  };

  const tabs: Array<TabItem & { id: TabId }> = [
    { id: "overview", label: "Umumiy" },
    ...(canJobs ? [{ id: "generations" as const, label: "Generatsiyalar", badge: fmtNumber(stats.generations) }] : []),
    ...(canPayments ? [{ id: "payments" as const, label: "To'lovlar" }] : []),
    { id: "ledger", label: "Hisob" },
    ...(canSessions ? [{ id: "sessions" as const, label: "Sessiyalar", badge: fmtNumber(counts.activeSessions) }] : []),
    ...(canModeration ? [{ id: "links" as const, label: "O'yin havolalari", badge: fmtNumber(counts.activeGameLinks) }] : []),
    ...(canAudit ? [{ id: "audit" as const, label: "Audit" }] : []),
  ];
  const requested = tabStore.values.tab;
  const tab: TabId = tabs.some((t) => t.id === requested) ? (requested as TabId) : "overview";
  const setTab = (next: string) => tabStore.set({ tab: next === "overview" ? "" : next });

  const actions = [
    canWallet && !flags.self ? (
      <Button key="wallet" variant="primary" icon={<Wallet className="size-4" aria-hidden="true" />} onClick={() => setDialog("wallet")}>
        Hamyonni tuzatish
      </Button>
    ) : null,
    canBlock && mayActOnTarget ? (
      <Button
        key="block"
        variant={user.isBlocked ? "secondary" : "dangerOutline"}
        icon={user.isBlocked ? <ShieldCheck className="size-4" aria-hidden="true" /> : <Ban className="size-4" aria-hidden="true" />}
        onClick={() => setDialog("block")}
      >
        {user.isBlocked ? "Blokdan chiqarish" : "Bloklash"}
      </Button>
    ) : null,
    canSessions && mayActOnTarget ? (
      <Button key="sessions" icon={<LogOut className="size-4" aria-hidden="true" />} onClick={() => setDialog("sessions")}>
        Sessiyalarni bekor qilish
      </Button>
    ) : null,
    canMessage && user.telegramId ? (
      <Button key="message" icon={<MessageSquare className="size-4" aria-hidden="true" />} onClick={() => setDialog("message")}>
        Xabar yuborish
      </Button>
    ) : null,
    canPii && !user.revealed ? (
      <Button key="reveal" variant="ghost" icon={<Eye className="size-4" aria-hidden="true" />} onClick={() => void reveal().catch((e: unknown) => toast(adminErrorMessage(e), { tone: "error" }))}>
        Telefonni ko&apos;rsatish
      </Button>
    ) : null,
  ].filter(Boolean);

  const plan =
    user.plan === "pro" ? `Pro${user.planExpiresAt ? ` · ${fmtDate(user.planExpiresAt)} gacha` : ""}` : "Free";

  return (
    <div className="flex min-w-0 flex-col gap-5" aria-busy={state.status === "loading" || undefined}>
      <BackLink />
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight">
          <span className="min-w-0 break-words">{user.name || `#${user.id}`}</span>
          {user.isBlocked ? (
            <Badge tone="danger" dot>
              Bloklangan
            </Badge>
          ) : null}
          {flags.isAdminAccount ? (
            <Badge tone="primary">
              Admin{flags.adminRole ? ` · ${roleLabel(flags.adminRole)}` : ""}
            </Badge>
          ) : null}
          {user.plan === "pro" ? <Badge tone="primary">Pro</Badge> : null}
        </h1>
        <p className="text-muted-foreground text-[13px]">
          #{user.id} · {user.username ? `@${user.username}` : "username yo'q"}
          {flags.self ? " · bu sizning hisobingiz" : ""}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Ball", "bonus", user.points],
            ["Kvota", "Pro", user.quota],
            ["Balans", "haqiqiy pul", user.balance],
          ] as const
        ).map(([label, hint, value]) => (
          <Card key={label}>
            <CardBody>
              <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                {label} · {hint}
              </span>
              <div className="mt-1 text-[22px] font-semibold tabular-nums">{fmtNumber(value)}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      {actions.length ? (
        <div role="group" aria-label="Amallar" className="flex flex-wrap gap-2">
          {actions}
        </div>
      ) : null}

      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Foydalanuvchi bo'limlari" idPrefix={TABS_ID} />

      <TabPanel idPrefix={TABS_ID} id={tab}>
        {tab === "overview" ? (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Profil"
                description={user.revealed ? "Telefon ochildi — audit jurnaliga yozildi" : "Telefon yashirilgan"}
              />
              <CardBody>
                <KeyValueList
                  items={[
                    {
                      label: "ID",
                      value: (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-mono text-[12.5px]">{user.id}</span>
                          <CopyButton value={user.id} />
                        </span>
                      ),
                    },
                    { label: "Telegram ID", mono: true, value: user.telegramId },
                    { label: "Username", value: user.username ? `@${user.username}` : null },
                    {
                      label: "Telefon",
                      value: <MaskedText value={user.phone} onReveal={canPii && !user.revealed ? reveal : undefined} />,
                    },
                    ...(user.localId ? [{ label: "Kirish identifikatori", mono: true, value: user.localId }] : []),
                    { label: "Tarif", value: plan },
                    { label: "Til", value: user.language },
                    { label: "Ro'yxatdan o'tgan", value: <span className="tabular-nums">{fmtDateTime(user.createdAt)}</span> },
                    { label: "Oxirgi faollik", value: user.lastSeenAt ? <span className="tabular-nums">{fmtDateTime(user.lastSeenAt)}</span> : null },
                    { label: "Yangilangan", value: <span className="tabular-nums">{fmtDateTime(user.updatedAt)}</span> },
                  ]}
                />
              </CardBody>
            </Card>
            <div className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardHeader title="Statistika" />
                <CardBody>
                  <KeyValueList
                    items={[
                      {
                        label: "Generatsiyalar",
                        value: (
                          <span className="tabular-nums">
                            {fmtNumber(stats.generations)}
                            <span className="text-muted-foreground">
                              {" "}
                              (tayyor {fmtNumber(stats.completed)}, xato {fmtNumber(stats.failed)})
                            </span>
                          </span>
                        ),
                      },
                      { label: "Sarflangan", value: <span className="tabular-nums">{fmtTanga(stats.spentTanga)}</span> },
                      { label: "To'lagan", value: <span className="tabular-nums">{fmtSoum(stats.paidSoum)}</span> },
                      { label: "Xotira", value: <span className="tabular-nums">{fmtBytes(stats.storageBytes)}</span> },
                      { label: "Faol sessiyalar", value: <span className="tabular-nums">{fmtNumber(counts.activeSessions)}</span> },
                      { label: "Navbatdagi ishlar", value: <span className="tabular-nums">{fmtNumber(counts.queuedJobs)}</span> },
                      { label: "Faol o'yin havolalari", value: <span className="tabular-nums">{fmtNumber(counts.activeGameLinks)}</span> },
                    ]}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Forma ma'lumotlari" description="Hujjat formalarining standart qiymatlari" />
                <CardBody>
                  <KeyValueList items={PROFILE_FIELDS.map((f) => ({ label: PROFILE_LABEL[f], value: user.profile[f] || null }))} />
                </CardBody>
              </Card>
            </div>
          </div>
        ) : tab === "generations" ? (
          <GenerationsTable tools={tools} embedded fixedFilters={{ userId: user.id }} caption="Foydalanuvchi generatsiyalari" />
        ) : tab === "payments" ? (
          <OrdersTable embedded fixedFilters={{ userId: user.id }} />
        ) : tab === "ledger" ? (
          <UserLedgerTable userId={user.id} />
        ) : tab === "sessions" ? (
          <UserSessionsTab userId={user.id} reloadKey={reloadKey} />
        ) : tab === "links" ? (
          <LinkCard
            title="O'yin havolalari"
            text={`Foydalanuvchining ${fmtNumber(counts.activeGameLinks)} ta faol ommaviy havolasi bor. Ko'rish va o'chirish moderatsiya bo'limida.`}
            href={`/admin/moderation?userId=${encodeURIComponent(user.id)}`}
            label="Moderatsiyada ochish"
          />
        ) : (
          <LinkCard
            title="Audit"
            text="Shu foydalanuvchiga nisbatan bajarilgan barcha admin amallari audit jurnalida."
            href={`/admin/audit?targetType=user&targetId=${encodeURIComponent(user.id)}`}
            label="Audit jurnalida ochish"
          />
        )}
      </TabPanel>

      <WalletAdjustDialog
        open={dialog === "wallet"}
        onClose={() => setDialog(null)}
        user={{ id: user.id, name: user.name, username: user.username, points: user.points, quota: user.quota, balance: user.balance }}
        confirmThreshold={data.walletConfirmThreshold}
        onDone={refresh}
      />
      <BlockDialog open={dialog === "block"} onClose={() => setDialog(null)} user={target} onDone={refresh} />
      <RevokeSessionsDialog open={dialog === "sessions"} onClose={() => setDialog(null)} user={target} onDone={refresh} />
      <MessageDialog open={dialog === "message"} onClose={() => setDialog(null)} user={target} />
    </div>
  );
}

function LinkCard({ title, text, href, label }: { title: string; text: string; href: string; label: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-[13px]">{text}</p>
        <Link
          href={href}
          className="border-input hover:bg-muted inline-flex h-8 items-center rounded-lg border px-3 text-[13px] font-medium"
        >
          {label}
        </Link>
      </CardBody>
    </Card>
  );
}
