"use client";

import { Moon, Sun } from "lucide-react";
import { useAppStore } from "@/lib/store";

/**
 * Light/dark switch backed by the site-wide theme store (`lib/store.ts`), so the
 * admin and the consumer app share one preference. The icon is chosen by CSS
 * (`dark:`), not by store state, which avoids a hydration mismatch: the store
 * only knows the real theme after the client has rehydrated it.
 */
export function ThemeToggle() {
  const setTheme = useAppStore((s) => s.setTheme);
  return (
    <button
      type="button"
      onClick={() => setTheme(useAppStore.getState().theme === "dark" ? "light" : "dark")}
      aria-label="Kunduzgi yoki tungi rejim"
      title="Kunduzgi yoki tungi rejim"
      className="hover:bg-muted focus-visible:ring-ring text-muted-foreground hover:text-foreground inline-flex size-9 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
    >
      <Moon className="size-4 dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-4 dark:block" aria-hidden="true" />
    </button>
  );
}
