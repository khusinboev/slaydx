"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/chunk-reload";
import { adminErrorMessage, adminRequestId } from "@/lib/admin-api/core";
import { Card, ErrorState } from "@/components/admin/ui";

/**
 * Error boundary for panel pages. It sits inside `(panel)/layout.tsx`, so the
 * nav and shell stay usable. Shows the request id of an admin API error (for
 * support) and the Next digest of a server render error.
 */
export default function AdminPanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const chunk = isChunkLoadError(error);

  useEffect(() => {
    console.error("[admin-ui]", error.message, error.digest ?? "");
    // A deploy removed the old chunk: reload once instead of re-throwing the cached error.
    reloadOnceForChunkError(error);
  }, [error]);

  function retry() {
    if (chunk) {
      window.location.reload();
      return;
    }
    // Refetch the server components too, then re-render the segment.
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <Card className="mx-auto mt-6 max-w-xl">
      <ErrorState
        message={
          chunk
            ? "Panelning yangi versiyasi chiqdi. Sahifa yangilanmoqda; yangilanmasa, qayta urinib ko'ring."
            : adminErrorMessage(error)
        }
        requestId={adminRequestId(error)}
        onRetry={retry}
      />
      {error.digest ? (
        <p className="text-muted-foreground -mt-6 pb-6 text-center font-mono text-xs">Kod: {error.digest}</p>
      ) : null}
    </Card>
  );
}
