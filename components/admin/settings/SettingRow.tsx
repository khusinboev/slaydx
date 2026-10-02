"use client";

import { Badge, Button, type Tone } from "@/components/admin/ui";
import { fmtDateTime } from "@/lib/admin-format";
import type { SettingItem, SettingSource } from "@/lib/admin-api/settings";
import { formatValue, SOURCE_LABEL, type ToolOption } from "./format";

const SOURCE_TONE: Record<SettingSource, Tone> = { db: "primary", env: "info", default: "neutral" };

export type SettingRowProps = {
  item: SettingItem;
  tools: ReadonlyArray<ToolOption>;
  /** `settings.edit` (cosmetic; the server enforces it). */
  canEdit: boolean;
  onEdit: (item: SettingItem) => void;
  onReset: (item: SettingItem) => void;
};

/** The current value as a badge (flags, tools) or a bold number. */
function ValueView({ item, tools }: { item: SettingItem; tools: ReadonlyArray<ToolOption> }) {
  if (item.type === "bool") {
    // Every flag in the catalog is a stop switch: "on" means something is switched off.
    return (
      <Badge tone={item.value ? "warning" : "success"} dot>
        {formatValue(item, item.value, tools)}
      </Badge>
    );
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

/** One setting: label, description and key, value, source badge, env value, last writer, actions. */
export function SettingRow({ item, tools, canEdit, onEdit, onReset }: SettingRowProps) {
  return (
    <li data-setting={item.key} className="flex flex-wrap items-start gap-x-5 gap-y-3 border-t px-4 py-3.5 first:border-t-0">
      <div className="min-w-[min(100%,15rem)] flex-1">
        <p className="text-[13.5px] font-semibold">{item.label}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{item.description}</p>
        <p className="text-muted-foreground mt-1 font-mono text-[11.5px] break-all">{item.key}</p>
        <p className="text-muted-foreground mt-1.5 text-xs">
          Env / standart: <span className="text-foreground tabular-nums">{formatValue(item, item.envValue, tools)}</span>
        </p>
        {item.source === "db" && item.updatedAt ? (
          <p className="text-muted-foreground mt-0.5 text-xs">
            O&apos;zgartirgan: <span className="text-foreground">{item.updatedBy ?? "noma'lum admin"}</span> · {fmtDateTime(item.updatedAt)}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          <ValueView item={item} tools={tools} />
          <Badge tone={SOURCE_TONE[item.source]}>{SOURCE_LABEL[item.source]}</Badge>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onEdit(item)}>
              O&apos;zgartirish
            </Button>
            {item.source === "db" ? (
              <Button size="sm" variant="ghost" onClick={() => onReset(item)}>
                Standartga qaytarish
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
