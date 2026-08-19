"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";
import type { FormValues, ToolConfig } from "@/lib/types";
import { languageName } from "@/lib/languages";
import { LanguagePicker, Legend, ModeSwitch } from "./fields";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";
import { extractText } from "@/lib/api-client";

const MODES = [
  { id: "text", title: "Matn", hint: "Matnni yozing yoki joylashtiring" },
  { id: "file", title: "Fayl", hint: "DOCX, PDF, PPTX, TXT — matn avtomatik olinadi" },
];

export function TranslationForm({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    language: "uz",
    sourceLang: "avto",
    fileName: "",
    sourceText: "",
    mode: "text",
  });
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState("");

  const mode = String(values.mode || "text");
  const text = String(values.sourceText || "");

  async function onFile(f: File) {
    setError(null);
    if (f.size > 8 * 1024 * 1024) {
      setError("Fayl 8 MB dan katta");
      return;
    }
    setReading(true);
    setFileMeta(f.name);
    setValues((s) => ({ ...s, fileName: f.name, sourceText: "" }));
    try {
      const data = await extractText(f);
      const extracted = String(data.text || "").trim();
      if (!extracted) {
        setError(data.error || "Fayldan matn olinmadi. TXT/DOCX yuboring yoki matn rejimiga o‘ting.");
        setValues((s) => ({ ...s, sourceText: "" }));
        return;
      }
      setValues((s) => ({ ...s, sourceText: extracted, fileName: f.name }));
      setFileMeta(`${f.name} · ${extracted.length.toLocaleString("uz-UZ")} belgi`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Faylni o‘qib bo‘lmadi");
      setValues((s) => ({ ...s, sourceText: "" }));
    } finally {
      setReading(false);
    }
  }

  async function submit() {
    setError(null);
    if (reading) {
      setError("Fayl hali o‘qilmoqda");
      return;
    }
    const source = text.trim();
    if (!source) {
      setError(mode === "file" ? "Avval fayl tanlang — matn olingandan keyin tarjima boshlanadi." : "Tarjima qilinadigan matnni yozing.");
      return;
    }
    if (source.length < 8) {
      setError("Matn juda qisqa");
      return;
    }
    setLoading(true);
    try {
      const id = await runGeneration(tool, {
        ...values,
        sourceText: source,
        topic: String(values.fileName || source.slice(0, 48)),
      });
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ToolChrome title="Tarjimon" submitLabel={tool.submitLabel} price={tool.basePrice} loading={loading} onSubmit={submit} error={error}>
      <ModeSwitch modes={MODES} value={mode} onChange={(v) => setValues((s) => ({ ...s, mode: v }))} />

      {mode === "file" ? (
        <fieldset className="mb-6">
          <Legend>Hujjatni biriktiring</Legend>
          <label className="border-input bg-card hover:bg-muted/40 flex cursor-pointer flex-col items-center rounded-2xl border border-dashed px-4 py-10 text-center">
            {reading ? <Loader2 className="text-muted-foreground mb-2 size-6 animate-spin" /> : <FileText className="text-muted-foreground mb-2 size-6" />}
            <span className="font-medium">{reading ? "Matn olinmoqda..." : "Fayl tanlash"}</span>
            <span className="text-muted-foreground mt-1 text-sm">DOCX, PDF, PPTX, XLSX, TXT — 8 MB gacha</span>
            <input
              type="file"
              className="hidden"
              accept=".txt,.md,.csv,.docx,.pdf,.pptx,.xlsx"
              disabled={reading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            {fileMeta ? <span className="mt-3 text-sm">{fileMeta}</span> : null}
          </label>
          {text ? (
            <div className="mt-4">
              <Legend>Olingan matn (tahrirlash mumkin)</Legend>
              <textarea
                value={text}
                onChange={(e) => setValues((s) => ({ ...s, sourceText: e.target.value }))}
                rows={8}
                className="border-input bg-card focus:ring-ring w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:ring-2"
              />
              <p className="text-muted-foreground mt-1 text-xs">{text.length.toLocaleString("uz-UZ")} belgi tarjima qilinadi</p>
            </div>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">
              Fayl tanlanganda matn shu yerda ko‘rinadi. Skaner PDF bo‘lsa, matn rejimiga o‘ting.
            </p>
          )}
        </fieldset>
      ) : (
        <fieldset className="mb-6">
          <Legend>Tarjima qilinadigan matn</Legend>
          <textarea
            value={text}
            onChange={(e) => setValues((s) => ({ ...s, sourceText: e.target.value }))}
            rows={10}
            className="border-input bg-card focus:ring-ring w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:ring-2"
            placeholder="Matnni shu yerga yozing yoki joylashtiring..."
          />
        </fieldset>
      )}

      <fieldset className="mb-6">
        <Legend>Qaysi tildan?</Legend>
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setValues((s) => ({ ...s, sourceLang: "avto" }))}
            className={
              values.sourceLang === "avto"
                ? "border-primary bg-primary text-primary-foreground rounded-full border px-3 py-1.5 text-sm"
                : "border-input bg-card hover:bg-muted rounded-full border px-3 py-1.5 text-sm"
            }
          >
            Avtomatik aniqlash
          </button>
        </div>
        <LanguagePicker compact value={values.sourceLang === "avto" ? "" : String(values.sourceLang)} onChange={(v) => setValues((s) => ({ ...s, sourceLang: v }))} />
      </fieldset>

      <fieldset className="mb-6">
        <Legend>Qaysi tilga?</Legend>
        <LanguagePicker compact value={String(values.language || "uz")} onChange={(v) => setValues((s) => ({ ...s, language: v }))} />
        <p className="text-muted-foreground mt-2 text-xs">
          Natija {languageName(String(values.language || "uz"))} tilida DOCX bo‘lib ochiladi.
        </p>
      </fieldset>
    </ToolChrome>
  );
}
