"use client";

import Link from "next/link";
import { Bell, ChevronRight, FolderOpen, Plus, Search, Wallet } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { PageHeader, HeaderIconButton } from "@/components/shell/PageHeader";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { BalanceChip } from "@/components/shell/BalanceChip";
import { useReturnToLogin } from "@/components/shell/useReturnToLogin";

/**
 * Bosh (`/uz`) — interim hub laid by the shell package (F0). Package W1
 * replaces the body with the real hub (greeting, search box, «Tez boshlash»,
 * «Davom ettirish», tools by group). Keep: `PageHeader` with search / theme /
 * notifications, `useReturnToLogin()`, links into the tabs.
 */
export function HomeHub() {
  useReturnToLogin();
  const user = useAppStore((s) => s.user);
  const open = useUi((s) => s.open);
  const first = (user?.name ?? "").trim().split(/\s+/)[0];

  return (
    <div className="flex w-full flex-col">
      <PageHeader
        title={first ? `Salom, ${first}` : BRAND_NAME}
        subtitle="Bugun nima yaratamiz?"
        actions={
          <>
            <HeaderIconButton label="Qidirish" onClick={() => open("search")}>
              <Search className="size-[1.2rem]" aria-hidden />
            </HeaderIconButton>
            <ThemeToggle />
            <HeaderIconButton label="Bildirishnomalar" title="Bildirishnomalar (Alt+T)" onClick={() => open("notifications")}>
              <Bell className="size-[1.2rem]" aria-hidden />
            </HeaderIconButton>
          </>
        }
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-1 pb-6">
        <BalanceChip className="self-start" />
        <button
          type="button"
          data-hub-create
          onClick={() => open("create")}
          className="text-hero-foreground focus-visible:ring-ring flex min-h-24 items-center gap-4 rounded-[var(--radius-card)] bg-[image:var(--hero)] px-5 text-left shadow-[var(--shadow-card)] outline-none focus-visible:ring-2"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/30">
            <Plus className="size-6" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[18px] font-bold">Yangi ish yaratish</span>
            <span className="block text-[14px] opacity-80">Slayd, referat, insho, test va boshqalar</span>
          </span>
        </button>
        <HubLink href="/uz/files" icon={<FolderOpen className="size-5" aria-hidden />} title="Ishlarim" hint="Yaratilgan fayllar" />
        <HubLink href="/uz/wallet" icon={<Wallet className="size-5" aria-hidden />} title="Hamyon" hint="Balans va to‘ldirish" />
      </div>
    </div>
  );
}

function HubLink({ href, icon, title, hint }: { href: string; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <Link
      href={href}
      className="bg-card hover:bg-accent focus-visible:ring-ring flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border px-4 shadow-[var(--shadow-card)] outline-none focus-visible:ring-2"
    >
      <span className="bg-accent-soft text-accent-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        <span className="text-muted-foreground block text-[13.5px]">{hint}</span>
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </Link>
  );
}
