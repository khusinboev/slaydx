"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Download, Eye, OctagonX, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  AdminForbiddenError,
  AdminNotFoundError,
  adminErrorMessage,
  adminRequestId,
  isAbortError,
} from "@/lib/admin-api/core";
import {
  generationFileUrl,
  getGeneration,
  type AdminGenerationDetail,
  type AdminGenerationDetailResponse,
  type CostPartView,
  type LedgerRow,
} from "@/lib/admin-api/generations";
import { fmtBytes, fmtDateTime, fmtDuration, fmtNumber, fmtRelative, fmtTanga, fmtUsd } from "@/lib/admin-format";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  DataTable,
  EmptyState,
  ErrorState,
  Forbidden,
  JsonView,
  KeyValueList,
  Skeleton,
  type Column,
  type FilterOption,
} from "@/components/admin/ui";
import { JobActionDialog, WALLET_LABEL, type JobAction } from "@/components/admin/money";
import { useCan } from "@/components/admin/shell/admin-identity";
import { GenerationStatusPill, chargeText, isCharged, toolLabel } from "./shared";

type State =
  | { reqKey: string; kind: "ok"; data: AdminGenerationDetailResponse }
  | { reqKey: string; kind: "error"; message: string; requestId?: string }
  | { reqKey: string; kind: "forbidden" }
  | { reqKey: string; kind: "missing" };

function classify(e: unknown, reqKey: string): State {
  if (e instanceof AdminForbiddenError) return { reqKey, kind: "forbidden" };
  // A 404 with `code: not_found` is a missing job; a bare 404 would be "not an admin" (never inside the panel).
  if (e instanceof AdminNotFoundError) return { reqKey, kind: "missing" };
  return { reqKey, kind: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) };
}

/** `{ got, want, unit }` of `delivered_json` as text; anything else as JSON. */
function deliveredText(d: unknown): ReactNode {
  if (d === null || d === undefined) return null;
  if (typeof d === "object" && d !== null && "got" in d && "want" in d) {
    const x = d as { got: unknown; want: unknown; unit?: unknown };
    if (typeof x.got === "number" && typeof x.want === "number") {
      return `${fmtNumber(x.want)} tadan ${fmtNumber(x.got)} ta${typeof x.unit === "string" && x.unit ? ` ${x.unit}` : ""} yetkazildi`;
    }
  }
  return <JsonView value={d} maxHeightClass="max-h-40" />;
}

type TimelineItem = { at: string; label: string; tone: "muted" | "ok" | "bad" };

