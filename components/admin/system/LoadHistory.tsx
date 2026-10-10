"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Activity } from "lucide-react";
import { getServerMetrics, type MetricPeak, type MetricRange, type ServerMetrics } from "@/lib/admin-api/system";
import { fmtDateTime, fmtDuration, fmtNumber, tashkentParts } from "@/lib/admin-format";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  LineChart,
  MultiLineChart,
  Segmented,
  Skeleton,
  useLoad,
  type Column,
  type MultiLinePoint,
} from "@/components/admin/ui";

/**
 * «Yuklama tarixi» (docs/ops/METRICS.md): the recorded server load over 24 hours, 7 or 30 days.
 * The server downsamples (max per bucket, so a spike stays visible); the charts only draw. Every
 * section degrades on its own: no nginx log means no request chart, no host cron means no host
 * charts, an empty database shows one explanation instead of empty axes.
 */

const RANGES: ReadonlyArray<{ value: MetricRange; label: string }> = [
  { value: "24h", label: "24 soat" },
  { value: "7d", label: "7 kun" },
  { value: "30d", label: "30 kun" },
];

const p2 = (n: number) => String(n).padStart(2, "0");

/** Axis label: `HH:mm` for a day, `DD.MM HH:mm` for longer ranges (Asia/Tashkent). */
function labelOf(iso: string, range: MetricRange): string {
  const t = tashkentParts(iso);
  if (!t) return "";
  return range === "24h" ? `${p2(t.h)}:${p2(t.mi)}` : `${p2(t.d)}.${p2(t.mo)} ${p2(t.h)}:${p2(t.mi)}`;
}

const pct = (n: number) => `${fmtNumber(n, { digits: 1 })}%`;
const dec1 = (n: number) => fmtNumber(n, { digits: 1 });

/** Every point of a series is null: nothing to draw. */
const hasAny = (values: ReadonlyArray<number | null>): boolean => values.some((v) => v !== null);

