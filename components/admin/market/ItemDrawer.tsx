"use client";

import { useCallback, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Download, TriangleAlert } from "lucide-react";
import { ApiError } from "@/lib/admin-api/core";
import {
  MARKET_LEVEL_OPTIONS,
  MARKET_REASON_OPTIONS,
  MARKET_SUBJECT_OPTIONS,
  MAX_COPIES_LIMIT,
  approveMarketItem,
  editMarketItem,
  getMarketBuyers,
  getMarketItem,
  marketFileUrl,
  redrawMarketPreviews,
  rejectMarketItem,
  resanitizeMarketItem,
  retireMarketItem,
  setMarketItemPrice,
  setPurchaseAbuse,
  unhideMarketItem,
  type ItemEdits,
  type MarketBuyer,
  type MarketItemDetail,
  type MarketLevel,
  type MarketReasonCode,
} from "@/lib/admin-api/market";
import { fmtBytes, fmtDateTime, fmtNumber, fmtRelative, fmtSoum } from "@/lib/admin-format";
import { Badge, Button, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Forbidden, KeyValueList, Skeleton, toast, useLoad, type Column } from "@/components/admin/ui";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { useCan } from "@/components/admin/shell/admin-identity";
import { ItemPreview } from "./ItemPreview";
import { MarketStatusPill, levelName, piiKindName, piiPlace, rejectReasonText, subjectName } from "./shared";

const FIELD = "border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 text-[13px] outline-none focus:ring-2";
const AREA = "border-input bg-card focus:ring-ring w-full rounded-lg border px-2.5 py-2 text-[13px] outline-none focus:ring-2";

type Dialog =
  | { type: "approve" | "edit" | "reject" | "retire" | "resanitize" | "redraw" | "unhide" | "price" }
  | { type: "abuse"; buyer: MarketBuyer }
  | null;

type Form = { title: string; summary: string; subject: string; level: MarketLevel; maxCopies: string };

const formOf = (i: MarketItemDetail): Form => ({ title: i.title, summary: i.summary, subject: i.subject, level: i.level, maxCopies: i.maxCopies === null ? "" : String(i.maxCopies) });

/** Only what the form changed; an empty copies field keeps the family default. */
function editsOf(i: MarketItemDetail, f: Form): ItemEdits {
  const e: ItemEdits = {};
  if (f.title.trim() !== i.title) e.title = f.title.trim();
  if (f.summary.trim() !== i.summary) e.summary = f.summary.trim();
  if (f.subject !== i.subject) e.subject = f.subject;
  if (f.level !== i.level) e.level = f.level;
  // Empty = no cap.
  const copies = f.maxCopies === "" ? null : Number(f.maxCopies);
  if (copies !== i.maxCopies) e.maxCopies = copies;
  return e;
}

/**
 * Review and manage one item (§6). Two columns from `lg`: the sanitised document on the left, the PII hits and the
 * listing form on the right; one column on a phone, flags first (they are what the review is about). The buttons are
 * cosmetic: every action is refused by the server without its permission.
 */
export function ItemDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Drawer open={id !== null} onClose={onClose} title="Bozor ishi" wide sheet>
      {id !== null ? <Body key={id} id={id} onClose={onClose} onChanged={onChanged} /> : null}
    </Drawer>
  );
}

