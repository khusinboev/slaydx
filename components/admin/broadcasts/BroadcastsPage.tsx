"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell/admin-identity";
import { BroadcastEditor } from "./BroadcastEditor";
import { BroadcastsTable } from "./BroadcastsTable";

/** S13 `/admin/broadcasts`: header, "Yangi xabar" (only with `broadcasts.send`) and the list. */
export function BroadcastsPage() {
  const canSend = useCan("broadcasts.send");
  const router = useRouter();
  const [editorOpen, setEditorOpen] = useState(false);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">E&apos;lonlar</h1>
          <p className="text-muted-foreground text-[13px]">Telegram bot orqali — botni bloklamagan, Telegram ID si bor foydalanuvchilarga</p>
        </div>
        {canSend ? (
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setEditorOpen(true)}>
            Yangi xabar
          </Button>
        ) : null}
      </header>
      <BroadcastsTable />
      <BroadcastEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onCreated={(id) => router.push(`/admin/broadcasts/${encodeURIComponent(id)}`)}
      />
      <p className="text-muted-foreground text-xs">
        Har bir xabar avval o&apos;zingizga sinov sifatida yuboriladi. Ommaviy yuborish auditoriya sonini qayta yozishni va 2FA tasdig&apos;ini talab qiladi; tezlik — sekundiga 25 tagacha xabar.
      </p>
    </div>
  );
}
