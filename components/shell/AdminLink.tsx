"use client";

import Link from "next/link";
import { ChevronRight, Shield } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/cn";

/**
 * «Admin panel» → `/admin` for a user with an admin account (`isAdmin`), nothing
 * for anyone else. It lived in the removed Sidebar; its new home is Profil
 * (docs/redesign/R1-inventory.md §2). A 56 px row.
 */
export function AdminLink({ className }: { className?: string }) {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const isAdmin = useAppStore((s) => Boolean(s.user?.isAdmin));
  if (!loggedIn || !isAdmin) return null;
  return (
    <Link
      href="/admin"
      data-admin-link
      className={cn(
        "bg-card hover:bg-accent focus-visible:ring-ring flex min-h-14 items-center gap-3 rounded-[20px] border px-4 text-[15.5px] font-medium outline-none focus-visible:ring-2",
        className,
      )}
    >
      <span className="bg-accent-soft flex size-9 shrink-0 items-center justify-center rounded-xl">
        <Shield className="text-primary size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate">Admin panel</span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </Link>
  );
}
