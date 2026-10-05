"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { parentOf } from "@/lib/nav/parents";
import { useHideInAppBack } from "@/components/telegram/useMiniAppShell";
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
 *
 * Inside a genuine Telegram Mini App it renders nothing while Telegram's
 * BackButton is shown (owner decision O6, docs/mobile/PLAN.md): one back
 * control, not two. Browsers always get the «←».
 */
export function BackLink({ fallback, onClick, children, ...rest }: Props) {
  const pathname = usePathname() ?? "/uz";
  const nav = useNav();
  const hidden = useHideInAppBack();
  const href = fallback ?? parentOf(pathname) ?? "/uz";
  if (hidden) return null;
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
