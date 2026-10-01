"use client";

import Link from "next/link";
import {
  Bug,
  Coins,
  Cpu,
  CreditCard,
  FileText,
  Flag,
  LayoutDashboard,
  ScrollText,
  Send,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ADMIN_NAV_GROUPS, navItemFor, visibleNav, type AdminNavIcon } from "./nav-registry";

const ICONS: Record<AdminNavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  users: Users,
  generations: FileText,
  payments: CreditCard,
  finance: Coins,
  ai: Cpu,
  pricing: Tag,
  moderation: Flag,
  broadcasts: Send,
  settings: SlidersHorizontal,
  system: Server,
  errors: Bug,
  audit: ScrollText,
  admins: ShieldCheck,
  account: UserRound,
};

/**
 * Module navigation, filtered by the admin's permissions (cosmetic: the
 * server enforces every route). The active item is the longest matching href.
 */
export function AdminNav({
  permissions,
  pathname,
  onNavigate,
}: {
  permissions: ReadonlyArray<string>;
  pathname: string;
  /** Called after a link is followed (closes the mobile drawer). */
  onNavigate?: () => void;
}) {
  const items = visibleNav(permissions);
  const activeHref = navItemFor(pathname)?.href ?? null;

  return (
    <nav aria-label="Bo'limlar" className="flex flex-col gap-0.5 px-2.5 pb-4">
      {ADMIN_NAV_GROUPS.map((group) => {
        const groupItems = items.filter((i) => i.group === group.id);
        if (!groupItems.length) return null;
        return (
          <div key={group.id} className="flex flex-col gap-0.5">
            {group.label ? (
              <p className="text-muted-foreground px-2.5 pt-3.5 pb-1 text-[11px] font-semibold tracking-wider uppercase">
                {group.label}
              </p>
            ) : (
              <div className="border-border mx-2.5 my-2 border-t" aria-hidden="true" />
            )}
            <ul className="flex flex-col gap-0.5">
              {groupItems.map((item) => {
                const Icon = ICONS[item.icon];
                const active = item.href === activeHref;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "focus-visible:ring-ring flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] outline-none focus-visible:ring-2",
                        active
                          ? "bg-card text-foreground font-semibold shadow-[inset_3px_0_0_var(--primary)]"
                          : "text-foreground/85 hover:bg-card",
                      )}
                    >
                      <Icon className="size-4 shrink-0 opacity-80" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
