"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Menu, X } from "lucide-react";
import { useDialog } from "@/components/overlays/useDialog";
import { setOnAdminAuthRequired } from "@/lib/admin-api/core";
import { BRAND_NAME } from "@/lib/brand";
import { AdminIdentityProvider, type AdminIdentity } from "./admin-identity";
import { AdminNav } from "./AdminNav";
import { ThemeToggle } from "./ThemeToggle";
import { adminLoginHref, roleLabel } from "./nav-registry";

export type AdminShellProps = AdminIdentity & { children: ReactNode };

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-lg text-[13px] font-bold"
      >
        {BRAND_NAME.charAt(0)}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[15px] font-semibold">{BRAND_NAME}</span>
        <span className="text-muted-foreground text-[11px]">Admin panel</span>
      </span>
    </div>
  );
}

function IdentityFooter({ name, username, role }: { name: string; username: string | null; role: string }) {
  return (
    <div className="border-sidebar-border mt-auto flex flex-col gap-2 border-t px-3.5 py-3 text-xs">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{name}</p>
          <p className="text-muted-foreground truncate">
            {username ? `@${username} · ` : ""}
            {roleLabel(role)}
          </p>
        </div>
        <ThemeToggle />
      </div>
      <Link
        href="/uz"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 self-start rounded outline-none focus-visible:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Saytga qaytish
      </Link>
    </div>
  );
}

/**
 * Admin frame (docs/admin/02-plan.md §7.0): a fixed left nav on desktop, a top
 * bar with a drawer below `md`, content capped at `max-w-7xl`. It also routes
 * 401 `admin_auth` from any admin API call to the login page with `next`, and
 * exposes the signed-in identity to pages via `useAdminIdentity()`.
 */
export function AdminShell({ adminId, role, permissions, name, username, children }: AdminShellProps) {
  const pathname = usePathname() ?? "/admin";
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const identity = useMemo<AdminIdentity>(() => ({ adminId, role, permissions, name, username }), [adminId, role, permissions, name, username]);

  useEffect(
    () => setOnAdminAuthRequired((nextPath) => router.replace(adminLoginHref(nextPath))),
    [router],
  );

  // A route change (including back/forward) closes the drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <AdminIdentityProvider value={identity}>
      <div className="bg-background text-foreground flex min-h-dvh">
        <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r md:flex">
          <div className="px-4.5 pt-4.5 pb-2">
            <Brand />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AdminNav permissions={permissions} pathname={pathname} />
          </div>
          <IdentityFooter name={name} username={username} role={role} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur md:hidden">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Bo'limlar menyusini ochish"
              aria-expanded={drawerOpen}
              aria-controls="admin-nav-drawer"
              className="hover:bg-muted focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <Brand />
            </div>
            <ThemeToggle />
          </header>

          <main id="main" className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:py-6">{children}</div>
          </main>
        </div>

        <MobileDrawer open={drawerOpen} onClose={closeDrawer}>
          <AdminNav permissions={permissions} pathname={pathname} onNavigate={closeDrawer} />
          <IdentityFooter name={name} username={username} role={role} />
        </MobileDrawer>
      </div>
    </AdminIdentityProvider>
  );
}

/** Left nav drawer below `md`: Escape, backdrop click and the X button close it; focus is trapped while open. */
function MobileDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  // `onClose` is stable (useCallback above), as `useDialog` requires.
  const panelRef = useDialog(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Menyuni yopish"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        id="admin-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Bo'limlar"
        className="bg-sidebar border-sidebar-border relative flex h-full w-[min(18rem,85vw)] flex-col border-r shadow-xl"
      >
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
          <div className="min-w-0 flex-1">
            <Brand />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Menyuni yopish"
            className="hover:bg-muted focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
