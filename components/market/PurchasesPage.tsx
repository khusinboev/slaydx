"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { PageHeader } from "@/components/shell/PageHeader";
import * as api from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { MarketClosed, MarketNote, NOTE_ACTION, useMarketOn } from "./MarketClosed";
import { MARKET_HOME, MARKET_PURCHASES, isWideCover, itemHref, toolTitle } from "./market-model";

const RATING_TEXT_MAX = 300;

const BTN =
  "focus-visible:ring-ring inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] px-4 text-[15px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-60";
const BTN_PRIMARY = cn(BTN, "bg-primary text-primary-foreground hover:brightness-105");
const BTN_PLAIN = cn(BTN, "bg-card hover:bg-muted border");

/** `12.10.2026`: fixed format, the same on the server and in every browser. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const STATE_NOTE: Partial<Record<api.MarketPurchaseState, string>> = {
  refunded: "Qaytarilgan",
  void: "Qaytarilgan",
  refund_pending: "Pul qaytarilmoqda",
  blocked: "Cheklangan",
};

/** Five stars as one radio group: 44 px targets, the arrow keys are the browser's own for radios. */
function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Baho" className="-ml-2 flex" data-rating-stars>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} yulduz`} data-rating-star={n} onClick={() => onChange(n)} className="focus-visible:ring-ring grid size-11 place-items-center rounded-xl outline-none focus-visible:ring-2">
          <Star className={cn("size-6", n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50")} aria-hidden />
        </button>
      ))}
    </div>
  );
}

