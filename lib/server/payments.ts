import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "./db";
import { safeEqual } from "./session";
import { activateProInTx, topUpInTx } from "./credits";
import { log } from "./log";

/**
 * To'lov buyurtmalari va ularni kreditga aylantirish.
 *
 * Idempotentlik bu yerda hayotiy: Click ham, Payme ham webhook ni
 * takrorlaydi. Har provayder tranzaksiyasi `transactions.reference`
 * bo'yicha unikal — ikkinchi chaqiruv pul qo'shmaydi.
 */

/**
 * ─────────────────────── Webhook autentifikatsiyasi ───────────────────────
 *
 * Imzo tekshiruvi ilgari route fayllari ichida yopiq funksiya edi va
 * `tests/payments.test.mts` uni CHAQIRA olmasdi — test formulani o'zi
 * qayta yozib, o'zi bilan solishtirardi (N-10). Ya'ni route dagi formula
 * o'zgarsa test yashil qolaverardi, holbuki bu aynan «har kim to'ladim
 * deb webhook yuborib, o'ziga bepul kredit yozdiradi» xavfi bo'lgan joy.
 *
 * Sir ARGUMENT sifatida uzatiladi, `env` dan o'qilmaydi: shunda
 * funksiya sof bo'ladi (modul yuklanish tartibiga bog'liq emas) va
 * bog'liqligi chaqiruv joyida ko'rinadi.
 */

export type ClickSignedParams = {
  click_trans_id?: string;
  service_id?: string;
  merchant_trans_id?: string;
  merchant_prepare_id?: string;
  amount?: string;
  action?: string;
  sign_time?: string;
  sign_string?: string;
};

/**
 * Click imzosi:
 *   md5(click_trans_id + service_id + SECRET + merchant_trans_id +
 *       [merchant_prepare_id] + amount + action + sign_time)
 *
 * `merchant_prepare_id` FAQAT Complete (`action=1`) da qatnashadi — uni
 * Prepare da ham qo'shish yoki Complete da tushirib qoldirish imzoni
 * buzadi, ya'ni haqiqiy to'lov rad etiladi.
 *
 * MD5 kriptografik jihatdan kuchsiz, lekin protokol shuni talab qiladi;
 * shu sababli route qo'shimcha ravishda `service_id`, summa va buyurtma
 * holatini ham tekshiradi.
 */
export function clickSignatureValid(p: ClickSignedParams, secretKey: string): boolean {
  if (!secretKey) return false;
  const parts = [
    p.click_trans_id ?? "",
    p.service_id ?? "",
    secretKey,
    p.merchant_trans_id ?? "",
    ...(p.action === "1" ? [p.merchant_prepare_id ?? ""] : []),
    p.amount ?? "",
    p.action ?? "",
    p.sign_time ?? "",
  ];
  const expected = createHash("md5").update(parts.join("")).digest("hex");
  return safeEqual(expected, String(p.sign_string ?? "").toLowerCase());
}

/** Qabul qilinadigan kalitlar — `payme-keys.ts` (env.ts bilan umumiy). */
export { acceptedPaymeKeys } from "./payme-keys";

/**
 * Payme: `Authorization: Basic base64("Paycom:KEY")`.
 *
 * Qabul qilinadigan kalitlar ro'yxati `acceptedPaymeKeys` dan keladi.
 * Taqqoslash doimiy vaqtda (SHA-256 dan keyin), shunda kalitni
 * bayt-bayt topib bo'lmaydi.
 */
export function paymeAuthorized(header: string | null | undefined, keys: readonly string[]): boolean {
  const valid = keys.filter(Boolean);
  if (!valid.length) return false;

  const [scheme, encoded] = String(header ?? "").split(" ");
  if (scheme?.toLowerCase() !== "basic" || !encoded) return false;
  /*
   * Base64 shakli QAT'IY tekshiriladi.
   *
   * Node ning dekoderi noto'g'ri belgilarni JIM tashlab yuboradi:
   * `Basic !!!<base64>` ham muvaffaqiyatli dekodlanadi. Kalit baribir
   * to'g'ri bo'lishi shart, shuning uchun bu teshik emas — lekin
   * «shakli buzuq» va «rad etildi» bir xil bo'lishi kerak, aks holda
   * sarlavha tahlili haqidagi tasavvur kod bilan mos kelmaydi.
   */
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  if (decoded.slice(0, sep) !== "Paycom") return false;
  const password = decoded.slice(sep + 1);

  const hash = (x: string) => createHash("sha256").update(x).digest("hex");
  return valid.some((k) => safeEqual(hash(k), hash(password)));
}

/** Pro tarifi. Narx o'zgarsa faqat shu yer tahrirlanadi. */
export const PRO_PLAN = {
  priceSoum: 15_000,
  days: 30,
  quota: 15_000,
} as const;

