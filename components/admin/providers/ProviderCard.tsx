"use client";

import { ExternalLink } from "lucide-react";
import { Badge, Button } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/admin-format";
import type { ProviderItem, ProviderTestResult } from "@/lib/admin-api/providers";
import { BILLING, NEED, keyState, providerStatus, type Period } from "./format";
import { UsageBlock } from "./UsageBlock";

export type TestState = { status: "running" } | ({ status: "done" } & ProviderTestResult);

/**
 * One provider: what it is for, whether it costs money, whether it works now and why not, every action on it
 * (switch, key in / replace / delete, test) and what it has been used for. Roles without edit rights see the same
 * card without the actions.
 */
export function ProviderCard({
  item,
  canEdit,
  canStoreKeys,
  period,
  soumPerUsd,
  purposeTitles,
  test,
  onToggle,
  onKey,
  onDeleteKey,
  onTest,
}: {
  item: ProviderItem;
  canEdit: boolean;
  canStoreKeys: boolean;
  period: Period;
  soumPerUsd: number;
  /** Purpose id -> title, for the «Nima uchun» chips. */
  purposeTitles: Readonly<Record<string, string>>;
  test: TestState | undefined;
  onToggle: (item: ProviderItem) => void;
  onKey: (item: ProviderItem) => void;
  onDeleteKey: (item: ProviderItem) => void;
  onTest: (item: ProviderItem) => void;
}) {
  const status = providerStatus(item);
  const key = keyState(item);
  const billing = BILLING[item.billing];
  const need = NEED[item.need];
  return (
    <article
      id={`provider-${item.id}`}
      data-provider={item.id}
      data-enabled={item.enabled ? "1" : "0"}
      data-usable={item.usable ? "1" : "0"}
      data-billing={item.billing}
      className="bg-card flex scroll-mt-20 flex-col gap-3 rounded-xl border p-4"
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] font-semibold">{item.label}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={billing.tone} title={billing.hint}>
              {billing.label}
            </Badge>
            <Badge tone={need.tone}>{need.label}</Badge>
            <span data-status={status.tone} title={status.hint}>
              <Badge tone={status.tone} dot>
                {status.label}
              </Badge>
            </span>
          </div>
        </div>
        {canEdit && item.implemented ? (
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-xs">
            <button
              type="button"
              role="switch"
              aria-checked={item.enabled}
              aria-label={`${item.label}: yoqilgan`}
              onClick={() => onToggle(item)}
              className={cn(
                "focus-visible:ring-ring relative h-6 w-11 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2",
                item.enabled ? "border-primary bg-primary" : "border-input bg-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("bg-card absolute top-0.5 left-0.5 size-4.5 rounded-full shadow transition-transform", item.enabled ? "translate-x-5" : "translate-x-0")}
              />
            </button>
            <span aria-hidden="true" className="text-muted-foreground w-[4.5rem]">
              {item.enabled ? "Yoqilgan" : "O'chirilgan"}
            </span>
          </label>
        ) : null}
      </header>

      <div className="flex flex-col gap-1">
        <p className="text-[13px] leading-snug">{item.role}</p>
        <p className="text-muted-foreground text-xs">
          <span className="font-medium">Narxi:</span> {item.priceNote}
        </p>
        {item.purposes.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            <span className="font-medium">Ishtirok etadi:</span> {item.purposes.map((p) => purposeTitles[p] ?? p).join(" · ")}
          </p>
        ) : null}
      </div>

      <UsageBlock item={item} period={period} soumPerUsd={soumPerUsd} />

      <div className="mt-auto flex flex-col gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground font-medium">Kalit:</span>
          <span data-key-state>
            <Badge tone={key.tone} dot>
              {key.label}
            </Badge>
          </span>
          {item.keyUrl ? (
            <a href={item.keyUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2">
              Kalit olish <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {item.updatedAt ? (
          <p className="text-muted-foreground text-xs">
            O&apos;zgartirgan: <span className="text-foreground">{item.updatedBy ?? "noma'lum admin"}</span> · {fmtDateTime(item.updatedAt)}
          </p>
        ) : null}
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => onKey(item)} disabled={!canStoreKeys} title={canStoreKeys ? undefined : "Serverda shifrlash kaliti sozlanmagan"}>
              {item.hasDbKey ? "Almashtirish" : "Kalitni kiritish"}
            </Button>
            {item.hasDbKey ? (
              <Button size="sm" variant="dangerOutline" onClick={() => onDeleteKey(item)}>
                O&apos;chirish
              </Button>
            ) : null}
            {item.testable ? (
              <Button size="sm" variant="ghost" loading={test?.status === "running"} onClick={() => onTest(item)}>
                Tekshirish
              </Button>
            ) : null}
          </div>
        ) : null}
        {test?.status === "done" ? (
          <p role="status" data-test-result={test.ok ? "ok" : "fail"} className={cn("text-xs font-medium", test.ok ? "text-badge-success-text" : "text-destructive")}>
            {test.message}
          </p>
        ) : null}
      </div>
    </article>
  );
}
