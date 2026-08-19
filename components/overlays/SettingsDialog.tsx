"use client";

import { X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { THEME_OPTIONS, UI_LOCALES, useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { useDialog } from "./useDialog";

export function SettingsDialog() {
  const open = useUi((s) => s.overlay === "settings");
  const close = useUi((s) => s.close);
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const dir = useAppStore((s) => s.dir);
  const setDir = useAppStore((s) => s.setDir);
  const reset = useAppStore((s) => s.resetUiPrefs);
  const panelRef = useDialog(open, close);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Sozlamalar"
    >
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Yopish" onClick={close} />
      <div ref={panelRef} className="bg-card relative z-10 w-full max-w-lg rounded-2xl border p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sozlamalar</h2>
          <button type="button" onClick={close} className="hover:bg-muted rounded-full p-1.5" aria-label="Yopish">
            <X className="size-4" />
          </button>
        </div>

        <section className="mb-5">
          <h3 className="mb-2 text-sm font-medium">Til</h3>
          <p className="text-muted-foreground mb-2 text-xs">O&apos;zingizga qulay tilni tanlang</p>
          <div className="flex flex-wrap gap-2">
            {UI_LOCALES.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setLocale(l.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm",
                  locale === l.value ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
                )}
              >
                {l.flag} {l.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-5">
          <h3 className="mb-2 text-sm font-medium">Mavzu</h3>
          <div className="flex flex-wrap gap-2">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTheme(t.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm",
                  theme === t.value ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-6">
          <h3 className="mb-2 text-sm font-medium">Yo&apos;nalish</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDir("ltr")}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm",
                dir === "ltr" ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
              )}
            >
              Chapdan o&apos;ngga
            </button>
            <button
              type="button"
              onClick={() => setDir("rtl")}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm",
                dir === "rtl" ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
              )}
            >
              O&apos;ngdan chapga
            </button>
          </div>
        </section>

        <button
          type="button"
          onClick={reset}
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-2 hover:underline"
        >
          Barcha sozlamalarni standart holatga qaytarish
        </button>
      </div>
    </div>
  );
}
