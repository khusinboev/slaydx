"use client";

import Link from "next/link";
import { PAY_RETURN_PATH } from "@/components/overlays/pay-amount";

/** The server's 402 wording (`app/api/generations/route.ts`), as the tool forms recognise it. */
const INSUFFICIENT_RE = /balans yetarli emas|to.langan balans bilan/i;

/**
 * The error line above a Studio form's submit button, with the top-up link when the balance is the reason. `gated`: the
 * channel gate above the form already says what stops the job.
 */
export function SubmitError({ error, gated = false }: { error: string | null; gated?: boolean }) {
  if (!error || gated) return null;
  return (
    <p role="alert" data-studio-error className="text-destructive mb-3 text-[14.5px] leading-snug">
      {error}
      {INSUFFICIENT_RE.test(error) ? (
        <>
          {" "}
          <Link href={PAY_RETURN_PATH} data-topup className="text-accent-soft-foreground pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center font-semibold whitespace-nowrap underline underline-offset-2">
            Balansni to‘ldirish →
          </Link>
        </>
      ) : null}
    </p>
  );
}
