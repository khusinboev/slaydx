"use client";

import { useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, CircleMinus, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import type { ProviderItem, PurposeItem } from "@/lib/admin-api/providers";
import { NEED, VERDICT_TONE, providerStatus } from "./format";
import { RouteEditor } from "./RouteEditor";

const VERDICT_ICON = { ok: CircleCheck, single: TriangleAlert, missing: CircleAlert, off: CircleMinus } as const;
const VERDICT_TEXT = { ok: "text-success-text", single: "text-badge-warning-text", missing: "text-destructive", off: "text-muted-foreground" } as const;

/**
 * One PURPOSE of the product (writing text, drawing, voice, video ...): what it does for the user, what is the
 * minimum and whether the current setup is enough, which providers can serve it and how each one is doing right
 * now. Purposes that offer a choice (the text chain, the voice order, the image model) fold their editors under
 * «Sozlash»; a purpose that is NOT enough opens by itself.
 */
export function PurposeCard({
  purpose,
  providers,
  canEdit,
  propagationSec,
  onChanged,
}: {
  purpose: PurposeItem;
  providers: Readonly<Record<string, ProviderItem>>;
  canEdit: boolean;
  propagationSec: number;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(purpose.verdict === "missing" || purpose.verdict === "single");
  const Icon = VERDICT_ICON[purpose.verdict];
  const need = NEED[purpose.need];
  const providerUsable = Object.fromEntries(Object.values(providers).map((p) => [p.id, p.usable]));
  const hasRoutes = purpose.routes.length > 0;
  const panelId = `purpose-${purpose.id}-panel`;
  const chips = [...purpose.providerIds, ...purpose.premiumIds];
  return (
    <section data-purpose={purpose.id} data-verdict={purpose.verdict} className="bg-card flex flex-col gap-3 rounded-xl border p-4">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] font-semibold">{purpose.title}</h3>
          <p className="text-muted-foreground mt-0.5 text-[12.5px] leading-snug">{purpose.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={need.tone}>{need.label}</Badge>
          <Badge tone={VERDICT_TONE[purpose.verdict]} dot>
            {purpose.headline}
          </Badge>
        </div>
      </header>

      <p className={cn("flex items-start gap-2 text-[13px] leading-snug", VERDICT_TEXT[purpose.verdict])} data-verdict-detail>
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{purpose.detail}</span>
      </p>
      <p className="text-muted-foreground text-xs">
        <span className="font-medium">Yetarlilik:</span> {purpose.minimum}
      </p>

      <ul className="flex flex-wrap gap-1.5" aria-label="Provayderlar">
        {chips.map((id) => {
          const p = providers[id];
          if (!p) return null;
          const st = providerStatus(p);
          const premium = purpose.premiumIds.includes(id);
          return (
            <li key={id}>
              <a
                href={`#provider-${id}`}
                title={st.hint ?? st.label}
                className="hover:border-ring focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs outline-none focus-visible:ring-2"
              >
                <span aria-hidden="true" className={cn("size-2 rounded-full", st.tone === "success" ? "bg-success" : st.tone === "danger" ? "bg-destructive" : st.tone === "warning" ? "bg-warning" : "bg-muted-foreground")} />
                <span className="font-medium">{p.label}</span>
                <span className="text-muted-foreground">{premium ? "premium · " : ""}{st.label}</span>
              </a>
            </li>
          );
        })}
      </ul>

      {purpose.setting ? (
        <p className="text-muted-foreground text-xs">
          «{purpose.setting.label}»:{" "}
          <span className="text-foreground font-medium">{purpose.setting.enabled ? "yoqilgan" : "o'chirilgan"}</span> —{" "}
          <a href="/admin/settings" className="underline underline-offset-2">
            Sozlamalar
          </a>{" "}
          bo&apos;limida o&apos;zgartiriladi.
        </p>
      ) : null}

      {hasRoutes ? (
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium outline-none focus-visible:ring-2"
          >
            <ChevronDown className={cn("size-4 transition-transform", open ? "rotate-180" : "")} aria-hidden="true" />
            {open ? "Sozlamani yopish" : canEdit ? "Sozlash: qaysi provayder va model" : "Qaysi provayder va model ishlatiladi"}
          </button>
          {open ? (
            <div id={panelId} className="flex flex-col gap-2.5">
              {purpose.routes.map((r) => (
                <RouteEditor
                  key={`${r.id}:${r.source}:${r.entries.map((e) => `${e.provider}/${e.model ?? ""}`).join(",")}`}
                  route={r}
                  canEdit={canEdit}
                  providerUsable={providerUsable}
                  propagationSec={propagationSec}
                  onChanged={onChanged}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
