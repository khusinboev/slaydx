"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { autoLogin } from "@/lib/admin-api/auth";
import { Button } from "@/components/admin/ui";
import { sanitizeAdminNext } from "./nav-registry";

/**
 * Simple-mode entry (2FA switch off): rendered by the panel layout and the
 * login page in place of a code form. It POSTs `/api/admin/auth/auto` exactly
 * once, then refreshes the server tree (the layout now sees the admin cookie)
 * or goes to `next`. The server decides everything: a non-admin gets 404 here
 * as everywhere, and with the switch on this component is never mounted.
 */
export function AdminAutoEnter({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // One request per attempt, also under StrictMode's doubled effects.
  const started = useRef(-1);

  useEffect(() => {
    if (started.current === attempt) return;
    started.current = attempt;
    const ctl = new AbortController();
    autoLogin({ signal: ctl.signal })
      .then(() => {
        if (next !== undefined) router.replace(sanitizeAdminNext(next));
        router.refresh();
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        setError(adminErrorMessage(e));
      });
    return () => ctl.abort();
  }, [attempt, next, router]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return (
    <div className="bg-background text-foreground grid min-h-dvh place-items-center px-4">
      {error ? (
        <div role="alert" className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-destructive text-sm">Admin panelga kirib bo&apos;lmadi: {error}</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={retry}>
              Qayta urinish
            </Button>
            <Link href="/uz" className="text-muted-foreground inline-flex h-9 items-center text-sm underline underline-offset-2">
              Saytga qaytish
            </Link>
          </div>
        </div>
      ) : (
        <p aria-busy="true" className="text-muted-foreground text-sm">
          Admin panelga kirilmoqda…
        </p>
      )}
    </div>
  );
}
