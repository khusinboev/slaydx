"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Check, Link2, RefreshCw } from "lucide-react";
import { request } from "@/lib/api-client";
import { GAME_KIND_LABEL } from "@/lib/game/engine";
import type { PublicGameKind } from "@/lib/game/public";
import { cn } from "@/lib/cn";

/**
 * O'YIN HAVOLASI PANELI (AUDIT-22 WP-C) — EGASI tomoni.
 *
 * Egasi qarori 8: ochiq havola + QR, loginsiz, ism kiritiladi, natijalar
 * o'qituvchiga (jadval + CSV), REAL-TIME/leaderboard YO'Q. Shuning uchun
 * bu panelda «jonli taxta» ham, avtomatik yangilanish ham yo'q —
 * «Yangilash» tugmasi bor va u yetarli: dars oxirida o'qituvchi bir
 * marta bosadi.
 *
 * QR KLIENTDA chiziladi (`qrcode` ning brauzer bandli, `toString` → SVG).
 * `lib/game/qr.ts` server tomoni uchun AYNI kutubxonani ishlatadi, lekin
 * u `server-only` va uni klient komponenti import qila olmaydi; ochiq
 * QR route esa YO'Q (havolaning o'zi sir, uni kalitsiz endpointdan
 * berish havolani yana bir joyda oshkor qilardi). Import DINAMIK —
 * kutubxona alohida bo'lakka chiqadi va o'yin bo'lmagan hujjatlarda
 * umuman yuklanmaydi.
 */

type Session = { token: string; url: string; kind: PublicGameKind; createdAt?: string; expiresAt: string | null };
type Row = { id: string; playerName: string; score: number; total: number; percent: number; seconds: number; createdAt: string };
/** Keyingi sahifa kursori (`app/api/generations/[id]/results` → `?before=&beforeId=`). */
type Cursor = { createdAt: string; id: string };
type ResultsPage = { results?: Row[]; total?: number; nextCursor?: Cursor | null };

const resultsUrl = (id: string, c: Cursor | null) =>
  `/api/generations/${id}/results${c ? `?before=${encodeURIComponent(c.createdAt)}&beforeId=${encodeURIComponent(c.id)}` : ""}`;

