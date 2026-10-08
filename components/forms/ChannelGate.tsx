"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Lock, Send } from "lucide-react";
import * as api from "@/lib/api-client";
import { gateFromStatus, useChannelGate } from "@/lib/channel-gate";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { openTelegramLink } from "@/lib/telegram-webapp";

/**
 * Mandatory channels card on every tool page (docs/bonus/BONUS3.md C-Q2/C-Q3), above the form:
 *
 *   - `channel_required` — «Avval kanalga obuna bo‘ling»: one 44 px button per channel (its t.me
 *     link; inside the Mini App through `openTelegramLink`, so Telegram opens the channel itself)
 *     and «✅ Tekshirish» (`GET /api/channels/required?fresh=1`);
 *   - `telegram_required` — the account has no Telegram (phone login): «Telegram orqali kiring»
 *     opens the existing login dialog (ticket flow), back to this page afterwards.
 *
 * Checked on page load (so the user sees it before filling the form) and set by the 403 of
 * `createGeneration`. The server is the gate; this card only explains it. Nothing renders while
 * the user may create.
 */
export function ChannelGate() {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const gate = useChannelGate((s) => s.gate);
  const setGate = useChannelGate((s) => s.setGate);
  const openLogin = useUi((s) => s.open);
  const pathname = usePathname();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!loggedIn) {
      setGate(null);
      return;
    }
    let live = true;
    api
      .requiredChannels()
      .then((r) => {
        if (live) setGate(gateFromStatus(r));
      })
      // Offline / server error: the POST gate still answers; never block the page on this read.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [loggedIn, setGate]);

  // A gate that appears after a submit is shown where the user can see it.
  useEffect(() => {
    if (gate) ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [gate]);

  if (!gate) return null;

  async function check() {
    setChecking(true);
    setNote(null);
    try {
      const next = gateFromStatus(await api.requiredChannels(true));
      setGate(next);
      if (next) setNote("Obuna hali ko‘rinmayapti. Kanalga qo‘shilganingizga ishonch hosil qilib, birozdan so‘ng qayta tekshiring.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Tekshirib bo‘lmadi");
    } finally {
      setChecking(false);
    }
  }

  const btn =
    "focus-visible:ring-ring flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] px-4 text-[15px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60";

  return (
    <section
      ref={ref}
      data-channel-gate={gate.needsTelegram ? "telegram" : "channels"}
      aria-labelledby="channel-gate-title"
      className="bg-card mb-5 rounded-[22px] border p-4 shadow-[var(--shadow-bar)]"
    >
      <h2 id="channel-gate-title" className="flex items-center gap-2 text-[17px] font-bold">
        <Lock className="text-primary size-5 shrink-0" aria-hidden="true" />
        {gate.needsTelegram ? "Telegram orqali kiring" : "Avval kanalga obuna bo‘ling"}
      </h2>
      <p className="text-muted-foreground mt-1.5 text-[14.5px] leading-snug">
        {gate.needsTelegram
          ? "Yangi ish yaratish uchun hisobingiz Telegram bilan bog‘langan bo‘lishi kerak: Telegram orqali kiring, so‘ng kanal obunasi tekshiriladi."
          : "Yangi ish yaratish uchun quyidagi kanalga obuna bo‘ling va «Tekshirish»ni bosing. Fayllaringiz, profil va hamyon ochiq."}
      </p>

      {gate.needsTelegram ? (
        <button
          type="button"
          data-telegram-login
          onClick={() => openLogin("login", { returnTo: pathname ?? "/uz" })}
          className={`${btn} bg-primary text-primary-foreground mt-3`}
        >
          <Send className="size-4" aria-hidden="true" />
          Telegram orqali kiring
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {gate.channels.map((c) =>
            c.joinUrl ? (
              <a
                key={c.id}
                href={c.joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-channel-link={c.id}
                onClick={(e) => {
                  if (openTelegramLink(c.joinUrl!)) e.preventDefault();
                }}
                className={`${btn} bg-primary text-primary-foreground`}
              >
                <Send className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{c.title}</span>
              </a>
            ) : (
              <span key={c.id} data-channel-link={c.id} className={`${btn} bg-muted text-foreground`}>
                <span className="truncate">{c.title}</span>
              </span>
            ),
          )}
          <button
            type="button"
            data-channel-check
            onClick={() => void check()}
            disabled={checking}
            className={`${btn} border-input text-foreground hover:bg-muted border`}
          >
            {checking ? "Tekshirilmoqda…" : "✅ Tekshirish"}
          </button>
        </div>
      )}
      {note ? (
        <p role="status" className="text-muted-foreground mt-2 text-[13.5px] leading-snug" data-channel-note>
          {note}
        </p>
      ) : null}
    </section>
  );
}