function Body({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const load = useCallback((signal: AbortSignal) => getMarketItem(id, { signal }), [id]);
  const [state, retry] = useLoad(load);
  const refresh = useCallback(() => {
    retry();
    onChanged();
  }, [retry, onChanged]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (state.status === "forbidden") return <Forbidden />;
  if (state.status === "error") return <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />;
  return <Loaded key={`${state.data.status}:${state.data.previewVersion}`} item={state.data} onClose={onClose} onChanged={refresh} />;
}

function Flags({ item }: { item: MarketItemDetail }) {
  if (!item.flagsList.length) {
    return <p className="text-muted-foreground text-[13px]">Matnda shaxsiy ma&apos;lumot topilmadi.</p>;
  }
  return (
    <div className="border-warning/40 bg-warning/10 flex flex-col gap-2 rounded-lg border p-3" data-market-flags>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        PII topildi: {fmtNumber(item.flagsList.length)} joy
      </p>
      <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto text-[12.5px]">
        {item.flagsList.map((f, i) => (
          <li key={`${f.path}:${i}`} className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge tone="warning">{piiKindName(f.kind)}</Badge>
              <span className="text-muted-foreground">{piiPlace(f.path)}</span>
            </span>
            {f.excerpt ? <span className="break-words">{f.excerpt}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ListingForm({ form, onChange }: { form: Form; onChange: (f: Form) => void }) {
  const ids = useId();
  const set = (p: Partial<Form>) => onChange({ ...form, ...p });
  return (
    <div className="flex flex-col gap-2.5 text-[12.5px]">
      <label htmlFor={`${ids}-t`} className="flex flex-col gap-1 font-semibold">
        Sarlavha
        <input id={`${ids}-t`} value={form.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} className={FIELD} />
      </label>
      <label htmlFor={`${ids}-s`} className="flex flex-col gap-1 font-semibold">
        Tavsif
        <AutoTextarea id={`${ids}-s`} value={form.summary} maxLength={400} minRows={2} maxRows={6} onChange={(e) => set({ summary: e.target.value })} className={AREA} />
      </label>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <label htmlFor={`${ids}-b`} className="flex flex-col gap-1 font-semibold">
          Fan
          <select id={`${ids}-b`} value={form.subject} onChange={(e) => set({ subject: e.target.value })} className={FIELD}>
            {MARKET_SUBJECT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${ids}-l`} className="flex flex-col gap-1 font-semibold">
          Daraja
          <select id={`${ids}-l`} value={form.level} onChange={(e) => set({ level: e.target.value as MarketLevel })} className={FIELD}>
            {MARKET_LEVEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${ids}-c`} className="flex flex-col gap-1 font-semibold">
          Nusxa chegarasi
          <input
            id={`${ids}-c`}
            value={form.maxCopies}
            inputMode="numeric"
            placeholder="cheklovsiz"
            onChange={(e) => set({ maxCopies: e.target.value.replace(/\D/g, "").slice(0, 4) })}
            className={FIELD}
          />
        </label>
      </div>
    </div>
  );
}

function Loaded({ item, onClose, onChanged }: { item: MarketItemDetail; onClose: () => void; onChanged: () => void }) {
  const canManage = useCan("market.manage");
  const canPrice = useCan("pricing.edit");
  const [form, setForm] = useState<Form>(() => formOf(item));
  const [dialog, setDialog] = useState<Dialog>(null);
  const edits = useMemo(() => editsOf(item, form), [item, form]);
  const copies = form.maxCopies === "" ? null : Number(form.maxCopies);
  const formOk = form.title.trim().length > 0 && (copies === null || (copies >= 1 && copies <= MAX_COPIES_LIMIT));
  const candidate = item.status === "candidate";
  const onShelf = item.status === "active" || item.status === "sold_out";
  const editable = canManage && item.status !== "rejected";
  const close = () => setDialog(null);

  const facts = [
    { label: "Vosita", value: item.toolTitle },
    { label: "Fan · daraja", value: `${subjectName(item.subject)} · ${levelName(item.level)}` },
    { label: "Hajm", value: item.slideCount ? `${item.slideCount} slayd` : item.pages ? `${item.pages} bet` : "—" },
    { label: "Til", value: item.language },
    { label: "Sifat", value: item.quality ?? "—" },
    { label: "Narx", value: `${fmtSoum(item.price)} · asl ${fmtSoum(item.originalPrice)}${item.priceOverride !== null ? " · qo'lda" : ""}` },
    { label: "Sotilgan", value: item.maxCopies === null ? fmtNumber(item.soldCount) : `${fmtNumber(item.soldCount)} / ${fmtNumber(item.maxCopies)}` },
    { label: "Manba", value: item.sourceFinishedAt ? fmtRelative(item.sourceFinishedAt) : "o'chirilgan" },
    ...(item.source?.userId ? [{ label: "Muallif", value: <Link href={`/admin/users/${encodeURIComponent(item.source.userId)}`} className="underline underline-offset-2">#{item.source.userId}</Link> }] : []),
    ...(item.neutralFile ? [{ label: "Neytral fayl", value: fmtBytes(item.neutralFile.sizeBytes) }] : []),
    ...(item.rejectReason ? [{ label: "Sabab", value: rejectReasonText(item.rejectReason) }] : []),
  ];

  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold break-words">{item.title}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <MarketStatusPill status={item.status} />
          {item.duplicates > 0 ? <Badge tone="warning">O&apos;xshash: {item.duplicates}</Badge> : null}
          {item.hidden ? <Badge tone="danger">Shikoyat tufayli yashirilgan</Badge> : null}
          {item.authorOptOut ? <Badge>Muallif voz kechgan</Badge> : null}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="order-2 min-w-0 lg:order-1">
          <ItemPreview item={item} canManage={canManage} />
        </div>
        <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
          <Flags item={item} />
          <KeyValueList items={facts} />
          {editable ? <ListingForm form={form} onChange={setForm} /> : null}
          {item.outline.length ? (
            <details className="text-[13px]">
              <summary className="cursor-pointer font-semibold">Mundarija ({item.outline.length})</summary>
              <ol className="text-muted-foreground mt-1 list-decimal pl-5">
                {item.outline.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ol>
            </details>
          ) : null}
          {item.reportsList.length ? (
            <div className="flex flex-col gap-1 text-[13px]">
              <h4 className="font-semibold">Shikoyatlar ({fmtNumber(item.reports)})</h4>
              <ul className="flex flex-col gap-1">
                {item.reportsList.map((r, i) => (
                  <li key={i} className="break-words">
                    <span className="text-muted-foreground text-xs tabular-nums">{fmtDateTime(r.createdAt)}</span> {r.reason || "—"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {item.status !== "candidate" && item.status !== "rejected" ? <Buyers itemId={item.id} canManage={canManage} onFlag={(buyer) => setDialog({ type: "abuse", buyer })} key={item.soldCount} /> : null}

      {canManage || canPrice ? (
        <div className="flex flex-wrap gap-2 border-t pt-3" data-market-actions>
          {canManage && candidate ? (
            <Button variant="primary" disabled={!formOk} onClick={() => setDialog({ type: "approve" })}>
              Tasdiqlash
            </Button>
          ) : null}
          {canManage && !candidate && editable ? (
            <Button disabled={!formOk || Object.keys(edits).length === 0} onClick={() => setDialog({ type: "edit" })}>
              Saqlash
            </Button>
          ) : null}
          {canManage && (candidate || onShelf) ? <Button onClick={() => setDialog({ type: "resanitize" })}>Qayta tozalash</Button> : null}
          {canPrice && (candidate || onShelf) ? <Button onClick={() => setDialog({ type: "price" })}>Narx</Button> : null}
          {canManage && onShelf ? <Button onClick={() => setDialog({ type: "redraw" })}>Qayta chizish</Button> : null}
          {canManage && item.neutralFile ? (
            <a href={marketFileUrl(item.id)} className="border-input hover:bg-muted inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px]">
              <Download className="size-4" aria-hidden="true" /> Neytral fayl
            </a>
          ) : null}
          {canManage && item.hidden ? <Button onClick={() => setDialog({ type: "unhide" })}>Yashirishni olib tashlash</Button> : null}
          {canManage && candidate ? (
            <Button variant="dangerOutline" onClick={() => setDialog({ type: "reject" })}>
              Rad etish
            </Button>
          ) : null}
          {canManage && onShelf ? (
            <Button variant="dangerOutline" onClick={() => setDialog({ type: "retire" })}>
              Olib tashlash
            </Button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={dialog?.type === "approve"}
        onClose={close}
        title="Ishni tasdiqlash"
        description="Neytral fayl chiziladi va ish katalogga chiqadi."
        target={form.title}
        reason={{ minLength: 5 }}
        confirmLabel="Tasdiqlash"
        sheet
        onConfirm={async ({ reason, idempotencyKey }) => {
          await approveMarketItem(item.id, reason, edits, idempotencyKey);
          toast("Ish katalogga chiqdi");
          onChanged();
          onClose();
        }}
      />
      <ConfirmDialog
        open={dialog?.type === "edit"}
        onClose={close}
        title="O'zgarishlarni saqlash"
        reason={{ minLength: 5 }}
        confirmLabel="Saqlash"
        sheet
        onConfirm={async ({ reason, idempotencyKey }) => {
          await editMarketItem(item.id, edits, reason, idempotencyKey);
          toast("Saqlandi");
          onChanged();
        }}
      />
      <CodeDialog open={dialog?.type === "reject"} onClose={close} title="Ishni rad etish" confirmLabel="Rad etish" description="Ish navbatdan chiqadi va qayta skanerlanmaydi." onSubmit={async (reason, code, key) => {
        await rejectMarketItem(item.id, reason, code, key);
        toast("Rad etildi");
        onChanged();
        onClose();
      }} />
      <CodeDialog open={dialog?.type === "retire"} onClose={close} title="Katalogdan olib tashlash" confirmLabel="Olib tashlash" description="Xaridorlar nusxasini saqlab qoladi, yangi xarid to'xtaydi." onSubmit={async (reason, code, key) => {
        await retireMarketItem(item.id, reason, code, key);
        toast("Olib tashlandi");
        onChanged();
      }} />
      <ConfirmDialog
        open={dialog?.type === "resanitize"}
        onClose={close}
        title="Qayta tozalash"
        description="Hozirgi qoidalar saqlangan matnga qayta qo'llanadi, oldindan ko'rish yangilanadi."
        reason={{ minLength: 5 }}
        confirmLabel="Tozalash"
        sheet
        onConfirm={async ({ reason, idempotencyKey }) => {
          const r = await resanitizeMarketItem(item.id, reason, idempotencyKey);
          toast(`Tozalandi: ${r.flags} joy`);
          onChanged();
        }}
      />
      <ConfirmDialog
        open={dialog?.type === "redraw"}
        onClose={close}
        title="Namuna rasmlarini qayta chizish"
        reason={{ minLength: 5 }}
        confirmLabel="Qayta chizish"
        sheet
        onConfirm={async ({ reason, idempotencyKey }) => {
          await redrawMarketPreviews(item.id, reason, idempotencyKey);
          toast("Keyingi ko'rishda yangi rasmlar chiziladi");
          onChanged();
        }}
      />
      <ConfirmDialog
        open={dialog?.type === "unhide"}
        onClose={close}
        title="Yashirishni olib tashlash"
        description="Shikoyatlar ko'rib chiqildi, ish katalogga qaytadi."
        reason={{ minLength: 5 }}
        confirmLabel="Qaytarish"
        sheet
        onConfirm={async ({ reason, idempotencyKey }) => {
          await unhideMarketItem(item.id, reason, idempotencyKey);
          toast("Ish katalogga qaytdi");
          onChanged();
        }}
      />
      {dialog?.type === "price" ? <PriceDialog item={item} onClose={close} onChanged={onChanged} /> : null}
      <ConfirmDialog
        open={dialog?.type === "abuse"}
        onClose={close}
        title={dialog?.type === "abuse" && dialog.buyer.abuseFlag ? "Belgini olib tashlash" : "Suiiste'mol belgisi"}
        description="Belgi qo'yilsa xarid qayta tiklanmaydi va baholanmaydi."
        target={dialog?.type === "abuse" ? dialog.buyer.buyer : undefined}
        reason={{ minLength: 5 }}
        danger={dialog?.type === "abuse" && !dialog.buyer.abuseFlag}
        confirmLabel="Tasdiqlash"
        sheet
        onConfirm={async ({ reason, idempotencyKey }) => {
          if (dialog?.type !== "abuse") return;
          await setPurchaseAbuse(dialog.buyer.purchaseId, reason, Boolean(dialog.buyer.abuseFlag), idempotencyKey);
          toast("Saqlandi");
          onChanged();
        }}
      />
    </>
  );
}

/** Reject and retire share this: a reason code (§9) plus the free-text reason of the audit row. */
function CodeDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  onSubmit: (reason: string, code: MarketReasonCode, key: string) => Promise<void>;
}) {
  const id = useId();
  const [code, setCode] = useState<MarketReasonCode | "">("");
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      reason={{ minLength: 5, label: "Izoh" }}
      danger
      confirmLabel={confirmLabel}
      confirmDisabled={code === ""}
      sheet
      onConfirm={async ({ reason, idempotencyKey }) => {
        if (code) await onSubmit(reason, code, idempotencyKey);
      }}
    >
      <label htmlFor={id} className="flex flex-col gap-1 text-[12.5px] font-semibold">
        Sabab
        <select id={id} value={code} onChange={(e) => setCode(e.target.value as MarketReasonCode)} className={FIELD}>
          <option value="">Tanlang</option>
          {MARKET_REASON_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </ConfirmDialog>
  );
}

/** Absolute price of one item; the step-up code is asked by the admin API core on 401 `reauth`. An empty field clears it. */
function PriceDialog({ item, onClose, onChanged }: { item: MarketItemDetail; onClose: () => void; onChanged: () => void }) {
  const id = useId();
  const [text, setText] = useState(item.priceOverride === null ? "" : String(item.priceOverride));
  const next = text === "" ? null : Number(text);
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Bozor narxi"
      description={`Hozir ${fmtSoum(item.price)}, asl narx ${fmtSoum(item.originalPrice)}. Bo'sh qoldirilsa narx formuladan hisoblanadi.`}
      before={item.priceOverride === null ? "formula" : fmtSoum(item.priceOverride)}
      after={next === null ? "formula" : fmtSoum(next)}
      reason={{ minLength: 5 }}
      confirmLabel="Qo'llash"
      confirmDisabled={next === item.priceOverride}
      sheet
      onConfirm={async ({ reason, idempotencyKey }) => {
        try {
          await setMarketItemPrice(item.id, next, reason, idempotencyKey);
        } catch (e) {
          if (e instanceof ApiError && e.status === 400 && e.data.code === "unchanged") return;
          throw e;
        }
        toast("Narx yangilandi");
        onChanged();
      }}
    >
      <label htmlFor={id} className="flex flex-col gap-1 text-[12.5px] font-semibold">
        Narx, so&apos;m
        <input id={id} value={text} inputMode="numeric" autoComplete="off" onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 8))} className={FIELD} />
      </label>
    </ConfirmDialog>
  );
}

function Buyers({ itemId, canManage, onFlag }: { itemId: string; canManage: boolean; onFlag: (b: MarketBuyer) => void }) {
  const load = useCallback((signal: AbortSignal) => getMarketBuyers(itemId, { signal }), [itemId]);
  const [state, retry] = useLoad(load);
  const columns: Column<MarketBuyer>[] = [
    { id: "buyer", header: "Xaridor", cell: (b) => b.buyer },
    { id: "date", header: "Sana", className: "whitespace-nowrap tabular-nums", cell: (b) => fmtDateTime(b.createdAt) },
    { id: "price", header: "Narx", align: "right", className: "whitespace-nowrap tabular-nums", cell: (b) => fmtSoum(b.price) },
    { id: "dl", header: "Yuklangan", align: "right", className: "tabular-nums", cell: (b) => fmtNumber(b.downloads) },
    {
      id: "marks",
      header: "Belgi",
      cell: (b) => (
        <span className="flex flex-wrap gap-1">
          {b.refunded ? <Badge tone="info">Qaytarilgan</Badge> : null}
          {b.abuseFlag ? <Badge tone="danger">Suiiste&apos;mol</Badge> : null}
        </span>
      ),
    },
    {
      id: "code",
      header: "Iz",
      hideOnCard: true,
      className: "font-mono text-xs",
      cell: (b) => (b.generationId ? <Link href={`/admin/generations?id=${encodeURIComponent(b.generationId)}`} className="underline underline-offset-2">{b.fingerprint}</Link> : b.fingerprint),
    },
    ...(canManage
      ? [
          {
            id: "act",
            header: "",
            align: "right" as const,
            cell: (b: MarketBuyer) => (
              <Button size="sm" variant="ghost" onClick={() => onFlag(b)}>
                {b.abuseFlag ? "Belgini olish" : "Belgi qo'yish"}
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-[13px] font-semibold">Xaridorlar</h3>
      {state.status === "error" ? <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} /> : null}
      {state.status === "forbidden" ? <Forbidden /> : null}
      {state.status === "loading" || state.status === "ready" ? (
        <DataTable
          columns={columns}
          rows={state.status === "ready" ? state.data.items : []}
          rowKey={(b) => b.purchaseId}
          caption="Xaridorlar"
          loading={state.status === "loading"}
          skeletonRows={2}
          empty={<EmptyState title="Hali xarid yo'q" />}
        />
      ) : null}
    </div>
  );
}
