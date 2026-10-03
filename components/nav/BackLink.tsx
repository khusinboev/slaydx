"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { parentOf } from "@/lib/nav/parents";
import { useNav } from "./NavProvider";

type Props = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** Target when there is no in-app entry to go back to. Default: `parentOf(pathname)`. */
  fallback?: string;
};

/**
 * In-app «←». A real link to the parent page (middle-click / open in new tab
 * work), but a plain click runs `backTo()`: back when the previous entry is
 * in-app, otherwise REPLACE with the parent, so it never leaves the site and
 * never ping-pongs. Leave guards save first.
 */
export function BackLink({ fallback, onClick, children, ...rest }: Props) {
  const pathname = usePathname() ?? "/uz";
  const nav = useNav();
  const href = fallback ?? parentOf(pathname) ?? "/uz";
  return (
    <Link
      {...rest}
      href={href}
      aria-label={rest["aria-label"] ?? "Orqaga"}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void nav.backTo(fallback);
      }}
    >
      {children}
    </Link>
  );
}
