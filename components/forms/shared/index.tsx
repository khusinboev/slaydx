"use client";

import { useState, type ReactNode } from "react";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { EXTRACT_ACCEPT, EXTRACT_MAX_BYTES } from "@/lib/extract-text";
import { extractText } from "@/lib/api-client";
import { SOURCE_TEXT_LIMIT } from "@/lib/generation/meta";
import { MAX_SOURCE_CHARS, formatTanga } from "@/lib/tools";
import type { FormValues } from "@/lib/types";
import { Row, SummaryChips } from "../compact";
import { TextInput } from "../fields";

/**
 * FORMALAR 3 (AUDIT-24) — barcha composerlar uchun umumiy bo'laklar.
 *
 * `compact.tsx` bitta parametr qatorini beradi; bu fayl esa
 * KOMPOZITORLAR ORASIDA takrorlanib kelgan bloklarni bitta joyga yig'adi:
 *
 *   — `SettingsDetails`  yig'iq «Sozlamalar» (avval 4 formada 2 xil
 *                        mexanizm, 2 tasida chevron yo'q edi);
 *   — `Field`            `data-field` zond belgisi (bezak maydon yo'q
 *                        testi shu atributni qidiradi);
 *   — `TopicRow`/`LimitedTextarea`  mavzu va cheklangan matn (Work da
 *                        hisoblagich yo'q edi — server jim kesardi);
 *   — `AuthorRows`       titul/shapka maydonlari (Work/Article/Teacher
 *                        uch joyda alohida yozilgan edi);
 *   — `SourceFileRow`    fayl yuklash BITTA qator (katta dashed quti
 *                        o'rniga; Tarjimon varianti umumiylashdi);
 *   — `RangeRow`         slayder + jonli narx (slayd naqshi — hajm,
 *                        davomiylik uchun);
 *   — `ColorDots`, `ClearFormButton`.
 *
 * Qoida (egasi, 2026-09-21, kelajakdagi admin panel uchun): narx bu
 * yerda HECH QAYERDA hisoblanmaydi — faqat `priceFor` natijasi
 * ko'rsatiladi. Yorliqlar reyestr/`lib/tools.ts` dan keladi.
 */

/* ───────────────────────── Sozlamalar ───────────────────────── */

/**
 * Yig'iq «Sozlamalar» — bitta mexanizm, bitta ko'rinish.
 *
 * Native `<details>` + CSS `group-open:` — React holati shart emas
 * (SSR da ham yopiq chiqadi, `tests/viewer/*` shu holatni o'lchaydi).
 * `open`/`onToggle` berilsa boshqariladigan rejim (Maqola/Rezyume
 * qoralamada ochiq/yopiq holatni saqlaydi). Yopiq holda `summary`
 * chiplari ko'rinadi, ochiq holda yashirinadi; chevron ▸ doim bor.
 */
export function SettingsDetails({
  title = "Sozlamalar",
  summary,
  open,
  onToggle,
  children,
  className,
  testId = "settings",
}: {
  title?: string;
  /** Yopiq holatda ko'rinadigan joriy tanlovlar (bo'shlar tashlanadi). */
  summary: Array<string | false | null | undefined>;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const items = summary.filter((s): s is string => Boolean(s));
  return (
    <details
      className={cn("group bg-card mb-3 rounded-2xl border", className)}
      data-settings={testId}
      {...(open === undefined ? {} : { open })}
      onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="text-muted-foreground text-[11.5px] font-semibold tracking-wide uppercase">{title}</span>
        <span aria-hidden className="text-muted-foreground text-xs transition group-open:rotate-90">
          ▸
        </span>
        {items.length ? (
          <span className="min-w-0 flex-1 group-open:hidden">
            <SummaryChips items={items} />
          </span>
        ) : null}
      </summary>
      <div className="border-t px-4 pt-2 pb-4">{children}</div>
    </details>
  );
}

/* ───────────────────────── Zond belgisi ───────────────────────── */

/**
 * `data-field={id}` — «bezak maydon yo'q» qamrov testi (`tests/viewer/*-form`)
 * reyestrdagi har `id` ni formada aynan shu atribut bilan qidiradi.
 * Composer maydonni chizmasa test qizaradi; reyestrda yo'q id chizilsa —
 * ham qizaradi (ikki yo'nalishli qamrov).
 */
export function Field({ id, children, className = "block" }: { id: string; children: ReactNode; className?: string }) {
  return (
    <span data-field={id} className={className}>
      {children}
    </span>
  );
}

/* ───────────────────────── Mavzu / matn ───────────────────────── */

export function TopicRow({
  value,
  onChange,
  placeholder,
  label = "Mavzu",
  hint,
  id = "topic",
  limit,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  id?: string;
  /** Berilsa matn shu uzunlikda kesiladi va hisoblagich chiqadi. */
  limit?: number;
}) {
  return (
    <Row label={label} hint={hint} wide>
      <Field id={id}>
        <TextInput value={value} onChange={(v) => onChange(limit ? v.slice(0, limit) : v)} placeholder={placeholder} />
        {limit ? <Counter len={value.length} limit={limit} /> : null}
      </Field>
    </Row>
  );
}

/** Belgi hisoblagichi — chegaraga yaqinlashganda ogohlantiradi. */
export function Counter({ len, limit }: { len: number; limit: number }) {
  const near = len >= limit * 0.9;
  return (
    <span
      className={cn("mt-1 block text-right text-[11px] tabular-nums", near ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}
      data-counter
    >
      {len.toLocaleString("uz-UZ")} / {limit.toLocaleString("uz-UZ")}
    </span>
  );
}

/**
 * Cheklangan matn maydoni: `.slice(limit)` + hisoblagich.
 *
 * Work formasida limit ko'rsatilmasdi — foydalanuvchi 5 000 belgi yozib,
 * server 2 000 da jim kesganini bilmasdi. Endi hamma formada bir xil.
 */
export function LimitedTextarea({
  value,
  onChange,
  limit,
  placeholder,
  rows = 3,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  limit: number;
  placeholder?: string;
  rows?: number;
  ariaLabel?: string;
}) {
  return (
    <span className="block">
      <textarea
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value.slice(0, limit))}
        placeholder={placeholder}
        rows={rows}
        maxLength={limit}
        className="border-input bg-card focus:ring-ring w-full resize-y rounded-xl border px-3.5 py-2.5 text-[14px] outline-none focus:ring-2"
      />
      <Counter len={value.length} limit={limit} />
    </span>
  );
}

