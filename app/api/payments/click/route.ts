import { NextResponse } from "next/server";
import { requestIdOf } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { log, withLogContext } from "@/lib/server/log";
import { recordPaymentEvent } from "@/lib/server/payment-events";
import {
  attachTransaction,
  cancelOrder,
  clickSignatureValid,
  findOrder,
  settleOrder,
} from "@/lib/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Click Merchant API — `Prepare` (action=0) va `Complete` (action=1).
 *
 * Ikkalasi ham bitta URL ga `application/x-www-form-urlencoded` bilan keladi.
 * Imzo MD5 bo'lgani uchun kriptografik jihatdan kuchsiz, lekin protokol
 * shuni talab qiladi — shuning uchun qo'shimcha ravishda summa, buyurtma
 * holati, provayder va service_id ham tekshiriladi.
 *
 * Holat o'zgarishlari (`settleOrder` / `cancelOrder`) buyurtma qatori
 * qulfi ostida, kredit bilan bitta tranzaksiyada (CONC-02, DB-09).
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

type Reply = { body: Record<string, unknown>; error: number };

function reply(params: Partial<ClickParams>, error: number, note: string, extra: Record<string, unknown> = {}): Reply {
  return {
    body: {
      click_trans_id: Number(params.click_trans_id ?? 0),
      merchant_trans_id: params.merchant_trans_id ?? "",
      error,
      error_note: note,
      ...extra,
    },
    error,
  };
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

/** Imzo tekshiruvidan o'tgan so'rovning biznes mantig'i. */
async function handle(p: ClickParams): Promise<Reply> {
  const order = await findOrder(p.merchant_trans_id);
  // Payme uchun yaratilgan buyurtma Click orqali to'lanmaydi (BEA-05 #6):
  // aks holda u Payme sverkasiga Click tranzaksiyasi bilan tushardi.
  if (!order || order.provider !== "click") return reply(p, CLICK_ERROR.NO_USER, "Buyurtma topilmadi");

  // Click summani so'mda, kasrli yuboradi.
  const amount = Math.round(Number(p.amount));
  if (!Number.isFinite(amount) || amount !== order.amountSoum) {
    return reply(p, CLICK_ERROR.AMOUNT, "Summa mos emas");
  }
  if (order.state === "cancelled") return reply(p, CLICK_ERROR.CANCELLED, "Bekor qilingan");

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
      // Click tomonda xato — bekor qilamiz, lekin TO'LANGAN buyurtmani emas:
      // ilgari bu yo'l `paid` ni ham `cancelled` ga o'zgartirardi, kredit esa
      // qolardi (DB-09). To'langan bo'lsa — «Already paid».
      const out = await cancelOrder(order.id, Date.now(), Number(p.error));
      if (out.status === "paid") return reply(p, CLICK_ERROR.ALREADY_PAID, "Allaqachon to'langan");
      return reply(p, CLICK_ERROR.CANCELLED, "Click tomonda bekor qilindi");
    }
    // Takroriy Complete — `settleOrder` idempotent (qulf ostida), pul ikki
    // marta qo'shilmaydi va parallel takror ham xato emas, muvaffaqiyat oladi.
    const done = await settleOrder(order.id, order.performTime || Date.now());
    if (done.status === "cancelled" || done.status === "expired") {
      return reply(p, CLICK_ERROR.CANCELLED, "Bekor qilingan");
    }
    if (done.status === "not_found") return reply(p, CLICK_ERROR.NO_USER, "Buyurtma topilmadi");
    return reply(p, CLICK_ERROR.OK, "Success", {
      merchant_confirm_id: order.prepareId,
      merchant_prepare_id: order.prepareId,
    });
  }

  return reply(p, CLICK_ERROR.ACTION, "Action topilmadi");
}

/**
 * Webhook `handler()` bilan o'ralmagan (Click javobi har doim 200 + o'z
 * xato kodi), shuning uchun so'rov id si shu yerda beriladi (OBS-02):
 * `settleOrder`/`cancelOrder` jurnal qatorlari ham shu `reqId` ni oladi.
 */
export async function POST(req: Request) {
  const reqId = requestIdOf(req);
  const res = await withLogContext({ reqId }, () => handleClick(req));
  res.headers.set("x-request-id", reqId);
  return res;
}

async function handleClick(req: Request): Promise<NextResponse> {
  if (!env.click.serviceId || !env.click.secretKey) {
    return NextResponse.json(reply({}, CLICK_ERROR.BAD_REQUEST, "Click sozlanmagan").body);
  }
  await ensureMigrated();

  const p = await readParams(req);
  if (!p || !p.click_trans_id || !p.merchant_trans_id || !p.sign_string) {
    return NextResponse.json(reply(p ?? {}, CLICK_ERROR.BAD_REQUEST, "So'rov to'liq emas").body);
  }
  if (p.service_id !== env.click.serviceId) {
    return NextResponse.json(reply(p, CLICK_ERROR.SIGN, "service_id mos emas").body);
  }
  if (!clickSignatureValid(p, env.click.secretKey)) {
    return NextResponse.json(reply(p, CLICK_ERROR.SIGN, "SIGN CHECK FAILED").body);
  }

  let out: Reply;
  try {
    out = await handle(p);
  } catch (e) {
    log("error", "[click] webhook xatosi", {
      orderId: String(p.merchant_trans_id ?? ""),
      providerTxn: String(p.click_trans_id ?? ""),
      action: String(p.action ?? ""),
      provider: "click",
      err: e,
    });
    out = reply(p, CLICK_ERROR.UPDATE_FAILED, "Ichki xatolik");
  }

  // Audit izi (OBS-09): imzodan o'tgan har so'rov, javob kodi bilan.
  // `sign_string` yozishdan oldin tozalanadi (`redactPayload`).
  await recordPaymentEvent({
    provider: "click",
    method: p.action === "0" ? "prepare" : p.action === "1" ? "complete" : `action:${String(p.action ?? "")}`,
    orderId: String(p.merchant_trans_id),
    providerTxn: String(p.click_trans_id),
    payload: p,
    responseCode: out.error,
  });
  return NextResponse.json(out.body);
}
