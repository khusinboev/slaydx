"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminLoginHref } from "./nav-registry";

/**
 * Sends a visitor without a valid admin session to `/admin/login?next=<here>`.
 *
 * Rendered by the panel layout instead of the panel. A server layout cannot
 * see the request path (Next passes no pathname to layouts and the app has no
 * middleware), so the `next` target is read from `location` on the client and
 * sanitised by `adminLoginHref`. The link is the no-JavaScript fallback.
 */
export function AdminLoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(adminLoginHref(`${location.pathname}${location.search}`));
  }, [router]);

  return (
    <div className="bg-background text-foreground grid min-h-dvh place-items-center px-4">
      <p className="text-muted-foreground text-sm">
        Admin sessiyasi tugagan.{" "}
        <Link href="/admin/login" className="text-foreground font-medium underline underline-offset-2">
          Kirish sahifasiga o&apos;tish
        </Link>
      </p>
    </div>
  );
}
