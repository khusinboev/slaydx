"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Ban, CheckCircle2 } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

function fmt(n: number) {
  return n.toLocaleString("uz-UZ");
}

const WALLET_LABEL: Record<api.Wallet, string> = {
  points: "Ball",
  quota: "Kvota",
  balance: "Balans",
};

/** Bitta foydalanuvchining bitta hamyonini tuzatish paneli. */
function WalletAdjuster({
  userId,
  wallet,
  value,
  onChanged,
}: {
  userId: string;
  wallet: api.Wallet;
  value: number;
  onChanged: (next: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(sign: 1 | -1) {
    const n = Math.trunc(Number(amount));
    if (!Number.isFinite(n) || n <= 0) {
      setError("Musbat butun son kiriting");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.adjustAdminWallet(userId, wallet, n * sign);
      onChanged(res.after);
      setAmount("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground w-14 shrink-0 text-xs">{WALLET_LABEL[wallet]}</span>
        <span className="w-20 shrink-0 text-sm font-medium tabular-nums">{fmt(value)}</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          disabled={busy}
          inputMode="numeric"
          placeholder="miqdor"
          className="border-input bg-background h-8 w-24 rounded-lg border px-2 text-sm disabled:opacity-60"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void apply(1)}
          className="bg-primary text-primary-foreground h-8 rounded-lg px-2.5 text-xs font-medium disabled:opacity-60"
        >
          + Qo&apos;shish
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void apply(-1)}
          className="border-input h-8 rounded-lg border px-2.5 text-xs font-medium disabled:opacity-60"
        >
          − Yechish
        </button>
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

function UserRow({ u, onUpdate }: { u: api.AdminUser; onUpdate: (next: api.AdminUser) => void }) {
  const [open, setOpen] = useState(false);
  const [busyBlock, setBusyBlock] = useState(false);

  async function toggleBlock() {
    const next = !u.isBlocked;
    setBusyBlock(true);
    try {
      // So'rov yiqilmasa `next` — bizning yangi holatimiz aynan shu.
      // `PUT` javobi `SessionUser` shaklida (`isBlocked` maydonisiz),
      // shuning uchun holatni javobdan emas, yuborilgan qiymatdan olamiz.
      await api.setAdminBlocked(u.id, next);
      onUpdate({ ...u, isBlocked: next });
    } catch {
      // Jimgina — tugma holati o'zgarmaydi, foydalanuvchi qayta bosishi mumkin.
    } finally {
      setBusyBlock(false);
    }
  }

  return (
    <div className="border-border/60 rounded-xl border p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{u.name || "Nomsiz"}</span>
            {u.isBlocked ? (
              <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 text-[10px] font-medium">
                bloklangan
              </span>
            ) : null}
          </div>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs">
            {u.username ? <span>@{u.username}</span> : null}
            {u.telegramId ? <span>tg:{u.telegramId}</span> : null}
            {u.localId ? <span>{u.localId}</span> : null}
            {u.phone ? <span>{u.phone}</span> : null}
          </div>
        </div>
        <div className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {fmt(u.points + u.quota + u.balance)} jami
        </div>
      </button>

      {open ? (
        <div className="border-border/60 mt-3 space-y-2 border-t pt-3">
          {(["points", "quota", "balance"] as const).map((w) => (
            <WalletAdjuster
              key={w}
              userId={u.id}
              wallet={w}
              value={u[w]}
              onChanged={(next) => onUpdate({ ...u, [w]: next })}
            />
          ))}
          <button
            type="button"
            disabled={busyBlock}
            onClick={() => void toggleBlock()}
            className="border-input mt-1 flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium disabled:opacity-60"
          >
            {u.isBlocked ? (
              <>
                <CheckCircle2 className="size-3.5" /> Blokdan chiqarish
              </>
            ) : (
              <>
                <Ban className="size-3.5" /> Bloklash
              </>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AdminPage() {
  const user = useAppStore((s) => s.user);
  const sessionChecked = useAppStore((s) => s.sessionChecked);

  // `q` — inputning ko'rinadigan qiymati (har harfda yangilanadi).
  // `debouncedQ` — haqiqiy so'rovni ishga tushiradigan qiymat. Ikkovini
  // ajratish ikki marta yuklashning oldini oladi: agar ikkalasi ham
  // bitta effektni ishga tushirsa, `setPage(1)` bilan `setQ` bir vaqtda
  // chaqirilganda oraliq (eski so'rov + 1-bet) so'rovi ham ketardi.
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [users, setUsers] = useState<api.AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((query: string, pageNum: number) => {
    setLoading(true);
    setError(null);
    api
      .fetchAdminUsers(query, pageNum)
      .then((r) => {
        setUsers(r.users);
        setTotal(r.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Yuklanmadi"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(debouncedQ, page);
  }, [debouncedQ, page, load]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function onSearch(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Bet ham shu yerda, kechikish bilan birga qaytariladi — aks holda
    // `setPage(1)` darhol chaqirilsa, eski qidiruv matni bilan qo'shimcha
    // (keraksiz) so'rov ketardi.
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setDebouncedQ(value);
    }, 300);
  }

  // Sessiya hali tekshirilmoqda — hech narsa ko'rsatmaymiz (yaltirash yo'q).
  if (!sessionChecked) return null;
  // Server sahifani allaqachon himoyalagan, lekin klient tomonda ham
  // adminlikni tasdiqlaymiz: sessiya boshqa foydalanuvchiga almashsa
  // (masalan chiqib, boshqa hisobga kirilsa) eski render qolib ketmasin.
  if (!user?.isAdmin) return null;

  const pageSize = 30;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Admin panel</h1>
      <p className="text-muted-foreground mb-6 text-sm">{fmt(total)} ta foydalanuvchi</p>

      <div className="relative mb-4">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Ism, username, Telegram ID yoki telefon..."
          className="border-input bg-background h-10 w-full rounded-xl border pl-9 pr-3 text-sm"
        />
      </div>

      {error ? <p className="text-destructive mb-3 text-sm">{error}</p> : null}

      <div className="space-y-2">
        {loading ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Yuklanmoqda...</p>
        ) : users.length ? (
          users.map((u) => (
            <UserRow
              key={u.id}
              u={u}
              onUpdate={(next) => setUsers((list) => list.map((x) => (x.id === next.id ? next : x)))}
            />
          ))
        ) : (
          <p className="text-muted-foreground py-8 text-center text-sm">Hech narsa topilmadi</p>
        )}
      </div>

      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="border-input h-8 rounded-lg border px-3 text-xs disabled:opacity-40"
          >
            Oldingi
          </button>
          <span className="text-muted-foreground text-xs">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            className="border-input h-8 rounded-lg border px-3 text-xs disabled:opacity-40"
          >
            Keyingi
          </button>
        </div>
      ) : null}
    </div>
  );
}
