"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { safeReturnTo } from "@/lib/safe-return";
import { useDialog } from "./useDialog";

export function LoginModal() {
  const router = useRouter();
  const open = useUi((s) => s.overlay === "login");
  const returnTo = useUi((s) => s.returnTo);
  const close = useUi((s) => s.close);
  // Escape, fokus tsikli va fon aylanishini bloklash — barcha
  // oynalar uchun bitta joyda.
  const panelRef = useDialog(open, close);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Kirish"
    >
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Yopish" onClick={close} />
      <div ref={panelRef} className="bg-card relative z-10 w-full max-w-md rounded-2xl border p-6 shadow-xl">
        <button
          type="button"
          onClick={close}
          className="hover:bg-muted absolute top-3 right-3 flex size-8 items-center justify-center rounded-full"
          aria-label="Yopish"
        >
          <X className="size-4" />
        </button>
        <LoginForm
          onDone={() => {
            close();
            // Ikkinchi qatlam (birinchisi `useUi.open` ichida): holat
            // `open()`ni chetlab o'tib to'g'ridan-to'g'ri o'rnatilgan
            // taqdirda ham, `push()`dan oldin yana bir bor tekshiramiz.
            const safe = safeReturnTo(returnTo);
            if (safe) router.push(safe);
            else router.refresh();
          }}
        />
      </div>
    </div>
  );
}

type Stage = "start" | "waiting" | "phone" | "phoneCode";