/** Balans to'ldirishda 1 so'm = 1 tanga. */
export const SOUM_PER_COIN = 1;

export const MIN_TOPUP_SOUM = 5_000;
export const MAX_TOPUP_SOUM = 10_000_000;

export type Provider = "click" | "payme";
export type Purpose = "topup" | "pro";
export type OrderState = "created" | "pending" | "paid" | "cancelled";

export type PaymentOrder = {
  id: string;
  userId: string;
  provider: Provider;
  purpose: Purpose;
  amountSoum: number;
  state: OrderState;
  providerTxn: string | null;
  /** Provayder tranzaksiyasi yaratilgan vaqt (ms). */
  createTime: number;
  /** To'lov bajarilgan vaqt (ms). To'lanmagan bo'lsa 0. */
  performTime: number;
  cancelTime: number;
  cancelReason: number | null;
  /** Click `merchant_prepare_id` — u butun son kutadi. */
  prepareId: number | null;
  createdAt: string;
};

type OrderRow = {
  id: string;
  user_id: string;
  provider: Provider;
  purpose: Purpose;
  amount_soum: string;
  state: OrderState;
  provider_txn: string | null;
  create_time: string;
  perform_time: string;
  cancel_time: string;
  cancel_reason: number | null;
  prepare_id: string | null;
  created_at: Date;
};

function toOrder(r: OrderRow): PaymentOrder {
  return {
    id: r.id,
    userId: String(r.user_id),
    provider: r.provider,
    purpose: r.purpose,
    amountSoum: Number(r.amount_soum),
    state: r.state,
    providerTxn: r.provider_txn,
    createTime: Number(r.create_time),
    performTime: Number(r.perform_time),
    cancelTime: Number(r.cancel_time),
    cancelReason: r.cancel_reason,
    prepareId: r.prepare_id === null ? null : Number(r.prepare_id),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const COLS = `id, user_id, provider, purpose, amount_soum, state, provider_txn,
              create_time, perform_time, cancel_time, cancel_reason, prepare_id, created_at`;

export async function createOrder(input: {
  userId: string;
  provider: Provider;
  purpose: Purpose;
  amountSoum: number;
}): Promise<PaymentOrder> {
  const amount = input.purpose === "pro" ? PRO_PLAN.priceSoum : Math.round(input.amountSoum);
  if (amount < MIN_TOPUP_SOUM || amount > MAX_TOPUP_SOUM) {
    throw new Error(
      `Summa ${MIN_TOPUP_SOUM.toLocaleString("uz-UZ")} — ${MAX_TOPUP_SOUM.toLocaleString("uz-UZ")} so'm oralig'ida bo'lishi kerak`,
    );
  }
  const row = await queryOne<OrderRow>(
    `INSERT INTO payment_orders (id, user_id, provider, purpose, amount_soum)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLS}`,
    [randomUUID(), input.userId, input.provider, input.purpose, amount],
  );
  const order = toOrder(row!);
  log("info", "[payments] buyurtma yaratildi", {
    orderId: order.id,
    userId: order.userId,
    provider: order.provider,
    purpose: order.purpose,
    amountSoum: order.amountSoum,
  });
  return order;
}

export async function findOrder(id: string): Promise<PaymentOrder | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await queryOne<OrderRow>(`SELECT ${COLS} FROM payment_orders WHERE id = $1`, [id]);
  return row ? toOrder(row) : null;
}

export async function findOrderByTxn(provider: Provider, txn: string): Promise<PaymentOrder | null> {
  const row = await queryOne<OrderRow>(
    `SELECT ${COLS} FROM payment_orders WHERE provider = $1 AND provider_txn = $2`,
    [provider, txn],
  );
  return row ? toOrder(row) : null;
}

export async function listOrders(userId: string, limit = 20): Promise<PaymentOrder[]> {
  const rows = await query<OrderRow>(
    `SELECT ${COLS} FROM payment_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(limit, 100)],
  );
  return rows.map(toOrder);
}

/**
 * Buyurtmani provayder tranzaksiyasiga bog'laydi
 * (Payme `CreateTransaction`, Click `Prepare`).
 *
 * `create_time` **alohida** ustunga yoziladi: ilgari u `perform_time` ga
 * tushardi va to'lov bajarilgach «yaratilgan vaqt» ham o'zgarib ketardi.
 */
export async function attachTransaction(
  orderId: string,
  txn: string,
  createTime: number,
): Promise<boolean> {
  return transaction(async (client) => {
    const cur = await client.query<OrderRow>(
      `SELECT ${COLS} FROM payment_orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = cur.rows[0];
    if (!order) return false;
    // Boshqa tranzaksiya allaqachon biriktirilgan — bu buyurtma band.
    if (order.provider_txn && order.provider_txn !== txn) return false;
    if (order.state === "paid" || order.state === "cancelled") return order.provider_txn === txn;

    await client.query(
      `UPDATE payment_orders
          SET provider_txn = $2,
              state = 'pending',
              create_time = $3,
              prepare_id = COALESCE(prepare_id, nextval('payment_prepare_seq')),
              updated_at = now()
        WHERE id = $1`,
      [orderId, txn, createTime],
    );
    return true;
  });
}

