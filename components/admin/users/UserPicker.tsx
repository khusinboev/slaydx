"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { AdminForbiddenError, adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { listUsers, type AdminUserRow } from "@/lib/admin-api/users";
import { Badge, Button } from "@/components/admin/ui";

/** What a pick hands back: enough to show "who" and to address the user by id. */
export type PickedUser = Pick<AdminUserRow, "id" | "name" | "username" | "telegramId" | "phoneMasked">;

export type UserPickerProps = {
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  /** Visible label of the search box. */
  label: string;
  /**
   * Why a row cannot be picked (shown on the disabled option), or `null` when
   * it can. The caller owns the rule (e.g. "already an admin").
   */
  unavailable?: (row: AdminUserRow) => string | null;
  /** Rows per search; the list endpoint's `limit`. */
  limit?: number;
  delayMs?: number;
};

type Results =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: AdminUserRow[]; more: boolean }
  | { status: "error"; message: string };

/** A bare `@`, `#` or `+` classifies to nothing useful on the server (§6.4.1). */
function searchable(q: string): boolean {
  return q !== "" && !/^[@#+]$/.test(q);
}

/**
 * Combobox over `GET /api/admin/users?q=…` (the server's classifier: `#id`,
 * Telegram id, exact `+phone`, `@username` prefix, name prefix). Typing is
 * debounced; every keystroke aborts the request in flight, so a slow answer
 * for an old prefix can never replace a newer one. ARIA combobox pattern:
 * the focus stays in the input, `aria-activedescendant` names the option,
 * ArrowUp/ArrowDown move over the pickable options, Enter picks, Escape
 * closes the list (without closing the surrounding dialog).
 */
export function UserPicker({ value, onChange, label, unavailable, limit = 10, delayMs = 250 }: UserPickerProps) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const listId = `${uid}-list`;
  const statusId = `${uid}-status`;
  const [text, setText] = useState("");
  const [results, setResults] = useState<Results>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    ctrl.current?.abort();
    ctrl.current = null;
  };
  useEffect(() => stop, []);

  const items = results.status === "ready" ? results.items : [];
  const why = (row: AdminUserRow) => unavailable?.(row) ?? null;
  const pickable = items.map((row, i) => (why(row) === null ? i : -1)).filter((i) => i >= 0);

  function search(raw: string) {
    setText(raw);
    stop();
    const q = raw.trim();
    if (!searchable(q)) {
      setResults({ status: "idle" });
      setActive(-1);
      setOpen(false);
      return;
    }
    setResults({ status: "loading" });
    setActive(-1);
    setOpen(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      const c = new AbortController();
      ctrl.current = c;
      listUsers({ q, limit }, { signal: c.signal }).then(
        (res) => {
          if (ctrl.current !== c) return;
          ctrl.current = null;
          setResults({ status: "ready", items: res.items, more: res.nextCursor !== null });
          const first = res.items.findIndex((row) => (unavailable?.(row) ?? null) === null);
          setActive(first);
        },
        (e: unknown) => {
          if (isAbortError(e) || ctrl.current !== c) return;
          ctrl.current = null;
          setResults({
            status: "error",
            message:
              e instanceof AdminForbiddenError
                ? "Foydalanuvchilarni qidirishga ruxsatingiz yo'q. ID bo'yicha kiriting."
                : adminErrorMessage(e),
          });
        },
      );
    }, delayMs);
  }

  function pick(i: number) {
    const row = items[i];
    if (!row || why(row) !== null) return;
    stop();
    setOpen(false);
    onChange({ id: row.id, name: row.name, username: row.username, telegramId: row.telegramId, phoneMasked: row.phoneMasked });
  }

  function move(step: 1 | -1) {
    if (!pickable.length) return;
    const at = pickable.indexOf(active);
    const next = at === -1 ? (step === 1 ? 0 : pickable.length - 1) : (at + step + pickable.length) % pickable.length;
    setActive(pickable[next]!);
    setOpen(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      // Never submit the surrounding form from the search box.
      e.preventDefault();
      if (open && active >= 0) pick(active);
    } else if (e.key === "Escape" && open) {
      // The dialog listens for Escape on window: closing the list must not close the dialog too.
      e.stopPropagation();
      setOpen(false);
    }
  }

  if (value) {
    return (
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <span className="font-semibold">{label}</span>
        <div className="border-input bg-muted/40 flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2" aria-label="Tanlangan foydalanuvchi" role="group">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] font-medium break-words">{value.name || `#${value.id}`}</span>
            <span className="text-muted-foreground text-xs break-all">{metaLine(value)}</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="size-3.5" aria-hidden="true" />}
            onClick={() => {
              onChange(null);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            Boshqasini tanlash
          </Button>
        </div>
      </div>
    );
  }

  const expanded = open && results.status !== "idle";
  const activeId = expanded && active >= 0 && items[active] ? `${uid}-opt-${items[active].id}` : undefined;

  return (
    <div className="flex flex-col gap-1.5 text-[12.5px]">
      <label htmlFor={inputId} className="font-semibold">
        {label}
      </label>
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={statusId}
          value={text}
          onChange={(e) => search(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          autoComplete="off"
          spellCheck={false}
          placeholder="@username, ism, +telefon yoki #ID"
          className="border-input bg-card focus:ring-ring h-9 w-full rounded-lg border pr-2.5 pl-8 text-[13px] outline-none focus:ring-2"
        />
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="Topilgan foydalanuvchilar"
        hidden={!expanded || items.length === 0}
        className="bg-card max-h-64 overflow-y-auto rounded-lg border p-1"
      >
        {items.map((row, i) => {
          const reason = why(row);
          return (
            <li
              key={row.id}
              id={`${uid}-opt-${row.id}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={reason !== null || undefined}
              // Keep the focus in the input (the combobox owns it) while clicking an option.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              onMouseMove={() => reason === null && i !== active && setActive(i)}
              className={cn(
                "flex min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-1.5",
                reason !== null ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                i === active ? "bg-muted" : "",
              )}
            >
              <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                <span className="min-w-0 break-words">{row.name || `#${row.id}`}</span>
                {row.isAdmin ? <Badge tone="primary">Admin</Badge> : null}
                {row.isBlocked ? (
                  <Badge tone="danger" dot>
                    Bloklangan
                  </Badge>
                ) : null}
              </span>
              <span className="text-muted-foreground text-xs break-all">{metaLine(row)}</span>
              {reason !== null ? <span className="text-muted-foreground text-xs">{reason}</span> : null}
            </li>
          );
        })}
      </ul>
      <span id={statusId} aria-live="polite" className={cn("text-xs", results.status === "error" ? "text-destructive" : "text-muted-foreground")}>
        {results.status === "loading"
          ? "Qidirilmoqda…"
          : results.status === "error"
            ? results.message
            : results.status === "ready"
              ? items.length === 0
                ? "Hech kim topilmadi. Ism, @username, +telefon yoki #ID bilan qidiring."
                : results.more
                  ? `Birinchi ${items.length} ta ko'rsatildi — aniqroq yozing.`
                  : `${items.length} ta topildi.`
              : "Ism, @username, +telefon (to'liq), Telegram ID yoki #ID bo'yicha qidiring."}
      </span>
    </div>
  );
}

/** `@username · +998 ** *** ** 67 · #42`: masked phone only (the list never returns a clear one). */
function metaLine(u: Pick<AdminUserRow, "id" | "username" | "phoneMasked">): string {
  return [u.username ? `@${u.username}` : null, u.phoneMasked, `#${u.id}`].filter(Boolean).join(" · ");
}
