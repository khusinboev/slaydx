"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as api from "@/lib/api-client";
import { creditTotal, useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";

const FIELDS = [
  ["author", "Muallif (F.I.Sh)"],
  ["university", "Universitet"],
  ["faculty", "Fakultet"],
  ["department", "Kafedra"],
  ["group", "Guruh"],
  ["course", "Kurs"],
  ["subject", "Fan"],
  ["teacher", "O'qituvchi"],
  ["city", "Shahar"],
] as const;

type Editable = (typeof FIELDS)[number][0];

export function ProfilePage() {
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const signOut = useAppStore((s) => s.signOut);
  const open = useUi((s) => s.open);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [ledger, setLedger] = useState<api.LedgerEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Chiqish tasodifiy bosilib ketmasin — ikki bosqichli tasdiq: birinchi
  // bosishda ogohlantirish chiqadi, ikkinchisida haqiqatan chiqadi.
  const [confirmOut, setConfirmOut] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (sessionChecked && !loggedIn) open("login", { returnTo: "/uz/profile" });
  }, [sessionChecked, loggedIn, open]);

  useEffect(() => {
    if (!loggedIn) return;
    void api
      .fetchMe()
      .then((r) => {
        setUser(r.user);
        setLedger(r.transactions);
      })
      .catch(() => {});
  }, [loggedIn, setUser]);

  // Tahrir avtomatik saqlanadi. Ilgari o'zgarish faqat `localStorage` ga
  // tushardi va boshqa qurilmada ko'rinmasdi.
  useEffect(() => {
    if (!Object.keys(draft).length) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaving(true);
      setError(null);
      api
        .updateProfile(draft)
        .then((r) => {
          setUser(r.user);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Saqlanmadi"))
        .finally(() => setSaving(false));
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, setUser]);

  if (!sessionChecked) return <div className="text-muted-foreground p-8 text-sm">Yuklanmoqda...</div>;
  if (!loggedIn || !user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="font-medium">Bu sahifani ko&apos;rish uchun tizimga kiring</p>
        <button
          type="button"
          onClick={() => open("login", { returnTo: "/uz/profile" })}
          className="bg-primary text-primary-foreground mt-4 h-10 rounded-full px-5 text-sm font-medium"
        >
          Kirish
        </button>
      </div>
    );
  }

  const value = (key: Editable) => draft[key] ?? user[key] ?? "";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="bg-card mb-6 rounded-2xl border p-6">
        <div className="flex items-center gap-4">
          <div className="bg-primary text-primary-foreground ring-primary ring-offset-card flex size-16 shrink-0 items-center justify-center rounded-full text-2xl font-bold ring-[3px] ring-offset-[3px]">
            {(user.name || "?").slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{user.name || "Foydalanuvchi"}</h1>
              {user.plan === "pro" ? (
                <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-[10.5px] font-bold tracking-wide">
                  PRO
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm">
              {user.plan === "pro" && user.planExpiresAt
                ? `${new Date(user.planExpiresAt).toLocaleDateString("uz-UZ")} gacha · `
                : ""}
              {creditTotal(user).toLocaleString("uz-UZ")} tanga
            </p>
          </div>
        </div>
        <div className="mt-4">
          <Link
            href="/uz/purchase"
            className="border-primary text-primary h-9 rounded-xl border px-4 text-sm font-medium leading-9"
          >
            Tariflar
          </Link>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <Stat label="Ball" value={user.points} />
          <Stat label="Kvota" value={user.quota} />
          <Stat label="Balans" value={user.balance} />
        </div>
      </div>

      <div className="bg-card rounded-2xl border p-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Shaxsiy ma&apos;lumotlar</h2>
          <span className="text-muted-foreground text-xs" aria-live="polite">
            {saving ? "Saqlanmoqda..." : saved ? "Saqlandi" : ""}
          </span>
        </div>
        <p className="text-muted-foreground mb-5 text-sm">
          Bu qiymatlar har bir yangi ish yaratganda titul sahifasiga avtomatik qo&apos;yiladi.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-1.5 block text-sm font-medium">{label}</span>
              <input
                className="border-input bg-card h-11 w-full rounded-xl border px-3"
                value={value(key)}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-destructive mt-3 text-sm">
            {error}
          </p>
        ) : null}
      </div>

      {ledger.length ? (
        <div className="bg-card mt-6 rounded-2xl border p-6">
          <h2 className="mb-4 text-lg font-semibold">Hisob harakati</h2>
          <div className="divide-y text-sm">
            {ledger.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2">
                <span className="min-w-0 flex-1 truncate">
                  {t.note || t.kind}
                  <span className="text-muted-foreground ml-2 text-xs">
                    {new Date(t.createdAt).toLocaleString("uz-UZ")}
                  </span>
                </span>
                <span
                  className={
                    t.amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                  }
                >
                  {t.amount >= 0 ? "+" : ""}
                  {t.amount.toLocaleString("uz-UZ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="bg-card mt-6 rounded-2xl border p-6">
        <h2 className="text-lg font-semibold">Hisobdan chiqish</h2>
        <p className="text-muted-foreground mt-1 mb-4 text-sm">
          Bu qurilmadan yoki barcha qurilmalardan chiqishingiz mumkin.
        </p>
        <div className="flex flex-col items-start gap-3">
          {confirmOut ? (
            <div className="border-destructive/30 bg-destructive/5 flex flex-wrap items-center gap-3 rounded-xl border p-3">
              <span className="text-sm font-medium">Rostdan ham chiqmoqchimisiz?</span>
              <button
                type="button"
                onClick={() => void signOut(false)}
                className="bg-destructive h-9 rounded-lg px-4 text-sm font-medium text-white"
              >
                Ha, chiqish
              </button>
              <button
                type="button"
                onClick={() => setConfirmOut(false)}
                className="h-9 rounded-lg border px-4 text-sm"
              >
                Bekor qilish
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmOut(true)}
              className="text-destructive border-destructive/40 hover:bg-destructive/10 h-10 rounded-xl border px-4 text-sm font-medium"
            >
              Chiqish
            </button>
          )}

          {confirmAll ? (
            <div className="border-destructive/30 bg-destructive/5 flex flex-wrap items-center gap-3 rounded-xl border p-3">
              <span className="text-sm font-medium">Barcha qurilmalardan chiqasiz. Davom etamizmi?</span>
              <button
                type="button"
                onClick={() => void signOut(true)}
                className="bg-destructive h-9 rounded-lg px-4 text-sm font-medium text-white"
              >
                Ha, hammasidan chiqish
              </button>
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                className="h-9 rounded-lg border px-4 text-sm"
              >
                Bekor qilish
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmAll(true)}
              className="text-muted-foreground hover:text-destructive text-sm underline-offset-2 hover:underline"
              title="Barcha qurilmalardagi sessiyalarni bekor qiladi"
            >
              Hamma joydan chiqish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/50 rounded-xl px-3 py-3">
      <div className="text-lg font-semibold">{value.toLocaleString("uz-UZ")}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}
