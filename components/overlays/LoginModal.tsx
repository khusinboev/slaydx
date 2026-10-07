"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { safeReturnTo } from "@/lib/safe-return";
import { cn } from "@/lib/cn";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { OverlayClose, OverlayFrame, OverlayPanel, OverlayScrim } from "./OverlayFrame";
import { useDialog } from "./useDialog";

export function LoginModal() {
  const router = useRouter();
  const open = useUi((s) => s.overlay === "login");
  const returnTo = useUi((s) => s.returnTo);
  const close = useUi((s) => s.close);
  // Escape, fokus tsikli va fon aylanishini bloklash — barcha
  // oynalar uchun bitta joyda.
  const panelRef = useDialog(open, close);
  /**
   * Telefon (docs/mobile/PLAN.md O5): 44 px yopish tugmasi, 360×740 ga sig'adi
   * va ichida aylanadi, klaviatura ochilganda kiritish maydoni ko'rinib turadi
   * (`OverlayFrame`).
   */
  const phone = useCoarsePointer();

  if (!open) return null;

  return (
    <OverlayFrame
      label="Kirish"
      phone={phone}
      sheet
      className={phone ? "flex items-end justify-center" : "flex items-center justify-center p-4"}
    >
      <OverlayScrim onClose={close} />
      <OverlayPanel
        ref={panelRef}
        phone={phone}
        sheet
        className={phone ? "pt-2 [&_h1]:pr-12" : "max-w-md [&_h1]:pr-10"}
      >
        <OverlayClose onClose={close} phone={phone} className={cn("absolute", phone ? "top-4 right-3" : "top-4 right-4")} />
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
      </OverlayPanel>
    </OverlayFrame>
  );
}

type Stage = "start" | "waiting" | "phone" | "phoneCode";

