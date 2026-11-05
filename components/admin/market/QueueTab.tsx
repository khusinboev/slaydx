"use client";

import { useCallback, useMemo, useState } from "react";
import { ScanSearch } from "lucide-react";
import { MARKET_SUBJECT_OPTIONS, MARKET_TOOL_OPTIONS, bulkApproveInBatches, scanMarket, type MarketAdminItem, type MarketItemsQuery, type MarketOverview } from "@/lib/admin-api/market";
import { fmtNumber, fmtRelative } from "@/lib/admin-format";
import { Badge, Button, ConfirmDialog, FilterBar, SearchInput, Segmented, SelectFilter, toast, type Column } from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell/admin-identity";
import { ItemDrawer } from "./ItemDrawer";
import { ItemsList } from "./ItemsList";
import { rejectReasonText, subjectName } from "./shared";

type QueueView = "queue" | "reports" | "errors" | "rejected";

const VIEWS: ReadonlyArray<{ value: QueueView; label: string }> = [
  { value: "queue", label: "Navbat" },
  { value: "reports", label: "Shikoyatlar" },
  { value: "errors", label: "Xatolar" },
  { value: "rejected", label: "Rad etilgan" },
];

const SCOPE: Record<QueueView, Pick<MarketItemsQuery, "status" | "view">> = {
  queue: { status: ["candidate"] },
  reports: { view: "reports" },
  errors: { status: ["rejected"], view: "errors" },
  rejected: { status: ["rejected"] },
};

/** More than this many works needs the count typed again (plan §7.0 of the admin plan: bulk actions). */
export const TYPED_CONFIRM_ABOVE = 10;

const qualityTone = (q: number | null) => (q === null ? "neutral" : q >= 85 ? "success" : q >= 70 ? "info" : "warning");

const COLUMNS: Column<MarketAdminItem>[] = [
  {
    id: "title",
    header: "Ish",
    className: "min-w-[12rem] max-w-[22rem]",
    cell: (r) => (
      <span className="flex flex-col gap-0.5">
        <span className="line-clamp-2 break-words">{r.title}</span>
        <span className="text-muted-foreground text-xs">
          {r.toolTitle} · {subjectName(r.subject)}
        </span>
      </span>
    ),
  },
  {
    id: "quality",
    header: "Sifat",
    align: "right",
    cell: (r) => <Badge tone={qualityTone(r.quality)}>{r.quality === null ? "—" : r.quality}</Badge>,
  },
  {
    id: "flags",
    header: "PII",
    align: "right",
    hint: "tozalangan joylar",
    cell: (r) => (r.flags > 0 ? <Badge tone="warning">{fmtNumber(r.flags)} joy</Badge> : <span className="text-muted-foreground">0</span>),
  },
  {
    id: "age",
    header: "Manba yoshi",
    className: "whitespace-nowrap tabular-nums",
    hideOnCard: true,
    cell: (r) => (r.sourceFinishedAt ? fmtRelative(r.sourceFinishedAt) : "—"),
  },
  {
    id: "note",
    header: "Eslatma",
    className: "max-w-[14rem]",
    cell: (r) => (
      <span className="text-muted-foreground flex flex-wrap gap-1 text-xs">
        {r.duplicates > 0 ? <Badge tone="warning">O&apos;xshash: {r.duplicates}</Badge> : null}
        {r.reports > 0 ? <Badge tone="danger">Shikoyat: {r.reports}</Badge> : null}
        {r.hidden ? <Badge tone="danger">Yashirilgan</Badge> : null}
        {r.authorOptOut ? <Badge>Muallif voz kechgan</Badge> : null}
        {r.status === "rejected" ? <span>{rejectReasonText(r.rejectReason)}</span> : null}
      </span>
    ),
  },
];

