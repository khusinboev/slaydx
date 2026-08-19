"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
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
            if (returnTo) router.push(returnTo);
            else router.refresh();
          }}
        />
      </div>
    </div>
  );
}

type Stage = "start" | "code";

export function LoginForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const features = useAppStore((s) => s.features);
  const setUser = useAppStore((s) => s.setUser);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);

  const [stage, setStage] = useState<Stage>("start");
  const [ticket, setTicket] = useState<api.Ticket | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

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

  async function startTelegram() {
    setError(null);
    setBusy(true);
    try {
      const t = await api.createLoginTicket();
      setTicket(t);
      setStage("code");
      setHint("Telegram'da «Start» tugmasini bosing — kod shu yerga keladi.");
      // Yangi oyna: foydalanuvchi saytdan chiqib ketmasin.
      window.open(t.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Boshlanmadi");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value: string) {
    if (!ticket) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.redeemLoginTicket(ticket.nonce, value);
      finish(res.user);
    } catch (e) {
      const err = e as api.ApiError;
      // 409 — hali Start bosilmagan; bu xato emas, kutish holati.
      if (err.status === 409) setHint(err.message);
      else setError(err.message || "Kod noto'g'ri");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (!features?.telegram) {
    return (
      <div>
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Kirish</h1>
        <p className="text-muted-foreground text-sm">
          Telegram kirish hali sozlanmagan. Administrator <code>TELEGRAM_BOT_TOKEN</code> ni
          qo&apos;shishi kerak.
        </p>
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
          onClick={() => void startTelegram()}
          className="bg-primary text-primary-foreground flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium disabled:opacity-60"
        >
          {busy ? "Ochilmoqda..." : "Telegram orqali kirish"}
        </button>
      ) : (
        <>
          <ol className="text-muted-foreground mb-4 space-y-1 text-sm">
            <li>1. Ochilgan Telegram chatida «Start» ni bosing</li>
            <li>2. Bot yuborgan 5 xonali kodni shu yerga kiriting</li>
          </ol>

          <label htmlFor="login-code" className="text-muted-foreground mb-1 block text-sm">
            Kod
          </label>
          <input
            id="login-code"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 5);
              setCode(v);
              if (v.length === 5) void submitCode(v);
            }}
            placeholder="•••••"
            className="border-input bg-background mb-3 h-11 w-full rounded-xl border px-3 text-center text-lg tracking-[0.5em] disabled:opacity-60"
          />

          <div className="flex gap-2">
            {ticket ? (
              <a
                href={ticket.url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-background hover:bg-muted flex h-10 flex-1 items-center justify-center rounded-xl border text-sm"
              >
                Telegram&apos;ni qayta ochish
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setStage("start");
                setTicket(null);
                setCode("");
                setError(null);
                setHint(null);
              }}
              className="text-muted-foreground hover:text-foreground h-10 px-3 text-xs"
            >
              Bekor qilish
            </button>
          </div>
        </>
      )}

      {hint && !error ? <p className="text-muted-foreground mt-3 text-xs">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-destructive mt-3 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
