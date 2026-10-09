"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Gift, Send } from "lucide-react";
import { request } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { REFERRAL_SHARE_TEXT, formatJoinDate, formatPoints, referralRuleText } from "@/lib/referral";
import { copyToClipboard } from "@/lib/share";
import { useLinkShare } from "../share/ShareMenu";

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

/** Variant A icon bubble: F0's `--accent-soft` when present, the same tint before F0 merges. */
const SOFT = { background: "var(--accent-soft, rgba(245, 158, 11, 0.16))" } as const;
const FOCUS = "focus-visible:ring-ring focus-visible:ring-offset-card focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";
const CARD = "bg-card min-w-0 rounded-[20px] border p-5";

/**
 * «Do'stlarni taklif qiling» (T3; Hamyon tab and profile): the user's invite link
 * (bot or site), copy and share, counters and the recent joiners (names only).
 * Phone first: every control is ≥ 44 px and nothing overflows at 360 px.
 * `className` replaces the default bottom margin (`mb-6`, the profile stack).
 */
export function ReferralCard({ className = "mb-6" }: { className?: string } = {}) {
  const [data, setData] = useState<ReferralSummaryView | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<LinkKind>("bot");
  const [notice, setNotice] = useState<Notice | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // «Ulashish»: Telegram's sheet in the Mini App, else the native sheet, else the fallback menu (lib/share.ts).
  const { share: shareLinkTo, menu: shareMenu } = useLinkShare();

  const load =useCallback(() => {
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
      <section className={cn(CARD, className)} data-referral-card="error">
        <h2 className="text-[17px] font-semibold">Do&apos;stlarni taklif qiling</h2>
        <p className="text-muted-foreground mt-1 text-[15px]">Taklif ma&apos;lumotlari yuklanmadi.</p>
        <button
          type="button"
          onClick={load}
          className={cn("hover:bg-muted mt-3 inline-flex h-11 items-center rounded-[14px] border px-4 text-[15px] font-medium", FOCUS)}
        >
          Qayta urinish
        </button>
      </section>
    );
  }

  if (!data) {
    return (
      <section className={cn(CARD, className)} aria-busy="true" aria-label="Yuklanmoqda" data-referral-card="loading">
        <div className="bg-muted h-6 w-48 rounded motion-safe:animate-pulse" />
        <div className="bg-muted mt-4 h-11 w-full rounded-[14px] motion-safe:animate-pulse" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="bg-muted h-16 rounded-2xl motion-safe:animate-pulse" />
          <div className="bg-muted h-16 rounded-2xl motion-safe:animate-pulse" />
        </div>
      </section>
    );
  }

  const link = kind === "bot" && data.botLink ? data.botLink : data.webLink;

  const copy = async () => {
    const ok = await copyToClipboard(link, { field: field.current });
    say(ok ? { text: "Havola nusxalandi", tone: "ok" } : { text: "Nusxalab bo'lmadi — havolani belgilab, qo'lda nusxalang", tone: "error" });
  };

  const share = () => shareLinkTo({ url: link, text: REFERRAL_SHARE_TEXT, title: "SlaydX" });

  return (
    <section className={cn(CARD, className)} data-referral-card="ready" aria-labelledby="referral-title">
      <div className="flex items-start gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-[14px] text-amber-700 dark:text-amber-400"
          style={SOFT}
          aria-hidden="true"
        >
          <Gift className="size-[22px]" />
        </span>
        <div className="min-w-0">
          <h2 id="referral-title" className="text-[17px] leading-snug font-semibold">
            Do&apos;stlarni taklif qiling
          </h2>
          <p className="text-muted-foreground mt-0.5 text-[14px] leading-snug" data-referral-rule>
            {referralRuleText(data.rewardPoints)}
          </p>
        </div>
      </div>

      {data.botLink ? (
        <div role="group" aria-label="Havola turi" className="bg-muted/70 mt-4 grid grid-cols-2 gap-1 rounded-[14px] p-1">
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
                "h-11 rounded-[11px] border text-[15px] font-medium transition-colors",
                FOCUS,
                // The border keeps the chosen segment visible in dark mode, where card ≈ muted (smoke screenshot).
                kind === id ? "border-border bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground border-transparent",
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
          className={cn("border-input bg-background h-11 w-full min-w-0 rounded-[14px] border px-3 font-mono text-[13.5px]", FOCUS)}
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          data-referral-copy
          className={cn(
            "hover:bg-muted inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-[14px] border px-3 text-[15px] font-medium",
            FOCUS,
          )}
        >
          <Copy className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Nusxalash</span>
        </button>
        <button
          type="button"
          onClick={share}
          data-referral-share
          className={cn(
            "bg-primary text-primary-foreground inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-[14px] px-3 text-[15px] font-semibold transition-transform active:scale-[0.98] motion-reduce:transform-none",
            FOCUS,
          )}
        >
          <Send className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Ulashish</span>
        </button>
      </div>
      <p
        aria-live="polite"
        data-referral-notice={notice?.tone ?? ""}
        className={cn("mt-2 min-h-5 text-[13px]", notice?.tone === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}
      >
        {notice?.text ?? ""}
      </p>

      <div className="mt-2 grid grid-cols-2 gap-3 text-center">
        <div className="bg-muted/60 rounded-2xl px-3 py-3">
          <div className="text-[20px] font-bold tabular-nums" data-referral-invited>
            {formatPoints(data.invitedCount)}
          </div>
          <div className="text-muted-foreground text-[13px]">Taklif qilinganlar</div>
        </div>
        <div className="bg-muted/60 rounded-2xl px-3 py-3">
          <div className="text-[20px] font-bold tabular-nums" data-referral-earned>
            {formatPoints(data.earnedPoints)}
          </div>
          <div className="text-muted-foreground text-[13px]">Ishlangan ball</div>
        </div>
      </div>

      <h3 className="text-muted-foreground mt-5 text-[13px] font-semibold tracking-[0.06em] uppercase">Oxirgi qo&apos;shilganlar</h3>
      {data.recent.length ? (
        <ul className="mt-1 divide-y text-[15px]" data-referral-recent>
          {data.recent.map((r, i) => (
            <li key={`${r.joinedAt}-${i}`} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="text-muted-foreground shrink-0 text-[13px] tabular-nums">{formatJoinDate(r.joinedAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-1.5 text-[15px]" data-referral-recent="empty">
          Hali hech kim qo&apos;shilmagan. Havolani do&apos;stlaringizga yuboring.
        </p>
      )}
      {shareMenu}
    </section>
  );
}
