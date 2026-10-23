"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Check, Copy, Download, FileUp, Loader2, Send } from "lucide-react";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { Card, Segmented } from "@/components/forms/compact";
import { request } from "@/lib/api-client";
import { CONVERT_MAX_BYTES } from "@/lib/convert/matrix";
import { copyToClipboard } from "@/lib/share";
import { bearerHeaders } from "@/lib/session-transport";
import { isInMiniAppShell } from "@/lib/telegram-webapp";
import { convert } from "@/lib/translit";
import { alifboKindOfName, SCRIPT_LABEL, SCRIPTS, type Script } from "@/lib/translit/script";

/**
 * Free Uzbek script converter page (`/uz/alifbo`, owner request 6): Kirill <-> Lotin <-> Yangi lotin.
 *
 * Text is converted LIVE in the browser by the same pure `convert()` the server uses for files (no server
 * call, no login needed). The file card posts DOCX / PPTX / TXT to `POST /api/convert` with `mode=alifbo`
 * (same login, daily limit and «Botga yuborish» delivery as the file converter).
 */

type Status = { enabled: boolean; limit: number; used: number; remaining: number };
type Done = { kind: "file"; url: string; name: string } | { kind: "bot"; name: string };

const OPTIONS = SCRIPTS.map((s) => ({ value: s, label: SCRIPT_LABEL[s] }));
const ACCEPT = ".docx,.pptx,.txt";
const TXT_MAX_BYTES = 5 * 1024 * 1024;

function nameFromDisposition(h: string | null, fallback: string): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(h ?? "");
  if (star) {
    try {
      return decodeURIComponent(star[1]!);
    } catch {
      /* fall through */
    }
  }
  return /filename="([^"]+)"/i.exec(h ?? "")?.[1] ?? fallback;
}

