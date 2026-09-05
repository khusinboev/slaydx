"use client";

import Link from "next/link";
import { useEffect } from "react";
import { TOOLS, toolBlockedReason } from "@/lib/tools";
import { TOOL_ICONS } from "../shell/icons";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";

export function CreateGrid() {
  const hydrated = useAppStore((s) => s.hydrated);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const features = useAppStore((s) => s.features);
  const open = useUi((s) => s.open);

  useEffect(() => {
    if (hydrated && !loggedIn) open("login", { returnTo: "/uz/create" });
  }, [hydrated, loggedIn, open]);

  if (!hydrated) return <div className="text-muted-foreground p-8 text-sm">Yuklanmoqda...</div>;

  const groups = [
    { id: "umumiy", label: "Umumiy vositalar" },
    { id: "talaba", label: "Talaba ishlari" },
    { id: "oqituvchi", label: "O'qituvchi vositalari" },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Nima yaratamiz?</h1>
      <p className="text-muted-foreground mb-8 text-sm">
        AI yordamida bir necha soniyada professional kontent yarating
      </p>
      {groups.map((g) => (
        <section key={g.id} className="mb-8">
          <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
            {g.label}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.filter((t) => t.group === g.id).map((t) => {
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
                        {t.basePrice.toLocaleString("uz-UZ")} tanga dan
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