/** «Navbat»: candidates, reported items, scan errors and rejected rows; row → review drawer; bulk approve; manual scan. */
export function QueueTab({ overview, changes, onChanged }: { overview: MarketOverview | null; changes: number; onChanged: () => void }) {
  const canManage = useCan("market.manage");
  const [view, setView] = useState<QueueView>("queue");
  const [tool, setTool] = useState("");
  const [subject, setSubject] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<readonly MarketAdminItem[]>([]);
  const [dialog, setDialog] = useState<"bulk" | "scan" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const query = useMemo<MarketItemsQuery>(() => ({ ...SCOPE[view], tool: tool || undefined, subject: subject || undefined, q: q || undefined }), [view, tool, subject, q]);
  const active = (tool ? 1 : 0) + (subject ? 1 : 0) + (q ? 1 : 0);
  const clear = () => {
    setTool("");
    setSubject("");
    setQ("");
  };

  const refresh = useCallback(() => {
    setSelected(new Set());
    onChanged();
  }, [onChanged]);

  const picked = rows.filter((r) => selected.has(r.id));
  const withFlags = picked.filter((r) => r.flags > 0).length;
  const scanned = overview?.lastScan;

  return (
    <div className="flex min-w-0 flex-col gap-3 pt-3">
      {overview && !overview.previews ? (
        <p className="bg-muted text-muted-foreground rounded-lg px-3 py-2 text-xs">Bu serverda LibreOffice topilmadi: oldindan ko&apos;rish rasmlari chizilmaydi.</p>
      ) : null}
      {scanned ? (
        <p data-last-scan className="text-muted-foreground px-1 text-xs">
          Oxirgi skanerlash {fmtRelative(scanned.at)}: ko&apos;rildi {fmtNumber(scanned.scanned)}, nomzod {fmtNumber(scanned.created)}, rad etildi {fmtNumber(scanned.rejected)}
          {scanned.stopped ? ". Vaqt tugadi, qolgani keyingi skanerlashda" : ""}
          {scanned.locked ? ". O'sha paytda boshqa skanerlash ketayotgan edi" : ""}
        </p>
      ) : null}
      <FilterBar activeCount={active} onClear={clear}>
        <Segmented ariaLabel="Navbat bo'limi" options={VIEWS} value={view} onChange={(v) => { setView(v as QueueView); setSelected(new Set()); }} />
        <div className="w-full min-w-[12rem] sm:w-64">
          <SearchInput value={q} placeholder="Sarlavha bo'yicha qidirish" ariaLabel="Sarlavha bo'yicha qidirish" onChange={(v) => setQ(v.slice(0, 100))} />
        </div>
        <SelectFilter label="Vosita" value={tool} options={MARKET_TOOL_OPTIONS} allLabel="Barcha vositalar" onChange={setTool} />
        <SelectFilter label="Fan" value={subject} options={MARKET_SUBJECT_OPTIONS} allLabel="Barcha fanlar" onChange={setSubject} />
        {canManage ? (
          <Button size="sm" onClick={() => setDialog("scan")} icon={<ScanSearch className="size-4" aria-hidden="true" />}>
            Skanerlash
          </Button>
        ) : null}
      </FilterBar>

      {canManage && selected.size > 0 ? (
        <div className="bg-muted flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[13px]" data-bulk-bar>
          <span>{fmtNumber(selected.size)} ta tanlandi</span>
          {withFlags > 0 ? <span className="text-badge-warning-text text-xs">PII topilgan {withFlags} ta ish alohida tekshiriladi</span> : null}
          <Button size="sm" variant="primary" disabled={withFlags === selected.size} onClick={() => setDialog("bulk")}>
            Tanlanganlarni tasdiqlash
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Bekor qilish
          </Button>
        </div>
      ) : null}

      <ItemsList
        query={query}
        reload={changes}
        columns={COLUMNS}
        caption="Bozor navbati"
        emptyTitle="Ish topilmadi"
        emptyText={view === "queue" ? "Navbat bo'sh. Skanerlash yangi ishlarni topadi." : "Bu bo'limda hozircha hech narsa yo'q."}
        onOpen={setOpenId}
        selected={view === "queue" && canManage ? selected : undefined}
        onSelectedChange={view === "queue" && canManage ? setSelected : undefined}
        onRows={setRows}
      />

      <ItemDrawer id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />

      <ConfirmDialog
        open={dialog === "bulk"}
        onClose={() => setDialog(null)}
        title="Tanlangan ishlarni tasdiqlash"
        description={progress ? `Tasdiqlanmoqda: ${progress.done} / ${progress.total}. Oynani yopmang.` : "Har ish uchun neytral fayl chiziladi va u katalogga chiqadi. PII topilgan ishlar o'tkazib yuboriladi. Ko'p ish kichik partiyalarda yuboriladi."}
        target={`${fmtNumber(selected.size - withFlags)} ta ish`}
        reason={{ minLength: 5 }}
        typedConfirmation={selected.size > TYPED_CONFIRM_ABOVE ? String(selected.size) : undefined}
        confirmLabel="Tasdiqlash"
        sheet
        onConfirm={async ({ reason, idempotencyKey }) => {
          const ids = [...selected];
          setProgress({ done: 0, total: ids.length });
          try {
            const res = await bulkApproveInBatches(ids, reason, idempotencyKey, (done) => {
              setProgress((p) => (p ? { ...p, done: p.done + done.length } : p));
              // A failed request leaves only the rest selected: «Tasdiqlash» again resumes there.
              setSelected((prev) => new Set([...prev].filter((id) => !done.includes(id))));
            });
            const failed = res.results.length - res.approved;
            toast(failed ? `${res.approved} ta tasdiqlandi, ${failed} tasi o'tkazib yuborildi` : `${res.approved} ta ish tasdiqlandi`);
            refresh();
          } finally {
            setProgress(null);
          }
        }}
      />
      <ConfirmDialog
        open={dialog === "scan"}
        onClose={() => setDialog(null)}
        title="Nomzodlarni skanerlash"
        description="Tayyor ishlardan yangi nomzodlar qidiriladi, bir marta 20 tagacha. Bozor o'chiq bo'lsa ham ishlaydi."
        reason={{ minLength: 5 }}
        confirmLabel="Skanerlash"
        sheet
        onConfirm={async ({ reason, idempotencyKey }) => {
          const r = await scanMarket(reason, idempotencyKey);
          toast(r.locked ? "Skanerlash allaqachon ketmoqda" : `Ko'rildi: ${r.scanned}, nomzod: ${r.created}, rad etildi: ${r.rejected}${r.stopped ? ". Qolgani keyingi skanerlashda" : ""}`);
          refresh();
        }}
      />
    </div>
  );
}