export function LoginForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const features = useAppStore((s) => s.features);
  const setUser = useAppStore((s) => s.setUser);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);

  const [stage, setStage] = useState<Stage>("start");
  const [ticket, setTicket] = useState<api.Ticket | null>(null);
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  /** UX-01: brauzer yangi oynani bloklagan — havola qo'lda bosiladi. */
  const [popupBlocked, setPopupBlocked] = useState(false);

  const finish = useCallback(
    (user: api.ServerUser) => {
      setUser(user);
      void refreshGenerations();
      if (onDone) onDone();
      else router.push("/uz");
    },
    [setUser, refreshGenerations, onDone, router],
  );

  /*
   * Telegram Mini App ichida bo'lsak — avtomatik kiramiz, kod so'ralmaydi.
   * `initData` URL dagi `#tgWebAppData` dan (FE-10, `api.miniAppInitData`);
   * store ham sahifa ochilganda shu yo'l bilan kiradi — so'rov bitta
   * (`miniAppLogin` uchayotgan va'dani qaytaradi).
   */
  useEffect(() => {
    if (!features?.telegram || !api.miniAppInitData()) return;
    setBusy(true);
    useAppStore
      .getState()
      .miniAppLogin()
      .then(() => {
        const user = useAppStore.getState().user;
        if (user) finish(user);
      })
      .catch(() => setError("Telegram orqali kirib bo'lmadi"))
      .finally(() => setBusy(false));
  }, [features?.telegram, finish]);

  /**
   * UX-01: yangi oyna bosish ichida SINXRON ochiladi, havola esa chipta
   * kelgach unga yoziladi. Ilgari `window.open` `await` dan KEYIN edi —
   * Safari/iOS (va ba'zan Chrome) bu paytda foydalanuvchi harakati
   * belgisini yo'qotib, oynani JIM bloklardi: ekranda «kutilmoqda»,
   * aslida hech narsa ochilmagan. Endi oyna ochilmasa (`null`) buni
   * aytamiz va havolani katta tugma qilib beramiz.
   */
  function startTelegram() {
    setError(null);
    setPopupBlocked(false);
    const win = window.open("", "_blank");
    setBusy(true);
    void (async () => {
      try {
        const t = await api.createLoginTicket();
        setTicket(t);
        setStage("waiting");
        // Yangi oyna: foydalanuvchi saytdan chiqib ketmasin. Botda
        // «Saytga kirish» havolasi shu OYNADA ochiladi — sessiya o'sha
        // yerda o'rnatiladi, biz esa pastdagi effektda uni kutamiz.
        if (win && !win.closed) {
          // `noopener` o'rniga: ochilgan sahifa bu oynaga qo'l cho'zolmasin.
          win.opener = null;
          win.location.href = t.url;
        } else {
          setPopupBlocked(true);
        }
      } catch (e) {
        win?.close();
        setError(e instanceof Error ? e.message : "Boshlanmadi");
        setStage("start");
      } finally {
        setBusy(false);
      }
    })();
  }

  /**
   * Sessiyani kutish.
   *
   * Kirish havolasi BOSHQA oynada (Telegram) ochiladi va cookie'ni
   * o'sha yerda o'rnatadi. Bu oyna buni faqat so'rab bilib oladi —
   * shuning uchun "waiting" bosqichida sessiyani har 2 soniyada
   * so'raymiz. Chipta 5 daqiqada eskiradi, shuning uchun shu muddatdan
   * keyin polling ham to'xtaydi.
   */
  useEffect(() => {
    if (stage !== "waiting" || !ticket) return;
    const deadline = new Date(ticket.expiresAt).getTime();
    const id = window.setInterval(async () => {
      if (Date.now() > deadline) {
        window.clearInterval(id);
        setStage("start");
        // UX-02: eng ko'p sabab — havola boshqa qurilmada ochilgan.
        setError(
          "Havola muddati tugadi. Agar «Saytga kirish» ni boshqa telefon yoki brauzerda bosgan bo‘lsangiz, kirish o‘sha yerda bo‘lgan — bu yerda qaytadan urinib ko‘ring.",
        );
        return;
      }
      try {
        const { user } = await api.fetchSession();
        if (user) {
          window.clearInterval(id);
          finish(user);
        }
      } catch {
        // Tarmoq xatosi — indamay keyingi tsiklda qayta uriniladi.
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [stage, ticket, finish]);

  /**
   * Telefon orqali kirish — faqat `DEV_LOGIN_ENABLED` yoqilganda.
   *
   * Endpoint (`/api/auth/otp`) allaqachon bor edi va serverning `devLogin`
   * bayrog'i ham klientga kelardi, lekin UI da unga yo'l yo'q edi: lokal
   * muhitda Telegram botisiz umuman kirib bo'lmasdi. Prod da bayroq
   * o'chiq (yoqilsa server ishga tushmaydi), demak bu yo'l chiqmaydi.
   */
  async function startPhone() {
    setError(null);
    const id = phone.trim();
    if (id.length < 3) {
      setError("Telefon raqamini kiriting");
      return;
    }
    setBusy(true);
    try {
      const res = await api.requestOtp(id);
      setStage("phoneCode");
      setCode("");
      // SMS ulanmagan — kod javobda qaytadi va shu yerda ko'rsatiladi.
      setHint(res.devCode ? `Sinov kodi: ${res.devCode}` : "Kod yuborildi");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kod so'ralmadi");
    } finally {
      setBusy(false);
    }
  }

  async function submitPhoneCode(value: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await api.verifyOtp(phone.trim(), value);
      finish(res.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kod noto'g'ri");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const phoneBlock = features?.devLogin ? (
    <div className="mt-4 border-t pt-4">
      {stage === "phone" || stage === "phoneCode" ? null : (
        <button
          type="button"
          onClick={() => {
            setStage("phone");
            setError(null);
            setHint(null);
          }}
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          Telefon raqami orqali kirish
        </button>
      )}
    </div>
  ) : null;

  if (stage === "phone" || stage === "phoneCode") {
    return (
      <div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Telefon orqali kirish</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          SMS ulanmagan — kod ekranda ko&apos;rsatiladi (sinov rejimi).
        </p>

        <label htmlFor="login-phone" className="text-muted-foreground mb-1 block text-sm">
          Telefon
        </label>
        <input
          id="login-phone"
          value={phone}
          inputMode="tel"
          autoComplete="tel"
          disabled={busy || stage === "phoneCode"}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+998901234567"
          className="border-input bg-background mb-3 h-11 w-full rounded-xl border px-3 disabled:opacity-60"
        />

        {stage === "phoneCode" ? (
          <>
            <label htmlFor="login-phone-code" className="text-muted-foreground mb-1 block text-sm">
              Kod
            </label>
            <input
              id="login-phone-code"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 5);
                setCode(v);
                if (v.length === 5) void submitPhoneCode(v);
              }}
              placeholder="•••••"
              className="border-input bg-background mb-3 h-11 w-full rounded-xl border px-3 text-center text-lg tracking-[0.5em] disabled:opacity-60"
            />
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void startPhone()}
            className="bg-primary text-primary-foreground mb-3 flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium disabled:opacity-60"
          >
            {busy ? "So'ralmoqda..." : "Kod olish"}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setStage("start");
            setCode("");
            setError(null);
            setHint(null);
          }}
          className="text-muted-foreground hover:text-foreground h-10 px-1 text-xs"
        >
          Orqaga
        </button>

        {hint && !error ? <p className="text-muted-foreground mt-3 text-xs">{hint}</p> : null}
        {error ? (
          <p role="alert" className="text-destructive mt-3 text-xs">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (!features?.telegram) {
    return (
      <div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Kirish</h1>
        <p className="text-muted-foreground text-sm">
          Telegram kirish hali sozlanmagan. Administrator <code>TELEGRAM_BOT_TOKEN</code> ni
          qo&apos;shishi kerak.
        </p>
        {phoneBlock}
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Xush kelibsiz</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Telegram orqali tez va xavfsiz kirish — parol kerak emas
      </p>

      {stage === "start" ? (
        <button
          type="button"
          disabled={busy}
          onClick={startTelegram}
          className="bg-primary text-primary-foreground flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium disabled:opacity-60"
        >
          {busy ? "Ochilmoqda..." : "Telegram orqali kirish"}
        </button>
      ) : (
        <>
          {popupBlocked ? (
            <p role="alert" data-popup-blocked className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              Yangi oyna ochilmadi — brauzeringiz uni bloklagan bo‘lishi mumkin. Quyidagi «Telegram’da ochish» tugmasini bosing.
            </p>
          ) : null}

          <ol className="text-muted-foreground mb-4 space-y-1 text-sm">
            <li>1. Ochilgan Telegram chatida «Start» ni bosing</li>
            <li>2. Bot yuborgan «Saytga kirish» tugmasini bosing</li>
          </ol>

          {/*
           * UX-02: kirish havolasi QAYSI brauzerda ochilsa, seans o'sha yerda
           * ochiladi. Kompyuterda boshlab telefonda bossa — bu sahifa 5 daqiqa
           * kutib, «muddati tugadi» derdi, sababini aytmasdan.
           */}
          <p className="text-muted-foreground mb-4 rounded-xl bg-muted/60 px-3 py-2 text-xs" data-same-device-hint>
            <span className="text-foreground font-medium">Shu qurilmada oching.</span> «Saytga kirish» ni boshqa telefon yoki
            kompyuterda bossangiz, kirish o‘sha yerda bo‘ladi — bu sahifa esa kutib qoladi.
          </p>

          <div className="border-border/60 mb-4 flex items-center justify-center gap-3 rounded-xl border py-6">
            <span className="border-muted-foreground/30 border-t-primary size-5 animate-spin rounded-full border-2" />
            <span className="text-muted-foreground text-sm">Telegram&apos;da tasdiqlanishi kutilmoqda...</span>
          </div>

          <div className="flex gap-2">
            {ticket ? (
              <a
                href={ticket.url}
                target="_blank"
                rel="noopener noreferrer"
                data-ticket-link
                className={
                  popupBlocked
                    ? "bg-primary text-primary-foreground flex h-10 flex-1 items-center justify-center rounded-xl text-sm font-medium"
                    : "bg-background hover:bg-muted flex h-10 flex-1 items-center justify-center rounded-xl border text-sm"
                }
              >
                {popupBlocked ? "Telegram’da ochish (shu qurilmada)" : "Telegram’ni shu qurilmada qayta ochish"}
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setStage("start");
                setTicket(null);
                setError(null);
                setHint(null);
                setPopupBlocked(false);
              }}
              className="text-muted-foreground hover:text-foreground h-10 px-3 text-xs"
            >
              Bekor qilish
            </button>
          </div>
        </>
      )}

      {phoneBlock}

      {hint && !error ? <p className="text-muted-foreground mt-3 text-xs">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-destructive mt-3 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
