"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { TOOL_BY_ID } from "@/lib/tools";
import { ArtifactViewer } from "../viewers/ArtifactViewer";
import type { Generation } from "@/lib/types";

/**
 * Bitta hujjat sahifasi.
 *
 * Holat serverdan keladi va tugaguncha polling qilinadi — shu sababli
 * sahifani yangilash yoki boshqa qurilmadan ochish ishlaydi. Ilgari
 * progress faqat generatsiyani boshlagan yorliqda yashardi va sahifa
 * yangilanganda `IN_PROGRESS` holida abadiy qotib qolardi.
 */
export function ResultView({ id }: { id: string }) {
  const router = useRouter();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const features = useAppStore((s) => s.features);
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const upsert = useAppStore((s) => s.upsertGeneration);
  const drop = useAppStore((s) => s.dropGeneration);

  const [gen, setGen] = useState<api.GenerationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionChecked || !loggedIn) return;
    const ctrl = new AbortController();
    setLoading(true);
    void api
      .pollGeneration(
        id,
        (g) => {
          setGen(g);
          setLoading(false);
          upsert(g);
        },
        ctrl.signal,
      )
      .then(() => {
        // Tugaganda balans o'zgargan bo'lishi mumkin (xato → qaytarish).
        void useAppStore.getState().refreshSession();
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Yuklab bo'lmadi");
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [id, loggedIn, sessionChecked, upsert]);

  const onDownload = useCallback(
    async (format?: "pdf") => {
      setBusy(true);
      setError(null);
      try {
        await api.downloadGeneration(id, format);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Yuklab olinmadi");
      } finally {
        setBusy(false);
      }
    },
    [id],
  );

  const onDelete = useCallback(async () => {
    setBusy(true);
    try {
      await api.deleteGeneration(id);
      drop(id);
      void useAppStore.getState().refreshSession();
      router.push("/uz");
    } catch (e) {
      setError(e instanceof Error ? e.message : "O'chirilmadi");
      setBusy(false);
    }
  }, [id, drop, router]);

  if (sessionChecked && !loggedIn) {
    return (
      <Empty title="Kirish talab qilinadi" hint="Hujjatni ko'rish uchun avval tizimga kiring." />
    );
  }
  if (loading) {
    return <Empty title="Yuklanmoqda..." hint="Hujjat holati olinmoqda." />;
  }
  if (!gen) {
    return <Empty title="Fayl topilmadi" hint={error ?? "Hujjat o'chirilgan bo'lishi mumkin."} />;
  }

  const tool = TOOL_BY_ID[gen.type];
  const running = gen.status === "QUEUED" || gen.status === "IN_PROGRESS";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <nav className="no-print bg-background/95 sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2 sm:px-4">
        <Link
          href="/uz"
          aria-label="Orqaga"
          className="text-muted-foreground hover:bg-muted flex size-8 items-center justify-center rounded-full"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold">{gen.topic}</h1>
          <p className="text-muted-foreground truncate text-xs">
            {tool?.title} · {gen.status === "COMPLETED" ? "Tayyor" : gen.step} ·{" "}
            {gen.price.toLocaleString("uz-UZ")} tanga
          </p>
        </div>
        {gen.status === "COMPLETED" ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-60"
              disabled={busy || !gen.hasFile}
              onClick={() => void onDownload()}
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">Yuklab olish</span>
              <span className="text-primary-foreground/80 hidden text-xs md:inline">
                {gen.format.toUpperCase()}
              </span>
            </button>
            {/*
              PDF talab bo'yicha o'giriladi va bazada saqlanmaydi.
              Server LibreOffice'siz bo'lsa bayroq `false` va tugma chiqmaydi.
            */}
            {features?.pdf && gen.format !== "png" ? (
              <button
                type="button"
                className="bg-card inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm disabled:opacity-60"
                disabled={busy || !gen.hasFile}
                onClick={() => void onDownload("pdf")}
                title="PDF ga o‘girib yuklab olish"
              >
                <Download className="size-4" />
                PDF
              </button>
            ) : null}
            <button
              type="button"
              className="bg-card inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm disabled:opacity-60"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              <Trash2 className="size-4" />
              <span className="hidden sm:inline">O&apos;chirish</span>
            </button>
          </div>
        ) : null}
      </nav>

      {running ? (
        <div className="mx-auto w-full max-w-2xl px-4 py-8">
          <div className="bg-card rounded-2xl border p-6">
            <p className="mb-2 font-medium">{tool?.creatingLabel ?? "Yaratilmoqda..."}</p>
            <p className="text-muted-foreground mb-4 text-sm">{gen.step}</p>
            <div
              className="bg-muted h-2 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={gen.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="bg-primary h-full transition-all" style={{ width: `${gen.progress}%` }} />
            </div>
            <p className="text-muted-foreground mt-4 text-xs">
              Sahifani yopsangiz ham ish davom etadi — keyin «Mening fayllarim» dan ochasiz.
            </p>
          </div>
        </div>
      ) : null}

      {gen.status === "FAILED" || gen.status === "REVOKED" ? (
        <div className="mx-auto w-full max-w-2xl px-4 py-8">
          <div className="border-destructive/30 bg-card rounded-2xl border p-6">
            <p className="font-medium">
              {gen.status === "REVOKED" ? "Bekor qilindi" : "Hujjat yaratib bo'lmadi"}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">{gen.error ?? gen.step}</p>
            <p className="text-muted-foreground mt-3 text-xs">
              Yechilgan tanga hisobingizga qaytarildi.
            </p>
          </div>
        </div>
      ) : null}

      {error && gen.status === "COMPLETED" ? (
        <p role="alert" className="text-destructive px-4 pt-3 text-sm">
          {error}
        </p>
      ) : null}

      {gen.status === "COMPLETED" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ArtifactViewer gen={toLegacyShape(gen)} />
        </div>
      ) : null}
    </div>
  );
}

/** Ko'ruvchilar hali eski `Generation` shaklini kutadi. */
function toLegacyShape(g: api.GenerationDetail): Generation {
  return {
    id: g.id,
    type: g.type,
    topic: g.topic,
    status: g.status,
    createdAt: g.createdAt,
    finishedAt: g.finishedAt,
    price: g.price,
    values: {},
    html: g.html ?? "",
    fileName: g.fileName,
    format: g.format,
    progress: g.progress,
    step: g.step,
    doc: g.doc ?? undefined,
  };
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-sm">{hint}</p>
      <Link href="/uz" className="text-primary mt-4 inline-block text-sm">
        Bosh sahifaga
      </Link>
    </div>
  );
}
