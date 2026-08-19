"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { EXTRACT_ACCEPT, EXTRACT_MAX_BYTES } from "@/lib/extract-text";
import { extractText } from "@/lib/api-client";
import { Legend } from "./fields";

const MAX_MB = Math.round(EXTRACT_MAX_BYTES / (1024 * 1024));

export type SourceFileState = {
  fileName: string;
  sourceText: string;
};

/**
 * «Fayl asosida» rejimi uchun maydon.
 *
 * Ilgari fayl tanlanganda faqat nomi saqlanardi — matn hech qachon o'qilmasdi,
 * shuning uchun natija «mavzu asosida» dan farq qilmasdi. Endi fayl darrov
 * `/api/extract` ga yuboriladi va olingan matn generatsiyaga uzatiladi.
 */
export function SourceFileField({
  legend = "Hujjat yuklang",
  fileName,
  sourceText,
  onChange,
  onBusyChange,
}: {
  legend?: string;
  fileName: string;
  sourceText: string;
  onChange: (next: SourceFileState) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setBusy(v: boolean) {
    setReading(v);
    onBusyChange?.(v);
  }

  async function onFile(f: File) {
    setError(null);
    if (f.size > EXTRACT_MAX_BYTES) {
      setError(`Fayl ${MAX_MB} MB dan katta`);
      return;
    }
    setBusy(true);
    onChange({ fileName: f.name, sourceText: "" });
    try {
      const data = await extractText(f);
      const text = String(data.text || "").trim();
      if (!text) {
        setError(data.error || "Fayldan matn olinmadi. Mavzu rejimidan foydalaning.");
        onChange({ fileName: f.name, sourceText: "" });
        return;
      }
      onChange({ fileName: f.name, sourceText: text });
    } catch (e) {
      // 401/413/429 kabi holatlar endi tushunarli matn bilan keladi.
      setError(e instanceof Error ? e.message : "Faylni o‘qib bo‘lmadi");
      onChange({ fileName: f.name, sourceText: "" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="mb-6">
      <Legend>{legend}</Legend>
      <label className="border-input bg-card hover:bg-muted/40 flex cursor-pointer flex-col items-center rounded-2xl border border-dashed px-4 py-10 text-center">
        {reading ? (
          <Loader2 className="text-muted-foreground mb-2 size-6 animate-spin" />
        ) : (
          <FileText className="text-muted-foreground mb-2 size-6" />
        )}
        <span className="font-medium">{reading ? "Matn olinmoqda..." : "Fayl tanlash"}</span>
        <span className="text-muted-foreground mt-1 text-sm">
          DOCX, PDF, PPTX, XLSX, TXT — {MAX_MB} MB gacha
        </span>
        <input
          type="file"
          className="hidden"
          accept={EXTRACT_ACCEPT}
          disabled={reading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
        {fileName ? (
          <span className="mt-3 text-sm">
            {fileName}
            {sourceText ? ` · ${sourceText.length.toLocaleString("uz-UZ")} belgi` : ""}
          </span>
        ) : null}
      </label>
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
      {sourceText ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Matn olindi — hujjat shu manba asosida yoziladi.
        </p>
      ) : null}
    </fieldset>
  );
}
