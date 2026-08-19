import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ensureMigrated } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { safeEqual } from "@/lib/server/session";
import {
  attachTransaction,
  cancelOrder,
  findOrder,
  findOrderByTxn,
  settleOrder,
} from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Payme Merchant API (JSON-RPC).
 *
 * Payme har chaqiruvni takrorlashi mumkin, shuning uchun har metod
 * idempotent: `PerformTransaction` ikkinchi marta kelsa pul qayta
 * qo'shilmaydi, faqat mavjud holat qaytariladi.
 *
 * Summalar Payme tomonda **tiyin** da (1 so'm = 100 tiyin).
 */

const PAYME_ERRORS = {
  AUTH: { code: -32504, message: "Ruxsat yo'q" },
  METHOD: { code: -32601, message: "Metod topilmadi" },
  PARSE: { code: -32700, message: "JSON o'qilmadi" },
  AMOUNT: { code: -31001, message: "Noto'g'ri summa" },
  ORDER: { code: -31050, message: "Buyurtma topilmadi" },
  TXN: { code: -31003, message: "Tranzaksiya topilmadi" },
  CANT_PERFORM: { code: -31008, message: "Amalni bajarib bo'lmadi" },
  CANT_CANCEL: { code: -31007, message: "Bekor qilib bo'lmaydi" },
} as const;

type RpcRequest = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
};

function rpcError(id: unknown, err: { code: number; message: string }, data?: unknown) {
  return NextResponse.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: err.code, message: { uz: err.message, ru: err.message, en: err.message }, data },
  });
}

function rpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

/**
 * `Authorization: Basic base64("Paycom:KEY")`.
 * Test va prod kalitlari alohida — ikkalasi ham qabul qilinadi.
 */
function authorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme?.toLowerCase() !== "basic" || !encoded) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const login = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  if (login !== "Paycom") return false;

  // Doimiy vaqtli taqqoslash — kalitni bayt-bayt topib bo'lmasin.
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const candidates = [env.payme.key, env.payme.testKey].filter(Boolean);
  return candidates.some((k) => safeEqual(hash(k), hash(password)));
}

function orderIdFrom(params: Record<string, unknown>): string {
  const account = (params.account ?? {}) as Record<string, unknown>;
  return String(account.order_id ?? account.order ?? "").trim();
}

function tiyin(soum: number): number {
  return soum * 100;
}

/** Payme kutgan tranzaksiya holati: 1 = kutilmoqda, 2 = to'langan, manfiy = bekor. */
function paymeState(order: { state: string; cancelReason: number | null }): number {
  if (order.state === "paid") return 2;
  if (order.state === "cancelled") return -1;
  return 1;
}

export async function POST(req: Request) {
  if (!env.payme.merchantId || (!env.payme.key && !env.payme.testKey)) {
    return rpcError(null, PAYME_ERRORS.AUTH, "Payme sozlanmagan");
  }
  if (!authorized(req)) return rpcError(null, PAYME_ERRORS.AUTH);

  await ensureMigrated();

  let body: RpcRequest;
  try {
    body = (await req.json()) as RpcRequest;
  } catch {
    return rpcError(null, PAYME_ERRORS.PARSE);
  }

  const id = body.id;
  const params = (body.params ?? {}) as Record<string, unknown>;

  try {
    switch (body.method) {
      case "CheckPerformTransaction": {
        const order = await findOrder(orderIdFrom(params));
        if (!order) return rpcError(id, PAYME_ERRORS.ORDER);
        if (order.state === "paid") return rpcError(id, PAYME_ERRORS.CANT_PERFORM, "Allaqachon to'langan");
        if (Number(params.amount) !== tiyin(order.amountSoum)) {
          return rpcError(id, PAYME_ERRORS.AMOUNT);
        }
        return rpcResult(id, { allow: true });
      }

      case "CreateTransaction": {
        const txn = String(params.id ?? "");
        const time = Number(params.time ?? Date.now());

        // Takroriy chaqiruv — mavjud tranzaksiyani qaytaramiz.
        const existing = await findOrderByTxn("payme", txn);
        if (existing) {
          if (existing.state === "cancelled") return rpcError(id, PAYME_ERRORS.CANT_PERFORM);
          return rpcResult(id, {
            create_time: existing.createTime,
            transaction: existing.id,
            state: paymeState(existing),
          });
        }

        const order = await findOrder(orderIdFrom(params));
        if (!order) return rpcError(id, PAYME_ERRORS.ORDER);
        if (Number(params.amount) !== tiyin(order.amountSoum)) {
          return rpcError(id, PAYME_ERRORS.AMOUNT);
        }
        if (order.state !== "created") return rpcError(id, PAYME_ERRORS.CANT_PERFORM);

        const attached = await attachTransaction(order.id, txn, time);
        if (!attached) return rpcError(id, PAYME_ERRORS.CANT_PERFORM);

        return rpcResult(id, { create_time: time, transaction: order.id, state: 1 });
      }

      case "PerformTransaction": {
        const txn = String(params.id ?? "");
        const order = await findOrderByTxn("payme", txn);
        if (!order) return rpcError(id, PAYME_ERRORS.TXN);
        if (order.state === "cancelled") return rpcError(id, PAYME_ERRORS.CANT_PERFORM);

        // Idempotent: ikkinchi chaqiruvda `settleOrder` kredit qo'shmaydi.
        const performTime = order.state === "paid" ? order.performTime : Date.now();
        const done = await settleOrder(order.id, performTime);
        if (!done.ok || !done.order) return rpcError(id, PAYME_ERRORS.CANT_PERFORM);

        return rpcResult(id, {
          transaction: done.order.id,
          perform_time: done.order.performTime,
          state: 2,
        });
      }

      case "CancelTransaction": {
        const txn = String(params.id ?? "");
        const order = await findOrderByTxn("payme", txn);
        if (!order) return rpcError(id, PAYME_ERRORS.TXN);

        // To'langan buyurtmani bekor qilish — bu yerda xizmat allaqachon
        // ko'rsatilgan (kredit berilgan), shuning uchun rad etamiz.
        if (order.state === "paid") return rpcError(id, PAYME_ERRORS.CANT_CANCEL);

        const cancelTime = order.cancelTime || Date.now();
        const cancelled = await cancelOrder(order.id, cancelTime, Number(params.reason ?? 0) || null);
        return rpcResult(id, {
          transaction: order.id,
          cancel_time: cancelled?.cancelTime ?? cancelTime,
          state: -1,
        });
      }

      case "CheckTransaction": {
        const txn = String(params.id ?? "");
        const order = await findOrderByTxn("payme", txn);
        if (!order) return rpcError(id, PAYME_ERRORS.TXN);
        return rpcResult(id, {
          create_time: order.createTime,
          perform_time: order.state === "paid" ? order.performTime : 0,
          cancel_time: order.cancelTime,
          transaction: order.id,
          state: paymeState(order),
          reason: order.cancelReason,
        });
      }

      case "GetStatement": {
        const { query } = await import("@/lib/server/db");
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
            state: r.state === "paid" ? 2 : r.state === "cancelled" ? -1 : 1,
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
  } catch (e) {
    console.error("[payme]", e instanceof Error ? e.message : e);
    return rpcError(id, PAYME_ERRORS.CANT_PERFORM);
  }
}
