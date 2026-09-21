"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, FileText, Loader2 } from "lucide-react";
import type { FormValues, ToolConfig } from "@/lib/types";

import { preflightError, translationPrice, TRANSLATION_LANGUAGES, TRANSLATION_MAX_CHARS, TRANSLATION_MIN_CHARS, TRANSLATION_STYLES } from "@/lib/tools";
import { deleteSource, uploadSource, type SourceUploadResult } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { parseUserGlossary } from "@/lib/generation/translate/glossary";
import { cn } from "@/lib/cn";
import { Card, Row, Segmented, SelectField } from "./compact";
import { SettingsDetails, SourceFileRow } from "./shared";
import { ToolChrome } from "./ToolChrome";
import { runGeneration } from "./runGeneration";
import { useFormDraft } from "./useFormDraft";

/**
 * Tarjimon formasi (Tarjimon 2, WP-E Formalar 3 da etalon nomuvofiqliklari
 * yopildi) — Formalar 2 uslubidagi ixcham kartalar.
 *
 *   Manba   — Matn (textarea) yoki Fayl (sudrab tashlash dropzone TANLAMAGAN
 *             holatda; tanlangach umumiy `SourceFileRow` — bayt serverda
 *             `source_uploads` ga tushadi, `onFile` orqali o'z yuklash yo'li
 *             (`uploadSource`), standart `/api/extract` EMAS — forma faqat
 *             `sourceAssetId` yuboradi, tuzilma saqlanishi uchun matn emas,
 *             FAYLNING O'ZI tarjima qilinadi);
 *   Tillar  — manba (Avto + 18) ⇄ maqsad (18);
 *   ▸ Sozlamalar — uslub, o'z lug'ati (umumiy `SettingsDetails`).
 *
 * Narx hajmdan (`translationPrice`): matnda — yozilgan belgilar, faylda —
 * server hisoblagan `chars` (tarjima qilinadigan segmentlar). Server
 * baribir o'zi qayta hisoblaydi — bu yerdagisi ko'rsatish uchun.
 *
 * Qoralama (`useFormDraft`) — FAQAT parametrlar (til, uslub, lug'at);
 * matn rejimidagi `sourceText` qoralamaga TUSHMAYDI — foydalanuvchi butun
 * hujjat matnini yozgan bo'lishi mumkin, har 1,2 soniyada shuni serverga
 * yuborish behuda trafik.
 */

const ACCEPT = ".txt,.md,.csv,.docx,.pdf,.pptx,.xlsx";
const MAX_BYTES = 20 * 1024 * 1024;
const KIND_LABEL: Record<string, string> = { docx: "DOCX", pptx: "PPTX", xlsx: "XLSX", pdf: "PDF → DOCX", txt: "TXT", md: "MD", csv: "CSV" };

/** Ming ajratgichi ODDIY bo'sh joy — `ru-RU` NBSP (U+00A0) beradi, u matn qidiruvi va nusxalashda «ko'rinmas» belgi. */
const fmt = (n: number) => n.toLocaleString("ru-RU").replace(/[  ,]/g, " ");

