"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { TOOLS } from "@/lib/tools";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { TOOL_ICONS } from "../shell/icons";
import { useDialog } from "./useDialog";

export function SearchDialog() {
  const open = useUi((s) => s.overlay === "search");
  const close = useUi((s) => s.close);
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const generations = useAppStore((s) => s.generations);
  const openLogin = useUi((s) => s.open);
  const [q, setQ] = useState("");
  const panelRef = useDialog(open, close);

  const tools = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return TOOLS;
    return TOOLS.filter(
      (t) => t.title.toLowerCase().includes(s) || t.description.toLowerCase().includes(s),
    );
  }, [q]);

  const files = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return generations.slice(0, 6);
    return generations.filter((g) => g.topic.toLowerCase().includes(s)).slice(0, 8);
  }, [q, generations]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Qidiruv"
    >
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Yopish" onClick={close} />
      <div ref={panelRef} className="bg-card relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border shadow-xl">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Qidirish..."
            className="h-12 flex-1 bg-transparent text-[15.5px] outline-none"
          />
          <button type="button" onClick={close} className="hover:bg-muted rounded-full p-1.5" aria-label="Yopish">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          <p className="text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wider uppercase">
            Xizmatlar
          </p>
          {tools.map((t) => {
            const Icon = TOOL_ICONS[t.icon];
            return (
              <button
                key={t.id}
                type="button"
                className="hover:bg-muted flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left"
                onClick={() => {
                  close();
                  router.push(`/uz/${t.slug}`);
                  if (!loggedIn) openLogin("login", { returnTo: `/uz/${t.slug}` });
                }}
              >
                {Icon ? (
                  <Icon className="size-4 text-[rgb(var(--tc))]" style={{ ["--tc" as string]: t.tc }} />
                ) : null}
                <span className="flex-1 text-sm font-medium">{t.title}</span>
                <span className="text-muted-foreground text-xs">{t.description}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="hover:bg-muted mt-1 flex w-full rounded-xl px-2 py-2 text-left text-sm"
            onClick={() => {
              close();
              router.push("/uz/purchase");
            }}
          >
            <span className="flex-1 font-medium">Tariflar</span>
            <span className="text-muted-foreground text-xs">Rejani tanlang</span>
          </button>
          {loggedIn ? (
            <>
              <p className="text-muted-foreground mt-2 px-2 py-1.5 text-xs font-semibold tracking-wider uppercase">
                Fayllar
              </p>
              {files.length === 0 ? (
                <p className="text-muted-foreground px-2 py-3 text-sm">
                  Yaratgan fayllaringiz ichidan qidiring
                </p>
              ) : (
                files.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="hover:bg-muted flex w-full rounded-xl px-2 py-2 text-left text-sm"
                    onClick={() => {
                      close();
                      router.push(`/uz/files/${g.id}`);
                    }}
                  >
                    {g.topic}
                  </button>
                ))
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
