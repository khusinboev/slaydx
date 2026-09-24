"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Loader2, RefreshCw, Trash2 } from "lucide-react";
import * as api from "@/lib/api-client";
import {
  editErrorCode,
  editErrorText,
  ensureGenerationFresh,
  isUnpaidError,
  polishArticle,
  rewriteArticle,
} from "@/lib/api-edit";
import type { ReviewCheck } from "@/lib/generation/article/types";
import { useAppStore } from "@/lib/store";
import { TOOL_BY_ID } from "@/lib/tools";
import { useConfirmClick } from "../overlays/useConfirmClick";
import { EditActions, type EditActionsState } from "./EditActions";
import { GameSharePanel } from "./GameSharePanel";
import { publicGameKindOf } from "@/lib/game/public";
import { ArtifactViewer } from "../viewers/ArtifactViewer";
import { ArticleReviewPanel, ESSAY_HIDDEN_GROUPS } from "../viewers/ArticleReviewPanel";
import { asLiveView } from "../viewers/live-view";
import { liveDocOf, type LiveDeck } from "@/lib/generation/slide-progress";

/*
 * Jonli slayd ko'ruvchisi ALOHIDA bo'lakda (FE-11): u faqat slayd
 * yaratilayotganda kerak, matn hujjatlarining sahifasi esa `planSlide`
 * dvigatelini birinchi yuklanishda olmasin.
 */