export function LoginForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const features = useAppStore((s) => s.features);
  const setUser = useAppStore((s) => s.setUser);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);
  /** Telefon: har tugma ≥ 44 px, kiritish 16 px (iOS fokusda yaqinlashtirmasin). */
  const touch = useCoarsePointer();

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

  // Telegram Mini App ichida bo'lsak — avtomatik kiramiz, kod so'ralmaydi.
  useEffect(() => {
    const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
    const initData = tg?.WebApp?.initData;
    if (!initData || !features?.telegram) return;
    setBusy(true);
    api
      .loginWithTelegram({ initData })
      .then((r) => finish(r.user))
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
          className={cn(
            "text-muted-foreground hover:text-foreground underline",
            touch ? "-mx-2 inline-flex min-h-11 items-center px-2 text-[14.5px]" : "text-[13.5px]",
          )}
        >
          Telefon raqami orqali kirish
        </button>
      )}
    </div>
  ) : null;

  if (stage === "phone" || stage === "phoneCode") {
    return (
      <div>
        <h1 className="mb-1.5 text-[22px] leading-tight font-bold tracking-[-0.02em]">Telefon orqali kirish</h1>
        <p className="text-muted-foreground mb-6 text-[15px] leading-snug">
          SMS ulanmagan — kod ekranda ko&apos;rsatiladi (sinov rejimi).
        </p>

        <label htmlFor="login-phone" className="text-muted-foreground mb-1.5 block text-[14.5px] font-medium">
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
          className="border-input bg-background focus:ring-ring mb-3 h-12 w-full rounded-[14px] border px-3.5 text-base outline-none focus:ring-2 disabled:opacity-60"
        />

        {stage === "phoneCode" ? (
          <>
            <label htmlFor="login-phone-code" className="text-muted-foreground mb-1.5 block text-[14.5px] font-medium">
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
              className="border-input bg-background focus:ring-ring mb-3 h-12 w-full rounded-[14px] border px-3.5 text-center text-lg tracking-[0.5em] outline-none focus:ring-2 disabled:opacity-60"
            />
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void startPhone()}
            className="bg-primary text-primary-foreground focus-visible:ring-ring mb-3 flex h-12 w-full items-center justify-center rounded-[16px] text-[15.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-60"
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
          className={cn(
            "text-muted-foreground hover:text-foreground",
            touch ? "h-11 min-w-11 px-2 text-[14.5px]" : "h-10 px-1 text-[13.5px]",
          )}
        >
          Orqaga
        </button>

        {hint && !error ? <p className="text-muted-foreground mt-3 text-[13.5px]">{hint}</p> : null}
        {error ? (
          <p role="alert" className="text-destructive mt-3 text-[13.5px] leading-snug">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (!features?.telegram) {
    return (
      <div>
        <h1 className="mb-1.5 text-[22px] leading-tight font-bold tracking-[-0.02em]">Kirish</h1>
        <p className="text-muted-foreground text-[15px] leading-snug">
          Telegram kirish hali sozlanmagan. Administrator <code>TELEGRAM_BOT_TOKEN</code> ni
          qo&apos;shishi kerak.
        </p>
        {phoneBlock}
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1.5 text-[22px] leading-tight font-bold tracking-[-0.02em]">Xush kelibsiz</h1>
      <p className="text-muted-foreground mb-6 text-[15px] leading-snug">
        Telegram orqali tez va xavfsiz kirish — parol kerak emas
      </p>

      {stage === "start" ? (
        <button
          type="button"
          disabled={busy}
          onClick={startTelegram}
          className="bg-primary text-primary-foreground focus-visible:ring-ring flex h-12 w-full items-center justify-center gap-2 rounded-[16px] text-[15.5px] font-semibold outline-none transition-transform focus-visible:ring-2 active:scale-[0.98] disabled:opacity-60 motion-reduce:transform-none"
        >
          {busy ? null : <Send className="size-[18px]" aria-hidden />}
          {busy ? "Ochilmoqda..." : "Telegram orqali kirish"}
        </button>
      ) : (
        <>
          {popupBlocked ? (
            <p role="alert" data-popup-blocked className="mb-3 rounded-[14px] border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-[14.5px] leading-snug text-amber-800 dark:text-amber-300">
              Yangi oyna ochilmadi — brauzeringiz uni bloklagan bo‘lishi mumkin. Quyidagi «Telegram’da ochish» tugmasini bosing.
            </p>
          ) : null}

          <ol className="text-muted-foreground mb-4 space-y-1.5 text-[15px]">
            <li>1. Ochilgan Telegram chatida «Start» ni bosing</li>
            <li>2. Bot yuborgan «Saytga kirish» tugmasini bosing</li>
          </ol>

          {/*
           * UX-02: kirish havolasi QAYSI brauzerda ochilsa, seans o'sha yerda
           * ochiladi. Kompyuterda boshlab telefonda bossa — bu sahifa 5 daqiqa
           * kutib, «muddati tugadi» derdi, sababini aytmasdan.
           */}
          <p className="text-muted-foreground mb-4 rounded-[14px] bg-muted/60 px-3.5 py-2.5 text-[13.5px] leading-snug" data-same-device-hint>
            <span className="text-foreground font-medium">Shu qurilmada oching.</span> «Saytga kirish» ni boshqa telefon yoki
            kompyuterda bossangiz, kirish o‘sha yerda bo‘ladi — bu sahifa esa kutib qoladi.
          </p>

          <div className="border-border/60 mb-4 flex items-center justify-center gap-3 rounded-[16px] border py-6">
            <span className="border-muted-foreground/30 border-t-primary size-5 animate-spin rounded-full border-2" />
            <span className="text-muted-foreground text-[15px]">Telegram&apos;da tasdiqlanishi kutilmoqda...</span>
          </div>

          <div className="flex gap-2">
            {ticket ? (
              <a
                href={ticket.url}
                target="_blank"
                rel="noopener noreferrer"
                data-ticket-link
                className={cn(
                  "flex flex-1 items-center justify-center rounded-[14px] px-3 py-2 text-center text-[14.5px] font-medium",
                  touch ? "min-h-11" : "min-h-10",
                  popupBlocked
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-background hover:bg-muted border",
                )}
              >
                {popupBlocked ? "Telegram’da ochish" : "Telegram’ni qayta ochish"}
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
              className={cn(
                "text-muted-foreground hover:text-foreground px-3",
                touch ? "h-11 min-w-11 text-[14.5px]" : "h-10 text-[13.5px]",
              )}
            >
              Bekor qilish
            </button>
          </div>
        </>
      )}

      {phoneBlock}

      {hint && !error ? <p className="text-muted-foreground mt-3 text-[13.5px]">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-destructive mt-3 text-[13.5px] leading-snug">
          {error}
        </p>
      ) : null}
    </div>
  );
}
