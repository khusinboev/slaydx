"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Undo2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  EmptyState,
  ErrorState,
  Forbidden,
  JsonView,
  KeyValueList,
  Skeleton,
  StatusPill,
} from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell";
import { ExternalRefundDialog, WALLET_LABEL } from "@/components/admin/money";
import { fmtDateTime, fmtNumber, fmtSoum } from "@/lib/admin-format";
import { getOrder, type AdminOrderDetailResponse, type AdminPaymentEvent, type OrderLedgerEntry, type AdminOrderRefund } from "@/lib/admin-api/payments";
import { KIND_LABEL, KIND_TONE, ORDER_STATE_LABEL, ORDER_STATE_TONE, PROVIDER_LABEL, PURPOSE_LABEL, cancelReasonText, shortId } from "./labels";
import { DeltaCell, ReferenceCell } from "./ledger-cells";
import { useResource } from "./list-state";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function BackLink() {
  return (
    <Link href="/admin/payments" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[12.5px]">
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      To&apos;lovlar
    </Link>
  );
}

/**
 * S9 `/admin/payments/[id]` (plan §7.1): order fields (provider times are
 * epoch ms on the server, shown as Tashkent dates), credited ledger rows,
 * the webhook timeline with the redacted payload as plain text, recorded
 * external refunds, and "Tashqi qaytarishni qayd etish" (paid orders,
 * `payments.refund_record`; the server re-checks both and asks for step-up).
 */
