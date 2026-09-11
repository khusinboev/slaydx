"use client";

import { useState } from "react";
import { useDialog } from "@/components/overlays/useDialog";
import { PUBLICATION_PROFILES } from "@/lib/generation/article/profiles";
import { PUBLICATION_PROFILE_IDS, type CiteStyle, type PublicationProfileId } from "@/lib/generation/article/types";
import { cn } from "@/lib/cn";

/**
 * Nashr profili galereyasi (Maqola 2, WP6) — `ResumeTemplateDialog` naqshi.
 *
 * Har karta HAQIQIY ko'rinish eskizini chizadi: shrift/interval/chegara
 * proporsional kichik varaqda, pastida esa profilning iqtibos namunasi —
 * foydalanuvchi "GOST nima?" deb o'ylamasdan farqni ko'radi.
 */

/** Iqtibos namunasi — profil TANLASHDA ko'rinadi, `citeStyle` bilan bir manba emas (bu yerda faqat vizual). */
const CITE_SAMPLE: Record<CiteStyle, string> = {
  gost: "[1; 25-b.]",
  numeric: "[1]",
  ieee: "[1]",
  apa7: "(Karimov, 2023)",
};

const SHEET_W = 74;
const SHEET_H = 100;
/** sm → px proporsiya kichik varaqda (chegaralar ko'zga ko'rinsin, lekin varaqni yemasin). */
const CM_PX = 2.6;

function ProfileSheet({ id }: { id: PublicationProfileId }) {
  const p = PUBLICATION_PROFILES[id];
  const lineGap = Math.max(2, p.line * 2.2);
  return (
    <div
      className="bg-background relative shrink-0 overflow-hidden rounded border"
      style={{ width: SHEET_W, height: SHEET_H }}
      aria-hidden
    >
      <div
        className="absolute flex flex-col gap-[1px]"
        style={{
          top: p.marginsCm.top * CM_PX,
          bottom: p.marginsCm.bottom * CM_PX,
          left: p.marginsCm.left * CM_PX,
          right: p.marginsCm.right * CM_PX,
        }}
      >
        {[100, 100, 70].map((w, i) => (
          <span
            key={i}
            className="bg-muted-foreground/50 block rounded-sm"
            style={{ height: Math.max(1.5, p.sizePt / 7), width: `${w}%`, marginBottom: lineGap - 2 }}
          />
        ))}
        <span className="text-muted-foreground mt-1 block text-[6px] leading-none">{CITE_SAMPLE[p.cite]}</span>
      </div>
    </div>
  );
}

export function PublicationProfileTile({
  value,
  onChange,
}: {
  value: PublicationProfileId;
  onChange: (id: PublicationProfileId) => void;
}) {
  const [open, setOpen] = useState(false);
  const p = PUBLICATION_PROFILES[value];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-profile-tile
        className="hover:bg-muted flex w-full items-center gap-3 rounded-xl border p-2.5 text-left"
      >
        <ProfileSheet id={value} />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{p.label.uz}</span>
          <span className="text-muted-foreground mt-0.5 block text-[11px]">{p.hint}</span>
          <span className="text-primary mt-1 block text-[11px]">O‘zgartirish</span>
        </span>
      </button>
      {open ? (
        <PublicationProfileDialog
          value={value}
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

export function PublicationProfileDialog({
  value,
  onClose,
  onPick,
}: {
  value: PublicationProfileId;
  onClose: () => void;
  onPick: (id: PublicationProfileId) => void;
}) {
  const panelRef = useDialog(true, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/50 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Nashr profili"
        onClick={(e) => e.stopPropagation()}
        className="bg-card my-8 w-full max-w-2xl rounded-2xl border p-4 shadow-xl"
      >
        <h2 className="mb-3 text-[15px] font-semibold">Nashr profilini tanlang</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PUBLICATION_PROFILE_IDS.map((id) => {
            const p = PUBLICATION_PROFILES[id];
            return (
              <button
                key={id}
                type="button"
                data-profile-card={id}
                onClick={() => onPick(id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
                  id === value ? "border-primary bg-primary/5" : "hover:bg-muted",
                )}
              >
                <ProfileSheet id={id} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{p.label.uz}</span>
                  <span className="text-muted-foreground mt-0.5 block text-[11px]">{p.hint}</span>
                  <span className="text-muted-foreground mt-1 block text-[10.5px]">
                    manba {p.refsMin}–{p.refsMax} ta
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