export function GameSharePanel({ id, kind }: { id: string; kind: PublicGameKind }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  /*
   * Sahifalash (W3-G nit 2): server 500 tadan beradi, `total` — HAQIQIY son.
   * Ilgari faqat birinchi sahifa ko'rinardi va son `rows.length` edi.
   * Eski server `total`/`nextCursor` bermasa — son qatorlardan, tugma yo'q.
   */
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [more, setMore] = useState(false);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const session = sessions[active];

  const takePage = useCallback((r: ResultsPage) => {
    setTotal(typeof r.total === "number" ? r.total : null);
    setCursor(r.nextCursor && r.nextCursor.createdAt && r.nextCursor.id ? r.nextCursor : null);
  }, []);

  /** Birinchi sahifa — ochilganda va «Yangilash» da (eski sahifalar tashlanadi). */
  const loadResults = useCallback(async () => {
    const r = await request<ResultsPage>(resultsUrl(id, null));
    setRows(r.results ?? []);
    takePage(r);
  }, [id, takePage]);

  const loadMore = useCallback(async () => {
    if (!cursor || more) return;
    setMore(true);
    setError("");
    try {
      const r = await request<ResultsPage>(resultsUrl(id, cursor));
      setRows((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...(r.results ?? []).filter((x) => !seen.has(x.id))];
      });
      takePage(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Natijalarni yuklab bo‘lmadi");
    } finally {
      setMore(false);
    }
  }, [id, cursor, more, takePage]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await request<{ sessions: Session[] }>(`/api/generations/${id}/share`);
        if (!alive) return;
        setSessions(s.sessions ?? []);
        if (s.sessions?.length) await loadResults();
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Yuklab bo‘lmadi");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, loadResults]);

  // QR — faqat havola bo'lganda va faqat tanlangan havola uchun.
  useEffect(() => {
    let alive = true;
    if (!session) {
      setQr("");
      return;
    }
    void (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const svg = await QRCode.toString(session.url, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 200 });
        if (alive) setQr(svg);
      } catch {
        // QR chizilmasa ham havola ishlaydi — panel yiqilmaydi.
        if (alive) setQr("");
      }
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  const create = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const s = await request<Session>(`/api/generations/${id}/share`, { method: "POST", body: JSON.stringify({}) });
      setSessions((prev) => [s, ...prev]);
      setActive(0);
      await loadResults();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Havola yaratilmadi");
    } finally {
      setBusy(false);
    }
  }, [id, loadResults]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await loadResults();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Natijalarni yuklab bo‘lmadi");
    } finally {
      setBusy(false);
    }
  }, [loadResults]);

  const copy = useCallback(() => {
    if (!session) return;
    void navigator.clipboard?.writeText(session.url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setError("Nusxalab bo‘lmadi — havolani qo‘lda belgilang"),
    );
  }, [session]);

  return (
    <section className="no-print" data-game-share>
      <div className="flex items-center gap-2">
        <Link2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
        <h2 className="text-sm font-medium">O‘yin havolasi</h2>
        <span className="text-muted-foreground text-xs">{GAME_KIND_LABEL[kind]}</span>
      </div>

      {error ? (
        <p role="alert" className="text-destructive mt-2 text-sm" data-share-error>
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground mt-2 text-sm">Yuklanmoqda…</p>
      ) : !session ? (
        /*
         * BO'SH HOLAT — nima bo'lishini AYTADI: o'qituvchi tugmani
         * bosishdan oldin «havola kimga ketadi, nima yig'iladi» ni
         * bilsin (loginsiz ochiq havola — qaytarib bo'lmaydigan qadam).
         */
        <div className="mt-2" data-share-empty>
          <p className="text-muted-foreground text-sm">
            Hali havola yaratilmagan. Havola va QR kod orqali o‘quvchilar bu {GAME_KIND_LABEL[kind].toLowerCase()}ni
            telefonda o‘ynaydi — ro‘yxatdan o‘tmasdan, faqat ismini yozib. Natijalar shu yerda ko‘rinadi.
          </p>
          <button
            type="button"
            data-share-create
            className="bg-primary text-primary-foreground mt-3 h-10 rounded-lg px-4 text-sm font-medium disabled:opacity-50"
            disabled={busy}
            onClick={() => void create()}
          >
            {busy ? "Yaratilmoqda…" : "O‘yin havolasi yaratish"}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-4 sm:flex-row">
          {qr ? (
            <div
              className="bg-background mx-auto size-[168px] shrink-0 rounded-xl border p-2 [&>svg]:size-full"
              data-share-qr
              aria-label="O‘yin havolasining QR kodi"
              // QR — o'zimiz yaratgan SVG (havola matnidan), tashqi
              // ma'lumot emas; `qrcode` chiqishi belgilangan shakl.
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <input
                readOnly
                data-share-url
                className="border-input bg-muted/40 h-9 min-w-0 flex-1 rounded-lg border px-2.5 text-xs"
                value={session.url}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                data-share-copy
                className="bg-card inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm"
                onClick={copy}
              >
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? "Nusxalandi" : "Nusxalash"}
              </button>
            </div>

            <p className="text-muted-foreground mt-1.5 text-xs" data-share-expires>
              {session.expiresAt ? `Amal muddati: ${dateText(session.expiresAt)}` : "Muddati cheklanmagan"}
              {sessions.length > 1 ? ` · jami ${sessions.length} ta havola` : ""}
            </p>

            {sessions.length > 1 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sessions.map((s, i) => (
                  <button
                    key={s.token}
                    type="button"
                    data-share-tab={s.token}
                    className={cn(
                      "h-8 rounded-lg border px-2.5 text-xs",
                      i === active ? "border-primary bg-primary/15 font-medium" : "bg-card",
                    )}
                    onClick={() => setActive(i)}
                  >
                    {i + 1}-havola
                  </button>
                ))}
              </div>
            ) : null}

            <button
              type="button"
              data-share-create
              className="bg-card mt-2 h-9 rounded-lg border px-3 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => void create()}
            >
              Yangi havola
            </button>
          </div>
        </div>
      )}

      {session ? (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Natijalar</h3>
            <span className="text-muted-foreground text-xs" data-results-total>
              {total !== null && total > rows.length ? `${rows.length} ta ko‘rsatilgan · jami ${total} ta` : `${total ?? rows.length} ta`}
            </span>
            <button
              type="button"
              data-results-refresh
              className="text-muted-foreground hover:text-foreground ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs disabled:opacity-50"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Yangilash
            </button>
            {rows.length ? (
              <a
                data-results-csv
                href={`/api/generations/${id}/results?format=csv`}
                className="bg-card inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium"
                download
              >
                CSV
              </a>
            ) : null}
          </div>

          {rows.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm" data-results-table>
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th className="py-1.5 pr-2 font-medium">Ism</th>
                    <th className="py-1.5 pr-2 font-medium">Ball</th>
                    <th className="py-1.5 pr-2 font-medium">Foiz</th>
                    <th className="py-1.5 pr-2 font-medium">Vaqt</th>
                    <th className="py-1.5 font-medium">Sana</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t" data-result-row={r.id}>
                      <td className="py-1.5 pr-2">{r.playerName}</td>
                      <td className="py-1.5 pr-2 tabular-nums">
                        {r.score} / {r.total}
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums">{r.percent}%</td>
                      <td className="text-muted-foreground py-1.5 pr-2 tabular-nums">{mmss(r.seconds)}</td>
                      <td className="text-muted-foreground py-1.5 text-xs">{dateText(r.createdAt, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cursor ? (
                <button
                  type="button"
                  data-results-more
                  className="bg-card mt-2 h-9 rounded-lg border px-3 text-sm disabled:opacity-50"
                  disabled={more || busy}
                  aria-busy={more || undefined}
                  onClick={() => void loadMore()}
                >
                  {more ? "Yuklanmoqda…" : "Yana ko‘rsatish"}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm" data-results-empty>
              Hali hech kim o‘ynamagan. Havolani yoki QR kodni o‘quvchilarga bering — natijalar shu yerda paydo bo‘ladi.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

const mmss = (s: number): string => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, "0")}`;

/** Sana — o'zbekcha; noto'g'ri qiymatda xom satr (panel yiqilmasin). */
function dateText(iso: string, withTime = false): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const date = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  return withTime ? `${date} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : date;
}
