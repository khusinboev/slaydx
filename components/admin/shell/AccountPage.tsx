"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { adminErrorMessage, adminRequestId, isAbortError } from "@/lib/admin-api/core";
import { listMySessions, logout, regenerateRecoveryCodes, revokeMySession, type AdminOwnSession } from "@/lib/admin-api/auth";
import { fmtDateTime, fmtRelative } from "@/lib/admin-format";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  KeyValueList,
  Modal,
  Skeleton,
  toast,
} from "@/components/admin/ui";
import { useAdminIdentity } from "./admin-identity";
import { CODE_INPUT_CLASS, FormError, LockoutNotice, authFailure } from "./auth-common";
import { roleLabel } from "./nav-registry";
import { RecoveryCodes } from "./RecoveryCodes";

/** "Chrome · Windows" from a User-Agent; good enough to recognise one's own devices. */
export function describeDevice(ua: string | null): string {
  if (!ua) return "Noma'lum qurilma";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /YaBrowser\//.test(ua)
        ? "Yandex"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Noma'lum qurilma";
}

type SessionsState =
  | { status: "loading" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; items: AdminOwnSession[] };

/**
 * S19 `/admin/account`: role and permissions, own admin sessions (revoke any
 * but the current one; the current one ends with "Chiqish"), recovery-code
 * regeneration (a fresh TOTP in the body), logout.
 */
export function AccountPage() {
  const { role, permissions, name, username } = useAdminIdentity();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionsState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [revoking, setRevoking] = useState<AdminOwnSession | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    listMySessions({ signal: ctl.signal })
      .then(({ items }) => setSessions({ status: "ready", items }))
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        setSessions({ status: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) });
      });
    return () => ctl.abort();
  }, [reload]);

  const retry = useCallback(() => {
    setSessions({ status: "loading" });
    setReload((n) => n + 1);
  }, []);

  async function signOut() {
    setLoggingOut(true);
    try {
      await logout();
      router.replace("/admin/login");
      router.refresh();
    } catch (e) {
      setLoggingOut(false);
      toast(adminErrorMessage(e), { tone: "error" });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Mening hisobim</h1>
          <p className="text-muted-foreground text-[13px]">
            {name}
            {username ? ` · @${username}` : ""} · Rol: {roleLabel(role)}
          </p>
        </div>
        <Button onClick={signOut} loading={loggingOut} icon={<LogOut className="size-4" aria-hidden="true" />}>
          Chiqish
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sessiyalarim" description="Admin panelga kirilgan faol sessiyalar" />
          {sessions.status === "loading" ? (
            <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-3 px-4 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : sessions.status === "error" ? (
            <ErrorState message={sessions.message} requestId={sessions.requestId} onRetry={retry} />
          ) : sessions.items.length === 0 ? (
            <EmptyState title="Faol sessiya yo'q" />
          ) : (
            <ul className="divide-y">
              {sessions.items.map((s) => (
                <li key={s.id} data-session={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                      {describeDevice(s.userAgent)}
                      {s.current ? (
                        <Badge tone="success" dot>
                          Joriy
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      <span className="font-mono">{s.ip ?? "—"}</span> · kirgan {fmtDateTime(s.createdAt)} · oxirgi faollik{" "}
                      {fmtRelative(s.lastSeenAt)}
                    </p>
                  </div>
                  {s.current ? null : (
                    <Button size="sm" variant="dangerOutline" onClick={() => setRevoking(s)}>
                      Bekor qilish
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Xavfsizlik" />
          <CardBody className="flex flex-col gap-3">
            <KeyValueList
              items={[
                {
                  label: "2FA (TOTP)",
                  value: (
                    <Badge tone="success" dot>
                      Yoqilgan
                    </Badge>
                  ),
                },
                { label: "Sessiya muddati", value: "30 daqiqa harakatsizlikdan yoki 12 soatdan keyin tugaydi" },
                { label: "Qayta tasdiqlash", value: "Muhim amallar uchun har 10 daqiqada kod so'raladi" },
              ]}
            />
            <div>
              <Button onClick={() => setRegenOpen(true)} icon={<KeyRound className="size-4" aria-hidden="true" />}>
                Yangi tiklash kodlari
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Ruxsatlarim" description="Rolingizga biriktirilgan ruxsatlar" />
        <CardBody>
          <ul aria-label="Ruxsatlar ro'yxati" className="flex flex-wrap gap-1.5">
            {permissions.map((p) => (
              <li key={p} className="bg-muted rounded-full px-2.5 py-0.5 font-mono text-[12px]">
                {p}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Sessiyani bekor qilish"
        description="Shu qurilmadagi admin sessiyasi darhol tugaydi."
        target={revoking ? `${describeDevice(revoking.userAgent)} · ${revoking.ip ?? "—"}` : undefined}
        danger
        confirmLabel="Bekor qilish"
        cancelLabel="Ortga"
        onConfirm={async () => {
          if (!revoking) return;
          const id = revoking.id;
          await revokeMySession(id);
          setSessions((s) => (s.status === "ready" ? { status: "ready", items: s.items.filter((x) => x.id !== id) } : s));
          toast("Sessiya bekor qilindi");
        }}
      />

      <RegenerateCodesDialog open={regenOpen} onClose={() => setRegenOpen(false)} />
    </div>
  );
}

const TOTP_LENGTH = 6;

/** Asks for a fresh TOTP, then shows the new codes once (the old set stops working immediately). */
function RegenerateCodesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <RegenerateBody onClose={onClose} />;
}

function RegenerateBody({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockout, setLockout] = useState<{ seconds: number; startedAt: number } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const mounted = useRef(true);
  const clearLockout = useCallback(() => setLockout(null), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== TOTP_LENGTH || busy || lockout) return;
    setBusy(true);
    setError(null);
    try {
      const res = await regenerateRecoveryCodes(code);
      if (!mounted.current) return;
      setCodes(res.recoveryCodes);
      toast("Yangi tiklash kodlari yaratildi");
    } catch (err) {
      if (!mounted.current || isAbortError(err)) return;
      setCode("");
      const f = authFailure(err);
      if (f.kind === "locked") setLockout({ seconds: f.seconds, startedAt: Date.now() });
      else setError(f.text);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  if (codes) {
    return (
      // Not dismissible: the codes are shown once, so leaving requires "Saqladim".
      <Modal open onClose={onClose} title="Yangi tiklash kodlari" dismissible={false}>
        <RecoveryCodes codes={codes} continueLabel="Tayyor" onContinue={onClose} />
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Yangi tiklash kodlari"
      description="Eski kodlar darhol ishlamay qoladi. Davom etish uchun authenticator ilovasidagi 6 xonali kodni kiriting."
      size="sm"
      dismissible={!busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-3 pb-1" noValidate>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, TOTP_LENGTH))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={TOTP_LENGTH}
          disabled={busy}
          aria-label="Authenticator kodi"
          placeholder="000000"
          className={CODE_INPUT_CLASS}
        />
        {lockout ? (
          <LockoutNotice seconds={lockout.seconds} startedAt={lockout.startedAt} onDone={clearLockout} />
        ) : error ? (
          <FormError>{error}</FormError>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            Bekor qilish
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={code.length !== TOTP_LENGTH || Boolean(lockout)}>
            Yangi kodlar yaratish
          </Button>
        </div>
      </form>
    </Modal>
  );
}
