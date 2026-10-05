"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { TOOLS, clientAdjustedPrice, toolBlockedReason, visibleToolGroups } from "@/lib/tools";
import { TOOL_ICONS } from "../shell/icons";
import { PageBack } from "../shell/PageBack";
import { useAppStore, usePricingVersion } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { filterCatalogue, type CatalogueGroup } from "./catalogue-filter";

export function CreateGrid() {
  const hydrated = useAppStore((s) => s.hydrated);
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const features = useAppStore((s) => s.features);
  // Re-render the "from" prices when admin adjustments change.
  usePricingVersion();
  const open = useUi((s) => s.open);
  const phone = useCoarsePointer();
  // Katalog filtri: bo'lim chipi + qidiruv (nom/tavsif bo'yicha).
  const [group, setGroup] = useState<CatalogueGroup>("all");
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterCatalogue(TOOLS, group, query), [group, query]);

  /*
   * FE-09: kirish oynasi faqat seans SERVERDAN tekshirilgandan keyin.
   * Ilgari `hydrated` (localStorage o'qildi) ga qarardi — u seans
   * javobidan oldin keladi, shuning uchun kirgan foydalanuvchi ham
   * `/uz/create` ni yangilaganda kirish oynasini ko'rardi.
   */
  useEffect(() => {
    if (sessionChecked && !loggedIn) open("login", { returnTo: "/uz/create" });
  }, [sessionChecked, loggedIn, open]);

  if (!hydrated) return <div className="text-muted-foreground p-8 text-sm">Yuklanmoqda...</div>;

  // Bo'lim yorliqlari `lib/tools.ts` dan (AUDIT-21 R0): `Sidebar` bilan
  // qo'lda sinxronlanadigan ikkinchi ro'yxat yo'q; bo'sh bo'lim (hozir
  // `media`) chizilmaydi.
  const groups = visibleToolGroups();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-2 flex items-center gap-2.5">
        <PageBack />
        <h1 className="text-2xl font-semibold tracking-tight">Nima yaratamiz?</h1>
      </div>
      <p className="text-muted-foreground mb-8 text-sm">
        AI yordamida bir necha soniyada professional kontent yarating
      </p>
      <div
        data-catalogue-bar
        className="bg-[var(--page-bg)] sticky top-0 z-10 -mx-4 mb-4 px-4 pt-1 pb-2"
      >
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Vositalarni qidirish"
            placeholder="Vosita qidirish…"
            data-catalogue-search
            className={cn(
              "border-input bg-background w-full rounded-full border pr-11 pl-10 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              phone ? "h-11" : "h-10",
            )}
          />
          {query ? (
            <button
              type="button"
              aria-label="Qidiruvni tozalash"
              onClick={() => setQuery("")}
              className="text-muted-foreground absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div
          role="group"
          aria-label="Bo'limlar"
          data-group-chips
          className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {([{ id: "all", label: "Hammasi" }, ...groups] as { id: CatalogueGroup; label: string }[]).map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={group === g.id}
              data-group-chip={g.id}
              onClick={() => setGroup(g.id)}
              className={cn(
                "inline-flex flex-none items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors",
                phone ? "h-11" : "h-9",
                group === g.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <div data-catalogue-empty className="bg-card rounded-2xl border px-6 py-12 text-center">
          <p className="font-medium">Hech narsa topilmadi</p>
          <p className="text-muted-foreground mt-1 text-sm">Boshqa so‘z yozing yoki bo‘limni almashtiring</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setGroup("all");
            }}
            className="text-primary mt-3 inline-flex min-h-11 items-center px-3 text-sm font-medium"
          >
            Filtrni tozalash
          </button>
        </div>
      ) : null}
      {groups
        .filter((g) => shown.some((t) => t.group === g.id))
        .map((g) => (
        <section key={g.id} data-catalogue-group={g.id} className="mb-8 scroll-mt-32">
          <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
            {g.label}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.filter((t) => t.group === g.id).map((t) => {
              const Icon = TOOL_ICONS[t.icon];
              /*
               * Kalitsiz xizmat SOTILMAYDI. Ilgari kartochka to'liq
               * ko'rinar, foydalanuvchi to'lar, navbat kutar va faqat
               * shundan keyin xato olardi (N-6). Kartochka yashirilmaydi
               * — sabab ochiq yozilib, bosish o'chiriladi.
               */
              const blocked = toolBlockedReason(t, features);
              const body = (
                <>
                  <div className="h-1 bg-[rgb(var(--tc))]" />
                  <div className="p-4">
                    <div className="mb-3 flex items-center gap-2.5">
                      {Icon ? <Icon className="size-5 text-[rgb(var(--tc))]" /> : null}
                      <span className="font-medium">{t.title}</span>
                    </div>
                    <p className="text-muted-foreground text-sm">{t.description}</p>
                    {blocked ? (
                      <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-500">{blocked}</p>
                    ) : (
                      <p className="mt-3 text-xs font-medium">
                        {clientAdjustedPrice(t.id, t.basePrice).toLocaleString("uz-UZ")} tanga dan
                      </p>
                    )}
                  </div>
                </>
              );

              if (blocked) {
                return (
                  <div
                    key={t.id}
                    style={{ ["--tc" as string]: t.tc }}
                    aria-disabled
                    className="bg-card overflow-hidden rounded-2xl border opacity-60"
                  >
                    {body}
                  </div>
                );
              }

              return (
                <Link
                  key={t.id}
                  href={`/uz/${t.slug}`}
                  style={{ ["--tc" as string]: t.tc }}
                  className="bg-card hover:border-primary/40 overflow-hidden rounded-2xl border transition-colors"
                >
                  {body}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
