"use client";

import { TriangleAlert } from "lucide-react";
import { fmtDateTime } from "@/lib/admin-format";
import { Button, CopyButton, Modal } from "@/components/admin/ui";

/** The one-time enrollment link of a created account or a 2FA reset. It lives in state only until the dialog is closed. */
export type EnrollLinkView = {
  /** Why the link exists: shown as the dialog title. */
  title: string;
  /** Account the link is for. */
  adminName: string;
  enrollUrl: string;
  expiresAt: string;
  /** The link was also sent to the person on Telegram. */
  sentViaTelegram?: boolean;
};

/**
 * Shows the enrollment URL exactly once (the server never returns it again).
 * The URL is plain text in a read-only box, with a copy button and the expiry.
 */
export function EnrollLinkDialog({ link, onClose }: { link: EnrollLinkView | null; onClose: () => void }) {
  return (
    <Modal
      open={link !== null}
      onClose={onClose}
      title={link?.title ?? ""}
      description={link ? <span>{link.adminName}</span> : undefined}
      footer={
        <Button variant="primary" onClick={onClose}>
          Nusxaladim, yopish
        </Button>
      }
    >
      {link ? (
        <>
          <p role="alert" className="bg-warning/10 text-badge-warning-text flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Bu havola faqat bir marta ko&apos;rsatiladi. Yopilgandan keyin uni qayta ko&apos;rib bo&apos;lmaydi.</span>
          </p>
          <div className="flex flex-col gap-1.5 text-[12.5px]">
            <label htmlFor="enroll-url" className="font-semibold">
              Ulanish havolasi
            </label>
            <input
              id="enroll-url"
              readOnly
              value={link.enrollUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="border-input bg-muted focus:ring-ring h-9 w-full rounded-lg border px-2.5 font-mono text-xs outline-none focus:ring-2"
            />
            <div>
              <CopyButton value={link.enrollUrl} />
            </div>
          </div>
          <p className="text-muted-foreground text-[13px]">
            Havola <span className="text-foreground font-semibold tabular-nums">{fmtDateTime(link.expiresAt)}</span> gacha amal qiladi va faqat shu admin o&apos;z Telegram hisobi bilan kirganda ochiladi.
            {link.sentViaTelegram ? " Havola Telegram orqali ham yuborildi." : ""}
          </p>
        </>
      ) : null}
    </Modal>
  );
}
