"use client";

import { useEffect } from "react";
import { request } from "@/lib/api-client";
import { REF_QUERY_PARAM, normalizeRefCode } from "@/lib/referral";

/**
 * Invite web link `/uz?ref=<code>` (T3): hands the code to the server, which
 * keeps it in an httpOnly cookie until this browser's first Telegram sign-in
 * (`POST /api/referral/capture`). Renders nothing; runs once per page load
 * that carries a code-shaped `ref`. A failed call is silent — the visit
 * itself must never be disturbed by the invite.
 */
export function ReferralCapture() {
  useEffect(() => {
    let code: string | null = null;
    try {
      code = normalizeRefCode(new URLSearchParams(window.location.search).get(REF_QUERY_PARAM));
    } catch {
      return;
    }
    if (!code) return;
    void request("/api/referral/capture", { method: "POST", body: JSON.stringify({ code }) }).catch(() => {});
  }, []);
  return null;
}
