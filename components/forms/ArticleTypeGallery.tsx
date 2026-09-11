"use client";

import { useState } from "react";
import { useDialog } from "@/components/overlays/useDialog";
import { ARTICLE_TYPE_IDS, type ArticleTypeId } from "@/lib/generation/article/types";
import { ARTICLE_TYPES } from "@/lib/generation/article/types-registry";
import { articleLabels } from "@/lib/generation/article/labels";
import { cn } from "@/lib/cn";

/**
 * Maqola turi galereyasi (Maqola 2, WP6) — `ResumeTemplateDialog` naqshi:
 * formada BITTA plitka turadi, ustiga bosilsa 12 turni ko'rsatuvchi
 * qalqib chiquvchi oyna ochiladi.
 *
 * Har karta o'zining SKELET bo'limlarini ko'rsatadi (`ARTICLE_TYPES[id]
 * .skeleton` → `articleLabels(language).section[titleKey]`) — foydalanuvchi
 * turni TANLASHDAN OLDIN qanday bo'limlar chiqishini ko'radi, keyin
 * "nega mening maqolamda X bo'lim yo'q" degan savol qolmaydi. Bo'lim
 * nomlari TANLANGAN TILDA (`ui.language`) — chunki hujjatda aynan shu
 * nomlar chiqadi, interfeys tilida emas.
 */

export function ArticleTypeTile({
  value,
  language,
  onChange,
}: {
  value: ArticleTypeId;
  language: string;
  onChange: (id: ArticleTypeId) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = ARTICLE_TYPES[value];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-type-tile
        className="hover:bg-muted flex w-full items-start justify-between gap-3 rounded-xl border p-2.5 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{t.label.uz}</span>
          <span className="text-muted-foreground mt-0.5 block text-[11px]">{t.hint}</span>
        </span>
        <span className="text-primary mt-0.5 shrink-0 text-[11px]">O‘zgartirish</span>
      </button>
      {open ? (
        <ArticleTypeDialog
          value={value}
          language={language}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export function ArticleTypeDialog({
  value,
  language,
  onClose,
  onPick,
}: {
  value: ArticleTypeId;
  language: string;
  onClose: () => void;
  onPick: (id: ArticleTypeId) => void;
}) {
  const panelRef = useDialog(true, onClose);
  const labels = articleLabels(language);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/50 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Maqola turi"
        onClick={(e) => e.stopPropagation()}
        className="bg-card my-8 w-full max-w-3xl rounded-2xl border p-4 shadow-xl"
      >
        <h2 className="mb-3 text-[15px] font-semibold">Maqola turini tanlang</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ARTICLE_TYPE_IDS.map((id) => {
            const t = ARTICLE_TYPES[id];
            return (
              <button
                key={id}
                type="button"
                data-type-card={id}
                onClick={() => onPick(id)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition-colors",
                  id === value ? "border-primary bg-primary/5" : "hover:bg-muted",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium">{t.label.uz}</span>
                  {id === "imrad_oak" ? (
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      ⭐ tavsiya
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-[11px]">{t.hint}</span>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {t.skeleton.map((s) => (
                    <li key={s.id} className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
                      {labels.section[s.titleKey]}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