/** Click `merchant_prepare_id` bo'yicha buyurtma. */
export async function findOrderByPrepareId(prepareId: number): Promise<PaymentOrder | null> {
  if (!Number.isSafeInteger(prepareId)) return null;
  const row = await queryOne<OrderRow>(`SELECT ${COLS} FROM payment_orders WHERE prepare_id = $1`, [
    prepareId,
  ]);
  return row ? toOrder(row) : null;
}

/**
 * Payme tranzaksiyasining umri — 12 soat (43 200 000 ms).
 *
 * Payme Merchant API, «CreateTransaction» / «PerformTransaction»: holati
 * `1` bo'lgan tranzaksiya yaratilganidan 12 soat o'tib kelgan Create
 * (takror) yoki Perform uni `reason = 4` (timeout) bilan bekor qilishi va
 * -31008 qaytarishi shart; `time` i 12 soatdan eski yangi Create esa
 * umuman ochilmaydi (BEA-05).
 */
export const PAYME_TIMEOUT_MS = 43_200_000;

/** Payme bekor qilish sababi: tranzaksiya muddati o'tdi. */
export const CANCEL_REASON_TIMEOUT = 4;

export type SettleOutcome =
  /** Hozir to'landi — kredit shu chaqiruvda yozildi. */
  | { status: "paid"; order: PaymentOrder }
  /** Allaqachon to'langan — takroriy yetkazish, hech narsa o'zgarmadi. */
  | { status: "already_paid"; order: PaymentOrder }
  /** Bekor qilingan buyurtma — kredit YOZILMADI. */
  | { status: "cancelled"; order: PaymentOrder }
  /** Muddati o'tgan (Payme) — shu chaqiruvda `reason = 4` bilan bekor qilindi. */
  | { status: "expired"; order: PaymentOrder }
  | { status: "not_found"; order: null };

export type CancelOutcome =
  | { status: "cancelled"; order: PaymentOrder }
  /** Takroriy bekor qilish — birinchi `cancel_time`/sabab saqlanadi. */
  | { status: "already_cancelled"; order: PaymentOrder }
  /** To'langan buyurtma — xizmat ko'rsatilgan, bekor qilinmaydi. */
  | { status: "paid"; order: PaymentOrder }
  | { status: "not_found"; order: null };

/**
 * Buyurtma qatorini tranzaksiya oxirigacha qulflaydi.
 *
 * Holat o'zgarishi (to'lash / bekor qilish / muddati o'tish) FAQAT shu
 * qulf ostida qaror qilinadi. Ilgari `settleOrder` qatorni qulfsiz o'qib,
 * kreditni alohida tranzaksiyada yozar, `paid` ni esa uchinchi so'rovda
 * qo'yardi; `cancelOrder` esa holatga qaramay `cancelled` yozardi. Payme
 * `CancelTransaction` `PerformTransaction` bilan ustma-ust kelsa,
 * bekor qilingan buyurtmada kredit qolardi (CONC-02, DB-09).
 *
 * Qulf tartibi: avval `payment_orders`, keyin `users` — boshqa hech bir
 * yo'l bu ikkisini teskari tartibda olmaydi (deadlock yo'q).
 */
async function lockOrder(client: PoolClient, orderId: string): Promise<OrderRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  const res = await client.query<OrderRow>(`SELECT ${COLS} FROM payment_orders WHERE id = $1 FOR UPDATE`, [orderId]);
  return res.rows[0] ?? null;
}

async function reread(client: PoolClient, orderId: string): Promise<PaymentOrder> {
  const res = await client.query<OrderRow>(`SELECT ${COLS} FROM payment_orders WHERE id = $1`, [orderId]);
  return toOrder(res.rows[0]);
}

/**
 * To'lovni yakunlaydi: kreditni qo'shadi va buyurtmani `paid` qiladi —
 * BITTA tranzaksiyada, buyurtma qatori qulflangan holda.
 *
 * `reference` provayder tranzaksiya id sidan quriladi, shuning uchun
 * takroriy webhook ikkinchi marta pul qo'shmaydi; PARALLEL takror esa
 * qulfda kutadi va `already_paid` oladi (xato emas).
 *
 * `expiresBefore` (faqat Payme): holati `pending` va `create_time` shu
 * vaqtdan eski bo'lsa — to'lanmaydi, `reason = 4` bilan bekor qilinadi.
 */
