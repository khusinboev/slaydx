"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { TOOLS } from "@/lib/tools";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { TOOL_ICONS } from "../shell/icons";
import { OverlayFrame } from "./OverlayFrame";
import { useDialog } from "./useDialog";

export function SearchDialog() {
  const open = useUi((s) => s.overlay === "search");
  const close = useUi((s) => s.close);
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const generations = useAppStore((s) => s.generations);
  // Serverda yana sahifa bor — qidiruv hamma fayllarni ko'rmaydi.
  const moreOnServer = useAppStore((s) => s.generationsCursor !== null);
  const openLogin = useUi((s) => s.open);
  const [q, setQ] = useState("");
  const panelRef = useDialog(open, close);
  /** Telefon (docs/mobile/PLAN.md O5): qatorlar ≥ 48 px, kiritish 16 px, ichki aylantirish. */
  const phone = useCoarsePointer();

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

  const row = cn(
    "hover:bg-muted flex w-full rounded-xl px-2 text-left",
    phone ? "min-h-12 items-center py-1.5" : "py-2",
  );

  return (
    <OverlayFrame
      label="Qidiruv"
      phone={phone}
      className={cn("flex items-start justify-center", !phone && "px-4 pt-[12vh]")}
      topGap="0.5rem"
    >
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Yopish" onClick={close} />
      <div
        ref={panelRef}
        className={cn(
          "bg-card relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border shadow-xl",
          phone && "flex max-h-full flex-col",
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Qidirish..."
            enterKeyHint="search"
            className={cn("min-w-0 flex-1 bg-transparent outline-none", phone ? "h-14 text-base" : "h-12 text-[15.5px]")}
          />
          <button
            type="button"
            onClick={close}
            className={cn(
              "hover:bg-muted flex shrink-0 items-center justify-center rounded-full",
              phone ? "-mr-1 size-11" : "p-1.5",
            )}
            aria-label="Yopish"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className={cn("overflow-y-auto p-2", phone ? "min-h-0 flex-1 overscroll-contain" : "max-h-[60vh]")}>
          <p className="text-muted-foreground px-2 py-1.5 text-xs font-semibold tracking-wider uppercase">
            Xizmatlar
          </p>
          {tools.map((t) => {
            const Icon = TOOL_ICONS[t.icon];
            return (
              <button
                key={t.id}
                type="button"
                className={cn(row, "gap-3", !phone && "items-center")}
                onClick={() => {
                  close();
                  router.push(`/uz/${t.slug}`);
                  if (!loggedIn) openLogin("login", { returnTo: `/uz/${t.slug}` });
                }}
              >
                {Icon ? (
                  <Icon className="size-4 shrink-0 text-[rgb(var(--tc))]" style={{ ["--tc" as string]: t.tc }} />
                ) : null}
                {phone ? (
                  // Telefonda sarlavha va tavsif ustma-ust: bir qatorga sig'masdi.
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="text-muted-foreground block truncate text-xs">{t.description}</span>
                  </span>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium">{t.title}</span>
                    <span className="text-muted-foreground text-xs">{t.description}</span>
                  </>
                )}
              </button>
            );
          })}
          <button
            type="button"
            className={cn(row, "mt-1 text-sm", phone && "gap-3")}
            onClick={() => {
              close();
              router.push("/uz/purchase");
            }}
          >
            {phone ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">Balansni to&apos;ldirish</span>
                <span className="text-muted-foreground block truncate text-xs">Hisobni to&apos;ldiring</span>
              </span>
            ) : (
              <>
                <span className="flex-1 font-medium">Balansni to&apos;ldirish</span>
                <span className="text-muted-foreground text-xs">Hisobni to&apos;ldiring</span>
              </>
            )}
          </button>
          {loggedIn ? (
            <>
              <p className="text-muted-foreground mt-2 px-2 py-1.5 text-xs font-semibold tracking-wider uppercase">
                Fayllar
              </p>
              {/*
               * W2-E/FE-08: qidiruv faqat yuklangan birinchi sahifa (50 ta)
               * ichida — server qidiruvi yo'q. Eskilari bor bo'lsa halol aytiladi,
               * aks holda «topilmadi» = «hujjat o'chib ketgan» deb o'qilardi.
               */}
              {moreOnServer ? (
                <p className="text-muted-foreground px-2 pb-1 text-xs" data-search-partial>
                  Qidiruv faqat yuklanganlar orasida (oxirgi {generations.length} ta). Eskiroq fayllarni «Mening
                  fayllarim» dagi «Yana ko‘rsatish» orqali oching.
                </p>
              ) : null}
              {files.length === 0 ? (
                <p className="text-muted-foreground px-2 py-3 text-sm">
                  {q.trim() ? "Yuklangan fayllar orasida topilmadi" : "Yaratgan fayllaringiz ichidan qidiring"}
                </p>
              ) : (
                files.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={cn(row, "text-sm")}
                    onClick={() => {
                      close();
                      router.push(`/uz/files/${g.id}`);
                    }}
                  >
                    <span className={phone ? "line-clamp-2" : undefined}>{g.topic}</span>
                  </button>
                ))
              )}
            </>
          ) : null}
        </div>
      </div>
    </OverlayFrame>
  );
}
