"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileUp, Loader2, Send } from "lucide-react";
import { Card, Segmented } from "@/components/forms/compact";
import { request } from "@/lib/api-client";
import { bearerHeaders } from "@/lib/session-transport";
import { SOURCE_LABEL, TARGET_LABEL, maxBytesFor, sourceOfName, targetsFor, type ConvertSource, type ConvertTarget } from "@/lib/convert/matrix";
import { isInMiniAppShell } from "@/lib/telegram-webapp";

/**
 * Free file converter page (`/uz/convert`, owner request 13). One card:
 * pick or drop a file -> the source type is detected from its name -> only the
 * targets the route accepts are offered (`targetsFor`, the same table the
 * server checks) -> «Konvertatsiya» -> download. Inside the Telegram Mini App a
 * browser download works badly, so the file is sent to the bot chat instead
 * (`POST /api/convert?deliver=bot`). Excel is not offered (v1).
 */

type Status = { enabled: boolean; limit: number; used: number; remaining: number };
type Done = { kind: "file"; url: string; name: string } | { kind: "bot"; name: string };

const ACCEPT = ".docx,.doc,.odt,.rtf,.pptx,.ppt,.odp,.pdf,.png,.jpg,.jpeg,.webp";

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

export function ConvertPage() {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<ConvertSource | null>(null);
  const [target, setTarget] = useState<ConvertTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [drag, setDrag] = useState(false);
  const miniApp = isInMiniAppShell();

  const loadStatus = useCallback(() => {
    request<Status>("/api/convert").then(setStatus, () => undefined);
  }, []);
  useEffect(loadStatus, [loadStatus]);
  useEffect(() => () => (done?.kind === "file" ? URL.revokeObjectURL(done.url) : undefined), [done]);

  const pick = (f: File | null) => {
    setDone(null);
    setError(null);
    if (!f) return;
    const src = sourceOfName(f.name);
    if (!src) {
      setFile(null);
      setSource(null);
      setTarget(null);
      setError("Bu fayl turi qo'llab-quvvatlanmaydi. Word, PowerPoint, PDF yoki rasm (PNG, JPG, WebP) tanlang.");
      return;
    }
    const cap = maxBytesFor(src);
    if (f.size > cap) {
      setFile(null);
      setSource(null);
      setTarget(null);
      setError(`Fayl ${Math.round(cap / 1024 / 1024)} MB dan katta bo'lmasligi kerak.`);
      return;
    }
    setFile(f);
    setSource(src);
    setTarget(targetsFor(src, f.name)[0] ?? null);
  };

  const convert = async () => {
    if (!file || !target || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const form = new FormData();
    form.set("file", file);
    form.set("target", target);
    const url = miniApp ? "/api/convert?deliver=bot" : "/api/convert";
    try {
      const res = await fetch(url, { method: "POST", body: form, credentials: "same-origin", headers: bearerHeaders(url) });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? (res.status === 401 ? "Kirish talab qilinadi" : `Xatolik (${res.status})`));
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
  const options = source && file ? targetsFor(source, file.name).map((t) => ({ value: t, label: TARGET_LABEL[t] })) : [];

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-8" data-convert>
      <Card title="Fayl konvertatsiya — tekin" aside={status && status.enabled ? <span data-convert-left>Bugun qoldi: {status.remaining} / {status.limit}</span> : null}>
        {off ? (
          <p role="status" data-convert-off className="text-muted-foreground text-[15px]">
            Fayl konvertatsiyasi hozir o&apos;chirilgan.
          </p>
        ) : (
          <>
            <button
              type="button"
              data-convert-drop
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                pick(e.dataTransfer.files[0] ?? null);
              }}
              className={`focus-visible:ring-ring flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center outline-none focus-visible:ring-2 ${drag ? "border-primary bg-accent" : "border-input"}`}
            >
              <FileUp className="text-muted-foreground size-7" aria-hidden />
              <span className="text-[15px] font-medium break-all">{file ? file.name : "Faylni tanlang yoki shu yerga tashlang"}</span>
              <span className="text-muted-foreground text-[13px]">Word, PowerPoint, PDF, PNG, JPG, WebP · 20 MB gacha (rasm 15 MB)</span>
            </button>
            <input ref={input} type="file" accept={ACCEPT} hidden data-convert-input onChange={(e) => pick(e.target.files?.[0] ?? null)} />

            {source && file ? (
              <div className="mt-4 flex flex-col gap-2" data-convert-options>
                <p className="text-[14.5px]">
                  Fayl turi: <b data-convert-source>{SOURCE_LABEL[source]}</b>
                </p>
                <p className="text-muted-foreground text-[13.5px]">Qaysi formatga o&apos;giramiz?</p>
                <Segmented ariaLabel="Natija formati" options={options} value={target ?? ""} onChange={(v) => setTarget(v as ConvertTarget)} />
              </div>
            ) : null}

            <button
              type="button"
              data-convert-go
              disabled={!file || !target || busy}
              onClick={convert}
              className="bg-primary text-primary-foreground focus-visible:ring-ring mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : miniApp ? <Send className="size-5" aria-hidden /> : null}
              {busy ? "Konvertatsiya qilinmoqda…" : miniApp ? "Konvertatsiya va botga yuborish" : "Konvertatsiya"}
            </button>
          </>
        )}

        {error ? (
          <p role="alert" data-convert-error className="text-destructive mt-3 text-[14.5px]">
            {error}
          </p>
        ) : null}

        {done?.kind === "file" ? (
          <a
            href={done.url}
            download={done.name}
            data-convert-download
            className="bg-accent text-foreground mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15.5px] font-semibold break-all"
          >
            <Download className="size-5 shrink-0" aria-hidden />
            Yuklab olish: {done.name}
          </a>
        ) : null}
        {done?.kind === "bot" ? (
          <p role="status" data-convert-sent className="mt-3 text-[15px]">
            Tayyor! «{done.name}» fayli bot chatiga yuborildi.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
