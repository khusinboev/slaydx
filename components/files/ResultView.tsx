"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import * as api from "@/lib/api-client";
import { ensureGenerationFresh } from "@/lib/api-edit";
import { useAppStore } from "@/lib/store";
import { TOOL_BY_ID } from "@/lib/tools";
import { useConfirmClick } from "../overlays/useConfirmClick";
import { EditActions, type EditActionsState } from "./EditActions";
import { ArtifactViewer } from "../viewers/ArtifactViewer";
import { SlideViewer, asLiveView } from "../viewers/SlideViewer";
import { liveDocOf, type LiveDeck } from "@/lib/generation/slide-progress";
import { viewerKind } from "@/lib/viewers/kind";
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
  /**
   * Ko'ruvchi tahririning holati — «Asliga qaytarish» va «Saqlash · N»
   * SHU sarlavha qatorida, «Yuklab olish» yonida turadi: foydalanuvchi
   * faylni olishdan oldin saqlanmagan o'zgarish borligini aynan shu
   * yerda ko'radi («ko'rdim = oldim»). Holatning o'zi `SlideViewer` da.
   */
  const [editState, setEditState] = useState<EditActionsState | null>(null);

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
        /*
         * Ko'ruvchida tahrir qilingan bo'lsa PPTX hali ESKI bo'lishi
         * mumkin (qayta yasash oxirgi tahrirdan 3 s keyin). Yuklab
         * olishdan oldin faylni hujjat bilan tenglaymiz — «ko'rdim =
         * oldim» aynan shu yerda buzilardi. Fayl yangi bo'lsa so'rov
         * umuman ketmaydi.
         */
        if (gen) {
          const r = await ensureGenerationFresh(gen);
          if (r) {
            setGen((prev) =>
              prev ? { ...prev, fileVersion: r.fileVersion, docVersion: r.docVersion } : prev,
            );
          }
        }
        await api.downloadGeneration(id, format);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Yuklab olinmadi");
      } finally {
        setBusy(false);
      }
    },
    [id, gen],
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

  // Ikki bosqichli tasdiq — tasodifiy bosishda hujjat yo'qolmasin.
  const del = useConfirmClick(() => void onDelete());

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
  const completed = gen.status === "COMPLETED";
  /*
   * «Topilmadi» — hujjat COMPLETED, lekin fayli endi yo'q.
   *
   * Fayl/hujjat endi MUDDATSIZ saqlanadi (`011_no_expiry.sql`) — bu
   * holat endi faqat kutilmagan sabab bilan (masalan qo'lda tozalash)
   * yuzaga kelishi mumkin, lekin himoya sifatida qoldirilgan: aks
   * holda sahifa «Tayyor» deb turar, ko'ruvchi esa «Hujjat matni
   * topilmadi» yoki rasmda «qayta generate qiling» (chalg'ituvchi)
   * ko'rsatardi.
   */
  const expired = completed && !gen.hasFile;
  /** Ko'ruvchida tahrir bo'lgan, PPTX hali qayta yasalmagan. */
  const fileStale = (gen.fileVersion ?? 0) < (gen.docVersion ?? 0);
  /*
   * OQIM rejimi (AUDIT-16 §7): tarjima natijasida butun sahifa scroll
   * bo'ladi — peshtoq (sarlavha, yuklab olish), chiplar va tablar mazmun
   * bilan birga yuqoriga suriladi, PDF ko'rinishi esa ekranni to'liq oladi.
   * Boshqa ko'ruvchilar (slayd, hujjat) o'z ichki scroll'i bilan qat'iy
   * balandlikda qoladi — ular sahifalash/klaviatura uchun shunga tayanadi.
   */
  const flow = completed && gen.type === "translation";

  return (
    <div className={cn("flex h-full min-h-0 flex-1 flex-col", flow ? "overflow-y-auto" : "overflow-hidden")} data-result-flow={flow ? "1" : undefined}>
      <nav
        className={cn(
          "no-print bg-background/95 z-10 flex items-center gap-2 border-b px-3 py-2 sm:px-4",
          flow ? "shrink-0" : "sticky top-0",
        )}
      >
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
            {tool?.title} · {completed ? (expired ? "Topilmadi" : "Tayyor") : gen.step} ·{" "}
            {gen.price.toLocaleString("uz-UZ")} tanga
          </p>
        </div>
        {completed ? (
          <div className="flex shrink-0 items-center gap-2">
            <EditActions state={editState} />
            {!expired ? (
            <button
              type="button"
              className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-60"
              disabled={busy || !gen.hasFile}
              onClick={() => void onDownload()}
            >
              <Download className="size-4" />
              {/*
                Tahrirdan keyin fayl hujjatdan orqada qolgan bo'lsa
                tugma shuni AYTADI (va bosilganda avval qayta yasaladi) —
                foydalanuvchi eski PPTX ni olib ketmasin.
              */}
              <span className="hidden sm:inline">{fileStale || busy ? "Fayl yangilanmoqda…" : "Yuklab olish"}</span>
              <span className="text-primary-foreground/80 hidden text-xs md:inline">
                {gen.format.toUpperCase()}
              </span>
            </button>
            ) : null}
            {/*
              PDF talab bo'yicha o'giriladi va bazada saqlanmaydi.
              Server LibreOffice'siz bo'lsa bayroq `false` va tugma chiqmaydi.

              Ro'yxat RUXSAT ETILGANLAR, taqiqlanganlar emas (AUDIT-5 P1-9):
              shart `format !== "png"` edi, ya'ni bir nechta rasm uchun
              chiqadigan ZIP ham o'tib ketardi. Tugma ko'rinar, bosilganda
              esa server 400 qaytarardi («Bu fayl allaqachon tayyor
              formatda») — ishlamaydigan tugma ko'rsatilmagani yaxshi.
            */}
            {!expired && features?.pdf && PDF_CONVERTIBLE.has(gen.format) ? (
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
              className={
                del.armed
                  ? "bg-destructive text-destructive-foreground inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-60"
                  : "bg-card inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm disabled:opacity-60"
              }
              disabled={busy}
              onClick={del.trigger}
            >
              <Trash2 className="size-4" />
              <span className={del.armed ? "inline" : "hidden sm:inline"}>
                {del.armed ? "Rostdan?" : "O’chirish"}
              </span>
            </button>
          </div>
        ) : null}
      </nav>

      {running ? <RunningPanel gen={gen} /> : null}

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

      {error && completed ? (
        <p role="alert" className="text-destructive px-4 pt-3 text-sm">
          {error}
        </p>
      ) : null}

      {expired ? (
        <div className="mx-auto w-full max-w-2xl px-4 py-8">
          <div className="bg-card rounded-2xl border p-6">
            <p className="font-medium">Hujjat topilmadi</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Bu hujjatning fayli topilmadi — kerak bo‘lsa, uni qaytadan yarating.
            </p>
            <Link
              href={tool ? `/uz/${tool.slug}` : "/uz/create"}
              className="text-primary mt-4 inline-block text-sm font-medium"
            >
              Qaytadan yaratish
            </Link>
          </div>
        </div>
      ) : completed ? (
        <div className={cn("flex flex-col", flow ? "shrink-0" : "min-h-0 flex-1 overflow-hidden")}>
          {gen.delivered ? (
            /*
             * Va'da qilinganidan kam yetkazilgan (AUDIT-6 C7).
             *
             * Ilgari bu farq faqat qisman qaytarish tranzaksiyasining
             * izohida qolardi — sahifa "Tayyor" deb ko'rsatar,
             * foydalanuvchi nega kam rasm/qator kelganini bilmasdi.
             */
            <p className="border-b bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
              {/*
               * `unit` — nima sanalgani («slayd», «rasm», «atama»).
               * Slayd dekasida ikkita miqdor kam chiqishi mumkin, ya'ni
               * sonning o'zi noaniq edi: foydalanuvchi ekranda 16 ta
               * slaydni ko'rib turib «13 tadan 0 tasi» ni slayd deb
               * o'qirdi. Eski qatorlarda maydon yo'q — jumla o'zgarmaydi.
               */}
              {gen.delivered.want} tadan {gen.delivered.got}{" "}
              {gen.delivered.unit ? `ta ${gen.delivered.unit}` : "tasi"} yaratildi
              {/*
               * Pul qaytmagan holatda (`refundShare: 0` — paket bu miqdor
               * uchun ustama olmagan) «farq qaytarildi» deyish yolg'on
               * bo'lardi, lekin kamomadning o'zi baribir aytiladi.
               */}
              {(gen.delivered.refundShare ?? 1) > 0 ? " — farq balansingizga qaytarildi." : "."}
            </p>
          ) : null}
          <ArtifactViewer
            gen={toLegacyShape(gen)}
            detail={gen}
            onDetail={(g) => setGen((prev) => ({ ...(prev as api.GenerationDetail), ...(g as api.GenerationDetail) }))}
            onEditState={setEditState}
            pdf={Boolean(features?.pdf)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ish ketayotgandagi maydon — JONLI ko'ruvchi yoki eski progress bar.
 *
 * Alohida komponent, chunki tanlov qoidasi shu yerda va uni SSR bilan
 * to'g'ridan-to'g'ri sinash mumkin (`ResultView`ning o'zi sessiya va
 * pollingga bog'liq, SSR da esa hali «Yuklanmoqda…» holatida bo'ladi).
 *
 * Shartlar UCHTA va hammasi kerak: bu SLAYD vositasi (matn hujjatlarida
 * jonli model yo'q — `liveDocOf` ularga hech narsa bermaydi), jonli
 * holat kelgan va uning shakli to'g'ri. Bittasi tushsa — eski progress
 * kartochkasi, ya'ni yiqilish xavfsiz tomonga.
 */
export function RunningPanel({ gen }: { gen: api.GenerationDetail }) {
  const tool = TOOL_BY_ID[gen.type];
  const live =
    viewerKind(gen.type) === "slides" ? asLiveView(gen.live as LiveDeck | null | undefined) : null;

  if (live) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SlideViewer doc={withFrozenYear(liveDocOf(live), gen.createdAt)!} live={live} />
      </div>
    );
  }

  return (
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
  );
}

/**
 * LibreOffice PDF ga o'gira oladigan formatlar.
 *
 * Server tomonidagi `CONVERTIBLE` (mime bo'yicha) bilan juftlik —
 * bu yerda foydalanuvchi ko'radigan yorliq bo'yicha.
 */
const PDF_CONVERTIBLE = new Set<Generation["format"]>(["docx", "pptx"]);

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
    doc: withFrozenYear(g.doc, g.createdAt),
  };
}

/**
 * Sprint 14 dan oldingi `doc_json` da `meta.year` bo'lmaydi — `title-model`
 * u yo'q bo'lsa render vaqti yiliga qaytadi. Bu yerda uni yaratilgan
 * sanadan orqaga to'ldiramiz, shunda eski hujjat ham to'g'ri yil ko'rsatadi.
 */
function withFrozenYear(doc: api.GenerationDetail["doc"], createdAt: string): Generation["doc"] {
  if (!doc) return undefined;
  if (doc.meta.year) return doc;
  const t = Date.parse(createdAt);
  const year = Number.isFinite(t) ? new Date(t).getFullYear() : new Date().getFullYear();
  return { ...doc, meta: { ...doc.meta, year } };
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
