"use client";

import { currentDeliveryEnv, deliver, markGesture, type ReadyFile } from "@/lib/downloads/deliver";

/**
 * One Studio result file through the delivery driver (session fetch → blob → `<a download>`), like the viewer's tiles.
 * Inside Telegram a single asset has no signed, cookie-free URL, so the result page (with its «Yuklab olish» sheet)
 * opens instead; so does a failed delivery.
 */
export async function downloadStudioFile(file: Pick<ReadyFile, "url" | "fileName" | "mime">, openPage: () => void): Promise<void> {
  markGesture();
  const env = currentDeliveryEnv();
  if (env.capability !== "browser") {
    openPage();
    return;
  }
  try {
    await deliver({ ...file, format: "native", size: 0, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }, env);
  } catch {
    openPage();
  }
}
