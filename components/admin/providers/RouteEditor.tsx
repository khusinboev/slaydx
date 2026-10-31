"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from "lucide-react";
import { Badge, Button, ConfirmDialog, toast } from "@/components/admin/ui";
import { fmtDateTime } from "@/lib/admin-format";
import { resetRoute, setRoute, type RouteEntry, type RouteItem } from "@/lib/admin-api/providers";
import { SOURCE_LABEL, modelPrice, propagationNote, routeText, sameEntries } from "./format";

const SELECT_CLASS = "border-input bg-card focus:ring-ring h-9 min-w-0 flex-1 rounded-lg border px-2 text-[13px] outline-none focus:ring-2";

const keyOf = (e: RouteEntry): string => `${e.provider}|${e.model ?? ""}`;

/** A draft row keeps its identity (`rid`) while its value changes or it moves, so the browser keeps focus on it. */
type Row = RouteEntry & { rid: number };
let rowCounter = 0;
const toRow = (e: RouteEntry): Row => ({ provider: e.provider, model: e.model, rid: ++rowCounter });
const plain = (rows: readonly Row[]): RouteEntry[] => rows.map(({ provider, model }) => ({ provider, model }));

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
 *   order  EVERY allowed provider, reorder only: the first one speaks, the next is the fallback. Switching a provider
 *          off altogether is the provider's own switch, not a missing row.
 */
export function RouteEditor({
  route,
  canEdit,
  propagationSec,
  onChanged,
}: {
  route: RouteItem;
  canEdit: boolean;
  propagationSec: number;
  onChanged: () => void;
}) {
  const initial: RouteEntry[] = (() => {
    const base = route.entries.map((e) => ({ provider: e.provider, model: e.model }));
    if (route.shape !== "order") return base;
    // A stored order may list only some voices; the editor always shows all of them (the unlisted ones run last).
    return [...base, ...route.providers.filter((p) => !base.some((e) => e.provider === p.id)).map((p) => ({ provider: p.id, model: null }))];
  })();
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [confirm, setConfirm] = useState<"save" | "reset" | null>(null);

  const draft = plain(rows);
  const labelOf = (provider: string) => route.providers.find((p) => p.id === provider)?.label ?? provider;
  const withLabels = (entries: readonly RouteEntry[]) => entries.map((e) => ({ ...e, label: labelOf(e.provider) }));
  const dirty = !sameEntries(draft, initial);
  const keys = draft.map(keyOf);
  const duplicate = new Set(keys).size !== keys.length;
  const usable = (provider: string) => route.usable[provider] === true;
  const usableCount = draft.filter((e) => usable(e.provider)).length;
  const firstDown = draft.length > 0 && !usable(draft[0].provider);
  // A value that came from the server's environment may be outside the price book: it is shown (never silently replaced
  // by the first option) but cannot be saved.
  const priced = (e: RouteEntry) => route.shape === "order" || route.models.some((m) => m.provider === e.provider && m.model === e.model);
  const unpriced = draft.filter((e) => !priced(e));

  const optionLabel = (o: RouteItem["models"][number]) => `${labelOf(o.provider)} · ${o.model} — ${modelPrice(o)}`;
  const unusedOptions = route.models.filter((o) => !keys.includes(`${o.provider}|${o.model}`));
  const listShape = route.shape === "chain";
  const canAdd = canEdit && listShape && rows.length < route.max && unusedOptions.length > 0;
  const canReorder = canEdit && route.shape !== "model";

  function addEntry() {
    const o = unusedOptions[0];
    if (o) setRows([...rows, toRow({ provider: o.provider, model: o.model })]);
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
        {rows.map((r, i) => {
          const up = usable(r.provider);
          const own = priced(r) ? [] : [{ provider: r.provider, model: r.model ?? "", inUsdPerM: null, outUsdPerM: null, perImageUsd: null }];
          return (
            <li key={r.rid} data-entry={i} className="flex flex-wrap items-center gap-2">
              {route.shape === "model" ? null : (
                <span className="text-muted-foreground w-16 shrink-0 text-xs font-medium">{i === 0 ? "Birinchi" : `Zaxira ${i}`}</span>
              )}
              {route.shape === "order" ? (
                <span className="min-w-0 flex-1 text-[13px] font-medium">{labelOf(r.provider)}</span>
              ) : (
                <select
                  aria-label={`${route.title}: ${i + 1}-qator`}
                  className={SELECT_CLASS}
                  disabled={!canEdit}
                  value={keyOf(r)}
                  onChange={(ev) => {
                    const o = route.models.find((m) => `${m.provider}|${m.model}` === ev.target.value);
                    if (o) setRows(rows.map((d, j) => (j === i ? { ...d, provider: o.provider, model: o.model } : d)));
                  }}
                >
                  {[...own, ...route.models].map((o) => (
                    <option key={`${o.provider}|${o.model}`} value={`${o.provider}|${o.model}`}>
                      {o.perImageUsd === null && o.inUsdPerM === null ? `${labelOf(o.provider)} · ${o.model} — narxsiz (narxlar jadvalida yo'q)` : optionLabel(o)}
                    </option>
                  ))}
                </select>
              )}
              <Badge tone={up ? "success" : "neutral"} dot title={up ? "Provayder ishlayapti" : "Provayder hozir ishlamayapti (kalit yo'q yoki o'chirilgan)"}>
                {up ? "Ishlayapti" : "Ishlamayapti"}
              </Badge>
              {canReorder ? (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`${labelOf(r.provider)}ni yuqoriga`} disabled={i === 0} onClick={() => setRows(move(rows, i, i - 1))} icon={<ArrowUp className="size-3.5" aria-hidden="true" />} />
                  <Button size="sm" variant="ghost" aria-label={`${labelOf(r.provider)}ni pastga`} disabled={i === rows.length - 1} onClick={() => setRows(move(rows, i, i + 1))} icon={<ArrowDown className="size-3.5" aria-hidden="true" />} />
                  {listShape ? (
                    <Button size="sm" variant="ghost" aria-label={`${labelOf(r.provider)}ni olib tashlash`} disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} icon={<X className="size-3.5" aria-hidden="true" />} />
                  ) : null}
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
      {unpriced.length > 0 ? (
        <p role="alert" data-unpriced className="text-destructive text-xs font-medium">
          {unpriced.map((e) => e.model).join(", ")}: narxlar jadvalida yo&apos;q (serverning muhit sozlamasidan kelgan), shuning uchun saqlab bo&apos;lmaydi. Ro&apos;yxatdagi modelni tanlang.
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          {listShape ? (
            <Button size="sm" variant="ghost" disabled={!canAdd} onClick={addEntry} icon={<Plus className="size-3.5" aria-hidden="true" />}>
              Zaxira qo&apos;shish
            </Button>
          ) : null}
          <span className="flex-1" />
          {dirty ? (
            <Button size="sm" variant="ghost" onClick={() => setRows(initial.map(toRow))}>
              Bekor qilish
            </Button>
          ) : null}
          {route.source === "db" ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirm("reset")} icon={<RotateCcw className="size-3.5" aria-hidden="true" />}>
              Standartga qaytarish
            </Button>
          ) : null}
          <Button size="sm" variant="primary" disabled={!dirty || duplicate || unpriced.length > 0 || draft.length === 0} onClick={() => setConfirm("save")}>
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