const SlideViewer = lazy(() => import("../viewers/SlideViewer").then((m) => ({ default: m.SlideViewer })));
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
   * Polling holati (C20): `issue` — uzilish yoki odatdan uzoq kutish
   * (polling DAVOM etmoqda); `errorStatus` — polling taslim bo'lgan
   * xatoning HTTP statusi (404 → «topilmadi», boshqasi → «Qayta
   * tekshirish»). `pollKey` ni oshirish pollingni boshidan boshlaydi.
   */
  const [issue, setIssue] = useState<api.PollIssue | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [pollKey, setPollKey] = useState(0);
  /** Qaysi yuklab olish ketmoqda — PDF o'girish 1 daqiqagacha (UX-08). */
  const [downloading, setDownloading] = useState<"file" | "pdf" | null>(null);
  /**
   * 402 `unpaid` (W1-E): hujjat bonus ball bilan to'langan — bepul AI
   * tahrir unga ishlamaydi. Sabab bir marta aytiladi va «Tuzatish»/
   * «Hammasini tuzatish» o'chadi (qayta bosish yana 402 berardi).
   */
  const [aiLocked, setAiLocked] = useState<string | null>(null);
  /**
   * Ko'ruvchi tahririning holati — «Asliga qaytarish» va «Saqlash · N»
   * SHU sarlavha qatorida, «Yuklab olish» yonida turadi: foydalanuvchi
   * faylni olishdan oldin saqlanmagan o'zgarish borligini aynan shu
   * yerda ko'radi («ko'rdim = oldim»). Holatning o'zi `SlideViewer` da.
   */
  const [editState, setEditState] = useState<EditActionsState | null>(null);
  /**
   * «Tuzatish» (Maqola 2, WP7): hozir bajarilayotgan `fix.target`; panel
   * tugmalarini o'chiradi. `genRef` — `onFix` ichida `await` dan keyin
   * eng yangi versiyani o'qish uchun (holat yopilmasi eskirgan bo'ladi).
   */
  const [fixing, setFixing] = useState<string | null>(null);
  /** «Hammasini tuzatish» (AUDIT-18) — sayqal davomida panel tugmalari o'chiq. */
  const [polishing, setPolishing] = useState(false);
  const genRef = useRef<api.GenerationDetail | null>(null);
  genRef.current = gen;

  useEffect(() => {
    if (!sessionChecked || !loggedIn) return;
    const ctrl = new AbortController();
    // «Qayta tekshirish» da hujjat allaqachon ekranda — «Yuklanmoqda» ga qaytmaymiz.
    setLoading(genRef.current === null);
    setError(null);
    setErrorStatus(null);
    setIssue(null);
    void api
      .pollGeneration(
        id,
        (g) => {
          setGen(g);
          setLoading(false);
          upsert(g);
        },
        ctrl.signal,
        setIssue,
      )
      .then(() => {
        setIssue(null);
        // Tugaganda balans o'zgargan bo'lishi mumkin (xato → qaytarish).
        void useAppStore.getState().refreshSession();
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setIssue(null);
        setError(e instanceof Error ? e.message : "Yuklab bo'lmadi");
        setErrorStatus(e instanceof api.ApiError ? e.status : null);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [id, loggedIn, sessionChecked, upsert, pollKey]);

  const recheck = useCallback(() => setPollKey((k) => k + 1), []);

  const onDownload = useCallback(
    async (format?: "pdf") => {
      setBusy(true);
      setDownloading(format ?? "file");
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
            /*
             * Faqat `fileVersion` (review R3): `docVersion` ni `doc` siz
             * oshirish tahrir navbatini eski hujjatga «yangi versiya» deb
             * bog'lab, serverga yetgan bo'lakni ikki marta qo'llatardi.
             */
            setGen((prev) => (prev ? { ...prev, fileVersion: r.fileVersion } : prev));
          }
        }
        await api.downloadGeneration(id, format);
      } catch (e) {
        // 429/503 (PDF band) — server matni + «qachon qayta» (`downloadGeneration`).
        setError(e instanceof Error ? e.message : "Yuklab olinmadi");
      } finally {
        setBusy(false);
        setDownloading(null);
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

  /** Ko'ruvchidan (tahrir) yoki serverdan kelgan yangi generatsiyani o'zlashtiradi. */
  const adoptDetail = useCallback((g: unknown) => {
    const merged = { ...(genRef.current as api.GenerationDetail), ...(g as api.GenerationDetail) };
    genRef.current = merged;
    setGen(merged);
  }, []);

  /*
   * Tayyorlik hisobotidagi «Tuzatish» — `POST …/rewrite`.
   *
   * Avval ko'ruvchining SAQLANMAGAN navbati yuboriladi (`editState.save`):
   * server tahriri versiyani oshiradi, keyin yuborilgan eski navbat 409
   * olardi. Javobdagi generatsiya o'zlashtiriladi — `WordViewer`
   * (`useArticleEdit`) yangi versiyani ko'rib hujjatni almashtiradi va
   * steklarni tozalaydi. 409/`legacy` — hujjat serverdan qayta yuklanadi
   * (`useDocEdit` naqshi). Kredit yechilmaydi.
   */
  const onFix = useCallback(
    async (fix: NonNullable<ReviewCheck["fix"]>) => {
      const cur = genRef.current;
      if (!cur || fixing) return;
      setFixing(fix.target);
      setError(null);
      try {
        if (editState?.pending && (await editState.save()) === false) {
          setError(UNSAVED_FIRST);
          return;
        }
        const base = genRef.current?.docVersion ?? cur.docVersion ?? 0;
        const { generation } = await rewriteArticle(cur.id, base, fix);
        adoptDetail(generation);
      } catch (e) {
        if (isUnpaidError(e)) {
          setAiLocked(editErrorText(e));
          return;
        }
        setError(editErrorText(e));
        if (editErrorCode(e)) {
          try {
            const { generation } = await api.getGeneration(cur.id);
            adoptDetail(generation);
          } catch {
            // Qayta yuklash ham yiqilsa — xato matni allaqachon ko'rsatilgan.
          }
        }
      } finally {
        setFixing(null);
      }
    },
    [fixing, editState, adoptDetail],
  );

  /*
   * «Hammasini tuzatish» — `POST …/polish` (AUDIT-18): `onFix` bilan bir
   * naqsh — avval saqlanmagan navbat, keyin sayqal; javobdagi generatsiya
   * (yangi hujjat + jurnalli hisobot, yoki eski hujjat + jurnal) o'zlashtiriladi;
   * 409 → qayta yuklash. Kredit yechilmaydi (3 marta/maqola/kun).
   */
  const onPolish = useCallback(async () => {
    const cur = genRef.current;
    if (!cur || fixing || polishing) return;
    setPolishing(true);
    setError(null);
    try {
      if (editState?.pending && (await editState.save()) === false) {
        setError(UNSAVED_FIRST);
        return;
      }
      const base = genRef.current?.docVersion ?? cur.docVersion ?? 0;
      const { generation } = await polishArticle(cur.id, base);
      adoptDetail(generation);
    } catch (e) {
      if (isUnpaidError(e)) {
        setAiLocked(editErrorText(e));
        return;
      }
      setError(editErrorText(e));
      if (editErrorCode(e)) {
        try {
          const { generation } = await api.getGeneration(cur.id);
          adoptDetail(generation);
        } catch {
          // Qayta yuklash ham yiqilsa — xato matni allaqachon ko'rsatilgan.
        }
      }
    } finally {
      setPolishing(false);
    }
  }, [fixing, polishing, editState, adoptDetail]);

  if (sessionChecked && !loggedIn) {
    return (
      <Empty title="Kirish talab qilinadi" hint="Hujjatni ko'rish uchun avval tizimga kiring." />
    );
  }
  if (loading) {
    return (
      <Empty
        title="Yuklanmoqda..."
        hint={issue?.message ?? "Hujjat holati olinmoqda."}
        action={issue ? <RecheckButton onClick={recheck} /> : null}
      />
    );
  }
  if (!gen) {
    // Faqat 404/403/400 — «topilmadi»; tarmoq va boshqa xato — qayta tekshirish mumkin.
    const gone = errorStatus === 404 || errorStatus === 403 || errorStatus === 400;
    return gone ? (
      <Empty title="Fayl topilmadi" hint={error ?? "Hujjat o'chirilgan bo'lishi mumkin."} />
    ) : (
      <Empty
        title="Hujjat holatini olib bo‘lmadi"
        hint={error ?? "Aloqani tekshirib, qayta urinib ko‘ring."}
        action={<RecheckButton onClick={recheck} />}
      />
    );
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
  const expired = completed && (!gen.hasFile || Boolean(gen.filesPurgedAt));
  /*
   * Bonus-faqat hujjatlar fayli 180 kundan keyin o'chiriladi (W2-D2
   * retention); server buni `filesPurgedAt` bilan aytadi (ixtiyoriy maydon —
   * eski server bermaydi, u holda umumiy «topilmadi» matni).
   */
  const purged = Boolean(gen.filesPurgedAt);
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

  /*
   * Tayyorlik hisoboti — YAGONA o'qish nuqtasi: maqola/tezisda
   * `doc.article.review`, inshoda `doc.essay.review` (AUDIT-19 WP-E1).
   * Panel ikkalasida ham bir xil `DocReview` shaklini o'qiydi.
   */
  const isEssay = gen.type === "essay";
  /*
   * O'qituvchi hujjatlari (AUDIT-20 WP-D) — `doc.teacher.review`.
   * Panel shakli bir xil (`DocReview`), «Tuzatish» esa bandma-band
   * ishlaydi (`rewriteTeacher`), shuning uchun inshodagi kabi
   * yashirilmaydi.
   *
   * AUDIT-21 WP-D: bosma o'yinlar (`doc.game.review`) va infografika
   * (`doc.infographic.review`) ham SHU yagona nuqtadan o'qiladi —
   * oltinchi va yettinchi model. Panel ularda ham bir xil `DocReview`
   * shaklini ko'radi; farq faqat qaysi guruhlar chizilishida va
   * bandma-band «Tuzatish» borligida (pastda).
   *
   * AUDIT-22 WP-A2: audio (`doc.audio.review`) — SAKKIZINCHI model.
   * Hisobot ko'rinadi, lekin «Tuzatish»/«Hammasini tuzatish» YO'Q
   * (`noFix`/`noPolish` pastda) — sayqal audio dvigatelida SINTEZDAN
   * OLDIN ishlaydi, natija sahifasidan qayta chaqirish qayta TTS
   * to'lovi bo'lardi va `POLISHERS` jadvalida ataylab yo'q.
   */
  const review =
    gen.doc?.article?.review ??
    gen.doc?.essay?.review ??
    gen.doc?.work?.review ??
    gen.doc?.teacher?.review ??
    gen.doc?.game?.review ??
    gen.doc?.infographic?.review ??
    gen.doc?.audio?.review;
  /*
   * O'YIN va PLAKAT (AUDIT-21 WP-D).
   *
   * `hideGroups` — «Manbalar» va «Vizuallar» guruhlari bu oilalarda
   * BO'SH: krossvord/karta/plakat manba keltirmaydi va sxema chizmaydi,
   * ya'ni ularning bandlari umuman hisoblanmaydi (insho bilan ayni
   * qaror — bo'sh guruh «manbalar tekshirilmadi» deb o'qilardi).
   *
   * `isPoster` — plakatda bandma-band «Tuzatish» YO'Q: nishon bitta
   * (`spec`) va har tuzatish butun plakatni qayta chizdiradi, shuning
   * uchun server ham 422 qaytaradi (`article-rewrite.ts`). O'yinda esa
   * BOR — ta'rif/karta matni to'rga tegmasdan almashadi.
   *
   * «Tahrirlash» ikkalasida ham ko'rinmaydi va bu SHU YERDA emas,
   * `edit-adapters.ts` da hal qilingan: adapter yo'q → `editableTools()`
   * da yo'q → `WordViewer` `editable` false → `EditActions` bo'sh.
   */
  const isGame = Boolean(gen.doc?.game);
  const isPoster = Boolean(gen.doc?.infographic);
  /*
   * AUDIT-22 WP-A2: audio — hujjat MODELIDAN (`isGame`/`isPoster` bilan
   * ayni naqsh, vosita id sidan emas).
   */
  const isAudio = Boolean(gen.doc?.audio);
  const noFix = isEssay || isPoster || isAudio;
  /*
   * «Hammasini tuzatish» AUDIODA YO'Q — bu boshqa oilalardan farq:
   * inshoda/o'yinda/plakatda avto-sayqal ASOSIY yo'l (nishon bitta
   * bo'lsa ham), audioda esa sayqal SINTEZDAN OLDIN, dvigatel ICHIDA
   * ishlaydi (fayl izohi) — `POLISHERS` jadvalida ataylab yo'q, ya'ni
   * bu yerdan chaqirilsa server 409 «eski formatda» qaytarardi.
   */
  const noPolish = isAudio;
  const hideGroups = isEssay || isGame || isPoster || isAudio ? ESSAY_HIDDEN_GROUPS : undefined;
  /*
   * O'YIN HAVOLASI (AUDIT-22 WP-C) — faqat O'YNALADIGAN vositalarda.
   *
   * Ro'yxat `publicGameKindOf` dan keladi, bu yerda QAYTA yozilmaydi:
   * `share` route ham aynan shu funksiya bilan rad etadi, ya'ni panel
   * chiqib, tugma 400 qaytaradigan holat bo'lmaydi. Referat yoki
   * podkastda «o'yin havolasi» tugmasi foydalanuvchini adashtirardi.
   *
   * `expired` (fayl yo'q) da ham chizilmaydi: `createGameSession`
   * hujjatning `COMPLETED` holatiga tayanadi va havola o'ynab
   * bo'lmaydigan hujjatga olib borardi.
   */
  const shareKind = completed && !expired ? publicGameKindOf(gen.type) : null;

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
              <span className="hidden sm:inline">
                {fileStale || downloading === "file" ? "Fayl yangilanmoqda…" : "Yuklab olish"}
              </span>
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
              /*
                O'girish 1 daqiqagacha davom etadi (UX-08): tugma shuni
                AYTADI — aylanuvchi belgi + «PDF tayyorlanmoqda…» —
                aks holda o'chgan tugma «ishlamay qoldi» deb o'qilardi.
              */
              <button
                type="button"
                className="bg-card inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm disabled:opacity-60"
                disabled={busy || !gen.hasFile}
                aria-busy={downloading === "pdf"}
                data-pdf-busy={downloading === "pdf" ? "1" : undefined}
                onClick={() => void onDownload("pdf")}
                title="PDF ga o‘girib yuklab olish"
              >
                {downloading === "pdf" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span className="hidden sm:inline">PDF tayyorlanmoqda…</span>
                    <span className="sm:hidden">PDF…</span>
                  </>
                ) : (
                  <>
                    <Download className="size-4" />
                    PDF
                  </>
                )}
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

      {downloading === "pdf" ? (
        <p role="status" className="text-muted-foreground no-print px-4 pt-3 text-sm" data-pdf-status>
          PDF tayyorlanmoqda — bu 1 daqiqagacha davom etishi mumkin.
        </p>
      ) : null}

      {/*
        C20: polling taslim bo'lsa (`error`) yoki qiynalsa (`issue` —
        uzilish, odatdan uzoq navbat) — ish ketayotgan holatda ham
        AYTILADI va «Qayta tekshirish» beriladi. Ilgari xato faqat
        COMPLETED da ko'rinardi, progress esa jimgina qotib qolardi.
      */}
      {running && (error || issue) ? (
        <PollNotice
          tone={error ? "error" : "info"}
          text={error ? `Holat yangilanmay qoldi — ${error}` : issue!.message}
          onRetry={recheck}
        />
      ) : null}

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

      {error && !running ? (
        <p role="alert" className="text-destructive px-4 pt-3 text-sm">
          {error}
        </p>
      ) : null}

      {expired ? (
        <div className="mx-auto w-full max-w-2xl px-4 py-8">
          <div className="bg-card rounded-2xl border p-6">
            <p className="font-medium">Hujjat topilmadi</p>
            <p className="text-muted-foreground mt-1 text-sm" data-files-purged={purged ? "1" : undefined}>
              {purged
                ? "Bonus bilan yaratilgan hujjatlar 180 kun saqlanadi — bu hujjat fayli o‘chirilgan."
                : "Bu hujjatning fayli topilmadi — kerak bo‘lsa, uni qaytadan yarating."}
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
          {review ? (
            /*
             * Tayyorlik hisoboti (Maqola 2, WP5; insho — AUDIT-19 WP-E1)
             * — ko'ruvchi TEPASIDA, yig'iladigan `<details open>`:
             * ko'ruvchi o'z ichki scroll'i bilan qoladi, panel esa
             * `shrink-0` va o'z balandligi chegarasi bilan.
             *
             * «Tuzatish» (`onFix` → `POST …/rewrite`) inshoda va
             * PLAKATDA chizilmaydi (`noFix`): ikkalasida ham nishon
             * bitta va har bandi butun matnga tegishli, shuning uchun
             * bandma-band tuzatish «Hammasini tuzatish» ning
             * baholovchisiz nusxasi bo'lardi (server ham 422 qaytaradi).
             * O'yinlarda esa bor — ta'rif/karta matni to'rga tegmasdan
             * almashadi.
             *
             * AUDIODA (`noPolish`) «Hammasini tuzatish» HAM yo'q —
             * boshqa `noFix` oilalaridan farqi shu: ularda avto-sayqal
             * baribir ishlaydi, audioda esa sayqal MP3 sintezidan OLDIN
             * dvigatel ichida allaqachon bajarilgan (qayta chaqirish —
             * TTS ni ikkinchi marta to'lash). Hisobot (`review`) o'zi
             * baribir ko'rinadi.
             */
            <details open className="no-print max-h-[45vh] shrink-0 overflow-y-auto border-b px-3 py-2 sm:px-4" data-article-review-panel>
              <summary className="cursor-pointer text-sm font-medium select-none">
                Tayyorlik hisoboti · {review.score} ball
              </summary>
              <div className="mt-2">
                {isEssay ? (
                  // AUDIT-24 WP-C: nega «Tuzatish» yo'qligi tushuntirilmasdi
                  // (forms3-talaba.md topilmasi) — endi bitta qatorlik izoh.
                  <p className="text-muted-foreground mb-2 text-[11.5px]" data-essay-nofix-note>
                    Insho bitta matn — «Hammasini tuzatish» butun matnni qayta ko‘radi.
                  </p>
                ) : null}
                {aiLocked ? (
                  // 402 `unpaid`: tugmalar o'chadi, sabab (server matni) shu yerda turadi.
                  <p className="mb-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11.5px] text-amber-800" data-ai-unpaid>
                    {aiLocked}
                  </p>
                ) : null}
                <ArticleReviewPanel
                  review={review}
                  hrefBase={`/uz/${gen.type}`}
                  {...(aiLocked ? {} : noFix ? {} : { onFix: (fix: NonNullable<ReviewCheck["fix"]>) => void onFix(fix) })}
                  fixing={fixing}
                  {...(aiLocked ? {} : noPolish ? {} : { onPolish: () => void onPolish(), polishing })}
                  {...(hideGroups ? { hideGroups } : {})}
                />
              </div>
            </details>
          ) : null}
          {shareKind ? (
            /*
             * Hisobot panelining OSTIDA va ko'ruvchining USTIDA: o'qituvchi
             * avval «hujjat tayyormi» ni ko'radi, so'ng uni SINFGA beradi.
             * `shrink-0` + o'z scroll'i — ko'ruvchi balandligini yemasin.
             */
            <div className="no-print max-h-[45vh] shrink-0 overflow-y-auto border-b px-3 py-3 sm:px-4">
              <GameSharePanel id={gen.id} kind={shareKind} />
            </div>
          ) : null}
          <ArtifactViewer
            gen={toLegacyShape(gen)}
            detail={gen}
            onDetail={adoptDetail}
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
  /*
   * FE-13: `liveDocOf` har chaqiriqda slaydlarni KLONLAYDI. Ilgari u har
   * renderda (har 1,2 s polling tikida) chaqirilardi va `SlideViewer`
   * ichidagi `buildSlideDeck` memosi o'zgarish bo'lmasa ham buzilardi —
   * barcha eskizlar qayta rejalanardi. `live` identifikatori `mergeLive`
   * da saqlanadi, ya'ni o'zgarmagan tikda hujjat ham o'sha-o'sha.
   */
  const liveDoc = useMemo(
    () => (live ? withFrozenYear(liveDocOf(live), gen.createdAt)! : null),
    [live, gen.createdAt],
  );

  if (live && liveDoc) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Suspense fallback={<div className="text-muted-foreground p-8 text-sm">Yuklanmoqda...</div>}>
          <SlideViewer doc={liveDoc} live={live} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="bg-card rounded-2xl border p-6">
        <p className="mb-2 font-medium">{tool?.creatingLabel ?? "Yaratilmoqda..."}</p>
        <p className="text-muted-foreground mb-4 text-sm">{gen.step}</p>
        {/*
          UX-07: navbatdagi o'rin va taxminiy kutish — server bersagina
          (W2-B, ixtiyoriy maydonlar). Aks holda yangi ish va 15 daqiqa
          navbatda turgan ish bir xil ko'rinardi.
        */}
        {gen.status === "QUEUED" && typeof gen.queuePosition === "number" && gen.queuePosition > 0 ? (
          <p className="mb-4 text-sm" data-queue-position>
            Navbatdagi o‘rningiz: <b>{gen.queuePosition}</b>
            {typeof gen.etaSec === "number" && gen.etaSec > 0 ? ` · boshlanishiga taxminan ${etaText(gen.etaSec)}` : null}
          </p>
        ) : null}
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

/** «Tuzatish» dan oldin saqlash yiqildi — sababini ko'ruvchi o'zi ko'rsatadi (navbat qolgan yoki qayta yuklangan). */
const UNSAVED_FIRST = "«Tuzatish» boshlanmadi — tahrirlar saqlanmadi (sababi hujjat ustida ko‘rsatilgan).";

/** Taxminiy kutish: «1 daqiqadan kam» / «N daqiqa» / «N soat». */
export function etaText(sec: number): string {
  if (sec < 60) return "1 daqiqadan kam";
  const min = Math.round(sec / 60);
  if (min < 90) return `${min} daqiqa`;
  return `${Math.round(min / 60)} soat`;
}

function RecheckButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-card hover:bg-muted inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium"
    >
      <RefreshCw className="size-3.5" />
      Qayta tekshirish
    </button>
  );
}

/**
 * Ish ketayotganda polling holati (C20). `error` — polling to'xtadi
 * (`role="alert"`); `info` — polling davom etmoqda, lekin uzilish yoki
 * odatdan uzoq navbat bor (`role="status"`). Ikkalasida ham qo'lda
 * «Qayta tekshirish» — pollingni darhol, boshidan qayta boshlaydi.
 */
function PollNotice({ tone, text, onRetry }: { tone: "error" | "info"; text: string; onRetry: () => void }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-poll-notice={tone}
      className={cn(
        "no-print mx-auto mt-4 flex w-full max-w-2xl flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between",
        tone === "error" ? "border-destructive/30 text-destructive" : "border-amber-300 bg-amber-50 text-amber-900",
      )}
    >
      <p className="min-w-0">{text}</p>
      <RecheckButton onClick={onRetry} />
    </div>
  );
}

function Empty({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-sm">{hint}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      <Link href="/uz" className="text-primary mt-4 inline-block text-sm">
        Bosh sahifaga
      </Link>
    </div>
  );
}
