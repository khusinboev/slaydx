import { NextResponse } from "next/server";
import { ensureMigrated, query } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { recordPaymentEvent } from "@/lib/server/payment-events";
import {
  PAYME_TIMEOUT_MS,
  CANCEL_REASON_TIMEOUT,
  acceptedPaymeKeys,
  attachTransaction,
  cancelOrder,
  findOrder,
  findOrderByTxn,
  paymeAuthorized,
  settleOrder,
  type PaymentOrder,
} from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Payme Merchant API (JSON-RPC 2.0).
 * Spetsifikatsiya: developer.help.paycom.uz → «Merchant API» (metodlar,
 * «Ошибки» jadvali, tranzaksiya holatlari 1 / 2 / -1 / -2, timeout).
 *
 * Payme har chaqiruvni takrorlashi mumkin, shuning uchun har metod
 * idempotent: `PerformTransaction` ikkinchi marta kelsa pul qayta
 * qo'shilmaydi, faqat mavjud holat qaytariladi. Holat o'zgarishlari
 * (to'lash / bekor qilish / timeout) buyurtma qatori qulfi ostida
 * (`settleOrder` / `cancelOrder`) — Perform ∥ Cancel poygasi bekor
 * qilingan buyurtmada kredit qoldirmaydi (CONC-02, DB-09).
 *
 * Summalar Payme tomonda **tiyin** da (1 so'm = 100 tiyin).
 */

type Msg = { uz: string; ru: string; en: string };
type PaymeError = { code: number; message: Msg };

const m = (uz: string, ru: string, en: string): Msg => ({ uz, ru, en });

/** Spetsifikatsiyaning «Ошибки» jadvalidagi kodlar. */
const PAYME_ERRORS = {
  /** -32504 — «Недостаточно привилегий для выполнения метода». */
  AUTH: { code: -32504, message: m("Ruxsat yo'q", "Недостаточно привилегий", "Insufficient privileges") },
  /** -32601 — «Запрашиваемый метод не найден». */
  METHOD: { code: -32601, message: m("Metod topilmadi", "Метод не найден", "Method not found") },
  /** -32700 — «Ошибка парсинга JSON». */
  PARSE: { code: -32700, message: m("JSON o'qilmadi", "Ошибка парсинга JSON", "JSON parse error") },
  /** -32600 — «Отсутствуют обязательные поля в RPC-запросе или тип полей не соответствует спецификации». */
  INVALID: { code: -32600, message: m("So'rov noto'g'ri", "Неверный RPC-запрос", "Invalid RPC request") },
  /** -31001 — «Неверная сумма». */
  AMOUNT: { code: -31001, message: m("Noto'g'ri summa", "Неверная сумма", "Incorrect amount") },
  /** -31003 — «Транзакция не найдена». */
  TXN: { code: -31003, message: m("Tranzaksiya topilmadi", "Транзакция не найдена", "Transaction not found") },
  /** -31007 — «Невозможно отменить транзакцию» (заказ выполнен). */
  CANT_CANCEL: { code: -31007, message: m("Bekor qilib bo'lmaydi", "Невозможно отменить транзакцию", "Unable to cancel transaction") },
  /** -31008 — «Невозможно выполнить данную операцию». */
  CANT_PERFORM: { code: -31008, message: m("Amalni bajarib bo'lmadi", "Невозможно выполнить операцию", "Unable to perform operation") },
  /**
   * -31050…-31099 — hisob (`account`) xatolari; `data` — maydon nomi.
   * Kodni diapazon ichida savdogar tanlaydi.
   */
  ORDER: { code: -31050, message: m("Buyurtma topilmadi", "Заказ не найден", "Order not found") },
  /** Bir martalik buyurtmada boshqa faol tranzaksiya bor («заказ ожидает оплаты»). */
  BUSY: { code: -31051, message: m("Buyurtma to'lov kutmoqda", "Заказ ожидает оплаты", "Order is awaiting payment") },
  /** Buyurtma to'langan yoki bekor qilingan — qayta to'lab bo'lmaydi. */
  CLOSED: { code: -31052, message: m("Buyurtma yopilgan", "Заказ уже оплачен или отменён", "Order is already paid or cancelled") },
} as const satisfies Record<string, PaymeError>;

/** Hisob maydoni — `data` da qaytariladi (spetsifikatsiya talabi). */
const ACCOUNT_FIELD = "order_id";

/** Payme so'rovi kichik (< 2 KB); chegara autentifikatsiyadan oldin o'qish uchun. */
const MAX_BODY_BYTES = 64 * 1024;

type RpcRequest = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
};

/** Dispetcher natijasi: javob tanasi + audit izi uchun maydonlar. */
type Outcome = {
  body: Record<string, unknown>;
  /** 0 — natija; aks holda Payme xato kodi. */
  code: number;
  orderId?: string | null;
  txn?: string | null;
};

function rpcError(id: unknown, err: PaymeError, data?: unknown): Outcome {
  return {
    body: { jsonrpc: "2.0", id: id ?? null, error: { code: err.code, message: err.message, ...(data === undefined ? {} : { data }) } },
    code: err.code,
  };
}

function rpcResult(id: unknown, result: unknown): Outcome {
  return { body: { jsonrpc: "2.0", id: id ?? null, result }, code: 0 };
}

function orderIdFrom(params: Record<string, unknown>): string {
  const account = (params.account ?? {}) as Record<string, unknown>;
  return String(account.order_id ?? account.order ?? "").trim();
}

function tiyin(soum: number): number {
  return soum * 100;
}

/** Payme kutgan tranzaksiya holati: 1 = kutilmoqda, 2 = to'langan, -1 = bajarilmasdan bekor. */
function paymeState(order: { state: string }): number {
  if (order.state === "paid") return 2;
  if (order.state === "cancelled") return -1;
  return 1;
}

/**
 * CheckPerformTransaction mantig'i (CreateTransaction ham yangi tranzaksiya
 * ochishdan oldin shuni bajaradi). `null` — to'lash mumkin.
 *
 * Buyurtmalar BIR MARTALIK: faol tranzaksiyasi bor buyurtma «band»,
 * to'langan/bekor qilingani «yopiq» — ikkalasi ham hisob xatosi
 * (-31050…-31099, `data: "order_id"`), -31008 yoki `allow: true` emas (BEA-05).
 * Click uchun yaratilgan buyurtma Payme orqali to'lanmaydi (BEA-05 #6).
 */
function payable(id: unknown, order: PaymentOrder | null, amount: unknown): Outcome | null {
  if (!order || order.provider !== "payme") return rpcError(id, PAYME_ERRORS.ORDER, ACCOUNT_FIELD);
  if (Number(amount) !== tiyin(order.amountSoum)) return rpcError(id, PAYME_ERRORS.AMOUNT);
  if (order.state === "pending") return rpcError(id, PAYME_ERRORS.BUSY, ACCOUNT_FIELD);
  if (order.state !== "created") return rpcError(id, PAYME_ERRORS.CLOSED, ACCOUNT_FIELD);
  return null;
}

async function dispatch(body: RpcRequest): Promise<Outcome> {
  const id = body.id;
  const params = (body.params ?? {}) as Record<string, unknown>;
  const txn = typeof params.id === "string" ? params.id : params.id === undefined ? "" : String(params.id);

  switch (body.method) {
    case "CheckPerformTransaction": {
      const order = await findOrder(orderIdFrom(params));
      return { ...(payable(id, order, params.amount) ?? rpcResult(id, { allow: true })), orderId: order?.id };
    }

    case "CreateTransaction": {
      const time = Number(params.time);
      if (!txn || !Number.isFinite(time)) return rpcError(id, PAYME_ERRORS.INVALID);

      // Takroriy chaqiruv (spetsifikatsiya, CreateTransaction 1-qadam):
      // holati 1 bo'lmasa -31008; 12 soat o'tgan bo'lsa reason 4 bilan
      // bekor qilinadi va -31008; aks holda mavjud natija qaytadi.
      const existing = await findOrderByTxn("payme", txn);
      if (existing) {
        const tag = { orderId: existing.id, txn };
        if (existing.state !== "pending") return { ...rpcError(id, PAYME_ERRORS.CANT_PERFORM), ...tag };
        if (Date.now() - existing.createTime > PAYME_TIMEOUT_MS) {
          await cancelOrder(existing.id, Date.now(), CANCEL_REASON_TIMEOUT);
          return { ...rpcError(id, PAYME_ERRORS.CANT_PERFORM, "timeout"), ...tag };
        }
        return {
          ...rpcResult(id, { create_time: existing.createTime, transaction: existing.id, state: 1 }),
          ...tag,
        };
      }

      // Yangi tranzaksiya: avval CheckPerformTransaction tekshiruvlari.
      const order = await findOrder(orderIdFrom(params));
      const tag = { orderId: order?.id, txn };
      const refused = payable(id, order, params.amount);
      if (refused) return { ...refused, ...tag };
      // `time` 12 soatdan eski — bunday tranzaksiya ochilmaydi.
      if (Date.now() - time >= PAYME_TIMEOUT_MS) return { ...rpcError(id, PAYME_ERRORS.CANT_PERFORM, "timeout"), ...tag };

      // Poyga: shu orada boshqa tranzaksiya biriktirilgan bo'lsa — band.
      const attached = await attachTransaction(order!.id, txn, time);
      if (!attached) return { ...rpcError(id, PAYME_ERRORS.BUSY, ACCOUNT_FIELD), ...tag };
      return { ...rpcResult(id, { create_time: time, transaction: order!.id, state: 1 }), ...tag };
    }

    case "PerformTransaction": {
      const order = await findOrderByTxn("payme", txn);
      if (!order) return { ...rpcError(id, PAYME_ERRORS.TXN), txn };
      const tag = { orderId: order.id, txn };

      // Holat qarori `settleOrder` ichida, qulf ostida: 2 → mavjud natija
      // (idempotent), -1 → -31008, 12 soat o'tgan 1 → reason 4 + -31008.
      const now = Date.now();
      const done = await settleOrder(order.id, now, { expiresBefore: now - PAYME_TIMEOUT_MS });
      if (done.status === "paid" || done.status === "already_paid") {
        return {
          ...rpcResult(id, { transaction: done.order.id, perform_time: done.order.performTime, state: 2 }),
          ...tag,
        };
      }
      if (done.status === "not_found") return { ...rpcError(id, PAYME_ERRORS.TXN), ...tag };
      return { ...rpcError(id, PAYME_ERRORS.CANT_PERFORM, done.status === "expired" ? "timeout" : undefined), ...tag };
    }

    case "CancelTransaction": {
      const order = await findOrderByTxn("payme", txn);
      if (!order) return { ...rpcError(id, PAYME_ERRORS.TXN), txn };
      const tag = { orderId: order.id, txn };

      // To'langan buyurtmani bekor qilish — xizmat allaqachon ko'rsatilgan
      // (kredit berilgan), shuning uchun -31007. Takroriy bekor qilish
      // birinchi `cancel_time` va sababni qaytaradi.
      const out = await cancelOrder(order.id, Date.now(), Number(params.reason ?? 0) || null);
      if (out.status === "paid") return { ...rpcError(id, PAYME_ERRORS.CANT_CANCEL), ...tag };
      if (out.status === "not_found") return { ...rpcError(id, PAYME_ERRORS.TXN), ...tag };
      return {
        ...rpcResult(id, { transaction: out.order.id, cancel_time: out.order.cancelTime, state: -1 }),
        ...tag,
      };
    }

    case "CheckTransaction": {
      const order = await findOrderByTxn("payme", txn);
      if (!order) return { ...rpcError(id, PAYME_ERRORS.TXN), txn };
      return {
        ...rpcResult(id, {
          create_time: order.createTime,
          perform_time: order.state === "paid" ? order.performTime : 0,
          cancel_time: order.cancelTime,
          transaction: order.id,
          state: paymeState(order),
          reason: order.cancelReason,
        }),
        orderId: order.id,
        txn,
      };
    }

    case "GetStatement": {
      const from = Number(params.from ?? 0);
      const to = Number(params.to ?? Date.now());
      const rows = await query<{
        id: string;
        provider_txn: string | null;
        amount_soum: string;
        create_time: string;
        perform_time: string;
        cancel_time: string;
        cancel_reason: number | null;
        state: string;
      }>(
        // Sverka oynasi tranzaksiya **yaratilgan** vaqt bo'yicha —
        // Payme spetsifikatsiyasi shuni talab qiladi.
        `SELECT id, provider_txn, amount_soum, create_time, perform_time,
                cancel_time, cancel_reason, state
           FROM payment_orders
          WHERE provider = 'payme'
            AND provider_txn IS NOT NULL
            AND create_time BETWEEN $1 AND $2
          ORDER BY create_time`,
        [from, to],
      );
      return rpcResult(id, {
        transactions: rows.map((r) => ({
          id: r.provider_txn,
          time: Number(r.create_time),
          amount: tiyin(Number(r.amount_soum)),
          account: { order_id: r.id },
          transaction: r.id,
          state: paymeState(r),
          reason: r.cancel_reason,
          create_time: Number(r.create_time),
          perform_time: r.state === "paid" ? Number(r.perform_time) : 0,
          cancel_time: Number(r.cancel_time),
        })),
      });
    }

    default:
      return rpcError(id, PAYME_ERRORS.METHOD);
  }
}

/** Tanani chegara bilan o'qiydi; `null` — o'qib/tahlil qilib bo'lmadi. */
async function readRpc(req: Request): Promise<RpcRequest | null> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RpcRequest) : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // Tana autentifikatsiyadan OLDIN (chegara bilan) o'qiladi: JSON-RPC 2.0
  // bo'yicha javob — xato bo'lsa ham — so'rov `id` sini qaytarishi kerak.
  const body = await readRpc(req);
  const id = body?.id ?? null;

  // Sinov kaliti faqat `PAYME_SANDBOX=true` da (C11) — prod'da test to'lovi balansga tushmaydi.
  const keys = acceptedPaymeKeys(env.payme);
  if (!env.payme.merchantId || !keys.length) {
    return NextResponse.json(rpcError(id, PAYME_ERRORS.AUTH, "Payme sozlanmagan").body);
  }
  if (!paymeAuthorized(req.headers.get("authorization"), keys)) {
    return NextResponse.json(rpcError(id, PAYME_ERRORS.AUTH).body);
  }
  if (!body) return NextResponse.json(rpcError(null, PAYME_ERRORS.PARSE).body);

  await ensureMigrated();

  let out: Outcome;
  try {
    out = await dispatch(body);
  } catch (e) {
    console.error("[payme]", e instanceof Error ? e.message : e);
    out = rpcError(id, PAYME_ERRORS.CANT_PERFORM);
  }

  // Audit izi (OBS-09): autentifikatsiyadan o'tgan har so'rov, javob kodi bilan.
  await recordPaymentEvent({
    provider: "payme",
    method: typeof body.method === "string" ? body.method : "?",
    orderId: out.orderId ?? (orderIdFrom((body.params ?? {}) as Record<string, unknown>) || null),
    providerTxn: out.txn ?? null,
    payload: body,
    responseCode: out.code,
  });
  return NextResponse.json(out.body);
}
