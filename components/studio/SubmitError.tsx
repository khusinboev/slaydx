"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { PAY_RETURN_PATH } from "@/components/overlays/pay-amount";

/** The server's 402 wording (`app/api/generations/route.ts`), as the tool forms recognise it. */
const INSUFFICIENT_RE = /balans yetarli emas|to.langan balans bilan/i;

/**
 * The error line above a Studio form's submit button, with the top-up link when the balance is the reason. `gated`: the
 * channel gate above the form already says what stops the job. The press may have come from far away (a retry on a result
 * card, down the page on a phone), so a line outside the screen comes into view.
 */
export function SubmitError({ error, gated = false }: { error: string | null; gated?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const shown = error && !gated ? error : null;
  useEffect(() => {
    const el = ref.current;
    if (!shown || !el) return;
    const { top, bottom } = el.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) el.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [shown]);
  if (!shown) return null;
  return (
    <p ref={ref} role="alert" data-studio-error className="text-destructive mb-3 scroll-mt-20 text-[14.5px] leading-snug">
      {shown}
      {INSUFFICIENT_RE.test(shown) ? (
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