/* ───────────────────────── Titul / shapka ───────────────────────── */

/**
 * Titul/shapka maydonlari — reyestr nomlari `FormValues` kalitlari bilan
 * BIR XIL (`profileDefaults`, `profilePatchFrom` shu kalitlarni o'qiydi),
 * shuning uchun composer faqat qaysi qatorlar kerakligini aytadi.
 */
export const AUTHOR_FIELD_LABEL = {
  university: { label: "OTM", placeholder: "Toshkent davlat universiteti" },
  institution: { label: "Muassasa", placeholder: "15-son umumiy o'rta ta'lim maktabi" },
  organization: { label: "Tashkilot", placeholder: "Tashkilot nomi" },
  faculty: { label: "Fakultet", placeholder: "Fakultet nomi" },
  department: { label: "Kafedra", placeholder: "Kafedra nomi" },
  group: { label: "Guruh", placeholder: "301-guruh" },
  course: { label: "Kurs", placeholder: "3" },
  author: { label: "Muallif", placeholder: "F.I.Sh." },
  position: { label: "Lavozim", placeholder: "Katta o'qituvchi" },
  teacher: { label: "O‘qituvchi", placeholder: "F.I.Sh." },
  teacherDegree: { label: "Unvon", placeholder: "Unvon / ilmiy daraja" },
  approver: { label: "Tasdiqlaydi", placeholder: "Lavozim, F.I.Sh. (ixtiyoriy)" },
  city: { label: "Shahar", placeholder: "Toshkent" },
  subject: { label: "Fan", placeholder: "Matematika" },
} as const;

export type AuthorFieldId = keyof typeof AUTHOR_FIELD_LABEL;

export function AuthorRows({
  ids,
  values,
  set,
  required = [],
  labels = {},
}: {
  ids: readonly AuthorFieldId[];
  values: FormValues;
  set: (id: AuthorFieldId, v: string) => void;
  /** Yorliq yoniga «*» qo'yiladi (majburiylik `CUSTOM_REQUIRED` dan keladi). */
  required?: readonly AuthorFieldId[];
  /** Vositaga xos yorliq (masalan teacher da `university` → «Muassasa»). */
  labels?: Partial<Record<AuthorFieldId, string>>;
}) {
  return (
    <>
      {ids.map((id) => {
        const meta = AUTHOR_FIELD_LABEL[id];
        const label = labels[id] ?? meta.label;
        return (
          <Row key={id} label={required.includes(id) ? `${label} *` : label}>
            <Field id={id}>
              <TextInput value={String(values[id] ?? "")} onChange={(v) => set(id, v)} placeholder={meta.placeholder} />
            </Field>
          </Row>
        );
      })}
    </>
  );
}

/* ───────────────────────── Fayl qatori ───────────────────────── */

const MAX_MB = Math.round(EXTRACT_MAX_BYTES / (1024 * 1024));

export type SourceFileValue = { fileName: string; sourceText: string };

/**
 * Fayl yuklash — BITTA QATOR (tugma · nom · belgi · olib tashlash).
 *
 * `SourceFileField` (katta dashed quti, 10 qator) o'rnini bosadi: fayl
 * darrov `/api/extract` ga ketadi, matn `sourceText` ga tushadi. Uzun
 * matn ogohlantirishlari saqlangan — «nega faqat boshi ishlatildi»
 * savoliga javob shu yerda.
 */
