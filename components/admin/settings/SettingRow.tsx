"use client";

import { Badge, Button, type Tone } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/admin-format";
import type { SettingItem } from "@/lib/admin-api/settings";
import { formatValue, type ToolOption } from "./format";
import { FEATURE_EFFECT, isFeatureKey, shortHint, STOP_KEYS } from "./layout";

/** Shared by the column header and every row: four columns from 760 px, one stacked card below. */
export const ROW_GRID = "min-[760px]:grid min-[760px]:grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(10rem,auto)] min-[760px]:gap-x-5";

export type SettingRowProps = {
  item: SettingItem;
  tools: ReadonlyArray<ToolOption>;
  /** `settings.edit` (cosmetic; the server enforces it). */
  canEdit: boolean;
  onEdit: (item: SettingItem) => void;
  onReset: (item: SettingItem) => void;
  /** A flag's switch was used: the page opens the confirm dialog on the flipped value. */
  onToggle: (item: SettingItem) => void;
  /** A short remark under the value (e.g. «amalda o'chiq»). */
  note?: string;
};

/** Switch whose click only asks to flip: the change itself happens in the confirm dialog (reason, step-up, audit). */
function FlagSwitch({ item, onToggle }: { item: SettingItem & { type: "bool" }; onToggle: (item: SettingItem) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={item.value}
      aria-label={item.label}
      onClick={() => onToggle(item)}
      className="focus-visible:ring-ring -ml-1 flex h-10 w-14 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
    >
      <span className={cn("relative h-6 w-11 rounded-full border transition-colors", item.value ? "border-primary bg-primary" : "border-input bg-muted")}>
        <span
          aria-hidden="true"
          className={cn("bg-card absolute top-0.5 left-0.5 size-4.5 rounded-full shadow transition-transform", item.value ? "translate-x-5" : "translate-x-0")}
        />
      </span>
    </button>
  );
}

/** Tone of a flag's state: stop switches warn when ON, feature switches are green when ON. */
function flagTone(item: SettingItem & { type: "bool" }): Tone {
  if (STOP_KEYS.has(item.key)) return item.value ? "warning" : "success";
  return item.value ? "success" : "neutral";
}

/** The current value as a badge (flags, tools) or a bold number. */
function ValueView({ item, tools }: { item: SettingItem; tools: ReadonlyArray<ToolOption> }) {
  if (item.type === "bool") {
    return (
      <Badge tone={flagTone(item)} dot>
        {formatValue(item, item.value, tools)}
      </Badge>
    );
  }
  if (item.type === "text") {
    if (!item.value.trim()) return <span className="text-muted-foreground text-[13px]">Kiritilmagan</span>;
    return <span className="line-clamp-3 max-w-full text-[13px] whitespace-pre-line [overflow-wrap:anywhere]">{item.value}</span>;
  }
  if (item.type === "tool_ids") {
    if (item.value.length === 0) return <span className="text-muted-foreground text-[13px]">Hech biri</span>;
    const label = new Map(tools.map((t) => [t.value, t.label]));
    return (
      <span className="flex flex-wrap gap-1.5">
        {item.value.map((id) => (
          <Badge key={id} tone="warning">
            {label.get(id) ?? id}
          </Badge>
        ))}
      </span>
    );
  }
  return <b className="text-[14px] tabular-nums">{formatValue(item, item.value, tools)}</b>;
}

/**
 * One setting: Uzbek label, a one-line explanation, the current value, the default,
 * who changed it and when, and the actions. Table row from 760 px, stacked card below.
 */
export function SettingRow({ item, tools, canEdit, onEdit, onReset, onToggle, note }: SettingRowProps) {
  const feature = isFeatureKey(item.key);
  const overridden = item.source === "db";
  return (
    <li data-setting={item.key} className="flex flex-col gap-3 border-t px-4 py-3.5 first:border-t-0 min-[760px]:items-start">
      <div className={cn("flex w-full flex-col gap-3", ROW_GRID, "min-[760px]:items-start")}>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold">{item.label}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{feature ? FEATURE_EFFECT[item.key] : shortHint(item.description)}</p>
          {overridden && item.updatedAt ? (
            <p className="text-muted-foreground mt-1.5 text-xs">
              O&apos;zgartirgan: <span className="text-foreground">{item.updatedBy ?? "noma'lum admin"}</span> · {fmtDateTime(item.updatedAt)}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase min-[760px]:hidden">Hozirgi qiymat</span>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ValueView item={item} tools={tools} />
            {overridden ? <Badge tone="primary">O&apos;zgartirilgan</Badge> : null}
          </div>
          {note ? (
            <p data-setting-note className="text-warning text-xs font-medium">
              {note}
            </p>
          ) : null}
        </div>

        <p className="text-muted-foreground min-w-0 text-xs min-[760px]:text-[13px]">
          <span className="min-[760px]:hidden">Standart: </span>
          <span data-setting-default className="text-foreground tabular-nums">
            {formatValue(item, item.envValue, tools)}
          </span>
        </p>

        <div className="flex min-w-0 flex-wrap items-center gap-2 min-[760px]:justify-end">
          {canEdit && item.type === "bool" ? <FlagSwitch item={item} onToggle={onToggle} /> : null}
          {canEdit && item.type !== "bool" ? (
            <Button className="max-[759px]:min-h-10" onClick={() => onEdit(item)}>
              O&apos;zgartirish
            </Button>
          ) : null}
          {canEdit && overridden ? (
            <Button variant="ghost" className="max-[759px]:min-h-10" onClick={() => onReset(item)}>
              Standartga qaytarish
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