export async function settleOrder(
  orderId: string,
  performTime: number,
  opts: { expiresBefore?: number } = {},
): Promise<SettleOutcome> {
  let credited = false;
  const out = await transaction(async (client): Promise<SettleOutcome> => {
    credited = false;
    const row = await lockOrder(client, orderId);
    if (!row) return { status: "not_found", order: null };
    const order = toOrder(row);
    if (order.state === "cancelled") return { status: "cancelled", order };
    if (order.state === "paid") return { status: "already_paid", order };

    if (
      opts.expiresBefore !== undefined &&
      order.state === "pending" &&
      order.createTime > 0 &&
      order.createTime < opts.expiresBefore
    ) {
      await client.query(
        `UPDATE payment_orders
            SET state = 'cancelled', cancel_time = $2, cancel_reason = $3, updated_at = now()
          WHERE id = $1`,
        [orderId, performTime, CANCEL_REASON_TIMEOUT],
      );
      return { status: "expired", order: await reread(client, orderId) };
    }

    /*
     * Kredit `credits.ts` ning tranzaksiya ichidagi yo'llari bilan — buyurtma
     * qulfi va `paid` holati bilan BITTA atomar qadam (W3 wrap-up: ilgari bu
     * yerda `creditInTx` nusxasi bor edi). Idempotentlik `reference` bo'yicha,
     * foydalanuvchi qulfi tekshiruvdan oldin (`topUpInTx` izohi).
     */
    const reference = `${order.provider}:${order.providerTxn ?? order.id}`;
    if (order.purpose === "pro") {
      // Kvota va tarif BIR tranzaksiyada: ilgari (`activatePro`) ular alohida
      // yozilardi va orada yiqilish «kvota bor, plan free» holatini qoldirardi.
      credited = await activateProInTx(client, order.userId, PRO_PLAN.quota, PRO_PLAN.days, reference);
    } else {
      credited = await topUpInTx(
        client,
        order.userId,
        { balance: Math.floor(order.amountSoum / SOUM_PER_COIN) },
        reference,
        "topup",
        `${order.provider} orqali to'ldirish`,
      );
    }

    await client.query(
      `UPDATE payment_orders
          SET state = 'paid',
              perform_time = $2,
              -- Yaratilish vaqti noma'lum bo'lsa (Click Prepare siz
              -- to'g'ridan-to'g'ri Complete yuborgan holat), to'lov
              -- vaqtini qo'yamiz — nol qolishidan yaxshiroq.
              create_time = CASE WHEN create_time = 0 THEN $2 ELSE create_time END,
              updated_at = now()
        WHERE id = $1`,
      [orderId, performTime],
    );
    return { status: "paid", order: await reread(client, orderId) };
  });
  // COMMIT dan KEYIN — rollback bo'lgan urinish «to'landi» deb yozilmasin.
  logOrder("settle", out, { credited });
  return out;
}

/**
 * To'lov holati o'zgarishi izi (OBS-02): buyurtma, provayder, foydalanuvchi,
 * summa va natija bitta qatorda. `reqId` — route kontekstidan (agar bo'lsa).
 */
function logOrder(
  action: "settle" | "cancel",
  out: { status: string; order: PaymentOrder | null },
  extra: Record<string, unknown> = {},
): void {
  const o = out.order;
  log(out.status === "not_found" ? "warn" : "info", `[payments] ${action}: ${out.status}`, {
    orderId: o?.id,
    userId: o?.userId,
    provider: o?.provider,
    purpose: o?.purpose,
    amountSoum: o?.amountSoum,
    providerTxn: o?.providerTxn,
    state: o?.state,
    ...extra,
  });
}

/**
 * Buyurtmani bekor qiladi — faqat hali to'lanmagan bo'lsa, qulf ostida.
 *
 * To'langan buyurtma bekor qilinmaydi (`paid` qaytadi — route uni
 * Payme -31007 / Click -4 ga aylantiradi): kredit allaqachon berilgan.
 * Takroriy bekor qilish birinchi `cancel_time` va sababni saqlaydi.
 */
export async function cancelOrder(orderId: string, cancelTime: number, reason: number | null): Promise<CancelOutcome> {
  const out = await transaction(async (client): Promise<CancelOutcome> => {
    const row = await lockOrder(client, orderId);
    if (!row) return { status: "not_found", order: null };
    const order = toOrder(row);
    if (order.state === "paid") return { status: "paid", order };
    if (order.state === "cancelled") return { status: "already_cancelled", order };

    await client.query(
      `UPDATE payment_orders
          SET state = 'cancelled', cancel_time = $2, cancel_reason = $3, updated_at = now()
        WHERE id = $1 AND state IN ('created', 'pending')`,
      [orderId, cancelTime, reason],
    );
    return { status: "cancelled", order: await reread(client, orderId) };
  });
  logOrder("cancel", out, { reason });
  return out;
}
