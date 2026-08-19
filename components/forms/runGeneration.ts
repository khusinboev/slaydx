"use client";

import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import type { FormValues, ToolConfig } from "@/lib/types";

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
 */
export async function runGeneration(tool: ToolConfig, values: FormValues): Promise<string> {
  const store = useAppStore.getState();
  const { id, price } = await api.createGeneration(tool.slug, values);

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

/** Foydalanuvchi so'roviga ko'ra generatsiyani (va faylini) o'chiradi. */
export async function forgetGeneration(id: string): Promise<void> {
  await api.deleteGeneration(id);
  const store = useAppStore.getState();
  store.dropGeneration(id);
  void store.refreshSession();
}

export const downloadGeneration = api.downloadGeneration;
