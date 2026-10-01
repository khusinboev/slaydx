"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button, toast } from "@/components/admin/ui";
import { AdminAuthRequiredError, AdminReauthCancelledError, adminErrorMessage } from "@/lib/admin-api/core";

/**
 * "CSV yuklab olish": runs a step-up protected export download. A cancelled
 * step-up is silent; other failures become an error toast with the server's text.
 */
export function ExportButton({ onExport, label = "CSV yuklab olish" }: { onExport: () => Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      loading={busy}
      icon={<Download className="size-3.5" aria-hidden="true" />}
      onClick={async () => {
        setBusy(true);
        try {
          await onExport();
          toast("Eksport tayyor — fayl yuklab olinmoqda");
        } catch (e) {
          if (!(e instanceof AdminReauthCancelledError) && !(e instanceof AdminAuthRequiredError)) {
            toast(adminErrorMessage(e), { tone: "error" });
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
