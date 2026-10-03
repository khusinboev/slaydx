"use client";

import { ArrowLeft } from "lucide-react";
import { BackLink } from "@/components/nav/BackLink";

/**
 * «← Foydalanuvchilar» of an admin detail page. A plain click is a real back
 * (to the filtered list the admin came from, no ping-pong); with no in-app
 * history (deep link, fresh tab) the page is replaced by the last remembered
 * list URL with its filters, else the bare list (lib/nav/history `parentHref`).
 */
export function DetailBack({ label }: { label: string }) {
  return (
    <BackLink className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[12.5px]">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {label}
    </BackLink>
  );
}
