"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { photoUrl } from "@/lib/api-client";
import { PHOTO_ACCEPT } from "@/lib/photo-accept";
import { ApiImg } from "@/lib/use-api-src";
import type { ImageParam } from "@/lib/studio-core";
import { uploadStudioInput } from "./studio-api";

/** The file picker's accept list for Studio inputs = the photo upload's (the server sniffs the bytes anyway). */
export const STUDIO_INPUT_ACCEPT = PHOTO_ACCEPT;

/**
 * The control of an `image` param (docs/studio/P2B-SPEC.md): the chosen pictures as thumbnails (each removable) and
 * «Rasm qo'shish» while there is room (`max`). Uploads go to `POST /api/media/inputs`; the value is the list of asset
 * ids, exactly what the request sends. Thumbnails come from `/api/uploads/photo/<id>` (owner only).
 */
export function ImageInputs({ param, value, onChange }: { param: ImageParam; value: readonly string[]; onChange: (ids: string[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(file: File) {
    setBusy(true);
    setError(null);
    try {
      const got = await uploadStudioInput(file, file.name || "rasm");
      onChange([...value.filter((id) => id !== got.assetId), got.assetId].slice(0, param.max));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rasm yuklanmadi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-image-inputs={param.name}>
      <ul className="flex flex-wrap gap-2">
        {value.map((id, i) => (
          <li key={id} className="bg-muted relative size-20 overflow-hidden rounded-[14px] border" data-image-input={id}>
            <ApiImg src={photoUrl(id)} alt={`${i + 1}-rasm`} className="size-full object-cover" />
            <button
              type="button"
              data-image-remove={id}
              aria-label={`${i + 1}-rasmni olib tashlash`}
              onClick={() => onChange(value.filter((x) => x !== id))}
              className="focus-visible:ring-ring absolute top-1 right-1 inline-flex size-8 items-center justify-center rounded-full bg-black/70 text-white outline-none focus-visible:ring-2"
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
        {value.length < param.max ? (
          <li>
            <button
              type="button"
              data-image-add
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="hover:bg-muted focus-visible:ring-ring text-muted-foreground flex size-20 flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-dashed text-[12px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50"
            >
              <ImagePlus className="size-5" aria-hidden />
              {busy ? "Yuklanmoqda…" : "Rasm qo‘shish"}
            </button>
          </li>
        ) : null}
      </ul>
      <input
        ref={fileRef}
        type="file"
        accept={STUDIO_INPUT_ACCEPT}
        className="hidden"
        data-image-file
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void add(f);
        }}
      />
      {error ? (
        <p role="alert" className="text-destructive mt-1 text-[13px]" data-image-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}
