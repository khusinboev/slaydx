"use client";

import { useId, useState } from "react";
import { ConfirmDialog, toast } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { updateSetting, type SettingItem, type SettingValue } from "@/lib/admin-api/settings";
import { fmtNumber } from "@/lib/admin-format";
import { checkNumberText, formatValue, numberText, PROPAGATION_NOTE, type ToolOption } from "./format";

export type SettingEditDialogProps = {
  /** The setting being edited; `null` keeps the dialog closed. */
  item: SettingItem | null;
  tools: ReadonlyArray<ToolOption>;
  onClose: () => void;
  /** Called with the server's updated item after a successful save. */
  onSaved: (item: SettingItem) => void;
};

const FIELD = "border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 text-[13px] tabular-nums outline-none focus:ring-2 disabled:opacity-60";

/**
 * Edit dialog per setting type (plan §7.1 S14): a switch for flags, a bounded
 * number input, a multi-select of tools. Reason is required and audited; the
 * step-up code is asked by the admin API core when the server needs it.
 */
export function SettingEditDialog(props: SettingEditDialogProps) {
  if (!props.item) return null;
  return <Body key={props.item.key} {...props} item={props.item} />;
}

function initialDraft(item: SettingItem): { bool: boolean; text: string; tools: string[] } {
  return {
    bool: item.type === "bool" ? item.value : false,
    text: item.type === "int" || item.type === "number" ? numberText(item.value) : "",
    tools: item.type === "tool_ids" ? [...item.value] : [],
  };
}

function Body({ item, tools, onClose, onSaved }: SettingEditDialogProps & { item: SettingItem }) {
  const ids = useId();
  const [draft, setDraft] = useState(() => initialDraft(item));

  let next: SettingValue | null = null;
  let error: string | null = null;
  if (item.type === "bool") {
    next = draft.bool;
  } else if (item.type === "tool_ids") {
    next = draft.tools;
  } else {
    const checked = checkNumberText(item, draft.text);
    if (checked.ok) next = checked.value;
    else error = checked.error;
  }

  const showError = error !== null && draft.text !== "";
  const hint = item.min !== null && item.max !== null ? `${fmtNumber(item.min, { digits: 2 })} dan ${fmtNumber(item.max, { digits: 2 })} gacha` : null;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Sozlamani o'zgartirish"
      description={item.description}
      target={
        <span>
          {item.label} <span className="text-muted-foreground font-mono text-xs">{item.key}</span>
        </span>
      }
      before={formatValue(item, item.value, tools)}
      after={next === null ? "—" : formatValue(item, next, tools)}
      reason={{ minLength: 5 }}
      confirmLabel="Saqlash"
      confirmDisabled={next === null}
      onConfirm={async ({ reason }) => {
        if (next === null) return;
        const { item: saved } = await updateSetting(item.key, next, reason);
        toast(`Saqlandi. ${PROPAGATION_NOTE}`);
        onSaved(saved);
      }}
    >
      {item.type === "bool" ? (
        <div className="flex items-center gap-3 text-[13px]">
          <button
            type="button"
            role="switch"
            aria-checked={draft.bool}
            aria-label={item.label}
            onClick={() => setDraft((d) => ({ ...d, bool: !d.bool }))}
            className={cn(
              "focus-visible:ring-ring relative h-6 w-11 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2",
              draft.bool ? "border-primary bg-primary" : "border-input bg-muted",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "bg-card absolute top-0.5 left-0.5 size-4.5 rounded-full shadow transition-transform",
                draft.bool ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
          <span className="font-medium">{draft.bool ? "Yoqilgan" : "O'chiq"}</span>
        </div>
      ) : null}

      {item.type === "int" || item.type === "number" ? (
        <div className="flex flex-col gap-1.5 text-[12.5px]">
          <label htmlFor={`${ids}-value`} className="font-semibold">
            Yangi qiymat
          </label>
          <input
            id={`${ids}-value`}
            value={draft.text}
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            inputMode={item.type === "int" ? "numeric" : "decimal"}
            autoComplete="off"
            aria-invalid={showError}
            aria-describedby={`${ids}-hint`}
            className={FIELD}
          />
          <span id={`${ids}-hint`} className={cn("text-xs", showError ? "text-destructive" : "text-muted-foreground")}>
            {showError ? error : (hint ?? "")}
          </span>
        </div>
      ) : null}

      {item.type === "tool_ids" ? (
        <fieldset className="flex flex-col gap-2 text-[12.5px]">
          <legend className="font-semibold">To&apos;xtatiladigan vositalar</legend>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, tools: tools.map((t) => t.value) }))}
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
            >
              Hammasini tanlash
            </button>
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, tools: [] }))}
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
            >
              Tozalash
            </button>
          </div>
          <div className="grid max-h-64 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto sm:grid-cols-2">
            {tools.map((t) => {
              const checked = draft.tools.includes(t.value);
              return (
                <label key={t.value} className="flex min-w-0 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setDraft((d) => ({ ...d, tools: checked ? d.tools.filter((x) => x !== t.value) : [...d.tools, t.value] }))
                    }
                    className="accent-primary size-4 shrink-0"
                  />
                  <span className="truncate">{t.label}</span>
                </label>
              );
            })}
          </div>
          <span className="text-muted-foreground text-xs">Tanlangan: {draft.tools.length} ta</span>
        </fieldset>
      ) : null}
    </ConfirmDialog>
  );
}
