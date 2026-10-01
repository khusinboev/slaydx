"use client";

import { RefreshCw } from "lucide-react";
import { getAiProviders, type AiBreaker, type AiLimiter, type AiProcess, type AiProviderKeyName, type AiProvidersResponse, type AiUsage24h } from "@/lib/admin-api/ai";
import { fmtPercent, fmtRelative } from "@/lib/admin-format";
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Forbidden, Skeleton, type Column, type Tone } from "@/components/admin/ui";
import { numText, soumText, usdText, useLoad } from "./shared";

/** Order and Uzbek names of the key grid (the API sends one boolean per name). */
const KEY_LABELS: ReadonlyArray<{ name: AiProviderKeyName; label: string; hint: string }> = [
  { name: "gemini", label: "Gemini", hint: "matn, rasm, ovoz" },
  { name: "anthropic", label: "Anthropic", hint: "Claude modellari" },
  { name: "openai", label: "OpenAI", hint: "matn zaxirasi" },
  { name: "openrouter", label: "OpenRouter", hint: "matn zaxirasi" },
  { name: "xai", label: "xAI", hint: "Grok modellari" },
  { name: "fal", label: "fal.ai", hint: "rasm" },
  { name: "pexels", label: "Pexels", hint: "foto" },
  { name: "pixabay", label: "Pixabay", hint: "foto" },
  { name: "azureTts", label: "Azure TTS", hint: "ovoz (kalit va region)" },
  { name: "aisha", label: "Aisha TTS", hint: "ovoz" },
];

const BREAKER_TEXT: Record<AiBreaker["state"], string> = { closed: "Yopiq", open: "Ochiq", "half-open": "Yarim ochiq" };
const BREAKER_TONE: Record<AiBreaker["state"], Tone> = { closed: "success", open: "danger", "half-open": "warning" };

const loadProviders = (signal: AbortSignal): Promise<AiProvidersResponse> => getAiProviders({ signal });

/** Tab "Provayderlar": key presence, breaker states and limiter load per process, 24 h usage. */
export function ProvidersTab() {
  const [state, retry] = useLoad(loadProviders);

  return (
    <div className="flex flex-col gap-4 pt-4">
      {state.status === "loading" ? (
        <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : state.status === "forbidden" ? (
        <Card>
          <Forbidden />
        </Card>
      ) : state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
        </Card>
      ) : (
        <ProvidersReady data={state.data} onRefresh={retry} />
      )}
    </div>
  );
}

