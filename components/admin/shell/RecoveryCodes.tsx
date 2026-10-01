"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button, CopyButton } from "@/components/admin/ui";
import { BRAND_NAME } from "@/lib/brand";

export const RECOVERY_FILE_NAME = "slaydx-admin-tiklash-kodlari.txt";

/** Plain-text file body: a short header and one code per line (CRLF so Windows Notepad shows lines). */
export function recoveryFileText(codes: ReadonlyArray<string>): string {
  return [`${BRAND_NAME} admin panel — tiklash kodlari`, "Har bir kod faqat bir marta ishlaydi.", "", ...codes, ""].join("\r\n");
}

/** Triggers a download of the codes as a .txt file. Returns false where the browser has no Blob URLs. */
export function downloadRecoveryCodes(codes: ReadonlyArray<string>): boolean {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([recoveryFileText(codes)], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = RECOVERY_FILE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/**
 * The one-time display of recovery codes (enrollment and regeneration): the
 * list, copy and download actions, and a required "Saqladim" checkbox that
 * unlocks `onContinue`. The codes are never shown again after this.
 */
export function RecoveryCodes({
  codes,
  continueLabel = "Davom etish",
  onContinue,
}: {
  codes: ReadonlyArray<string>;
  continueLabel?: string;
  onContinue: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px]">
        Bu 10 ta tiklash kodi faqat hozir ko&apos;rsatiladi. Telefoningiz yo&apos;qolsa, ularning har biri bilan bir
        marta kirish mumkin. Ularni xavfsiz joyda saqlang.
      </p>
      <ol
        aria-label="Tiklash kodlari"
        className="bg-muted grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg px-4 py-3 font-mono text-[13.5px] tabular-nums"
      >
        {codes.map((c) => (
          <li key={c} className="select-all">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={codes.join("\n")} label="Nusxa olish" />
        <Button
          size="sm"
          variant="ghost"
          icon={<Download className="size-3.5" aria-hidden="true" />}
          onClick={() => setDownloadFailed(!downloadRecoveryCodes(codes))}
        >
          Yuklab olish (.txt)
        </Button>
      </div>
      {downloadFailed ? (
        <p role="alert" className="text-destructive text-xs">
          Yuklab bo&apos;lmadi. Kodlarni nusxalab saqlang.
        </p>
      ) : null}
      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="accent-primary mt-0.5 size-4 shrink-0"
        />
        <span>Saqladim — kodlarni xavfsiz joyga yozib oldim</span>
      </label>
      <Button variant="primary" disabled={!saved} onClick={onContinue} className="w-full">
        {continueLabel}
      </Button>
    </div>
  );
}