export function AlifboPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState<Script>("cyr");
  const [to, setTo] = useState<Script>("lat");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const [status, setStatus] = useState<Status | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const miniApp = isInMiniAppShell();

  const output = useMemo(() => convert(text, from, to), [text, from, to]);

  const loadStatus = useCallback(() => {
    request<Status>("/api/convert").then(setStatus, () => undefined);
  }, []);
  useEffect(loadStatus, [loadStatus]);
  useEffect(() => () => (done?.kind === "file" ? URL.revokeObjectURL(done.url) : undefined), [done]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  /** Choosing the other side's script swaps the two, so `from` and `to` are never equal. */
  const pickFrom = (v: string) => {
    const next = v as Script;
    if (next === to) setTo(from);
    setFrom(next);
    setDone(null);
  };
  const pickTo = (v: string) => {
    const next = v as Script;
    if (next === from) setFrom(to);
    setTo(next);
    setDone(null);
  };
  /** Swap the scripts; the converted text becomes the new input, so it can be converted straight back. */
  const swap = () => {
    setFrom(to);
    setTo(from);
    if (output) setText(output);
    setDone(null);
  };

  const copy = async () => {
    if (!output) return;
    setCopied(await copyToClipboard(output));
  };

  const pickFile = (f: File | null) => {
    setDone(null);
    setError(null);
    if (!f) return;
    const kind = alifboKindOfName(f.name);
    if (!kind) {
      setFile(null);
      setError("Faqat DOCX, PPTX yoki TXT fayl tanlang.");
      return;
    }
    const cap = kind === "txt" ? TXT_MAX_BYTES : CONVERT_MAX_BYTES;
    if (f.size > cap) {
      setFile(null);
      setError(`Fayl ${Math.round(cap / 1024 / 1024)} MB dan katta bo'lmasligi kerak.`);
      return;
    }
    setFile(f);
  };

  const convertFile = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const form = new FormData();
    form.set("file", file);
    form.set("mode", "alifbo");
    form.set("from", from);
    form.set("to", to);
    const url = miniApp ? "/api/convert?deliver=bot" : "/api/convert";
    try {
      const res = await fetch(url, { method: "POST", body: form, credentials: "same-origin", headers: bearerHeaders(url) });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? (res.status === 401 ? "Faylni o'girish uchun tizimga kiring" : `Xatolik (${res.status})`));
        return;
      }
      if (miniApp) {
        const data = (await res.json()) as { fileName?: string };
        setDone({ kind: "bot", name: data.fileName ?? "fayl" });
      } else {
        const name = nameFromDisposition(res.headers.get("content-disposition"), "fayl");
        setDone({ kind: "file", url: URL.createObjectURL(await res.blob()), name });
      }
    } catch {
      setError("Internetga ulanib bo'lmadi. Aloqani tekshirib, qayta urinib ko'ring.");
    } finally {
      setBusy(false);
      loadStatus();
    }
  };

  const off = status ? !status.enabled : false;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-8" data-alifbo>
      <Card title="Alifbo: Kirill ↔ Lotin ↔ Yangi lotin — tekin">
        <div className="flex flex-wrap items-end gap-3" data-alifbo-scripts>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-muted-foreground text-[13px]">Qaysi alifbodan</span>
            <Segmented ariaLabel="Boshlang'ich alifbo" options={OPTIONS} value={from} onChange={pickFrom} />
          </div>
          <button
            type="button"
            data-alifbo-swap
            onClick={swap}
            aria-label="Alifbolarni almashtirish"
            className="bg-muted/70 hover:bg-accent focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center rounded-[12px] outline-none focus-visible:ring-2"
          >
            <ArrowLeftRight className="size-5" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-muted-foreground text-[13px]">Qaysi alifboga</span>
            <Segmented ariaLabel="Natija alifbosi" options={OPTIONS} value={to} onChange={pickTo} />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-[13px]">Matn ({SCRIPT_LABEL[from]})</span>
            <AutoTextarea
              data-alifbo-input
              value={text}
              onChange={(e) => setText(e.target.value)}
              minRows={5}
              maxRows={14}
              placeholder="Matnni shu yerga yozing yoki qo'ying"
              spellCheck={false}
              className="border-input bg-card focus:ring-ring w-full rounded-[14px] border p-3 text-[16px] leading-relaxed outline-none focus:ring-2"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-[13px]">Natija ({SCRIPT_LABEL[to]})</span>
            <AutoTextarea
              data-alifbo-output
              value={output}
              readOnly
              minRows={5}
              maxRows={14}
              placeholder="Natija shu yerda chiqadi"
              spellCheck={false}
              className="border-input bg-muted/40 focus:ring-ring w-full rounded-[14px] border p-3 text-[16px] leading-relaxed outline-none focus:ring-2"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted-foreground text-[13.5px]" data-alifbo-count aria-live="polite">
              Belgilar: {text.length}
            </span>
            <button
              type="button"
              data-alifbo-copy
              disabled={!output}
              onClick={copy}
              className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50"
            >
              {copied ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
              {copied ? "Nusxalandi" : "Nusxalash"}
            </button>
          </div>
        </div>
        <p className="text-muted-foreground mt-3 text-[13.5px]" data-alifbo-note>
          Yangi lotin alifbosi — ЎРҚ-1184 qonuni (21.10.2026), 22.04.2027 dan kuchga kiradi.
        </p>
      </Card>

      <Card title="Faylni o'girish (DOCX, PPTX, TXT)" aside={status && status.enabled ? <span data-alifbo-left>Bugun qoldi: {status.remaining} / {status.limit}</span> : null}>
        {off ? (
          <p role="status" data-alifbo-off className="text-muted-foreground text-[15px]">
            Fayl o&apos;girish hozir o&apos;chirilgan. Matnni yuqorida o&apos;girishingiz mumkin.
          </p>
        ) : (
          <>
            <button
              type="button"
              data-alifbo-drop
              onClick={() => fileInput.current?.click()}
              className="border-input focus-visible:ring-ring flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center outline-none focus-visible:ring-2"
            >
              <FileUp className="text-muted-foreground size-7" aria-hidden />
              <span className="text-[15px] font-medium break-all">{file ? file.name : "Faylni tanlang"}</span>
              <span className="text-muted-foreground text-[13px]">
                {SCRIPT_LABEL[from]} → {SCRIPT_LABEL[to]} · Word, PowerPoint, TXT · 20 MB gacha (TXT 5 MB)
              </span>
            </button>
            <input ref={fileInput} type="file" accept={ACCEPT} hidden data-alifbo-file onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            <button
              type="button"
              data-alifbo-go
              disabled={!file || busy}
              onClick={convertFile}
              className="bg-primary text-primary-foreground focus-visible:ring-ring mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : miniApp ? <Send className="size-5" aria-hidden /> : null}
              {busy ? "O'girilmoqda…" : miniApp ? "O'girish va botga yuborish" : "Faylni o'girish"}
            </button>
          </>
        )}

        {error ? (
          <p role="alert" data-alifbo-error className="text-destructive mt-3 text-[14.5px]">
            {error}
          </p>
        ) : null}
        {done?.kind === "file" ? (
          <a
            href={done.url}
            download={done.name}
            data-alifbo-download
            className="bg-accent text-foreground mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15.5px] font-semibold break-all"
          >
            <Download className="size-5 shrink-0" aria-hidden />
            Yuklab olish: {done.name}
          </a>
        ) : null}
        {done?.kind === "bot" ? (
          <p role="status" data-alifbo-sent className="mt-3 text-[15px]">
            Tayyor! «{done.name}» fayli bot chatiga yuborildi.
          </p>
        ) : null}
        <p className="text-muted-foreground mt-3 text-[13px]">
          Fayl tuzilmasi (shrift, jadval, rasm) o&apos;zgarmaydi — faqat matn o&apos;giriladi. Faylni o&apos;girish uchun tizimga kirgan bo&apos;lishingiz kerak.
        </p>
      </Card>
    </div>
  );
}