function Chart({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} as="h3" />
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function NoData({ children }: { children: ReactNode }) {
  return (
    <p data-no-data="" className="text-muted-foreground py-6 text-center text-[13px]">
      {children}
    </p>
  );
}

export function LoadHistory() {
  const [range, setRange] = useState<MetricRange>("24h");
  const load = useCallback((signal: AbortSignal) => getServerMetrics(range, { signal }), [range]);
  const [state, reload] = useLoad(load);

  return (
    <section aria-labelledby="load-history-title" className="flex flex-col gap-3" data-section="load-history">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id="load-history-title" className="text-base font-semibold tracking-tight">
            Yuklama tarixi
          </h2>
          <p className="text-muted-foreground text-xs">Server va ilova yuklamasining yozib borilgan tarixi (90 kun saqlanadi).</p>
        </div>
        <Segmented options={RANGES} value={range} onChange={(v) => setRange(v as MetricRange)} ariaLabel="Davr" />
      </div>

      {state.status === "loading" ? (
        <div aria-busy="true" aria-label="Yuklama tarixi yuklanmoqda" className="flex flex-col gap-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : state.status === "forbidden" ? null : state.status === "error" || !isMetrics(state.data) ? (
        <Card>
          <ErrorState message={state.status === "error" ? state.message : "Javob noto'g'ri formatda"} requestId={state.status === "error" ? state.requestId : undefined} onRetry={reload} />
        </Card>
      ) : (
        <HistoryCharts data={state.data} />
      )}
    </section>
  );
}

function isMetrics(d: unknown): d is ServerMetrics {
  const m = d as Partial<ServerMetrics> | null;
  return Boolean(m && Array.isArray(m.host) && Array.isArray(m.app) && Array.isArray(m.containers) && m.peaks);
}

function HistoryCharts({ data }: { data: ServerMetrics }) {
  const { range } = data;
  const lbl = useCallback((iso: string) => labelOf(iso, range), [range]);

  const memory = useMemo<MultiLinePoint[]>(
    () => data.host.map((p) => ({ label: lbl(p.t), values: { mem: p.memUsedPct, swap: p.swapUsedPct } })),
    [data.host, lbl],
  );
  const cpuLimitKnown = data.host.some((p) => p.cpus !== null);
  const load = useMemo<MultiLinePoint[]>(
    () => data.host.map((p) => ({ label: lbl(p.t), values: { load1: p.load1, load5: p.load5, limit: p.cpus === null ? null : p.cpus * 2 } })),
    [data.host, lbl],
  );
  const containerNames = useMemo(() => [...new Set(data.containers.map((c) => c.name))].sort(), [data.containers]);
  const containerPoints = useMemo<MultiLinePoint[]>(() => {
    const times = [...new Set(data.containers.map((c) => c.t))].sort();
    const byKey = new Map(data.containers.map((c) => [`${c.t}|${c.name}`, c.memMb]));
    return times.map((t) => ({ label: lbl(t), values: Object.fromEntries(containerNames.map((n) => [n, byKey.get(`${t}|${n}`) ?? null])) }));
  }, [data.containers, containerNames, lbl]);
  const requests = useMemo<MultiLinePoint[]>(
    () => data.host.map((p) => ({ label: lbl(p.t), values: { req: p.reqPerMin, s4xx: p.s4xxPerMin, s5xx: p.s5xxPerMin } })),
    [data.host, lbl],
  );
  const db = useMemo<MultiLinePoint[]>(
    () => data.app.map((p) => ({ label: lbl(p.t), values: { conns: p.dbConns, max: p.dbMaxConns, waiting: p.poolWaiting } })),
    [data.app, lbl],
  );

  if (!data.hasData) {
    return (
      <Card>
        <EmptyState
          icon={<Activity className="size-8" />}
          title="Yuklama tarixi hali yo'q"
          description="Ilova namunalari worker ishga tushgach har daqiqada yoziladi; server namunalari esa serverdagi metrika cron'i o'rnatilgach (har 5 daqiqada). Birinchi nuqtalar bir necha daqiqadan keyin paydo bo'ladi."
        />
      </Card>
    );
  }

  const noHost = data.host.length === 0;
  const noApp = data.app.length === 0;
  const hostHint = "Server namunalari yo'q: serverdagi slaydx-metrics cron'i o'rnatilmagan yoki ishlamayapti (docs/ops/METRICS.md).";

  return (
    <div className="flex flex-col gap-3" data-has-data="">
      {data.truncated ? (
        <p role="status" className="border-warning/40 bg-warning/10 rounded-lg border px-3 py-2 text-[13px]">
          Ko&apos;rsatkichlar ko&apos;p bo&apos;lgani uchun eng eski qismi qirqilgan.
        </p>
      ) : null}

      <PeaksTable data={data} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-2">
        <Chart title="Xotira va swap" description="Band xotira (jami − mavjud) va swap, % da. 90% dan yuqori — xotira tugayapti.">
          {noHost ? (
            <NoData>{hostHint}</NoData>
          ) : (
            <MultiLineChart
              title="Xotira va swap, foiz"
              points={memory}
              series={[
                { key: "mem", label: "Band xotira", color: 1 },
                { key: "swap", label: "Swap", color: 3 },
              ]}
              yMax={100}
              formatValue={pct}
            />
          )}
        </Chart>

        <Chart title="Protsessor yuklamasi (load)" description={cpuLimitKnown ? "1 va 5 daqiqalik load; chegara — yadrolar soni × 2." : "1 va 5 daqiqalik load."}>
          {noHost ? (
            <NoData>{hostHint}</NoData>
          ) : (
            <MultiLineChart
              title="Server load"
              points={load}
              series={[
                { key: "load1", label: "load 1 daq", color: 1 },
                { key: "load5", label: "load 5 daq", color: 2 },
                ...(cpuLimitKnown ? [{ key: "limit", label: "Chegara (2 × yadro)", color: 4 as const }] : []),
              ]}
              formatValue={dec1}
            />
          )}
        </Chart>

        <Chart title="Konteynerlar xotirasi" description="Har bir slaydx konteyneri band qilgan xotira, MB.">
          {containerNames.length === 0 ? (
            <NoData>{hostHint}</NoData>
          ) : (
            <MultiLineChart
              title="Konteynerlar xotirasi, MB"
              points={containerPoints}
              series={containerNames.map((n, i) => ({ key: n, label: n.replace(/^slaydx-/, ""), color: (((i % 5) + 1) as 1 | 2 | 3 | 4 | 5) }))}
              formatValue={(n) => fmtNumber(n)}
            />
          )}
        </Chart>

        <Chart title="So'rovlar va xatolar" description="Daqiqasiga so'rovlar soni (nginx jurnali): jami, 4xx va 5xx.">
          {!hasAny(data.host.map((p) => p.reqPerMin)) ? (
            <NoData>nginx jurnali hali yig&apos;ilmayapti: slaydx uchun alohida access_log yoqing (docs/ops/METRICS.md).</NoData>
          ) : (
            <MultiLineChart
              title="So'rovlar, daqiqasiga"
              points={requests}
              series={[
                { key: "req", label: "Jami", color: 1 },
                { key: "s4xx", label: "4xx", color: 3 },
                { key: "s5xx", label: "5xx", color: 5 },
              ]}
              formatValue={dec1}
            />
          )}
        </Chart>
      </div>

      <Chart
        title="Foydalanuvchilar, navbat va ish kutishi"
        description="Bir xil vaqt o'qida: nechta foydalanuvchida navbat o'sib, ish kutishi uzayganini shu yerdan ko'ring."
      >
        {noApp ? (
          <NoData>Ilova namunalari yo&apos;q: worker hali namuna yozmagan.</NoData>
        ) : (
          <div className="flex flex-col gap-4">
            <AppLine title="Faol foydalanuvchilar (so'nggi 5 daqiqa)" points={data.app} pick={(p) => p.activeUsers} color={1} lbl={lbl} format={(n) => fmtNumber(n)} />
            <AppLine title="Navbatdagi ishlar" points={data.app} pick={(p) => p.queued} color={3} lbl={lbl} format={(n) => fmtNumber(n)} />
            <AppLine title="Ish kutishi, p95 (soniya)" points={data.app} pick={(p) => p.waitP95Sec} color={5} lbl={lbl} format={(n) => fmtDuration(n)} />
          </div>
        )}
      </Chart>

      <Chart title="Baza ulanishlari" description="Ishlatilayotgan ulanishlar, ruxsat etilgan eng ko'pi va hovuzda kutayotganlar.">
        {noApp ? (
          <NoData>Ilova namunalari yo&apos;q: worker hali namuna yozmagan.</NoData>
        ) : (
          <MultiLineChart
            title="Baza ulanishlari"
            points={db}
            series={[
              { key: "conns", label: "Ulanishlar", color: 1 },
              { key: "max", label: "Chegara", color: 4 },
              { key: "waiting", label: "Hovuzda kutayotgan", color: 5 },
            ]}
            formatValue={(n) => fmtNumber(n)}
          />
        )}
      </Chart>
    </div>
  );
}

function AppLine({
  title,
  points,
  pick,
  color,
  lbl,
  format,
}: {
  title: string;
  points: ServerMetrics["app"];
  pick: (p: ServerMetrics["app"][number]) => number | null;
  color: 1 | 3 | 5;
  lbl: (iso: string) => string;
  format: (n: number) => string;
}) {
  const pts = useMemo(() => points.map((p) => ({ label: lbl(p.t), value: pick(p) ?? 0 })), [points, lbl, pick]);
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-muted-foreground text-xs font-medium">{title}</h4>
      <LineChart title={title} points={pts} color={color} formatValue={format} height={130} />
    </div>
  );
}