export function SourceFileRow({
  value,
  onChange,
  onBusyChange,
  label = "Fayl",
  hint = `DOCX, PDF, PPTX, XLSX, TXT — ${MAX_MB} MB gacha`,
  id = "sourceText",
}: {
  value: SourceFileValue;
  onChange: (next: SourceFileValue) => void;
  onBusyChange?: (busy: boolean) => void;
  label?: string;
  hint?: string;
  id?: string;
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
      setError(e instanceof Error ? e.message : "Faylni o‘qib bo‘lmadi");
      onChange({ fileName: f.name, sourceText: "" });
    } finally {
      setBusy(false);
    }
  }

  const { fileName, sourceText } = value;
  const tooLong = sourceText.length > SOURCE_TEXT_LIMIT;
  return (
    <Row label={label} hint={hint} wide>
      <Field id={id}>
        <div className="border-input bg-card flex min-h-9 flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px]" data-upload>
          {reading ? <Loader2 className="text-muted-foreground size-4 animate-spin" /> : <FileText className="text-muted-foreground size-4" />}
          {fileName ? (
            <>
              <span className="min-w-0 flex-1 truncate font-medium" title={fileName}>
                {fileName}
              </span>
              {sourceText ? <span className="bg-muted rounded-md px-1.5 py-0.5 text-[11px] tabular-nums">{sourceText.length.toLocaleString("uz-UZ")} belgi</span> : null}
            </>
          ) : (
            <span className="text-muted-foreground min-w-0 flex-1 truncate">{reading ? "Matn olinmoqda…" : "Fayl tanlanmagan"}</span>
          )}
          <label className="text-primary cursor-pointer text-[12.5px] underline-offset-2 hover:underline">
            {fileName ? "Boshqa fayl" : "Fayl tanlash"}
            <input
              type="file"
              className="hidden"
              accept={EXTRACT_ACCEPT}
              disabled={reading}
              aria-label={label}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {fileName ? (
            <button type="button" className="text-destructive text-[12.5px]" onClick={() => onChange({ fileName: "", sourceText: "" })}>
              Olib tashlash
            </button>
          ) : null}
        </div>
        {error ? <p className="text-destructive mt-1 text-[12px]">{error}</p> : null}
        {tooLong ? (
          <p className="mt-1 text-[11.5px] text-amber-600 dark:text-amber-500">
            Matn uzun: faqat birinchi {SOURCE_TEXT_LIMIT.toLocaleString("uz-UZ")} belgisi ishlatiladi
            {sourceText.length > MAX_SOURCE_CHARS ? `; serverga eng ko‘pi ${MAX_SOURCE_CHARS.toLocaleString("uz-UZ")} belgi yuboriladi` : ""}.
          </p>
        ) : null}
      </Field>
    </Row>
  );
}

/* ───────────────────────── Slayder + narx ───────────────────────── */

/**
 * Slayder bitta qatorda: qiymat · slayder · (narx). Narx faqat
 * `priceFor` dan keladi — bu komponent hech narsani hisoblamaydi.
 */
export function RangeRow({
  label,
  hint,
  id,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(v),
  price,
  rule,
}: {
  label: string;
  hint?: string;
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Qiymat yorlig'i («15 bet», «3 daqiqa»). */
  format?: (v: number) => string;
  /** `priceFor(tool, values)` natijasi — ko'rsatiladi, hisoblanmaydi. */
  price?: number;
  /** Narx qoidasi izohi (masalan «20 tagacha 3 000 · keyingisi +500»). */
  rule?: string;
}) {
  return (
    <Row label={label} hint={hint} wide>
      <Field id={id}>
        <div className="flex items-center gap-3">
          <span className="min-w-[4.5rem] text-[13px] font-semibold tabular-nums" data-range-value>
            {format(value)}
          </span>
          <input
            type="range"
            aria-label={label}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="accent-primary min-w-0 flex-1"
          />
          {price === undefined ? null : (
            <span className="bg-muted rounded-md px-2 py-0.5 text-[12px] font-medium tabular-nums whitespace-nowrap" data-price>
              {formatTanga(price)}
            </span>
          )}
        </div>
        {rule ? (
          <p className="text-muted-foreground mt-1 text-[11px]" data-price-rule>
            {rule}
          </p>
        ) : null}
      </Field>
    </Row>
  );
}

/* ───────────────────────── Rang nuqtalari ───────────────────────── */

export function ColorDots({
  options,
  value,
  onChange,
  ariaLabel = "Palitra",
}: {
  options: readonly { id: string; hex: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.id)}
            className={cn("size-6 rounded-full border-2 transition", on ? "border-foreground scale-110" : "border-transparent hover:scale-105")}
            style={{ background: o.hex }}
          />
        );
      })}
    </div>
  );
}

/* ───────────────────────── Tozalash ───────────────────────── */

/** Ikki bosqichli «Formani tozalash» (`useConfirmClick` bilan). */
export function ClearFormButton({ armed, onClick }: { armed: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-muted-foreground hover:text-destructive text-[12px]" data-clear-form>
      {armed ? "Ishonchingiz komilmi? Yana bosing" : "Formani tozalash"}
    </button>
  );
}
