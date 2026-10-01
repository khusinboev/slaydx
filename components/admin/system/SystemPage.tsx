"use client";

import { RefreshCw } from "lucide-react";
import { getSystem, type SystemProcess, type SystemStatus, type SystemStep } from "@/lib/admin-api/system";
import { fmtDateTime, fmtDuration, fmtNumber, fmtRelative } from "@/lib/admin-format";
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Forbidden, KpiTile, Skeleton, type Column } from "@/components/admin/ui";
import { useLoad, useNow } from "./shared";

const loadSystem = (signal: AbortSignal): Promise<SystemStatus> => getSystem({ signal });

const ENV_TEXT: Record<SystemStatus["nodeEnv"], string> = {
  production: "production",
  development: "development",
  test: "test",
  unknown: "noma'lum muhit",
};

/**
 * S15 `/admin/system`: DB status and latency, migrations, queue, processes
 * (with the stale badge), housekeeping steps and configuration problems and
 * warnings. Config arrives as message text only; the API never sends values.
 * Permission `system.view` is enforced by the API (403 renders `Forbidden`).
 */
export function SystemPage() {
  const [state, reload] = useLoad(loadSystem);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Tizim holati</h1>
          <p className="text-muted-foreground text-[13px]">Baza, navbat, jarayonlar va fon vazifalari.</p>
        </div>
        <Button onClick={reload} loading={state.status === "loading"} icon={<RefreshCw className="size-3.5" aria-hidden="true" />}>
          Yangilash
        </Button>
      </header>

      {state.status === "loading" ? (
        <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <KpiTile key={i} label="" value="" loading />
            ))}
          </div>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : state.status === "forbidden" ? (
        <Card>
          <Forbidden />
        </Card>
      ) : state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        </Card>
      ) : (
        <SystemReady data={state.data} />
      )}
    </div>
  );
}

function SystemReady({ data }: { data: SystemStatus }) {
  const now = useNow();
  const { db, queue } = data;
  const m = db.migrations;
  const pending = m.latest !== null && m.applied < m.latest;
  const staleCount = data.processes.filter((p) => p.stale).length;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile
          label="Baza"
          value={
            <span className="inline-flex items-center gap-2">
              <Badge tone={db.ok ? "success" : "danger"} dot>
                {db.ok ? "Ulangan" : "Ulanmagan"}
              </Badge>
            </span>
          }
          hint={db.latencyMs === null ? "javob yo'q" : `${fmtNumber(db.latencyMs)} ms`}
        />
        <KpiTile
          label="Migratsiyalar"
          value={`${fmtNumber(m.applied)} / ${m.latest === null ? "—" : fmtNumber(m.latest)}`}
          hint={pending ? "kutilayotgan migratsiya bor" : m.lastApplied}
        />
        <KpiTile
          label="Navbatda"
          value={fmtNumber(queue.queued)}
          hint={queue.oldestQueuedSec === null ? "navbat bo'sh" : `eng eskisi: ${fmtDuration(queue.oldestQueuedSec)}`}
        />
        <KpiTile label="Ishlanmoqda" value={fmtNumber(queue.running)} />
        <KpiTile label="Versiya" value={data.version} hint={ENV_TEXT[data.nodeEnv]} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            title="Jarayonlar"
            description="Veb va worker jarayonlari har 30 soniyada signal yuboradi; 90 soniya jim bo'lsa «Eskirgan»."
            aside={
              staleCount > 0 ? (
                <Badge tone="warning" dot>
                  {fmtNumber(staleCount)} ta eskirgan
                </Badge>
              ) : null
            }
          />
          <div className="p-3">
            <ProcessesTable processes={data.processes} now={now} />
          </div>
        </Card>

        <ConfigCard problems={data.config.problems} warnings={data.config.warnings} />
      </div>

      <Card>
        <CardHeader title="Fon vazifalari" description="Worker har siklda bajaradigan qadamlar: oxirgi natija va xatolar." />
        <div className="p-3">
          <StepsTable steps={data.housekeeping} now={now} />
        </div>
      </Card>
    </>
  );
}

