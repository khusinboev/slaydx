"use client";

import { useState } from "react";
import { ApiError } from "@/lib/admin-api/core";
import { sendBroadcast, type AdminBroadcast } from "@/lib/admin-api/broadcasts";
import { fmtNumber } from "@/lib/admin-format";
import { ConfirmDialog, Skeleton, toast } from "@/components/admin/ui";
import { useAudienceCount } from "./AudiencePicker";
import { TestSendButton } from "./TestSendButton";
import { audienceLabel } from "./shared";

/**
 * "Yuborish": the real send of a draft. The recipient count is fetched when the
 * dialog opens and must be typed back exactly (a guard against a mass message
 * to the wrong audience). If the audience changed meanwhile the server answers
 * 409 `count_changed` with the real count; the dialog then asks for the new
 * number instead of sending to a different crowd than the admin confirmed.
 * The body mounts only while open (fresh count, fresh idempotency state).
 */
export function SendDialog({
  open,
  broadcast,
  onClose,
  onSent,
}: {
  open: boolean;
  broadcast: AdminBroadcast;
  onClose: () => void;
  onSent: (b: AdminBroadcast) => void;
}) {
  if (!open) return null;
  return <SendBody broadcast={broadcast} onClose={onClose} onSent={onSent} />;
}

function SendBody({ broadcast, onClose, onSent }: { broadcast: AdminBroadcast; onClose: () => void; onSent: (b: AdminBroadcast) => void }) {
  const live = useAudienceCount(broadcast.audience);
  // A count the server reported in a 409; it beats the one fetched on open.
  const [reported, setReported] = useState<number | null>(null);
  const count = reported ?? (live.kind === "ok" ? live.count : null);

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Xabarni yuborish"
      description="Yuborilgandan keyin bekor qilish faqat hali yuborilmaganlarini to'xtatadi: ketgan xabarni qaytarib bo'lmaydi."
      target={
        <span className="break-words">
          {audienceLabel(broadcast.audience)}:{" "}
          {count !== null ? <b className="tabular-nums">{fmtNumber(count)} ta qabul qiluvchi</b> : live.kind === "error" ? <span className="text-destructive">{live.message}</span> : <Skeleton className="inline-block h-4 w-24 align-middle" />}
        </span>
      }
      reason={{ minLength: 5 }}
      typedConfirmation={count !== null ? String(count) : ""}
      confirmDisabled={count === null || count === 0}
      confirmLabel="Yuborish"
      danger
      onConfirm={async ({ reason }) => {
        if (count === null) return;
        try {
          const { broadcast: b } = await sendBroadcast(broadcast.id, { reason, confirmCount: count });
          toast("Navbatga qo'yildi — xabarlar asta-sekin yuboriladi");
          onSent(b);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && e.data.code === "count_changed" && typeof e.data.count === "number") {
            setReported(e.data.count);
            throw new ApiError(`Auditoriya soni o'zgardi: endi ${fmtNumber(e.data.count)} ta. Yangi sonni yozib, qayta tasdiqlang.`, 409, e.data);
          }
          throw e;
        }
      }}
    >
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground bg-muted max-h-32 overflow-y-auto rounded-lg px-3 py-2 text-[12.5px] break-words whitespace-pre-wrap">{broadcast.text}</p>
        <div>
          <TestSendButton id={broadcast.id} />
        </div>
      </div>
    </ConfirmDialog>
  );
}
