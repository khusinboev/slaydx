"use client";

import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { formatTanga, priceFor } from "@/lib/tools";
import type { FormValues, ToolConfig } from "@/lib/types";
import { confirmAccepted, confirmClock } from "../overlays/useConfirmClick";

/**
 * Generatsiyani boshlaydi.
 *
 * Ilgari bu funksiya juda ko'p ish qilardi: balansdan pul yechardi,
 * progressni o'zi o'ylab topardi, javobni kutardi va faylni IndexedDB ga
 * yozardi. Endi u faqat navbatga qo'yadi — pul, progress va fayl serverda.
 *
 * Natijada:
 *   - brauzer yopilsa ham ish davom etadi va boshqa qurilmada ko'rinadi,
 *   - HTTP timeout muammosi yo'q (40 varaqli kurs ishi ham tugaydi),
 *   - balansni klientdan o'zgartirib bo'lmaydi.
 *
 * Price guard (docs/admin/02-plan.md §17.2): the request carries the price
 * the form shows as `expectedPrice`. Every form renders `priceFor(tool, values)`
 * for exactly the values it submits, so that is the number on the submit
 * button. If the server price differs, nothing is charged (409): the form
 * shows the new price under the button, and only the user's NEXT press of
 * the same button (the two-step pattern of `useConfirmClick`) retries, with
 * the price that was shown to them.
 */
export async function runGeneration(tool: ToolConfig, values: FormValues): Promise<string> {
  const store = useAppStore.getState();
  const intent = intentOf(tool, values);
  const pending = takePendingConfirm(intent);
  const expectedPrice = pending ?? priceFor(tool, values);

  let created: Awaited<ReturnType<typeof api.createGeneration>>;
  try {
    // The idempotency key is derived from the intent inside `createGeneration`.
    // After a 409 the old key is dropped (a 4xx is "rejected"), so the
    // confirmed retry is a new intent with a new key, as it must be.
    created = await api.createGeneration(tool.slug, values, { expectedPrice });
  } catch (e) {
    if (e instanceof api.PriceChangedError) {
      armConfirm(intent, e.price);
      // Pull the new adjustments before the form re-renders with the error,
      // so the price on the button already is the one in the message.
      await store.refreshSession();
      throw priceChangedError(e.price, e.data);
    }
    throw e;
  }
  const { id, price } = created;

  // Ro'yxatda darhol ko'rinsin — server javobini kutmaymiz.
  store.upsertGeneration({
    id,
    type: tool.id,
    topic: String(values.topic || tool.title),
    status: "QUEUED",
    createdAt: new Date().toISOString(),
    price,
    fileName: "",
    format: tool.output,
    progress: 0,
    step: "Navbatga qo‘yildi",
    expiresAt: null,
    error: null,
    preview: null,
  });

  // Balans o'zgardi — sarlavhadagi raqamni yangilaymiz.
  void store.refreshSession();
  return id;
}

/*
 * Pending price confirmation: after a 409 the new price is "armed" for the
 * same intent (tool + values). The next submit of that intent is the user's
 * confirmation and sends the armed price. A submit within CONFIRM_MIN_MS
 * (the second half of a double click) is not a confirmation: it is refused
 * again without a request and the confirmation stays armed. A changed form
 * or an expired confirmation falls back to the displayed price.
 */
const CONFIRM_TTL_MS = 10 * 60_000;
let pendingConfirm: { intent: string; price: number; armedAt: number; at: number } | null = null;

function intentOf(tool: ToolConfig, values: FormValues): string {
  return JSON.stringify({ slug: tool.slug, values });
}

function armConfirm(intent: string, price: number) {
  pendingConfirm = { intent, price, armedAt: confirmClock(), at: Date.now() };
}

function takePendingConfirm(intent: string): number | undefined {
  const p = pendingConfirm;
  if (!p || p.intent !== intent || Date.now() - p.at > CONFIRM_TTL_MS) {
    pendingConfirm = null;
    return undefined;
  }
  if (!confirmAccepted(p.armedAt)) throw priceChangedError(p.price);
  pendingConfirm = null;
  return p.price;
}

function priceChangedError(price: number, data: Record<string, unknown> = {}): api.PriceChangedError {
  return new api.PriceChangedError(
    `Narx o‘zgardi. Yangi narx: ${formatTanga(price)}. Shu narxda davom etish uchun tugmani yana bir marta bosing.`,
    price,
    { ...data, code: "price_changed", price },
  );
}

/** Foydalanuvchi so'roviga ko'ra generatsiyani (va faylini) o'chiradi. */
export async function forgetGeneration(id: string): Promise<void> {
  await api.deleteGeneration(id);
  const store = useAppStore.getState();
  store.dropGeneration(id);
  void store.refreshSession();
}

export const downloadGeneration = api.downloadGeneration;