type PeakRow = { id: string; label: string; peak: MetricPeak | null; format: (n: number) => string; note?: (p: MetricPeak) => string | null };

function PeaksTable({ data }: { data: ServerMetrics }) {
  const rows: PeakRow[] = [
    {
      id: "users",
      label: "Eng ko'p faol foydalanuvchi",
      peak: data.peaks.activeUsers,
      format: (n) => fmtNumber(n),
      note: (p) => (p.queued != null || p.waitP95Sec != null ? `shu paytda navbat: ${fmtNumber(p.queued)}, ish kutishi p95: ${fmtDuration(p.waitP95Sec)}` : null),
    },
    { id: "mem", label: "Eng yuqori xotira bandligi", peak: data.peaks.memUsedPct, format: pct },
    { id: "queue", label: "Navbatda eng uzoq kutish", peak: data.peaks.oldestQueuedSec, format: (n) => fmtDuration(n) },
    { id: "wait", label: "Ish kutishi p95 (eng yuqori)", peak: data.peaks.waitP95Sec, format: (n) => fmtDuration(n) },
    { id: "load", label: "Eng yuqori load (1 daq)", peak: data.peaks.load1, format: dec1 },
  ];
  const columns: Column<PeakRow>[] = [
    { id: "what", header: "Ko'rsatkich", cell: (r) => r.label },
    { id: "value", header: "Qiymat", align: "right", className: "tabular-nums", cell: (r) => (r.peak ? <span className="font-semibold">{r.format(r.peak.value)}</span> : "—") },
    { id: "at", header: "Qachon", cell: (r) => (r.peak ? fmtDateTime(r.peak.at) : "—") },
    {
      id: "note",
      header: "Izoh",
      hideOnCard: true,
      cell: (r) => (r.peak && r.note ? (r.note(r.peak) ?? "") : ""),
    },
  ];
  return (
    <Card>
      <CardHeader
        title="Eng yuqori nuqtalar"
        description="Tanlangan davrdagi eng katta qiymatlar va ular qaysi vaqtda bo'lgani."
        aside={<Badge tone="neutral">{RANGES.find((r) => r.value === data.range)?.label}</Badge>}
        as="h3"
      />
      <div className="p-3">
        <DataTable caption="Eng yuqori nuqtalar" columns={columns} rows={rows} rowKey={(r) => r.id} />
      </div>
    </Card>
  );
}
