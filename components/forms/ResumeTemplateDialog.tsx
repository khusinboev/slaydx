"use client";

import { useMemo, useState } from "react";
import { useDialog } from "@/components/overlays/useDialog";
import { ResumePage } from "@/components/viewers/resume/ResumePage";
import { planResume } from "@/lib/generation/resume/layout";
import { sampleResume } from "@/lib/generation/resume/samples";
import {
  RESUME_PALETTES,
  RESUME_PALETTE_IDS,
  RESUME_TEMPLATES,
  RESUME_TEMPLATE_IDS,
  type ResumePaletteId,
  type ResumeTemplateId,
} from "@/lib/generation/resume/templates";
import { A4 } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";

/**
 * Shablon galereyasi (Rezyume 2, 6-band) — Shablonlar 2 dagi
 * `TemplateGallery` naqshi: formada BITTA plitka turadi, ustiga bosilsa
 * qalqib chiquvchi oynada barcha variant ko'rinadi.
 *
 * Kartalar HAQIQIY chizg'ich bilan chiziladi (`ResumePage` + namuna
 * model): «ko'rdim = oldim» galereyaga ham tegishli — bu yerda alohida
 * «preview rasm» yo'q, foydalanuvchi aynan natijani ko'radi.
 */

const THUMB_SCALE = 0.3;

function ResumeThumb({
  template,
  palette,
  withPhoto,
}: {
  template: ResumeTemplateId;
  palette: ResumePaletteId;
  withPhoto: boolean;
}) {
  const layout = useMemo(() => planResume(sampleResume(template, palette, withPhoto)), [template, palette, withPhoto]);
  const main = layout.zones.find((z) => z.id === "main")?.items ?? [];
  return (
    <div
      className="bg-card relative overflow-hidden rounded-lg border"
      style={{ width: A4.wPx * THUMB_SCALE, height: A4.hPx * THUMB_SCALE }}
    >
      <div
        className="origin-top-left"
        style={{ width: A4.wPx, height: A4.hPx, transform: `scale(${THUMB_SCALE})` }}
        aria-hidden
      >
        <ResumePage layout={layout} pageItems={main} pageIndex={0} total={1} />
      </div>
    </div>
  );
}

export function ResumeTemplateTile({
  template,
  palette,
  withPhoto,
  onChange,
}: {
  template: ResumeTemplateId;
  palette: ResumePaletteId;
  withPhoto: boolean;
  onChange: (t: ResumeTemplateId, p: ResumePaletteId) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = RESUME_TEMPLATES[template];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-template-tile
        className="hover:bg-muted flex items-center gap-3 rounded-xl border p-2 text-left"
      >
        <ResumeThumb template={template} palette={palette} withPhoto={withPhoto} />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{t.title}</span>
          <span className="text-muted-foreground block text-[11px]">{t.hint}</span>
          <span className="text-primary mt-1 block text-[11px]">O‘zgartirish</span>
        </span>
      </button>
      {open ? (
        <ResumeTemplateDialog
          template={template}
          palette={palette}
          withPhoto={withPhoto}
          onClose={() => setOpen(false)}
          onPick={(tt, pp) => {
            onChange(tt, pp);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export function ResumeTemplateDialog({
  template,
  palette,
  withPhoto,
  onClose,
  onPick,
}: {
  template: ResumeTemplateId;
  palette: ResumePaletteId;
  withPhoto: boolean;
  onClose: () => void;
  onPick: (t: ResumeTemplateId, p: ResumePaletteId) => void;
}) {
  const panelRef = useDialog(true, onClose);
  const [photo, setPhoto] = useState(withPhoto);
  const [pal, setPal] = useState<ResumePaletteId>(palette);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/50 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Rezyume shabloni"
        onClick={(e) => e.stopPropagation()}
        className="bg-card my-8 w-full max-w-3xl rounded-2xl border p-4 shadow-xl"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Shablon tanlang</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />
              Suratli
            </label>
            <span className="flex items-center gap-1" data-palettes>
              {RESUME_PALETTE_IDS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-label={RESUME_PALETTES[p].title}
                  aria-pressed={p === pal}
                  onClick={() => setPal(p)}
                  className={cn("size-5 rounded-full border-2", p === pal ? "border-foreground" : "border-transparent")}
                  style={{ background: `#${RESUME_PALETTES[p].accent}` }}
                />
              ))}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {RESUME_TEMPLATE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              data-template-card={id}
              onClick={() => onPick(id, pal)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors",
                id === template ? "border-primary bg-primary/5" : "hover:bg-muted",
              )}
            >
              <ResumeThumb template={id} palette={pal} withPhoto={photo} />
              <span className="text-[12px] font-medium">{RESUME_TEMPLATES[id].title}</span>
              <span className="text-muted-foreground text-[10.5px]">{RESUME_TEMPLATES[id].hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