export function OrderDetailPage({ id }: { id: string }) {
  const valid = UUID.test(id);
  const { state, retry } = useResource<AdminOrderDetailResponse>(id, (signal) => getOrder(id, { signal }), valid);
  const canRecord = useCan("payments.refund_record");
  const [refundOpen, setRefundOpen] = useState(false);

  if (!valid || (state.status === "error" && state.notFound)) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <div className="bg-card rounded-xl border">
          <EmptyState title="Buyurtma topilmadi" description="Havola noto'g'ri yoki buyurtma o'chirilgan." />
        </div>
      </div>
    );
  }
  if (state.status === "forbidden") {
    return (
      <div className="bg-card rounded-xl border">
        <Forbidden />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <div className="bg-card rounded-xl border">
          <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
        </div>
      </div>
    );
  }
  if (!state.data) {
    return (
      <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const { order, events, eventsCapped, ledger, refunds } = state.data;
  const showRefund = canRecord && order.state === "paid";

  return (
    <div className="flex min-w-0 flex-col gap-5" aria-busy={state.status === "loading" || undefined}>
      <BackLink />
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-tight">
            <span>
              Buyurtma <span className="font-mono">{shortId(order.id)}</span>
            </span>
            <StatusPill tone={ORDER_STATE_TONE[order.state]} dot>
              {ORDER_STATE_LABEL[order.state]}
            </StatusPill>
          </h1>
          <p className="text-muted-foreground text-[13px] tabular-nums">
            {PROVIDER_LABEL[order.provider]} · {PURPOSE_LABEL[order.purpose]} · {fmtSoum(order.amountSoum)}
          </p>
        </div>
        {showRefund ? (
          <Button variant="dangerOutline" icon={<Undo2 className="size-4" aria-hidden="true" />} onClick={() => setRefundOpen(true)}>
            Tashqi qaytarishni qayd etish
          </Button>
        ) : null}
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Buyurtma" description="Provayder vaqtlari Toshkent vaqtida" />
          <CardBody>
            <KeyValueList
              items={[
                {
                  label: "ID",
                  mono: true,
                  value: (
                    <span className="inline-flex max-w-full items-center gap-1.5">
                      <span className="break-all">{order.id}</span>
                      <CopyButton value={order.id} />
                    </span>
                  ),
                },
                {
                  label: "Foydalanuvchi",
                  value: (
                    <Link href={`/admin/users/${order.userId}`} className="underline-offset-2 hover:underline">
                      {order.userName || `#${order.userId}`}
                      {order.userUsername ? <span className="text-muted-foreground"> · @{order.userUsername}</span> : null}
                    </Link>
                  ),
                },
                { label: "Provayder", value: PROVIDER_LABEL[order.provider] },
                { label: "Maqsad", value: PURPOSE_LABEL[order.purpose] },
                { label: "Summa", value: <span className="tabular-nums">{fmtSoum(order.amountSoum)}</span> },
                { label: "Provayder tranzaksiyasi", mono: true, value: order.providerTxn },
                { label: "Prepare ID", mono: true, value: order.prepareId },
                { label: "Yaratilgan", value: <span className="tabular-nums">{fmtDateTime(order.createdAt)}</span> },
                { label: "Provayderda yaratilgan (create_time)", value: order.createTime ? <span className="tabular-nums">{fmtDateTime(order.createTime)}</span> : null },
                { label: "To'langan (perform_time)", value: order.performTime ? <span className="tabular-nums">{fmtDateTime(order.performTime)}</span> : null },
                { label: "Bekor qilingan (cancel_time)", value: order.cancelTime ? <span className="tabular-nums">{fmtDateTime(order.cancelTime)}</span> : null },
                { label: "Bekor qilish sababi", value: cancelReasonText(order.cancelReason, order.provider) },
                {
                  label: "Hisobga yozildi",
                  value: order.credited ? (
                    <Badge tone="success" dot>
                      Ha
                    </Badge>
                  ) : order.state === "paid" ? (
                    <Badge tone="danger" dot>
                      Yo&apos;q — tekshiring
                    </Badge>
                  ) : (
                    <Badge>Yo&apos;q</Badge>
                  ),
                },
                { label: "Hisob havolasi", mono: true, value: order.settlementReference },
                {
                  label: "Tashqi qaytarilgan",
                  value: (
                    <span className="tabular-nums">
                      {fmtSoum(order.recordedSoum)}
                      <span className="text-muted-foreground"> · qolgan {fmtSoum(order.remainingSoum)}</span>
                    </span>
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>

        <EventsCard events={events} capped={eventsCapped} />
      </div>

      <LedgerCard rows={ledger} />
      <RefundsCard rows={refunds} />

      <ExternalRefundDialog
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        order={{ id: order.id, amountSoum: order.amountSoum, purpose: order.purpose, recordedSoum: order.recordedSoum, userName: order.userName }}
        onDone={() => retry()}
      />
    </div>
  );
}

function responseTone(code: number | null): "success" | "danger" | "neutral" {
  if (code === null) return "neutral";
  return code === 0 ? "success" : "danger";
}

function EventsCard({ events, capped }: { events: AdminPaymentEvent[]; capped: boolean }) {
  return (
    <Card>
      <CardHeader
        title="Webhook voqealari"
        description="payment_events · maxfiy maydonlar yashirilgan"
        aside={<span className="text-muted-foreground tabular-nums">{fmtNumber(events.length)} ta</span>}
      />
      {events.length === 0 ? (
        <EmptyState title="Voqealar yo'q" description="Provayder bu buyurtma bo'yicha hali so'rov yubormagan." />
      ) : (
        <ol className="flex flex-col divide-y" aria-label="Webhook voqealari">
          {events.map((e) => (
            <li key={e.id} className="px-4 py-2.5">
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
                  <span className="font-mono font-medium">{e.method}</span>
                  <Badge tone={responseTone(e.responseCode)}>{e.responseCode === null ? "javob kodi yo'q" : `javob ${e.responseCode}`}</Badge>
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">{fmtDateTime(e.receivedAt)}</span>
                </summary>
                <div className="mt-2">
                  <JsonView value={e.payload} maxHeightClass="max-h-64" />
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
      {capped ? <p className="text-muted-foreground border-t px-4 py-2 text-xs">Faqat birinchi 200 ta voqea ko&apos;rsatildi.</p> : null}
    </Card>
  );
}

function LedgerCard({ rows }: { rows: OrderLedgerEntry[] }) {
  return (
    <Card>
      <CardHeader title="Hisob yozuvlari" description="Kredit yozuvi va tashqi qaytarishdagi yechimlar" />
      {rows.length === 0 ? (
        <EmptyState title="Hisob yozuvi yo'q" description="Buyurtma to'lanmagan yoki kredit hali yozilmagan." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Buyurtma bo&apos;yicha hisob yozuvlari</caption>
            <thead>
              <tr className="text-muted-foreground text-[11.5px]">
                <th scope="col" className="border-b px-4 py-2 text-left font-semibold">Turi</th>
                <th scope="col" className="border-b px-3 py-2 text-right font-semibold">{WALLET_LABEL.balance}</th>
                <th scope="col" className="border-b px-3 py-2 text-right font-semibold">{WALLET_LABEL.quota}</th>
                <th scope="col" className="border-b px-3 py-2 text-left font-semibold">Havola</th>
                <th scope="col" className="border-b px-4 py-2 text-left font-semibold">Vaqt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={KIND_TONE[r.kind]}>{KIND_LABEL[r.kind]}</Badge>
                      <span className="text-muted-foreground text-xs">{r.role === "credit" ? "kredit" : "qaytarish yechimi"}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <DeltaCell value={r.balance} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <DeltaCell value={r.quota} />
                  </td>
                  <td className="max-w-[16rem] px-3 py-2">
                    <ReferenceCell reference={r.reference} link={null} />
                  </td>
                  <td className="text-muted-foreground px-4 py-2 whitespace-nowrap tabular-nums">{fmtDateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const REFUND_KIND_LABEL: Record<AdminOrderRefund["kind"], string> = { refund: "Qaytarish", chargeback: "Chargeback" };

function RefundsCard({ rows }: { rows: AdminOrderRefund[] }) {
  return (
    <Card>
      <CardHeader title="Tashqi qaytarishlar" description="Provayder yoki bank orqali qaytarilgan pul (payment_refunds)" />
      {rows.length === 0 ? (
        <EmptyState title="Qayd etilmagan" description="Bu buyurtma bo'yicha tashqi qaytarish yo'q." />
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.kind === "chargeback" ? "danger" : "warning"}>{REFUND_KIND_LABEL[r.kind]}</Badge>
                <span className="font-semibold tabular-nums">{fmtSoum(r.amountSoum)}</span>
                <span className="text-muted-foreground ml-auto text-xs tabular-nums">{fmtDateTime(r.createdAt)}</span>
              </div>
              <p className="text-muted-foreground text-xs tabular-nums">
                {r.clawbackWallet
                  ? `${WALLET_LABEL[r.clawbackWallet]}dan yechildi: ${fmtNumber(r.clawbackAmount)}${r.shortfall ? ` · yetishmadi: ${fmtNumber(r.shortfall)}` : ""}`
                  : "Hamyonga tegilmagan"}
                {r.createdByName ? ` · ${r.createdByName}` : ""}
              </p>
              <p className="break-words">{r.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
