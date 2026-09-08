"use client";

import { useState } from "react";
import { uploadLogo } from "@/lib/api-client";
import { Legend } from "./fields";

/** Klientda ham oldindan tekshiriladi — serverga borib qaytishni kutmasdan. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_ACCEPT_TYPES = ["image/png", "image/jpeg"];

/**
 * Pro slayd logotipi — `SourceFileField` naqshi (busy holati, xato matni).
 *
 * `value` — `values.logoAssetId` (WP-F server shartnomasi bo'yicha
 * yuklangandan keyingi asset id). Preview faqat SHU sessiyada tanlangan
 * fayldan (`URL.createObjectURL`) — sahifa qayta ochilganda eski
 * `logoAssetId` bilan qaytgan bo'lsa, rasm emas, «Logotip yuklangan»
 * matni ko'rsatiladi (fayl bayti klientda saqlanmaydi).
 */
export function LogoField({
  value,
  onChange,
}: {
  value: string;
  onChange: (assetId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function onFile(f: File) {
    setError(null);
    if (f.size > LOGO_MAX_BYTES) {
      setError("Logo 2 MB dan katta");
      return;
    }
    if (!LOGO_ACCEPT_TYPES.includes(f.type)) {
      setError("Faqat PNG yoki JPEG");
      return;
    }
    setBusy(true);
    try {
      const { assetId } = await uploadLogo(f);
      setPreview(URL.createObjectURL(f));
      onChange(assetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Logotip yuklanmadi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="mb-6">
      <Legend>Logotip</Legend>
      <p className="text-muted-foreground mb-3 text-sm">
        Taqdimotning pastki burchagida ko‘rinadi — ixtiyoriy.
      </p>
      {value ? (
        <div className="flex items-center gap-3">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Logotip" className="h-12 w-12 rounded-lg border object-contain" />
          ) : (
            <span className="text-muted-foreground text-sm">Logotip yuklangan</span>
          )}
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              setError(null);
              onChange("");
            }}
            className="text-destructive text-sm"
          >
            O‘chirish
          </button>
        </div>
      ) : (
        <label className="border-input bg-card hover:bg-muted/40 flex cursor-pointer items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center text-sm">
          {busy ? "Yuklanmoqda..." : "Logotip tanlash (PNG/JPEG, 2 MB gacha)"}
          <input
            type="file"
            className="hidden"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
    </fieldset>
  );
}
