"use client";

import { useMemo, useState } from "react";
import { MARKET_SUBJECT_OPTIONS, MARKET_TOOL_OPTIONS, type MarketAdminItem, type MarketItemsQuery, type MarketStatus } from "@/lib/admin-api/market";
import { fmtNumber, fmtSoum } from "@/lib/admin-format";
import { Badge, FilterBar, SearchInput, Segmented, SelectFilter, type Column } from "@/components/admin/ui";
import { ItemDrawer } from "./ItemDrawer";
import { ItemsList } from "./ItemsList";
import { MarketStatusPill } from "./shared";

const STATUS_OPTIONS = [
  { value: "", label: "Hammasi" },
  { value: "active", label: "Sotuvda" },
  { value: "sold_out", label: "Tugagan" },
  { value: "retired", label: "Olib tashlangan" },
];

const ALL_STATUSES: readonly MarketStatus[] = ["active", "sold_out", "retired"];

const COLUMNS: Column<MarketAdminItem>[] = [
  {
    id: "title",
    header: "Ish",
    className: "min-w-[12rem] max-w-[22rem]",
    cell: (r) => (
      <span className="flex flex-col gap-0.5">
        <span className="line-clamp-2 break-words">{r.title}</span>
        <span className="text-muted-foreground text-xs">{r.toolTitle}</span>
      </span>
    ),
  },
  { id: "status", header: "Holat", cell: (r) => <MarketStatusPill status={r.status} /> },
  {
    id: "price",
    header: "Narx",
    align: "right",
    className: "whitespace-nowrap tabular-nums",
    cell: (r) => (
      <span className="flex flex-col items-end">
        <span>{fmtSoum(r.price)}</span>
        {r.priceOverride !== null ? <span className="text-muted-foreground text-xs">qo&apos;lda</span> : null}
      </span>
    ),
  },
  {
    id: "sold",
    header: "Sotilgan",
    align: "right",
    className: "tabular-nums",
    cell: (r) => (r.maxCopies === null ? fmtNumber(r.soldCount) : `${fmtNumber(r.soldCount)} / ${fmtNumber(r.maxCopies)}`),
  },
  { id: "revenue", header: "Tushum", align: "right", className: "whitespace-nowrap tabular-nums", hint: "qaytarishsiz", cell: (r) => fmtSoum(r.revenue) },
  { id: "rating", header: "Baho", align: "right", className: "tabular-nums", cell: (r) => (r.rating ? `${r.rating.avg} (${r.rating.count})` : "—") },
  {
    id: "note",
    header: "Eslatma",
    hideOnCard: false,
    cell: (r) => (
      <span className="flex flex-wrap gap-1">
        {r.reports > 0 ? <Badge tone="danger">Shikoyat: {r.reports}</Badge> : null}
        {r.hidden ? <Badge tone="danger">Yashirilgan</Badge> : null}
        {r.authorOptOut ? <Badge>Muallif voz kechgan</Badge> : null}
      </span>
    ),
  },
];

/** «Katalog»: everything that has been on the shelf; row → the same drawer with price, retire and buyers. */
export function CatalogTab({ changes, onChanged }: { changes: number; onChanged: () => void }) {
  const [status, setStatus] = useState("");
  const [tool, setTool] = useState("");
  const [subject, setSubject] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useMemo<MarketItemsQuery>(
    () => ({
      status: status ? [status as MarketStatus] : ALL_STATUSES,
      tool: tool || undefined,
      subject: subject || undefined,
      q: q || undefined,
      sort: "approved_desc",
    }),
    [status, tool, subject, q],
  );
  const active = (status ? 1 : 0) + (tool ? 1 : 0) + (subject ? 1 : 0) + (q ? 1 : 0);

  return (
    <div className="flex min-w-0 flex-col gap-3 pt-3">
      <FilterBar
        activeCount={active}
        onClear={() => {
          setStatus("");
          setTool("");
          setSubject("");
          setQ("");
        }}
      >
        <Segmented ariaLabel="Holat" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        <div className="w-full min-w-[12rem] sm:w-64">
          <SearchInput value={q} placeholder="Sarlavha bo'yicha qidirish" ariaLabel="Sarlavha bo'yicha qidirish" onChange={(v) => setQ(v.slice(0, 100))} />
        </div>
        <SelectFilter label="Vosita" value={tool} options={MARKET_TOOL_OPTIONS} allLabel="Barcha vositalar" onChange={setTool} />
        <SelectFilter label="Fan" value={subject} options={MARKET_SUBJECT_OPTIONS} allLabel="Barcha fanlar" onChange={setSubject} />
      </FilterBar>
      <ItemsList
        query={query}
        reload={changes}
        columns={COLUMNS}
        caption="Bozor katalogi"
        emptyTitle="Ish topilmadi"
        emptyText="Katalogda hali ish yo'q. Navbatdan tasdiqlang."
        onOpen={setOpenId}
      />
      <ItemDrawer id={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />
    </div>
  );
}
