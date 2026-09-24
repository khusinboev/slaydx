"use client";

import { useRef, useState } from "react";
import { photoUrl, uploadResumePhoto } from "@/lib/api-client";
import { PHOTO_ACCEPT } from "@/lib/photo-accept";
import { PhotoCropDialog } from "./PhotoCropDialog";
import type { Crop } from "@/lib/photo-crop";

/**
 * Rezyume surati maydoni (Rezyume 2, 6-band).
 *
 * Oqim: fayl tanlanadi → kesish oynasi (doira/kvadrat, shablonga qarab)
 * → `POST /api/uploads/photo` → `photoAssetId`. «Markazlash» ASL
 * nusxani qayta ochadi, «Olib tashlash» maydonni bo'shatadi.
 */
export function PhotoField({
  assetId,
  originalAssetId,
  crop,
  shape,
  savedShape,
  onChange,
}: {
  assetId: string;
  originalAssetId: string;
  crop?: Crop;
  /** Shablon talab qiladigan shakl. */
  shape: "circle" | "square";
  /** Surat AYNAN qaysi shaklda kesilgan (yuklashda qaytadi). */
  savedShape?: "circle" | "square";
  onChange: (v: { assetId: string; originalAssetId: string; crop?: Crop; shape?: "circle" | "square" }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [recrop, setRecrop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * C41 (BEA-19/FE-20): surat 90 kundan keyin serverdan o'chiriladi, qoralama
   * esa `photoAssetId` ni saqlab qoladi. Rasm yuklanmasa — `broken` (shu id),
   * holati serverdan so'raladi: 404/410 → id forma qiymatidan olib tashlanadi
   * (pullik rezyume o'lik id bilan jimgina suratsiz chiqmasin) va
   * `expired` ishorasi; boshqa xato (tarmoq) → id saqlanadi, faqat bo'sh joy.
   */
  const [broken, setBroken] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const showImg = Boolean(assetId) && broken !== assetId;
  const mismatch = Boolean(assetId && savedShape && savedShape !== shape);

  async function onImgError(id: string) {
    setBroken(id);
    try {
      const res = await fetch(photoUrl(id), { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (res.status === 404 || res.status === 410) {
        setExpired(true);
        onChange({ assetId: "", originalAssetId: "", crop: undefined, shape: undefined });
      }
    } catch (e) {
      console.warn("[photo] surat holatini tekshirib bo'lmadi", e);
    }
  }

  async function save(out: { blob: Blob; crop: Crop; shape: "circle" | "square" }) {
    setBusy(true);
    setError(null);
    try {
      const res = await uploadResumePhoto({ blob: out.blob, original: pending, crop: out.crop, shape: out.shape });
      setExpired(false);
      onChange({ assetId: res.assetId, originalAssetId: res.originalAssetId ?? originalAssetId, crop: out.crop, shape: out.shape });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Surat yuklanmadi");
    } finally {
      setBusy(false);
      setPending(null);
      setRecrop(false);
    }
  }

  return (
    <div className="flex items-center gap-3" data-photo-field>
      <div
        className={`bg-muted flex size-16 shrink-0 items-center justify-center overflow-hidden border ${shape === "circle" ? "rounded-full" : "rounded-xl"}`}
      >
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(assetId)}
            alt="Rezyume surati"
            className="size-full object-cover"
            onError={() => void onImgError(assetId)}
          />
        ) : (
          <span className="text-muted-foreground text-[10px]">surat</span>
        )}
      </div>
      <div className="min-w-0 text-[12px]">
        <input
          ref={fileRef}
          type="file"
          accept={PHOTO_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (f) setPending(f);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="text-primary font-medium disabled:opacity-40">
            {assetId ? "Almashtirish" : "Surat qo‘shish"}
          </button>
          {assetId && originalAssetId ? (
            <button type="button" onClick={() => setRecrop(true)} disabled={busy} className="text-muted-foreground hover:text-foreground disabled:opacity-40">
              Markazlash
            </button>
          ) : null}
          {assetId ? (
            <button
              type="button"
              onClick={() => onChange({ assetId: "", originalAssetId: "", crop: undefined, shape: undefined })}
              disabled={busy}
              className="text-muted-foreground hover:text-destructive disabled:opacity-40"
            >
              Olib tashlash
            </button>
          ) : null}
        </div>
        {/*
          * Shakl mos kelmasligi: surat DOIRA qilib kesilgan, keyin
          * foydalanuvchi KVADRAT slotli shablonga o'tgan (yoki teskarisi).
          * Doira PNG ning burchaklari shaffof, kvadrat ramkada esa bu oq
          * burchak bo'lib ko'rinadi — shuning uchun qayta kesish taklif
          * qilinadi. O'zi kesmasa ham hujjat yiqilmaydi.
          */}
        {expired && !assetId ? (
          <p className="mt-0.5 text-[11px] text-amber-600" data-photo-expired>
            Avvalgi surat muddati o‘tib o‘chirilgan. Suratni qayta yuklang.
          </p>
        ) : assetId && !showImg ? (
          <p className="mt-0.5 text-[11px] text-amber-600" data-photo-broken>
            Surat ochilmadi — sahifani yangilang yoki suratni qayta yuklang.
          </p>
        ) : mismatch ? (
          <p className="mt-0.5 text-[11px] text-amber-600">
            Shablon {shape === "circle" ? "doira" : "kvadrat"} surat kutadi — «Markazlash» bilan qayta kesing.
          </p>
        ) : (
          <p className="text-muted-foreground mt-0.5 text-[11px]">{busy ? "Yuklanmoqda…" : "PNG yoki JPEG, 5 MB gacha"}</p>
        )}
        {error ? <p className="text-destructive mt-0.5 text-[11px]">{error}</p> : null}
      </div>

      {pending || recrop ? (
        <PhotoCropDialog
          file={pending}
          src={recrop ? photoUrl(originalAssetId || assetId) : undefined}
          shape={shape}
          crop={recrop ? crop : undefined}
          onCancel={() => {
            setPending(null);
            setRecrop(false);
          }}
          onDone={save}
        />
      ) : null}
    </div>
  );
}