export function TranslationForm({ tool }: { tool: ToolConfig }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const [mode, setMode] = useState<"text" | "file">("text");
  const [sourceText, setSourceText] = useState("");
  const [upload, setUpload] = useState<SourceUploadResult | null>(null);
  const [language, setLanguage] = useState("uz");
  const [sourceLang, setSourceLang] = useState("avto");
  const [style, setStyle] = useState("formal");
  const [userGlossary, setUserGlossary] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Qoralama — FAQAT parametrlar (til/uslub/lug'at), `sourceText` YO'Q (izoh yuqorida).
  const { draft, ready, save, flush } = useFormDraft(tool.id, { enabled: loggedIn });
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!ready || restored) return;
    setRestored(true);
    if (draft) {
      if (typeof draft.language === "string") setLanguage(draft.language);
      if (typeof draft.sourceLang === "string") setSourceLang(draft.sourceLang);
      if (typeof draft.style === "string") setStyle(draft.style);
      if (typeof draft.userGlossary === "string") setUserGlossary(draft.userGlossary);
    }
  }, [ready, draft, restored]);
  useEffect(() => {
    if (!restored) return;
    save({ language, sourceLang, style, userGlossary });
  }, [language, sourceLang, style, userGlossary, restored, save]);

  const chars = mode === "file" ? (upload?.chars ?? 0) : sourceText.length;
  const price = translationPrice(chars);
  const sameLang = sourceLang !== "avto" && sourceLang === language;
  const glossaryCount = useMemo(() => parseUserGlossary(userGlossary).length, [userGlossary]);
  const outFormat = mode === "file" ? (upload ? (KIND_LABEL[upload.kind] ?? upload.kind.toUpperCase()) : "kirish formati bilan bir xil") : "DOCX";

  const values = (): FormValues => {
    const common: FormValues = { mode, language, sourceLang, style, userGlossary };
    if (mode === "file") {
      return { ...common, sourceAssetId: upload?.assetId ?? "", fileName: upload?.name ?? "", sourceChars: upload?.chars ?? 0, topic: upload?.name ?? "" };
    }
    return { ...common, sourceText, topic: sourceText.trim().slice(0, 48) };
  };

  async function onFile(f: File) {
    setError(null);
    if (f.size > MAX_BYTES) {
      setError("Fayl 20 MB dan katta");
      return;
    }
    if (!/\.(txt|md|csv|docx|pdf|pptx|xlsx)$/i.test(f.name)) {
      setError("Format qo‘llanmaydi: DOCX, PPTX, XLSX, PDF, TXT, MD, CSV");
      return;
    }
    setBusy(true);
    try {
      const res = await uploadSource(f);
      setUpload(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fayl yuklanmadi");
    } finally {
      setBusy(false);
    }
  }

  function clearUpload() {
    const id = upload?.assetId;
    setUpload(null);
    if (id) void deleteSource(id).catch(() => {});
  }

  async function submit() {
    setError(null);
    if (busy) {
      setError("Fayl hali tahlil qilinmoqda");
      return;
    }
    if (mode === "file" && !upload) {
      setError("Avval fayl tanlang — tahlildan keyin tarjima boshlanadi.");
      return;
    }
    if (mode === "text" && !sourceText.trim()) {
      setError("Tarjima qilinadigan matnni yozing.");
      return;
    }
    const v = values();
    const blocked = preflightError(tool, v);
    if (blocked) {
      setError(blocked);
      return;
    }
    setLoading(true);
    flush();
    try {
      const id = await runGeneration(tool, v);
      router.push(`/uz/files/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setLoading(false);
    }
  }

  const over = chars > TRANSLATION_MAX_CHARS;
  const disabled = busy || sameLang || over || (mode === "text" ? sourceText.trim().length < TRANSLATION_MIN_CHARS : !upload);
  const langOptions = TRANSLATION_LANGUAGES.map((l) => ({ value: l.value, label: `${l.flag ?? ""} ${l.label}`.trim() }));

  return (
    <ToolChrome title={tool.pageTitle} submitLabel={tool.submitLabel} price={price} loading={loading} disabled={disabled} onSubmit={submit} error={error}>
      <Card
        title="Manba"
        aside={
          <span className={cn("tabular-nums", over ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")} data-chars>
            {fmt(chars)} / {fmt(TRANSLATION_MAX_CHARS)} belgi
          </span>
        }
      >
        <div className="mb-3">
          <Segmented
            ariaLabel="Manba turi"
            options={[
              { value: "text", label: "Matn" },
              { value: "file", label: "Fayl" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as "text" | "file")}
          />
        </div>
        {mode === "text" ? (
          <textarea
            aria-label="Tarjima qilinadigan matn"
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={10}
            className="border-input bg-card focus:ring-ring w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:ring-2"
            placeholder="Matnni shu yerga yozing yoki joylashtiring…"
          />
        ) : upload ? (
          <>
            {/*
             * Umumiy `SourceFileRow` (etalon nomuvofiqligi #5) — `onFile`
             * qayta chaqiruv orqali o'z yuklash yo'lini (`uploadSource`)
             * ishlatadi, standart `/api/extract` EMAS: fayl BAYTI serverga
             * ketishi kerak (tuzilma saqlanadi), matn emas. `badge` — fayl
             * turi + server hisoblagan belgi soni (standart «N belgi»
             * o'rniga, chunki `sourceText` bu yerda umuman ishlatilmaydi).
             */}
            <SourceFileRow
              label="Fayl"
              value={{ fileName: upload.name, sourceText: "" }}
              onFile={onFile}
              onChange={() => clearUpload()}
              badge={
                <>
                  <span className="bg-muted rounded-md px-1.5 py-0.5 text-[11px]">{KIND_LABEL[upload.kind] ?? upload.kind}</span>
                  <span className="text-muted-foreground text-[12px] tabular-nums">{fmt(upload.chars)} belgi</span>
                </>
              }
            />
            {upload.text ? (
              <details className="mt-2 text-[12.5px]">
                <summary className="text-muted-foreground cursor-pointer">Olingan matn (ko‘rish)</summary>
                <p className="text-muted-foreground mt-1 text-[11.5px]">
                  Fayl rejimida tarjima FAYLNING O‘ZIGA yoziladi — matn tahrir qilinmaydi.{" "}
                  {!upload.truncatedPreview ? (
                    <button
                      type="button"
                      className="text-primary underline-offset-2 hover:underline"
                      onClick={() => {
                        setSourceText(upload.text);
                        setMode("text");
                      }}
                    >
                      Matn sifatida ochish
                    </button>
                  ) : null}
                </p>
                <pre className="bg-muted/40 mt-1 max-h-60 overflow-auto rounded-lg p-2 whitespace-pre-wrap">{upload.text}</pre>
              </details>
            ) : null}
          </>
        ) : (
          <label
            data-dropzone
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer?.files?.[0];
              if (f) void onFile(f);
            }}
            className={cn(
              "bg-card hover:bg-muted/40 flex cursor-pointer flex-col items-center rounded-xl border border-dashed px-4 py-8 text-center transition",
              drag ? "border-primary bg-primary/5" : "border-input",
              busy && "cursor-progress opacity-70",
            )}
          >
            {busy ? <Loader2 className="text-muted-foreground mb-2 size-6 animate-spin" /> : <FileText className="text-muted-foreground mb-2 size-6" />}
            <span className="font-medium">{busy ? "Tahlil qilinmoqda…" : "Faylni tanlang yoki shu yerga tashlang"}</span>
            <span className="text-muted-foreground mt-1 text-[12.5px]">DOCX, PPTX, XLSX, PDF, TXT, MD, CSV — 20 MB gacha. Tuzilma, shrift, jadval va rasmlar saqlanadi.</span>
            <input type="file" className="hidden" accept={ACCEPT} aria-label="Fayl tanlash" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          </label>
        )}
        <p className="text-muted-foreground mt-2 text-[11.5px]" data-price-rule>
          {fmt(10_000)} belgigacha {fmt(3000)} tanga · keyingi har {fmt(5000)} belgi +{fmt(1000)}
          {over ? ` · chegara ${fmt(TRANSLATION_MAX_CHARS)} — hujjatni bo‘lib yuboring` : ""}
        </p>
      </Card>

      <Card title="Tillar" aside={<span className="text-muted-foreground text-[11.5px]">Natija: {outFormat}</span>}>
        <div className="grid gap-x-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <Row label="Qaysi tildan">
            <SelectField ariaLabel="Manba tili" options={[{ value: "avto", label: "Avtomatik aniqlash" }, ...langOptions]} value={sourceLang} onChange={setSourceLang} />
          </Row>
          <button
            type="button"
            aria-label="Tillarni almashtirish"
            title="Tillarni almashtirish"
            disabled={sourceLang === "avto"}
            onClick={() => {
              setSourceLang(language);
              setLanguage(sourceLang);
            }}
            className="border-input hover:bg-muted mx-auto mb-1.5 flex size-8 items-center justify-center rounded-lg border disabled:opacity-40"
          >
            <ArrowLeftRight className="size-4" />
          </button>
          <Row label="Qaysi tilga">
            <SelectField ariaLabel="Maqsad tili" options={langOptions} value={language} onChange={setLanguage} />
          </Row>
        </div>
        {sameLang ? <p className="text-destructive mt-1 text-[12.5px]">Manba va maqsad tili bir xil</p> : null}
      </Card>

      <SettingsDetails summary={[TRANSLATION_STYLES.find((s) => s.value === style)?.label ?? style, glossaryCount ? `Lug‘at · ${glossaryCount}` : ""]}>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Row label="Uslub" hint="Rasmiy/ilmiy — akademik va rasmiy hujjatlar; Biznes — aniq, faol; Oddiy — sodda til; Adabiy — obraz va ohang saqlanadi.">
            <Segmented ariaLabel="Uslub" options={TRANSLATION_STYLES.map((s) => ({ value: s.value, label: s.label }))} value={style} onChange={setStyle} />
          </Row>
          <Row label="O‘z lug‘atim" hint="Har qatorda «atama = tarjima». Tarjimon shu juftliklarga qat’iy rioya qiladi." wide>
            <textarea
              aria-label="O‘z lug‘atim"
              value={userGlossary}
              onChange={(e) => setUserGlossary(e.target.value)}
              rows={3}
              placeholder={"fotosintez = photosynthesis\nOliy Majlis = Oliy Majlis"}
              className="border-input bg-card focus:ring-ring w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
            />
            {glossaryCount ? <p className="text-muted-foreground mt-1 text-[11.5px]">{glossaryCount} ta atama</p> : null}
          </Row>
        </div>
      </SettingsDetails>
    </ToolChrome>
  );
}
