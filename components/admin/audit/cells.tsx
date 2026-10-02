"use client";

import Link from "next/link";
import type { AuditOutcome } from "@/lib/admin-api/audit";
import { Badge, type Tone } from "@/components/admin/ui";
import { TARGET_TYPE_LABELS, targetHref } from "./shared";

const OUTCOME_TONE: Record<AuditOutcome, Tone> = { ok: "success", denied: "danger", failed: "warning" };

/** ok / denied / failed with a dot, so the outcome is not conveyed by colour alone. */
export function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  return (
    <Badge tone={OUTCOME_TONE[outcome] ?? "neutral"} dot>
      {outcome}
    </Badge>
  );
}

/**
 * `type #id` as a link to the matching admin screen when there is one
 * (the href is built from the validated id, never taken from data), plain text otherwise.
 */
export function TargetCell({ type, id }: { type: string | null; id: string | null }) {
  if (!type && !id) return <span className="text-muted-foreground">—</span>;
  const label = (
    <>
      <span title={type ? TARGET_TYPE_LABELS[type] : undefined}>{type ?? "?"}</span>
      {id ? <span className="text-muted-foreground"> · </span> : null}
      {id ? <span className="break-all">{/^[0-9a-f-]{36}$/i.test(id) ? `${id.slice(0, 8)}…` : id}</span> : null}
    </>
  );
  const href = targetHref(type, id);
  if (!href) return <span className="font-mono text-xs">{label}</span>;
  return (
    <Link href={href} className="text-primary font-mono text-xs underline-offset-2 hover:underline" title={id ?? undefined}>
      {label}
    </Link>
  );
}
