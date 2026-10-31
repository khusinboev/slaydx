"use client";

import { Badge, Card, CardHeader } from "@/components/admin/ui";
import { fmtDateTime, fmtRelative } from "@/lib/admin-format";
import type { SystemBody } from "@/lib/admin-api/providers";

const STATE_TONE = { closed: "success", open: "danger", "half-open": "warning" } as const;
const STATE_LABEL = { closed: "Ochiq emas", open: "To'xtatilgan", "half-open": "Sinovda" } as const;

/**
 * Health of the machinery behind the providers, read-only: running processes, the circuit breakers that skip a
 * provider after repeated failures or a quota stop, and the concurrency limiters. It moved here from the old
 * «AI xarajat → Provayderlar» tab, so provider control and provider health live on one page.
 */
export function SystemSection({ system }: { system: SystemBody }) {
  const breakers = system.breakers.filter((b) => !b.stale);
  const limiters = system.limiters.filter((l) => !l.stale);
  const processes = system.processes;
  return (
    <Card>
      <CardHeader title="Tizim holati" description="Provayderlar ortidagi jarayonlar va himoya mexanizmlari (faqat ko'rish)." />
      <div className="grid gap-x-6 gap-y-4 px-4 py-3.5 lg:grid-cols-3">
        <div>
          <h3 className="mb-1.5 text-xs font-semibold">Jarayonlar</h3>
          {processes.length === 0 ? (
            <p className="text-muted-foreground text-xs">Hali yurak urishi yozilmagan.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs">
              {processes.map((p) => (
                <li key={p.process} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono">{p.process}</span>
                  <Badge tone={p.stale ? "danger" : "success"} dot>
                    {p.stale ? "javob bermayapti" : p.role}
                  </Badge>
                  <span className="text-muted-foreground" title={fmtDateTime(p.lastSeenAt)}>
                    {fmtRelative(p.lastSeenAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1.5 text-xs font-semibold">Himoya (breaker)</h3>
          {breakers.length === 0 ? (
            <p className="text-muted-foreground text-xs">Ma&apos;lumot yo&apos;q.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs">
              {breakers.map((b) => (
                <li key={`${b.process}/${b.name}`} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono">{b.name}</span>
                  <Badge tone={STATE_TONE[b.state]} dot>
                    {STATE_LABEL[b.state]}
                  </Badge>
                  {b.failures > 0 ? <span className="text-muted-foreground">{b.failures} ta xato</span> : null}
                  {b.openUntil && b.state === "open" ? <span className="text-muted-foreground">{fmtRelative(b.openUntil)} gacha</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1.5 text-xs font-semibold">Parallel so&apos;rovlar</h3>
          {limiters.length === 0 ? (
            <p className="text-muted-foreground text-xs">Ma&apos;lumot yo&apos;q.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs">
              {limiters.map((l) => (
                <li key={`${l.process}/${l.name}`} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono">{l.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {l.active}/{l.max} band{l.waiting > 0 ? `, ${l.waiting} kutmoqda` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