function ProcessesTable({ processes, now }: { processes: SystemProcess[]; now: number }) {
  const columns: Column<SystemProcess>[] = [
    {
      id: "process",
      header: "Jarayon",
      cell: (p) => (
        <span className="flex flex-col gap-1">
          <span className="font-mono text-xs break-all">{p.process}</span>
          <span className="flex flex-wrap gap-1.5">
            <Badge tone={p.role === "worker" ? "info" : "neutral"}>{p.role === "worker" ? "worker" : "veb"}</Badge>
            {p.stale ? (
              <Badge tone="warning" dot title="Signal 90 soniyadan beri kelmagan: jarayon to'xtagan bo'lishi mumkin">
                Eskirgan
              </Badge>
            ) : (
              <Badge tone="success" dot>
                Faol
              </Badge>
            )}
          </span>
        </span>
      ),
    },
    { id: "started", header: "Ishga tushgan", cell: (p) => <span title={fmtDateTime(p.startedAt)}>{fmtRelative(p.startedAt, now)}</span> },
    {
      id: "seen",
      header: "Oxirgi signal",
      cell: (p) => <span title={fmtDateTime(p.lastSeenAt)}>{fmtRelative(p.lastSeenAt, now)}</span>,
    },
    {
      id: "busy",
      header: "Band",
      align: "right",
      className: "tabular-nums",
      cell: (p) => (p.concurrency > 0 ? `${fmtNumber(p.running)} / ${fmtNumber(p.concurrency)}` : "—"),
    },
  ];
  return (
    <DataTable
      caption="Jarayonlar va ularning oxirgi signali"
      columns={columns}
      rows={processes}
      rowKey={(p) => p.process}
      maxHeightClass="max-h-[50vh]"
      empty={<EmptyState title="Jarayonlardan signal kelmagan" description="Veb yoki worker jarayoni hali holat yozmagan yoki barchasi to'xtagan." />}
    />
  );
}

function ConfigCard({ problems, warnings }: { problems: string[]; warnings: string[] }) {
  const clean = problems.length === 0 && warnings.length === 0;
  return (
    <Card>
      <CardHeader title="Konfiguratsiya" description="Faqat xabarlar ko'rsatiladi; sozlama qiymatlari hech qachon ko'rsatilmaydi." />
      <CardBody className="flex flex-col gap-2">
        {problems.map((m) => (
          <p key={`p:${m}`} role="alert" data-config="problem" className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-[13px] [overflow-wrap:anywhere]">
            <span className="font-semibold">Muammo: </span>
            {m}
          </p>
        ))}
        {warnings.map((m) => (
          <p key={`w:${m}`} data-config="warning" className="border-warning/40 bg-warning/10 rounded-lg border px-3 py-2 text-[13px] [overflow-wrap:anywhere]">
            <span className="text-warning font-semibold">Ogohlantirish: </span>
            {m}
          </p>
        ))}
        {clean ? (
          <p data-config="clean" className="border-success/40 bg-success/10 text-success-text rounded-lg border px-3 py-2 text-[13px]">
            Konfiguratsiya muammolarsiz: muammo ham, ogohlantirish ham yo&apos;q.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** A step is "failing now" when its newest error is more recent than its newest success. */
function failingNow(s: SystemStep): boolean {
  if (!s.lastErrorAt) return false;
  return !s.lastOkAt || Date.parse(s.lastErrorAt) > Date.parse(s.lastOkAt);
}

function StepsTable({ steps, now }: { steps: SystemStep[]; now: number }) {
  const columns: Column<SystemStep>[] = [
    {
      id: "step",
      header: "Qadam",
      cell: (s) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12.5px]">{s.step}</span>
          {failingNow(s) ? (
            <Badge tone="danger" dot>
              Xato
            </Badge>
          ) : null}
        </span>
      ),
    },
    { id: "run", header: "Oxirgi ishga tushish", cell: (s) => (s.lastRunAt ? <span title={fmtDateTime(s.lastRunAt)}>{fmtRelative(s.lastRunAt, now)}</span> : "—") },
    { id: "ok", header: "Oxirgi muvaffaqiyat", hideOnCard: true, cell: (s) => (s.lastOkAt ? <span title={fmtDateTime(s.lastOkAt)}>{fmtRelative(s.lastOkAt, now)}</span> : "—") },
    { id: "rows", header: "Qatorlar", align: "right", className: "tabular-nums", cell: (s) => (s.lastRows === null ? "—" : fmtNumber(s.lastRows)) },
    { id: "runs", header: "Ishga tushirishlar", align: "right", className: "tabular-nums", hideOnCard: true, cell: (s) => fmtNumber(s.runs) },
    {
      id: "failures",
      header: "Xatolar",
      align: "right",
      className: "tabular-nums",
      cell: (s) => <span className={s.failures > 0 ? "text-destructive font-semibold" : undefined}>{fmtNumber(s.failures)}</span>,
    },
    {
      id: "error",
      header: "Oxirgi xato",
      cell: (s) =>
        s.lastError ? (
          <span className="flex flex-col gap-0.5">
            <span className="text-destructive font-mono text-xs break-words">{s.lastError}</span>
            {s.lastErrorAt ? <span className="text-muted-foreground text-xs">{fmtDateTime(s.lastErrorAt)}</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
  return (
    <DataTable
      caption="Fon vazifalari (housekeeping) qadamlari"
      columns={columns}
      rows={steps}
      rowKey={(s) => s.step}
      maxHeightClass="max-h-[60vh]"
      empty={<EmptyState title="Fon vazifalari hali ishga tushmagan" description="Worker birinchi siklni tugatgach qadamlar shu yerda ko'rinadi." />}
    />
  );
}
