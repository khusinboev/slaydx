"use client";

import { useState } from "react";
import { fileUrl } from "@/lib/api-client";
import { langInfo } from "@/lib/generation/i18n";
import type { AcademicDoc } from "@/lib/generation/types";
import type { TranslationReport, TranslationWarning } from "@/lib/generation/translate/report";
import { cn } from "@/lib/cn";
import { WordViewer } from "./WordViewer";

/**
 * Tarjima ko'ruvchisi (Tarjimon 2).
 *
 * Ikki rejim:
 *   - matn/PDF: faqat «Taqqoslash» — asl ↔ tarjima ikki ustunda;
 *   - fayl (DOCX/PPTX/XLSX/…): tablar «Taqqoslash» | «Fayl» — DOCX/PPTX
 *     brauzerning o'z PDF ko'ruvchisida (`?format=pdf`, talab bo'yicha
 *     LibreOffice), XLSX «yuklab oling», TXT/MD/CSV — tarjima matni.
 * Sarlavha chiplari: aniqlangan til → maqsad, uslub, band/belgi; ogohlantirishlar
 * `<details>` da. Eski (`translation` yo'q) hujjat → `WordViewer` (tarix buzilmaydi).
 */

const STYLE_LABEL: Record<string, string> = { formal: "Rasmiy / ilmiy", business: "Biznes", plain: "Oddiy", literary: "Adabiy" };
const KIND_LABEL: Record<string, string> = { docx: "DOCX", pptx: "PPTX", xlsx: "XLSX", pdf: "PDF → DOCX", txt: "TXT", md: "MD", csv: "CSV", text: "Matn" };
const PAGE = 300;

export function warningText(w: TranslationWarning): string {
  switch (w.code) {
    case "numbers":
      return `Raqam/URL mos kelmadi — tekshiring: ${w.detail}`;
    case "placeholders":
      return `Maket belgilari mos kelmadi: ${w.detail}`;
    case "untranslated":
      return `Tarjima qilinmagan band (asl matn qoldirildi): «${w.detail}»`;
    case "skipped-part":
      return w.detail;
    case "rtl":
      return w.detail;
    case "detected":
      return w.detail;
    case "unchanged":
      return `Band o‘zgarishsiz qoldi (asl matn qabul qilindi) — tekshiring: «${w.detail}»`;
    default:
      return w.detail;
  }
}

export function TranslationViewer({ doc, gen, pdf = false }: { doc: AcademicDoc; gen?: { id: string; format: string }; pdf?: boolean }) {
  const [tab, setTab] = useState<"pairs" | "file">("pairs");
  const t = doc.translation;
  if (!t) return <WordViewer doc={doc} />;
  const isFile = t.sourceKind !== "text" && t.sourceKind !== "pdf";
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <Header t={t} />
      {isFile ? (
        <div role="tablist" aria-label="Ko‘rinish" className="flex gap-1">
          {(["pairs", "file"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium", tab === k ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70")}
            >
              {k === "pairs" ? "Taqqoslash" : "Fayl"}
            </button>
          ))}
        </div>
      ) : null}
      {/* Ota konteyner (`ResultView`) `overflow-hidden` — scroll SHU YERDA, aks holda ro'yxat kesilib qoladi. */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-translation-scroll>
        {isFile && tab === "file" ? <FilePane t={t} gen={gen} pdf={pdf} /> : <Pairs t={t} />}
      </div>
    </div>
  );
}