function ProvidersReady({ data, onRefresh }: { data: AiProvidersResponse; onRefresh: () => void }) {
  const staleCount = data.processes.filter((p) => p.stale).length;
  const openCount = data.breakers.filter((b) => b.state === "open" && !b.stale).length;

  return (
    <>
      <Card>
        <CardHeader
          title="API kalitlari"
          description="Faqat bor-yo'qligi ko'rsatiladi; kalit qiymati hech qachon ko'rsatilmaydi. Holat veb-jarayon muhiti bo'yicha."
          aside={
            <Button size="sm" onClick={onRefresh} icon={<RefreshCw className="size-3.5" aria-hidden="true" />}>
              Yangilash
            </Button>
          }
        />
        <CardBody>
          <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-5">
            {KEY_LABELS.map((k) => {
              const on = data.keys[k.name] === true;
              return (
                <li key={k.name} data-key={k.name} data-present={on ? "1" : "0"} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{k.label}</span>
                    <span className="text-muted-foreground block truncate text-xs">{k.hint}</span>
                  </span>
                  <Badge tone={on ? "success" : "neutral"} dot>
                    {on ? "Bor" : "Yo'q"}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Jarayonlar va himoya qulflari"
          description="Har bir veb va worker jarayoni o'z holatini har 30 soniyada yozadi; qulf holati jarayon ichida saqlanadi."
          aside={
            <>
              {openCount > 0 ? <Badge tone="danger" dot>{numText(openCount)} ta ochiq</Badge> : null}
              {staleCount > 0 ? <Badge tone="warning" dot>{numText(staleCount)} ta eskirgan jarayon</Badge> : null}
            </>
          }
        />
        {data.processes.length === 0 ? (
          <EmptyState title="Jarayonlardan signal kelmagan" description="Veb yoki worker jarayoni hali holat yozmagan yoki barchasi to'xtagan." />
        ) : (
          <>
            <ProcessList processes={data.processes} />
            <div className="border-t p-3">
              <BreakersTable breakers={data.breakers} />
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Limiter yuklamasi" description="Bir vaqtda ketayotgan va navbat kutayotgan so'rovlar (band / chegara)." />
        <div className="p-3">
          <LimitersTable limiters={data.limiters} hasProcesses={data.processes.length > 0} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Oxirgi 24 soat" description="Provayder va model bo'yicha xarajat." />
        <div className="p-3">
          <UsageTable usage={data.usage24h} soumPerUsd={data.soumPerUsd} />
        </div>
      </Card>
    </>
  );
}

function ProcessList({ processes }: { processes: AiProcess[] }) {
  return (
    <ul className="divide-y" aria-label="Jarayonlar">
      {processes.map((p) => (
        <li key={p.process} data-process={p.process} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
          <Badge tone={p.role === "worker" ? "info" : "neutral"}>{p.role === "worker" ? "worker" : "veb"}</Badge>
          <span className="min-w-0 font-mono text-xs break-all">{p.process}</span>
          <span className="text-muted-foreground text-xs">oxirgi signal: {fmtRelative(p.lastSeenAt)}</span>
          {p.stale ? (
            <Badge tone="warning" dot title="Signal 90 soniyadan beri kelmagan: jarayon to'xtagan bo'lishi mumkin">
              Eskirgan
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ProcessCell({ process, stale }: { process: string; stale: boolean }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="font-mono text-xs break-all">{process}</span>
      {stale ? <Badge tone="warning">Eskirgan</Badge> : null}
    </span>
  );
}

function BreakersTable({ breakers }: { breakers: AiBreaker[] }) {
  const columns: Column<AiBreaker>[] = [
    { id: "process", header: "Jarayon", cell: (b) => <ProcessCell process={b.process} stale={b.stale} /> },
    { id: "name", header: "Provayder / manba", cell: (b) => <span className="font-mono text-[12.5px]">{b.name}</span> },
    {
      id: "state",
      header: "Holat",
      cell: (b) => (
        // An open breaker of a dead process says nothing about now: shown neutral, not red.
        <Badge tone={b.stale ? "neutral" : BREAKER_TONE[b.state]} dot>
          {BREAKER_TEXT[b.state]}
        </Badge>
      ),
    },
    {
      id: "until",
      header: "Ochiq muddati",
      cell: (b) => (b.state === "open" && b.openUntil && !b.stale ? fmtRelative(b.openUntil) : "—"),
    },
    { id: "failures", header: "Ketma-ket xatolar", align: "right", className: "tabular-nums", cell: (b) => numText(b.failures) },
  ];
  return (
    <DataTable
      caption="Provayder himoya qulflari (breaker) jarayonlar bo'yicha"
      columns={columns}
      rows={breakers}
      rowKey={(b) => `${b.process}|${b.name}`}
      maxHeightClass="max-h-[50vh]"
      empty={<EmptyState title="Himoya qulfi yo'q" description="Jarayonlar hali birorta provayderga murojaat qilmagan." />}
    />
  );
}

function LimitersTable({ limiters, hasProcesses }: { limiters: AiLimiter[]; hasProcesses: boolean }) {
  const columns: Column<AiLimiter>[] = [
    { id: "process", header: "Jarayon", cell: (l) => <ProcessCell process={l.process} stale={l.stale} /> },
    { id: "name", header: "Provayder", cell: (l) => <span className="font-mono text-[12.5px]">{l.name}</span> },
    {
      id: "load",
      header: "Band / chegara",
      cell: (l) => {
        const pct = l.max > 0 ? Math.min(100, (l.active / l.max) * 100) : 0;
        const full = l.max > 0 && l.active >= l.max;
        return (
          <span className="flex items-center gap-2 tabular-nums">
            <span className="bg-muted h-1.5 w-20 overflow-hidden rounded-full" aria-hidden="true">
              <span className={`block h-full rounded-full ${full && !l.stale ? "bg-destructive" : "bg-chart-2"}`} style={{ width: `${pct}%` }} />
            </span>
            <span>
              {numText(l.active)} / {numText(l.max)}
            </span>
            <span className="text-muted-foreground text-xs">{l.max > 0 ? fmtPercent(pct, { digits: 0 }) : ""}</span>
          </span>
        );
      },
    },
    { id: "waiting", header: "Navbatda", align: "right", className: "tabular-nums", cell: (l) => numText(l.waiting) },
  ];
  return (
    <DataTable
      caption="Limiter yuklamasi jarayonlar bo'yicha"
      columns={columns}
      rows={limiters}
      rowKey={(l) => `${l.process}|${l.name}`}
      maxHeightClass="max-h-[50vh]"
      empty={
        <EmptyState
          title="Limiter ma'lumoti yo'q"
          description={hasProcesses ? "Jarayonlarda hali band limiter yo'q." : "Jarayonlardan signal kelmagan."}
        />
      }
    />
  );
}

function UsageTable({ usage, soumPerUsd }: { usage: AiUsage24h[]; soumPerUsd: number }) {
  const total = usage.reduce((a, u) => a + u.usd, 0);
  const columns: Column<AiUsage24h>[] = [
    { id: "provider", header: "Provayder", cell: (u) => <span className="font-mono text-[12.5px]">{u.provider === "unknown" ? "noma'lum" : u.provider}</span> },
    { id: "model", header: "Model", cell: (u) => <span className="font-mono text-[12.5px] break-all">{u.model === "unknown" ? "noma'lum" : u.model}</span> },
    { id: "calls", header: "Chaqiruvlar", align: "right", className: "tabular-nums", cell: (u) => numText(u.calls) },
    {
      id: "usd",
      header: "Xarajat",
      align: "right",
      className: "tabular-nums",
      cell: (u) => (
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-medium">{usdText(u.usd)}</span>
          <span className="text-muted-foreground text-xs">{soumText(u.usd, soumPerUsd)}</span>
        </span>
      ),
    },
    {
      id: "share",
      header: "Ulush",
      hideOnCard: true,
      cell: (u) => {
        const share = total > 0 ? (u.usd / total) * 100 : 0;
        return (
          <span className="flex items-center gap-2">
            <span className="bg-muted h-1.5 w-20 overflow-hidden rounded-full" aria-hidden="true">
              <span className="bg-chart-1 block h-full rounded-full" style={{ width: `${Math.min(100, share)}%` }} />
            </span>
            <span className="text-muted-foreground w-12 text-xs tabular-nums">{fmtPercent(share)}</span>
          </span>
        );
      },
    },
  ];
  return (
    <DataTable
      caption="Oxirgi 24 soatdagi xarajat provayder va model bo'yicha"
      columns={columns}
      rows={usage}
      rowKey={(u) => `${u.provider}|${u.model}`}
      maxHeightClass="max-h-[50vh]"
      empty={<EmptyState title="Oxirgi 24 soatda AI xarajati yo'q" />}
    />
  );
}
