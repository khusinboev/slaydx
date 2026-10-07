"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Gift, Send } from "lucide-react";
import { request } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { REFERRAL_SHARE_TEXT, formatPoints, referralRuleText, telegramShareUrl } from "@/lib/referral";
import { isInTelegramWebApp, openTelegramLink } from "@/lib/telegram-webapp";

/** `GET /api/referral` (`lib/server/referrals.ts ReferralSummary`). */
export type ReferralSummaryView = {
  code: string;
  botLink: string | null;
  webLink: string;
  rewardPoints: number;
  invitedCount: number;
  earnedPoints: number;
  recent: { name: string; joinedAt: string }[];
};

type LinkKind = "bot" | "web";
type Notice = { text: string; tone: "ok" | "error" };

/**
 * Copies `text`: the async Clipboard API first; where it is missing or refused
 * (older Telegram webviews, insecure origins) the read-only field is selected
 * and `execCommand("copy")` tries; if both fail the field stays selected so
 * the user can copy by hand.
 */
export async function copyText(text: string, field: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection fallback.
  }
  try {
    if (field) {
      field.focus();
      field.select();
      field.setSelectionRange(0, text.length);
    }
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  }
}

/**
 * Profile section «Do'stlarni taklif qiling» (T3): the user's invite link
 * (bot or site), copy and share, counters and the recent joiners (names only).
 * Phone first: every control is ≥ 44 px and nothing overflows at 360 px.
 */
export function ReferralCard() {
  const [data, setData] = useState<ReferralSummaryView | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<LinkKind>("bot");
  const [notice, setNotice] = useState<Notice | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    request<ReferralSummaryView>("/api/referral")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [load]);

  const say = useCallback((n: Notice) => {
    setNotice(n);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3000);
  }, []);

  if (failed) {
    return (
      <section className="bg-card mb-6 rounded-2xl border p-6" data-referral-card="error">
        <h2 className="text-lg font-semibold">Do&apos;stlarni taklif qiling</h2>
        <p className="text-muted-foreground mt-1 text-sm">Taklif ma&apos;lumotlari yuklanmadi.</p>
        <button
          type="button"
          onClick={load}
          className="hover:bg-muted mt-3 inline-flex h-11 items-center rounded-xl border px-4 text-sm font-medium"
        >
          Qayta urinish
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="bg-card mb-6 rounded-2xl border p-6" aria-busy="true" aria-label="Yuklanmoqda" data-referral-card="loading">
        <div className="bg-muted h-6 w-48 animate-pulse rounded" />
        <div className="bg-muted mt-4 h-11 w-full animate-pulse rounded-xl" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="bg-muted h-16 animate-pulse rounded-xl" />
          <div className="bg-muted h-16 animate-pulse rounded-xl" />
        </div>
      </section>
    );
  }

  const link = kind === "bot" && data.botLink ? data.botLink : data.webLink;

  const copy = async () => {
    const ok = await copyText(link, field.current);
    say(ok ? { text: "Havola nusxalandi", tone: "ok" } : { text: "Nusxalab bo'lmadi — havolani belgilab, qo'lda nusxalang", tone: "error" });
  };

  const share = () => {
    // Inside the Mini App: Telegram's own «send to a chat» sheet.
    if (isInTelegramWebApp() && openTelegramLink(telegramShareUrl(link))) return;
    // Elsewhere: the system share sheet (called synchronously, inside the tap), else copy.
    if (typeof navigator.share === "function") {
      navigator.share({ title: "SlaydX", text: REFERRAL_SHARE_TEXT, url: link }).catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        void copy();
      });
      return;
    }
    void copy();
  };

  return (
    <section className="bg-card mb-6 min-w-0 rounded-2xl border p-6" data-referral-card="ready" aria-labelledby="referral-title">
      <div className="flex items-start gap-3">
        <span className="bg-primary/15 text-primary flex size-10 shrink-0 items-center justify-center rounded-full" aria-hidden="true">
          <Gift className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="referral-title" className="text-lg font-semibold">
            Do&apos;stlarni taklif qiling
          </h2>
          <p className="text-muted-foreground mt-0.5 text-sm" data-referral-rule>
            {referralRuleText(data.rewardPoints)}
          </p>
        </div>
      </div>

      {data.botLink ? (
        <div role="group" aria-label="Havola turi" className="bg-muted/60 mt-4 grid grid-cols-2 gap-1 rounded-xl p-1">
          {(
            [
              ["bot", "Telegram bot"],
              ["web", "Sayt"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={kind === id}
              data-referral-kind={id}
              onClick={() => setKind(id)}
              className={cn(
                "h-11 rounded-lg text-sm font-medium transition-colors",
                kind === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <label className="mt-3 block">
        <span className="sr-only">Taklif havolasi</span>
        <input
          ref={field}
          readOnly
          value={link}
          data-referral-link
          onFocus={(e) => e.currentTarget.select()}
          className="border-input bg-background h-11 w-full min-w-0 rounded-xl border px-3 font-mono text-[13px]"
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          data-referral-copy
          className="hover:bg-muted inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium"
        >
          <Copy className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Nusxalash</span>
        </button>
        <button
          type="button"
          onClick={share}
          data-referral-share
          className="bg-primary text-primary-foreground inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium"
        >
          <Send className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Ulashish</span>
        </button>
      </div>
      <p
        aria-live="polite"
        data-referral-notice={notice?.tone ?? ""}
        className={cn("mt-2 min-h-5 text-xs", notice?.tone === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}
      >
        {notice?.text ?? ""}
      </p>

      <div className="mt-2 grid grid-cols-2 gap-3 text-center">
        <div className="bg-muted/50 rounded-xl px-3 py-3">
          <div className="text-lg font-semibold tabular-nums" data-referral-invited>
            {formatPoints(data.invitedCount)}
          </div>
          <div className="text-muted-foreground text-xs">Taklif qilinganlar</div>
        </div>
        <div className="bg-muted/50 rounded-xl px-3 py-3">
          <div className="text-lg font-semibold tabular-nums" data-referral-earned>
            {formatPoints(data.earnedPoints)}
          </div>
          <div className="text-muted-foreground text-xs">Ishlangan ball</div>
        </div>
      </div>

      <h3 className="mt-5 text-sm font-semibold">Oxirgi qo&apos;shilganlar</h3>
      {data.recent.length ? (
        <ul className="mt-2 divide-y text-sm" data-referral-recent>
          {data.recent.map((r, i) => (
            <li key={`${r.joinedAt}-${i}`} className="flex min-w-0 items-center justify-between gap-3 py-2">
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {new Date(r.joinedAt).toLocaleDateString("uz-UZ")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-1 text-sm" data-referral-recent="empty">
          Hali hech kim qo&apos;shilmagan. Havolani do&apos;stlaringizga yuboring.
        </p>
      )}
    </section>
  );
}