function timeline(g: AdminGenerationDetail, ledger: ReadonlyArray<LedgerRow>): TimelineItem[] {
  // The charge is written in the enqueue transaction, so it shares the first step.
  const charged = ledger.some((t) => t.kind === "charge");
  const items: TimelineItem[] = [
    { at: g.createdAt, label: charged ? `Navbatga qo'yildi · pul yechildi: ${chargeText(g.charged)}` : "Navbatga qo'yildi", tone: "muted" },
  ];
  if (g.startedAt) items.push({ at: g.startedAt, label: `Worker oldi (${fmtNumber(g.attempts)}-urinish)`, tone: "muted" });
  if (g.finishedAt) {
    if (g.status === "COMPLETED") items.push({ at: g.finishedAt, label: "Tayyor", tone: "ok" });
    else if (g.status === "FAILED") items.push({ at: g.finishedAt, label: `Xato bilan tugadi${g.error ? `: ${g.error}` : ""}`, tone: "bad" });
    else if (g.status === "REVOKED") items.push({ at: g.finishedAt, label: "Bekor qilindi", tone: "muted" });
  }
  for (const t of ledger) if (t.kind === "refund") items.push({ at: t.createdAt, label: `Pul qaytarildi${t.note ? ` (${t.note})` : ""}`, tone: "ok" });
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const DOT: Record<TimelineItem["tone"], string> = { muted: "bg-muted-foreground", ok: "bg-success", bad: "bg-destructive" };

const PART_COLUMNS: Column<CostPartView & { key: string }>[] = [
  { id: "kind", header: "Turi", cell: (p) => p.kind },
  {
    id: "model",
    header: "Provayder · model",
    className: "font-mono text-xs break-all",
    cell: (p) => `${p.provider} · ${p.model}`,
  },
  { id: "calls", header: "Chaqiruv", align: "right", className: "tabular-nums", cell: (p) => fmtNumber(p.calls) },
  {
    id: "tokens",
    header: "Token (kirish / chiqish)",
    align: "right",
    className: "tabular-nums whitespace-nowrap",
    cell: (p) => (p.inputTokens || p.outputTokens ? `${fmtNumber(p.inputTokens)} / ${fmtNumber(p.outputTokens)}` : "—"),
  },
  { id: "units", header: "Birlik", align: "right", className: "tabular-nums", cell: (p) => (p.units ? fmtNumber(p.units) : "—") },
  { id: "outcome", header: "Natija", cell: (p) => OUTCOME_LABEL[p.outcome] ?? p.outcome },
  { id: "usd", header: "$", align: "right", className: "tabular-nums", cell: (p) => fmtUsd(p.usd, 4) },
];

const OUTCOME_LABEL: Record<string, string> = { completed: "Tayyor", failed: "Xato", abandoned: "Tashlab ketilgan" };

const delta = (n: number) => (n === 0 ? "—" : fmtNumber(n, { sign: true }));

const LEDGER_COLUMNS: Column<LedgerRow>[] = [
  {
    id: "kind",
    header: "Turi",
    cell: (t) => (t.kind === "charge" ? <Badge tone="neutral">Yechildi</Badge> : <Badge tone="success">Qaytarildi</Badge>),
  },
  { id: "balance", header: WALLET_LABEL.balance, align: "right", className: "tabular-nums", cell: (t) => delta(t.balance) },
  { id: "quota", header: WALLET_LABEL.quota, align: "right", className: "tabular-nums", cell: (t) => delta(t.quota) },
  { id: "points", header: WALLET_LABEL.points, align: "right", className: "tabular-nums", cell: (t) => delta(t.points) },
  { id: "note", header: "Izoh", className: "max-w-[16rem] break-words", cell: (t) => t.note || "—" },
  { id: "at", header: "Vaqt", className: "tabular-nums whitespace-nowrap", cell: (t) => fmtDateTime(t.createdAt) },
];

function Notice({ tone, children }: { tone: "warn" | "bad"; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-xl border px-4 py-3 text-[13px]",
        tone === "warn" ? "border-warning/40 bg-warning/10" : "border-destructive/40 bg-destructive/10",
      )}
    >
      {children}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/**
 * S7 `/admin/generations/[id]`: lifecycle, money, cost breakdown, file, inputs
 * (masked; "Ko'rsatish" reveals them through the audited `reveal=1`), ledger,
 * and the cancel / force-fail / refund actions in the state that allows them.
 */
export function GenerationDetail({ id, tools }: { id: string; tools: ReadonlyArray<FilterOption> }) {
  const canCancel = useCan("jobs.cancel");
  const canRefund = useCan("jobs.refund");
  const canInput = useCan("jobs.input");

  const [reload, setReload] = useState(0);
  const reqKey = `${id}|${reload}`;
  const [state, setState] = useState<State | null>(null);
  const [action, setAction] = useState<JobAction | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    getGeneration(id, { signal: ctl.signal })
      .then((data) => setState({ reqKey, kind: "ok", data }))
      .catch((e: unknown) => {
        if (!isAbortError(e)) setState(classify(e, reqKey));
      });
    return () => ctl.abort();
  }, [id, reqKey]);

  const current = state && state.reqKey === reqKey ? state : null;
  // Keep showing the previous data while a refresh (after an action) is in flight.
  const shown = current ?? (state?.kind === "ok" ? state : null);

  async function reveal() {
    setRevealing(true);
    setRevealError(null);
    try {
      const data = await getGeneration(id, { reveal: true });
      setState({ reqKey, kind: "ok", data });
    } catch (e) {
      if (!isAbortError(e)) setRevealError(adminErrorMessage(e));
    } finally {
      setRevealing(false);
    }
  }

  const back = (
    <Link href="/admin/generations" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[12.5px]">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      Generatsiyalar
    </Link>
  );

  if (!shown) return <DetailSkeleton />;
  if (shown.kind === "forbidden") return <Forbidden />;
  if (shown.kind === "missing") {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className="bg-card rounded-xl border">
          <EmptyState title="Generatsiya topilmadi" description="Bu ish o'chirilgan yoki havola noto'g'ri." />
        </div>
      </div>
    );
  }
  if (shown.kind === "error") {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className="bg-card rounded-xl border">
          <ErrorState message={shown.message} requestId={shown.requestId} onRetry={() => setReload((n) => n + 1)} />
        </div>
      </div>
    );
  }

  const { generation: g, ledger, gameLinks } = shown.data;
  const charged = isCharged(g.charged);
  const unrefunded = g.status === "FAILED" && charged && !g.refunded;
  const actions: Array<{ key: JobAction; label: string; icon: ReactNode; variant: "danger" | "primary" }> = [];
  if (canCancel && g.status === "QUEUED") actions.push({ key: "cancel", label: "Bekor qilish", icon: <Ban className="size-4" aria-hidden="true" />, variant: "danger" });
  if (canCancel && g.status === "IN_PROGRESS" && g.stuck) actions.push({ key: "fail", label: "To'xtatish", icon: <OctagonX className="size-4" aria-hidden="true" />, variant: "danger" });
  if (canRefund && unrefunded) actions.push({ key: "refund", label: "Pulni qaytarish", icon: <Undo2 className="size-4" aria-hidden="true" />, variant: "primary" });

  const fileStale = g.hasFile && g.fileVersion < g.docVersion;
  const parts = (g.cost?.parts ?? []).map((p, i) => ({ ...p, key: String(i) }));

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-busy={current === null || undefined}>
      <header className="flex flex-col gap-2">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight">{toolLabel(tools, g.toolId)}</h1>
          <GenerationStatusPill status={g.status} stuck={g.stuck} />
        </div>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="font-mono break-all">{g.id}</span>
          <CopyButton value={g.id} label="ID ni nusxalash" />
        </p>
      </header>

      {g.stuck ? (
        <Notice tone="warn">
          Ish «Ishlanmoqda» holatida osilib qolgan: {g.lockedAt ? `workerdan oxirgi belgi ${fmtRelative(g.lockedAt)} kelgan` : "ishda worker qulfi yo'q"},
          budjet ({fmtDuration(g.budgetMs / 1000)}) + 30 soniya o&apos;tib ketgan. Worker javob bermayotgan bo&apos;lishi mumkin.
        </Notice>
      ) : null}
      {unrefunded ? (
        <Notice tone="bad">Pul yechilgan, lekin qaytarilmagan: {chargeText(g.charged)}.</Notice>
      ) : null}

      {actions.length || (canInput && g.hasFile) ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a.key} variant={a.variant} icon={a.icon} onClick={() => setAction(a.key)}>
              {a.label}
            </Button>
          ))}
          {canInput && g.hasFile ? (
            <a
              href={generationFileUrl(g.id)}
              download
              className="border-input bg-card hover:border-ring focus-visible:ring-ring inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-[13px] outline-none focus-visible:ring-2"
            >
              <Download className="size-4" aria-hidden="true" />
              Faylni yuklab olish (audit)
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Holat" />
          <CardBody>
            <KeyValueList
              items={[
                {
                  label: "Foydalanuvchi",
                  value: (
                    <Link href={`/admin/users/${encodeURIComponent(g.userId)}`} className="hover:text-primary underline-offset-2 hover:underline">
                      {g.userName || "—"}
                      {g.userUsername ? ` · @${g.userUsername}` : ""} · #{g.userId}
                    </Link>
                  ),
                },
                { label: "Mavzu", value: g.topic },
                { label: "Narx", value: <span className="tabular-nums">{fmtTanga(g.price)}</span> },
                { label: "Yechilgan", value: <span className="tabular-nums">{chargeText(g.charged)}</span> },
                { label: "Qaytarilgan", value: g.refunded ? <Badge tone="success">Ha</Badge> : unrefunded ? <Badge tone="danger">Yo&apos;q</Badge> : "—" },
                { label: "Bosqich", value: g.step },
                { label: "Jarayon", value: <span className="tabular-nums">{fmtNumber(g.progress)}%</span> },
                { label: "Urinishlar", value: <span className="tabular-nums">{fmtNumber(g.attempts)} / 2</span> },
                { label: "Budjet", value: g.budgetMs > 0 ? fmtDuration(g.budgetMs / 1000) : "standart" },
                { label: "Davomiylik", value: fmtDuration(g.durationSec) },
                { label: "Qulf (worker)", value: g.lockedBy, mono: true },
                { label: "Qulf vaqti", value: g.lockedAt ? `${fmtDateTime(g.lockedAt)} (${fmtRelative(g.lockedAt)})` : null },
                { label: "Format", value: g.format },
                { label: "Xato", value: g.error ? <span className="text-destructive">{g.error}</span> : null },
                { label: "Yetkazilgan", value: deliveredText(g.delivered) },
                { label: "O'yin havolalari", value: <span className="tabular-nums">{fmtNumber(gameLinks)}</span> },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Hayot sikli" />
          <CardBody>
            <ol className="flex flex-col gap-2.5">
              {timeline(g, ledger).map((t, i) => (
                <li key={`${t.at}-${i}`} className="flex items-start gap-2.5 text-[13px]">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[t.tone])} aria-hidden="true" />
                  <span className="min-w-0 flex-1 break-words">{t.label}</span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{fmtDateTime(t.at)}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="AI xarajat"
          description="Kanonik xarajat yozuvlari (ai_usage yoki eski cost_json)"
          aside={<span className="text-sm font-semibold tabular-nums">{g.cost ? fmtUsd(g.cost.usd, 4) : "—"}</span>}
        />
        {parts.length ? (
          <div className="p-3">
            <DataTable columns={PART_COLUMNS} rows={parts} rowKey={(p) => p.key} caption="Xarajat qismlari" maxHeightClass="max-h-96" />
          </div>
        ) : (
          <CardBody>
            <p className="text-muted-foreground text-[13px]">
              {g.cost ? "Xarajat tafsiloti yozilmagan." : "Bu ish uchun xarajat yozuvi yo'q."}
            </p>
          </CardBody>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Fayl" />
          <CardBody>
            {g.hasFile ? (
              <KeyValueList
                items={[
                  { label: "Nomi", value: g.fileName, mono: true },
                  { label: "Turi", value: g.fileMime, mono: true },
                  { label: "Hajmi", value: <span className="tabular-nums">{fmtBytes(g.fileSize)}</span> },
                  { label: "Foydalanuvchi yuklagan", value: <span className="tabular-nums">{fmtNumber(g.downloads)} marta</span> },
                  {
                    label: "Versiya",
                    value: (
                      <span className="tabular-nums">
                        hujjat {fmtNumber(g.docVersion)} · fayl {fmtNumber(g.fileVersion)}
                        {fileStale ? " (fayl tahrirdan keyin qayta yasalmagan)" : ""}
                      </span>
                    ),
                  },
                  { label: "Tahrirlangan", value: g.editedAt ? fmtDateTime(g.editedAt) : null },
                  { label: "Bonus fayllar o'chirilgan", value: g.filesPurgedAt ? fmtDateTime(g.filesPurgedAt) : null },
                ]}
              />
            ) : (
              <p className="text-muted-foreground text-[13px]">
                {g.filesPurgedAt ? `Fayllar ${fmtDateTime(g.filesPurgedAt)} da o'chirilgan.` : "Bu ishda saqlangan fayl yo'q."}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Kiritilgan ma'lumot"
            aside={
              g.inputsRevealed ? (
                <Badge tone="warning">Ochiq ko&apos;rsatilmoqda</Badge>
              ) : canInput ? (
                <Button size="sm" onClick={reveal} loading={revealing} icon={<Eye className="size-3.5" aria-hidden="true" />}>
                  Ko&apos;rsatish (audit)
                </Button>
              ) : (
                <Badge tone="neutral">Yashirilgan</Badge>
              )
            }
          />
          <CardBody>
            {revealError ? (
              <p role="alert" className="text-destructive mb-2 text-xs">
                {revealError}
              </p>
            ) : null}
            <JsonView value={g.inputs} maxHeightClass="max-h-80" />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Hisob yozuvlari" description="Shu ishga tegishli yechish va qaytarish qatorlari" />
        {ledger.length ? (
          <div className="p-3">
            <DataTable columns={LEDGER_COLUMNS} rows={ledger} rowKey={(t) => t.id} caption="Hisob yozuvlari" maxHeightClass="max-h-96" />
          </div>
        ) : (
          <CardBody>
            <p className="text-muted-foreground text-[13px]">Bu ish uchun pul yechilmagan.</p>
          </CardBody>
        )}
      </Card>

      {action ? (
        <JobActionDialog
          open
          action={action}
          onClose={() => setAction(null)}
          generation={{ id: g.id, status: g.status, price: g.price, topic: g.topic, userName: g.userName }}
          onDone={() => setReload((n) => n + 1)}
        />
      ) : null}
    </div>
  );
}
