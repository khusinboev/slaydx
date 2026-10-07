"use client";

import { useSyncExternalStore } from "react";
import { Search } from "lucide-react";

const noop = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Field-looking button «Vosita yoki fayl qidirish» → the search dialog
 * (`useUi.open("search")`; the shell also binds Cmd/Ctrl+K). The shortcut
 * hint is drawn only for a fine pointer (desktop); ⌘ on Apple, Ctrl
 * elsewhere (server / hydration pass: Ctrl).
 */
export function HubSearch({ onOpen }: { onOpen: () => void }) {
  const mac = useSyncExternalStore(noop, isMac, () => false);
  return (
    <button
      type="button"
      data-hub-search
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      onClick={onOpen}
      className="bg-card text-muted-foreground hover:border-primary/40 focus-visible:ring-ring flex h-11 w-full min-w-0 items-center gap-2.5 rounded-[14px] border px-3.5 text-left text-[15.5px] shadow-[var(--shadow-card)] outline-none transition-colors focus-visible:ring-2"
    >
      <Search className="size-[18px] shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Vosita yoki fayl qidirish</span>
      <kbd
        data-hub-search-kbd
        className="bg-muted text-muted-foreground hidden shrink-0 rounded-md border px-1.5 py-0.5 font-sans text-[12.5px] font-medium pointer-fine:inline-block"
      >
        {mac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}
