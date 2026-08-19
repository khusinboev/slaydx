"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, LogIn, Plus, User } from "lucide-react";
import { TOOLS } from "@/lib/tools";
import { cn } from "@/lib/cn";
import { creditTotal, useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { TOOL_ICONS } from "./icons";

const GROUPS = [
  { id: "mashhur", label: "Mashhur" },
  { id: "hujjatlar", label: "Hujjatlar" },
] as const;

function itemClass(active: boolean) {
  return cn(
    "peer/menu-button flex w-full items-center gap-2.5 overflow-hidden rounded-xl px-3 py-2 text-start outline-hidden transition-colors",
    "h-10 text-[15.5px]",
    active
      ? "bg-white font-medium text-sidebar-accent-foreground shadow-sm dark:bg-sidebar-accent"
      : "hover:bg-white/70 dark:hover:bg-sidebar-accent",
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useAppStore((s) => s.user);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const open = useUi((s) => s.open);
  const hydrated = useAppStore((s) => s.hydrated);
  const total = creditTotal(user);

  function onToolClick(href: string) {
    onNavigate?.();
    if (hydrated && !loggedIn) {
      open("login", { returnTo: href });
    }
  }

  return (
    <div className="bg-sidebar flex h-full w-full flex-col">
      <div className="flex flex-col gap-2 p-2">
        <Link
          href="/uz"
          onClick={onNavigate}
          className={itemClass(pathname === "/uz")}
          aria-label="SoddaAI"
          style={{ height: 48 }}
        >
          {/* logo is a local static PNG; next/image not needed for 32px brand mark */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Sodda.ai" width={32} height={32} className="size-8 rounded-lg object-cover" />
          <span className="text-sidebar-foreground truncate text-[19px] leading-none font-medium">
            Sodda.ai
          </span>
          <House className="text-sidebar-foreground/90 ml-auto size-4 shrink-0" />
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-2 pt-0 scrollbar-thin">
        <Link
          href="/uz/create"
          onClick={() => onToolClick("/uz/create")}
          className={itemClass(pathname === "/uz/create")}
        >
          <Plus className="size-[18px] shrink-0" />
          <span>Yaratish</span>
        </Link>

        {GROUPS.map((g) => (
          <div key={g.id} className="pt-2">
            <div className="text-sidebar-foreground/70 flex h-8 items-center rounded-md px-3 text-xs font-semibold tracking-wider uppercase">
              {g.label}
            </div>
            <ul className="flex flex-col gap-1">
              {TOOLS.filter((t) => t.group === g.id).map((t) => {
                const href = `/uz/${t.slug}`;
                const active = pathname === href || pathname.startsWith(`${href}/`);
                const Icon = TOOL_ICONS[t.icon];
                return (
                  <li key={t.id}>
                    <Link
                      href={href}
                      onClick={() => onToolClick(href)}
                      className={itemClass(active)}
                    >
                      {Icon ? (
                        <Icon
                          className="size-[18px] shrink-0 text-[rgb(var(--tc))]"
                          style={{ ["--tc" as string]: t.tc }}
                        />
                      ) : null}
                      <span className="truncate">{t.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-auto p-2">
        {loggedIn ? (
          <Link
            href="/uz/profile"
            onClick={onNavigate}
            className="hover:bg-white/70 dark:hover:bg-sidebar-accent flex items-center gap-2.5 rounded-md px-3 py-2"
          >
            <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg text-sm font-semibold">
              {(user?.name || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">{user?.name || "Foydalanuvchi"}</div>
              <div className="text-muted-foreground truncate text-xs">
                {user?.plan === "pro" ? "Pro" : "Bepul"} · {total.toLocaleString("uz-UZ")} tanga
              </div>
            </div>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              open("login");
            }}
            className="hover:bg-white/70 dark:hover:bg-sidebar-accent flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-start"
          >
            <span className="bg-muted flex size-8 items-center justify-center rounded-lg">
              <User className="text-muted-foreground size-4" />
            </span>
            <span className="grid flex-1 text-start text-[15px] leading-tight">
              <span className="truncate font-semibold">Tizimga kiring</span>
              <span className="text-muted-foreground truncate text-xs">Kirish</span>
            </span>
            <LogIn className="text-muted-foreground size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