function RatingForm({ row, onSaved, onCancel }: { row: api.MarketPurchase; onSaved: (rating: api.MarketPurchase["rating"]) => void; onCancel: () => void }) {
  const [stars, setStars] = useState(row.rating?.stars ?? 0);
  const [text, setText] = useState(row.rating?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.rateMarketPurchase(row.id, { stars, text: text.trim() });
      onSaved({ ...r, editableUntil: row.rating?.editableUntil ?? "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Saqlanmadi. Qayta urinib ko‘ring.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-rating-form className="mt-2 flex flex-col gap-2 border-t pt-2">
      <Stars value={stars} onChange={setStars} />
      <AutoTextarea
        value={text}
        aria-label="Izoh"
        onChange={(e) => setText(e.target.value.slice(0, RATING_TEXT_MAX))}
        placeholder="Izoh (ixtiyoriy)"
        minRows={2}
        maxRows={6}
        maxLength={RATING_TEXT_MAX}
        className="border-input bg-card focus:ring-ring w-full rounded-[12px] border px-3 py-2 text-[16px] leading-snug outline-none focus:ring-2"
      />
      {error ? (
        <p role="alert" className="text-destructive text-[14px]">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="button" data-rating-save disabled={busy || stars === 0} onClick={() => void save()} className={BTN_PRIMARY}>
          Saqlash
        </button>
        <button type="button" onClick={onCancel} className={BTN_PLAIN}>
          Bekor qilish
        </button>
      </div>
    </div>
  );
}

function PurchaseRow({ row, onChange }: { row: api.MarketPurchase; onChange: (patch: Partial<api.MarketPurchase>) => void }) {
  const router = useRouter();
  const [rating, setRating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wide = isWideCover(row.toolId);
  const note = STATE_NOTE[row.state];

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.restoreMarketPurchase(row.id);
      router.push(`/uz/files/${r.generationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tiklab bo‘lmadi. Qayta urinib ko‘ring.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li data-purchase={row.id} className="bg-card rounded-[20px] border p-3 shadow-[var(--shadow-card)]">
      <div className="flex min-w-0 gap-3">
        <Link href={itemHref(row.itemId)} aria-label={row.title} className="bg-muted focus-visible:ring-ring block h-[84px] w-[72px] shrink-0 overflow-hidden rounded-[12px] border outline-none focus-visible:ring-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- public raster */}
          <img src={row.cover} alt="" loading="lazy" decoding="async" draggable={false} onError={(e) => (e.currentTarget.style.visibility = "hidden")} className={cn("h-full w-full bg-white object-top", wide ? "object-contain" : "object-cover")} />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link href={itemHref(row.itemId)} data-purchase-title className="focus-visible:ring-ring line-clamp-2 rounded-md text-[15.5px] leading-[1.3] font-semibold break-words outline-none focus-visible:ring-2">
            {row.title}
          </Link>
          <p className="text-muted-foreground truncate text-[13.5px]">
            {[toolTitle(row.toolId), dayOf(row.createdAt), formatSom(row.price)].filter(Boolean).join(" · ")}
          </p>
          {note ? (
            <span data-purchase-state={row.state} className="bg-muted text-muted-foreground mt-0.5 w-fit rounded-full px-2 py-0.5 text-[13px] font-medium">
              {note}
            </span>
          ) : null}
          {row.rating ? (
            <span data-purchase-rating className="mt-0.5 inline-flex items-center gap-1 text-[13.5px] font-medium tabular-nums">
              <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
              <span className="sr-only">Bahoyingiz:</span>
              {row.rating.stars}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2 empty:hidden">
        {row.state === "ready" && row.generationId ? (
          <Link href={`/uz/files/${row.generationId}`} data-purchase-open className={BTN_PRIMARY}>
            Ochish
          </Link>
        ) : null}
        {row.canRestore ? (
          <button type="button" data-purchase-restore disabled={busy} onClick={() => void restore()} className={BTN_PRIMARY}>
            {busy ? "Tiklanmoqda…" : "Qayta tiklash"}
          </button>
        ) : null}
        {row.canRate && !rating ? (
          <button type="button" data-purchase-rate onClick={() => setRating(true)} className={BTN_PLAIN}>
            {row.rating ? "Bahoni o‘zgartirish" : "Baho berish"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-destructive mt-2 text-[14px]">
          {error}
        </p>
      ) : null}
      {rating ? (
        <RatingForm
          row={row}
          onCancel={() => setRating(false)}
          onSaved={(r) => {
            setRating(false);
            onChange({ rating: r });
          }}
        />
      ) : null}
    </li>
  );
}

/** «Xaridlarim» (§2.3): the buyer's copies. What each row offers comes from the server (`state`, `canRestore`, `canRate`). */
export function PurchasesPage() {
  const marketOn = useMarketOn();
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const open = useUi((s) => s.open);
  const [rows, setRows] = useState<api.MarketPurchase[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "closed">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const r = await api.marketPurchases();
      setRows(r.purchases);
      setState("ready");
    } catch (e) {
      setState(e instanceof api.ApiError && e.status === 503 && e.data.code === "market_disabled" ? "closed" : "error");
    }
  }, []);

  useEffect(() => {
    if (sessionChecked && loggedIn && marketOn) void load();
  }, [sessionChecked, loggedIn, marketOn, load]);

  if (state === "closed" || (sessionChecked && !marketOn)) return <MarketClosed />;

  return (
    <div className="flex w-full flex-col" data-market-purchases>
      <PageHeader back backFallback={MARKET_HOME} title="Xaridlarim" subtitle="Bozordan olgan ishlaringiz" />
      <div className="mx-auto w-full max-w-3xl px-4 pt-1 pb-6">
        {sessionChecked && !loggedIn ? (
          <MarketNote
            title="Xaridlarni ko‘rish uchun kiring"
            action={
              <button type="button" data-purchases-login onClick={() => open("login", { returnTo: MARKET_PURCHASES })} className={NOTE_ACTION}>
                Kirish
              </button>
            }
          />
        ) : state === "error" ? (
          <MarketNote
            title="Xaridlar yuklanmadi"
            text="Aloqani tekshirib, qayta urinib ko‘ring."
            action={
              <button type="button" onClick={() => void load()} className={NOTE_ACTION}>
                Qayta urinish
              </button>
            }
          />
        ) : state === "loading" || !rows ? (
          <ul aria-hidden className="flex flex-col gap-3" data-purchases-skeleton>
            {[0, 1, 2].map((i) => (
              <li key={i} className="bg-card flex gap-3 rounded-[20px] border p-3">
                <div className="bg-muted slx-shimmer h-[84px] w-[72px] rounded-[12px]" />
                <div className="flex flex-1 flex-col gap-2 pt-1">
                  <div className="bg-muted slx-shimmer h-4 w-4/5 rounded-md" />
                  <div className="bg-muted slx-shimmer h-3.5 w-1/2 rounded-md" />
                </div>
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <MarketNote
            title="Hali xarid qilmagansiz"
            text="Bozordan olgan ishlaringiz shu yerda turadi."
            action={
              <Link href={MARKET_HOME} className={NOTE_ACTION}>
                Bozorga o‘tish
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3" data-purchases-list>
            {rows.map((row) => (
              <PurchaseRow key={row.id} row={row} onChange={(p) => setRows((list) => list?.map((r) => (r.id === row.id ? { ...r, ...p } : r)) ?? list)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
