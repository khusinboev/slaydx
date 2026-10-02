"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { fmtNumber } from "@/lib/admin-format";
import type { LedgerLink } from "@/lib/admin-api/payments";

/** A signed wallet delta: green credit, red debit, a dash for 0. */
export function DeltaCell({ value }: { value: number }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("tabular-nums font-medium", value > 0 ? "text-badge-success-text" : "text-destructive")}>
      {fmtNumber(value, { sign: true })}
    </span>
  );
}

/** Admin screen of a resolved ledger link; built from the id only, never from the raw reference. */
export function linkHref(link: LedgerLink): string {
  return link.type === "order" ? `/admin/payments/${encodeURIComponent(link.id)}` : `/admin/generations/${encodeURIComponent(link.id)}`;
}

/** The raw reference as text, wrapped in a link when it resolved to an order or a generation. */
export function ReferenceCell({ reference, link }: { reference: string | null; link: LedgerLink | null }) {
  if (!reference) return <span className="text-muted-foreground">—</span>;
  const text = (
    <span className="block truncate font-mono text-[12px]" title={reference}>
      {reference}
    </span>
  );
  if (!link) return text;
  return (
    <Link
      href={linkHref(link)}
      className="text-foreground block max-w-full underline decoration-dotted underline-offset-2"
      title={link.type === "order" ? "Buyurtmani ochish" : "Generatsiyani ochish"}
    >
      {text}
    </Link>
  );
}
