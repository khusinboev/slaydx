"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from "lucide-react";
import { Badge, Button, ConfirmDialog, toast } from "@/components/admin/ui";
import { fmtDateTime } from "@/lib/admin-format";
import { resetRoute, setRoute, type RouteEntry, type RouteItem } from "@/lib/admin-api/providers";
import { SOURCE_LABEL, modelPrice, propagationNote, routeText, sameEntries } from "./format";

const SELECT_CLASS = "border-input bg-card focus:ring-ring h-9 min-w-0 flex-1 rounded-lg border px-2 text-[13px] outline-none focus:ring-2";

const keyOf = (e: RouteEntry): string => `${e.provider}|${e.model ?? ""}`;

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Editor of ONE routing slot (which provider and model serve a purpose, in priority order). The draft lives in this
 * component; «Saqlash» asks for a reason (audited, step-up) and the server validates again. The page remounts it
 * (by key) after every save, so the draft always starts from what is stored.
 *
 *   chain  rows of provider + model, ordered; the first that answers wins, the next is the fallback;
 *   model  one model;
 *   order  rows of providers (voices), ordered.
 */
export function RouteEditor({
  route,
  canEdit,
  providerUsable,
  propagationSec,
  onChanged,
}: {
  route: RouteItem;
  canEdit: boolean;
  /** Provider id -> can serve right now (from the provider list). */
  providerUsable: Readonly<Record<string, boolean>>;
  propagationSec: number;
  onChanged: () => void;
}) {
  const initial: RouteEntry[] = route.entries.map((e) => ({ provider: e.provider, model: e.model }));
  const [draft, setDraft] = useState<RouteEntry[]>(initial);
  const [confirm, setConfirm] = useState<"save" | "reset" | null>(null);

  const labelOf = (provider: string) => route.providers.find((p) => p.id === provider)?.label ?? provider;
  const withLabels = (entries: readonly RouteEntry[]) => entries.map((e) => ({ ...e, label: labelOf(e.provider) }));
  const dirty = !sameEntries(draft, initial);
  const keys = draft.map(keyOf);
  const duplicate = new Set(keys).size !== keys.length;
  const usableCount = draft.filter((e) => providerUsable[e.provider]).length;
  const firstDown = draft.length > 0 && !providerUsable[draft[0].provider];

  const optionLabel = (o: RouteItem["models"][number]) => `${labelOf(o.provider)} · ${o.model} — ${modelPrice(o)}`;
  const unusedOptions = route.models.filter((o) => !keys.includes(`${o.provider}|${o.model}`));
  const unusedProviders = route.providers.filter((p) => !draft.some((e) => e.provider === p.id));
  const canAdd = canEdit && draft.length < route.max && (route.shape === "order" ? unusedProviders.length > 0 : unusedOptions.length > 0);

  function addEntry() {
    if (route.shape === "order") {
      const p = unusedProviders[0];
      if (p) setDraft([...draft, { provider: p.id, model: null }]);
      return;
    }
    const o = unusedOptions[0];
    if (o) setDraft([...draft, { provider: o.provider, model: o.model }]);
  }

  return (
    <div data-route={route.id} data-source={route.source} className="flex flex-col gap-2.5 rounded-lg border px-3 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{route.title}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{route.help}</p>
        </div>
        <Badge tone={route.source === "db" ? "primary" : "neutral"} title={route.updatedAt ? `${route.updatedBy ?? "admin"} · ${fmtDateTime(route.updatedAt)}` : undefined}>
          {SOURCE_LABEL[route.source]}
        </Badge>
      </div>

      <ol className="flex flex-col gap-2" aria-label={route.title}>
        {draft.map((e, i) => {
          const up = providerUsable[e.provider];
          return (
            <li key={`${keyOf(e)}-${i}`} data-entry={i} className="flex flex-wrap items-center gap-2">
              {route.shape === "model" ? null : (
                <span className="text-muted-foreground w-16 shrink-0 text-xs font-medium">{i === 0 ? "Birinchi" : `Zaxira ${i}`}</span>
              )}
              {route.shape === "order" ? (
                <span className="min-w-0 flex-1 text-[13px] font-medium">{labelOf(e.provider)}</span>
              ) : (
                <select
                  aria-label={`${route.title}: ${i + 1}-qator`}
                  className={SELECT_CLASS}
                  disabled={!canEdit}
                  value={keyOf(e)}
                  onChange={(ev) => {
                    const o = route.models.find((m) => `${m.provider}|${m.model}` === ev.target.value);
                    if (o) setDraft(draft.map((d, j) => (j === i ? { provider: o.provider, model: o.model } : d)));
                  }}
                >
                  {route.models.map((o) => (
                    <option key={`${o.provider}|${o.model}`} value={`${o.provider}|${o.model}`}>
                      {optionLabel(o)}
                    </option>
                  ))}
                </select>
              )}
              <Badge tone={up ? "success" : "neutral"} dot title={up ? "Provayder ishlayapti" : "Provayder hozir ishlamayapti (kalit yo'q yoki o'chirilgan)"}>
                {up ? "Ishlayapti" : "Ishlamayapti"}
              </Badge>
              {canEdit && route.shape !== "model" ? (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`${labelOf(e.provider)}ni yuqoriga`} disabled={i === 0} onClick={() => setDraft(move(draft, i, i - 1))} icon={<ArrowUp className="size-3.5" aria-hidden="true" />} />
                  <Button size="sm" variant="ghost" aria-label={`${labelOf(e.provider)}ni pastga`} disabled={i === draft.length - 1} onClick={() => setDraft(move(draft, i, i + 1))} icon={<ArrowDown className="size-3.5" aria-hidden="true" />} />
                  <Button size="sm" variant="ghost" aria-label={`${labelOf(e.provider)}ni olib tashlash`} disabled={draft.length <= 1} onClick={() => setDraft(draft.filter((_, j) => j !== i))} icon={<X className="size-3.5" aria-hidden="true" />} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {usableCount === 0 ? (
        <p role="alert" className="text-destructive text-xs font-medium">
          Bu tartibdagi hech bir provayder hozir ishlamayapti — vazifa bajarilmaydi. Provayder kalitini kiriting yoki boshqasini tanlang.
        </p>
      ) : firstDown ? (
        <p className="text-badge-warning-text text-xs font-medium">Birinchi provayder ishlamayapti: har so&apos;rov avval undan o&apos;tib, keyin zaxiraga tushadi.</p>
      ) : null}
      {duplicate ? <p className="text-destructive text-xs font-medium">Bir xil yozuv ikki marta tanlangan.</p> : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {route.shape !== "model" ? (
            <Button size="sm" variant="ghost" disabled={!canAdd} onClick={addEntry} icon={<Plus className="size-3.5" aria-hidden="true" />}>
              {route.shape === "order" ? "Provayder qo'shish" : "Zaxira qo'shish"}
            </Button>
          ) : null}
          <span className="flex-1" />
          {dirty ? (
            <Button size="sm" variant="ghost" onClick={() => setDraft(initial)}>
              Bekor qilish
            </Button>
          ) : null}
          {route.source === "db" ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirm("reset")} icon={<RotateCcw className="size-3.5" aria-hidden="true" />}>
              Standartga qaytarish
            </Button>
          ) : null}
          <Button size="sm" variant="primary" disabled={!dirty || duplicate || draft.length === 0} onClick={() => setConfirm("save")}>
            Saqlash
          </Button>
        </div>
      ) : null}

      {confirm === "save" ? (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          title="Sozlamani saqlash"
          description="Yangi tartib hamma yangi so'rovlarga qo'llanadi. Boshlangan ishlar o'z holicha tugaydi."
          target={<span>{route.title}</span>}
          before={routeText(withLabels(initial))}
          after={routeText(withLabels(draft))}
          reason={{ minLength: 5 }}
          confirmLabel="Saqlash"
          onConfirm={async ({ reason }) => {
            await setRoute(route.id, draft, reason);
            toast(`Saqlandi. ${propagationNote(propagationSec)}`);
            setConfirm(null);
            onChanged();
          }}
        />
      ) : null}
      {confirm === "reset" ? (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          title="Standartga qaytarish"
          description="Admin tanlovi o'chiriladi: server sozlamasi (env) yoki o'rnatilgan standart qiymat qaytadi."
          target={<span>{route.title}</span>}
          before={routeText(withLabels(initial))}
          after={routeText(route.fallbackEntries)}
          reason={{ minLength: 5 }}
          danger
          confirmLabel="Qaytarish"
          onConfirm={async ({ reason }) => {
            await resetRoute(route.id, reason);
            toast(`Standartga qaytarildi. ${propagationNote(propagationSec)}`);
            setConfirm(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
