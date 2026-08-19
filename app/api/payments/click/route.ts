import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ensureMigrated } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { safeEqual } from "@/lib/server/session";
import { attachTransaction, cancelOrder, findOrder, settleOrder } from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Click Merchant API — `Prepare` (action=0) va `Complete` (action=1).
 *
 * Ikkalasi ham bitta URL ga `application/x-www-form-urlencoded` bilan keladi.
 * Imzo MD5 bo'lgani uchun kriptografik jihatdan kuchsiz, lekin protokol
 * shuni talab qiladi — shuning uchun qo'shimcha ravishda summa, buyurtma
 * holati va service_id ham tekshiriladi.
 */

const CLICK_ERROR = {
  OK: 0,
  SIGN: -1,
  AMOUNT: -2,
  ACTION: -3,
  ALREADY_PAID: -4,
  NO_USER: -5,
  NO_TXN: -6,
  UPDATE_FAILED: -7,
  BAD_REQUEST: -8,
  CANCELLED: -9,
} as const;

type ClickParams = {
  click_trans_id: string;
  service_id: string;
  merchant_trans_id: string;
  merchant_prepare_id?: string;
  amount: string;
  action: string;
  sign_time: string;
  sign_string: string;
  error?: string;
};

function reply(params: Partial<ClickParams>, error: number, note: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    click_trans_id: Number(params.click_trans_id ?? 0),
    merchant_trans_id: params.merchant_trans_id ?? "",
    error,
    error_note: note,
    ...extra,
  });
}

/**
 * sign_string = md5(click_trans_id + service_id + SECRET_KEY +
 *                   merchant_trans_id + [merchant_prepare_id] + amount +
 *                   action + sign_time)
 * `merchant_prepare_id` faqat Complete (action=1) da qatnashadi.
 */
function verifySignature(p: ClickParams): boolean {
  const parts = [
    p.click_trans_id,
    p.service_id,
    env.click.secretKey,
    p.merchant_trans_id,
    ...(p.action === "1" ? [p.merchant_prepare_id ?? ""] : []),
    p.amount,
    p.action,
    p.sign_time,
  ];
  const expected = createHash("md5").update(parts.join("")).digest("hex");
  return safeEqual(expected, (p.sign_string ?? "").toLowerCase());
}

async function readParams(req: Request): Promise<ClickParams | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      return (await req.json()) as ClickParams;
    }
    const form = await req.formData();
    const out: Record<string, string> = {};
    form.forEach((v, k) => {
      out[k] = String(v);
    });
    return out as unknown as ClickParams;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!env.click.serviceId || !env.click.secretKey) {
    return reply({}, CLICK_ERROR.BAD_REQUEST, "Click sozlanmagan");
  }
  await ensureMigrated();

  const p = await readParams(req);
  if (!p || !p.click_trans_id || !p.merchant_trans_id || !p.sign_string) {
    return reply(p ?? {}, CLICK_ERROR.BAD_REQUEST, "So'rov to'liq emas");
  }
  if (p.service_id !== env.click.serviceId) {
    return reply(p, CLICK_ERROR.SIGN, "service_id mos emas");
  }
  if (!verifySignature(p)) {
    return reply(p, CLICK_ERROR.SIGN, "SIGN CHECK FAILED");
  }

  const order = await findOrder(p.merchant_trans_id);
  if (!order) return reply(p, CLICK_ERROR.NO_USER, "Buyurtma topilmadi");

  // Click summani so'mda, kasrli yuboradi.
  const amount = Math.round(Number(p.amount));
  if (!Number.isFinite(amount) || amount !== order.amountSoum) {
    return reply(p, CLICK_ERROR.AMOUNT, "Summa mos emas");
  }
  if (order.state === "cancelled") return reply(p, CLICK_ERROR.CANCELLED, "Bekor qilingan");

  try {
    if (p.action === "0") {
      // Prepare — buyurtmani band qilamiz.
      if (order.state === "paid") return reply(p, CLICK_ERROR.ALREADY_PAID, "Allaqachon to'langan");
      const ok = await attachTransaction(order.id, String(p.click_trans_id), Date.now());
      if (!ok) return reply(p, CLICK_ERROR.UPDATE_FAILED, "Buyurtma band");

      // Click `merchant_prepare_id` sifatida butun son kutadi —
      // ilgari bu yerda UUID qaytarilardi.
      const prepared = await findOrder(order.id);
      if (!prepared?.prepareId) {
        return reply(p, CLICK_ERROR.UPDATE_FAILED, "prepare_id yaratilmadi");
      }
      return reply(p, CLICK_ERROR.OK, "Success", { merchant_prepare_id: prepared.prepareId });
    }

    if (p.action === "1") {
      // Complete — pulni hisobga qo'shamiz.
      const sentPrepare = Number(p.merchant_prepare_id ?? 0);
      if (p.merchant_prepare_id !== undefined && p.merchant_prepare_id !== "") {
        if (!Number.isFinite(sentPrepare) || sentPrepare !== order.prepareId) {
          return reply(p, CLICK_ERROR.NO_TXN, "prepare_id mos emas");
        }
      }
      // Click tranzaksiyasi shu buyurtmaga tegishli ekanini tekshiramiz.
      if (order.providerTxn && order.providerTxn !== String(p.click_trans_id)) {
        return reply(p, CLICK_ERROR.NO_TXN, "click_trans_id mos emas");
      }
      if (Number(p.error ?? 0) < 0) {
        await cancelOrder(order.id, Date.now(), Number(p.error));
        return reply(p, CLICK_ERROR.CANCELLED, "Click tomonda bekor qilindi");
      }
      // Takroriy Complete — `settleOrder` idempotent, pul ikki marta qo'shilmaydi.
      const done = await settleOrder(order.id, order.performTime || Date.now());
      if (!done.ok) return reply(p, CLICK_ERROR.UPDATE_FAILED, "Yakunlab bo'lmadi");
      return reply(p, CLICK_ERROR.OK, "Success", {
        merchant_confirm_id: order.prepareId,
        merchant_prepare_id: order.prepareId,
      });
    }

    return reply(p, CLICK_ERROR.ACTION, "Action topilmadi");
  } catch (e) {
    console.error("[click]", e instanceof Error ? e.message : e);
    return reply(p, CLICK_ERROR.UPDATE_FAILED, "Ichki xatolik");
  }
}
