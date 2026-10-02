"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { sendBroadcastTest } from "@/lib/admin-api/broadcasts";
import { Button, toast } from "@/components/admin/ui";

/**
 * "O'zimga sinov": sends the draft's text to the acting admin's own Telegram
 * chat only. The server picks the chat (the request carries no recipient).
 */
export function TestSendButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await sendBroadcastTest(id);
      if (r.sent) toast("Sinov xabari Telegram'ingizga yuborildi");
      else toast("Telegram sinov xabarini qabul qilmadi (bot bloklangan bo'lishi mumkin)", { tone: "error" });
    } catch (e) {
      if (!isAbortError(e)) toast(adminErrorMessage(e), { tone: "error" });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Button onClick={run} loading={busy} icon={<Send className="size-4" aria-hidden="true" />}>
      O&apos;zimga sinov
    </Button>
  );
}