function Header({ t }: { t: TranslationReport }) {
  const src = t.detected && t.detected !== "avto" ? langInfo(t.detected).native : "aniqlanmadi";
  const chip = "bg-muted rounded-md px-2 py-0.5 text-[12px]";
  return (
    <div className="bg-card rounded-xl border p-3" data-translation-header>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(chip, "font-semibold")} data-langs>
          {src} → {langInfo(t.target).native}
        </span>
        <span className={chip}>{STYLE_LABEL[t.style] ?? t.style}</span>
        <span className={chip}>{KIND_LABEL[t.sourceKind] ?? t.sourceKind}</span>
        <span className={cn(chip, "text-muted-foreground")}>
          {t.translated} / {t.segments} band · {t.chars.toLocaleString("ru-RU").replace(/[  ,]/g, " ")} belgi
        </span>
        {t.sourceLang === "avto" ? <span className={cn(chip, "text-muted-foreground")}>Aniqlangan til: {src}</span> : null}
        {t.domain ? <span className={cn(chip, "text-muted-foreground")}>{t.domain}</span> : null}
      </div>
      {t.warnings.length ? (
        <details className="mt-2 text-[12.5px]" data-warnings>
          <summary className="cursor-pointer text-amber-700 dark:text-amber-400">Ogohlantirishlar ({t.warnings.length})</summary>
          <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-5">
            {t.warnings.slice(0, 60).map((w, i) => (
              <li key={i}>{warningText(w)}</li>
            ))}
            {t.warnings.length > 60 ? <li>… yana {t.warnings.length - 60} ta</li> : null}
          </ul>
        </details>
      ) : null}
      {t.glossary.length ? (
        <details className="mt-1 text-[12.5px]" data-glossary>
          <summary className="text-muted-foreground cursor-pointer">Atamalar lug‘ati ({t.glossary.length})</summary>
          <div className="mt-1 flex flex-wrap gap-1">
            {t.glossary.map((g, i) => (
              <span key={i} className="bg-muted rounded-md px-1.5 py-0.5 text-[11.5px]">
                {g.src} → {g.dst}
              </span>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Pairs({ t }: { t: TranslationReport }) {
  const [shown, setShown] = useState(PAGE);
  const rows = t.pairs.slice(0, shown);
  let lastCtx: string | undefined;
  return (
    <div className="bg-card rounded-xl border" data-pairs>
      <div className="text-muted-foreground grid grid-cols-2 gap-3 border-b px-3 py-2 text-[11.5px] font-semibold tracking-wide uppercase">
        <span>Asl</span>
        <span>Tarjima</span>
      </div>
      <div className="divide-y">
        {rows.map((p) => {
          const ctxRow = p.ctx && p.ctx !== lastCtx ? p.ctx : null;
          lastCtx = p.ctx;
          return (
            <div key={p.id}>
              {ctxRow ? <div className="text-muted-foreground bg-muted/40 px-3 py-1 text-[11px] tracking-wide uppercase">{ctxRow}</div> : null}
              <div
                data-pair={p.id}
                className={cn(
                  "grid grid-cols-2 gap-3 px-3 py-2 text-[13.5px] leading-relaxed",
                  p.kind === "h" || p.kind === "title" ? "font-semibold" : "",
                  p.kind === "cell" ? "text-[12.5px]" : "",
                  p.warn ? "border-l-2 border-amber-400" : "",
                )}
              >
                <div className="text-muted-foreground whitespace-pre-wrap">{p.src}</div>
                <div className="whitespace-pre-wrap">{p.dst}</div>
              </div>
            </div>
          );
        })}
      </div>
      {t.pairs.length > shown ? (
        <button type="button" className="text-primary w-full py-2 text-[13px] hover:underline" onClick={() => setShown((n) => n + PAGE)}>
          Yana ko‘rsatish ({t.pairs.length - shown})
        </button>
      ) : t.pairsTruncated ? (
        <p className="text-muted-foreground px-3 py-2 text-[12px]">Taqqoslash qisqartirildi — to‘liq matn faylda.</p>
      ) : null}
    </div>
  );
}

function FilePane({ t, gen, pdf }: { t: TranslationReport; gen?: { id: string; format: string }; pdf: boolean }) {
  const kind = t.sourceKind;
  if ((kind === "docx" || kind === "pptx") && gen && pdf) {
    // Brauzerning o'z PDF ko'ruvchisi; u yo'q bo'lsa (ba'zi mobil brauzerlar) — yangi oynada ochish havolasi.
    return (
      <div className="flex min-h-0 flex-col gap-2">
        <p className="text-muted-foreground text-[12px]">
          Fayl PDF ko‘rinishida (LibreOffice). Ko‘rinmasa —{" "}
          <a href={fileUrl(gen.id, "pdf", { inline: true })} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
            PDF ni yangi oynada ochish
          </a>
          .
        </p>
        <iframe src={fileUrl(gen.id, "pdf", { inline: true })} title="Tarjima qilingan fayl (PDF ko‘rinishi)" className="bg-card h-[80vh] w-full rounded-xl border" data-file-preview />
      </div>
    );
  }
  if (kind === "txt" || kind === "md" || kind === "csv") {
    return (
      <pre className="bg-card overflow-x-auto rounded-xl border p-4 text-[13px] leading-relaxed whitespace-pre-wrap" data-file-text>
        {t.pairs.map((p) => p.dst).join("\n\n")}
      </pre>
    );
  }
  return (
    <div className="bg-card text-muted-foreground rounded-xl border p-6 text-center text-[13.5px]" data-file-download>
      {kind === "xlsx"
        ? "XLSX brauzerda ko‘rsatilmaydi — faylni yuklab oling. Formulalar va raqamlar o‘zgartirilmagan; matn kalitlariga bog‘liq formulalar tekshirilsin."
        : "Fayl ko‘rinishi mavjud emas — yuqoridagi «Yuklab olish» tugmasidan foydalaning."}
    </div>
  );
}
