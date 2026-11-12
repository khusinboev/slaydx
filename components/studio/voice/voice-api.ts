"use client";

import { useCallback, useEffect, useState } from "react";
import { request } from "@/lib/api-client";
import { setClientClonePrice } from "@/lib/media/studio-speech-client";
import type { LibraryVoice, VoiceGender } from "@/lib/media/catalog-speech";

/** `GET /api/media/voices` as the UI reads it (`app/api/media/voices/route.ts`). Untrusted JSON → typed. */
export type UserVoice = { id: string; voice: string; name: string; status: "creating" | "ready"; createdAt: string; lastUsedAt: string; expiresAt: string | null };
export type CloneOffer = {
  available: boolean;
  /** Base price (`studio.clone_price`) before the tool's `tool_pricing` %. */
  price: number;
  consentText: string;
  consentVersion: string;
  minSeconds: number;
  maxSeconds: number;
  maxBytes: number;
  unusedDays: number;
};
export type VoicesData = { library: { elevenlabs: LibraryVoice[]; gemini: LibraryVoice[] }; mine: UserVoice[]; clone: CloneOffer };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

function voices(raw: unknown): LibraryVoice[] {
  return (Array.isArray(raw) ? raw : [])
    .map((v): LibraryVoice | null => {
      if (!(isObj(v) && str(v.id) && str(v.name) && (v.gender === "female" || v.gender === "male"))) return null;
      const note = str(v.note);
      // A native-speaker voice (the Uzbek library voices): `native` + `lang`, its style note for the list.
      return {
        id: v.id as string,
        name: v.name as string,
        gender: v.gender as VoiceGender,
        ...(v.lang === "uz" ? { lang: "uz" as const } : {}),
        ...(note ? { note: note.slice(0, 40) } : {}),
        ...(v.native === true ? { native: true as const } : {}),
      };
    })
    .filter((v): v is LibraryVoice => v !== null);
}

export function parseVoices(raw: unknown): VoicesData {
  const r = isObj(raw) ? raw : {};
  const lib = isObj(r.library) ? r.library : {};
  const c = isObj(r.clone) ? r.clone : {};
  const mine = (Array.isArray(r.mine) ? r.mine : [])
    .map((v): UserVoice | null =>
      isObj(v) && str(v.id) && str(v.name) && (v.status === "creating" || v.status === "ready")
        ? {
            id: v.id as string,
            voice: `clone:${v.id as string}`,
            name: v.name as string,
            status: v.status,
            createdAt: str(v.createdAt) ?? "",
            lastUsedAt: str(v.lastUsedAt) ?? "",
            expiresAt: str(v.expiresAt),
          }
        : null,
    )
    .filter((v): v is UserVoice => v !== null);
  return {
    library: { elevenlabs: voices(lib.elevenlabs), gemini: voices(lib.gemini) },
    mine,
    clone: {
      available: c.available === true,
      price: num(c.price, 5000),
      consentText: str(c.consentText) ?? "",
      consentVersion: str(c.consentVersion) ?? "",
      minSeconds: num(c.minSeconds, 30),
      maxSeconds: num(c.maxSeconds, 180),
      maxBytes: num(c.maxBytes, 10 * 1024 * 1024),
      unusedDays: num(c.unusedDays, 30),
    },
  };
}

export async function fetchVoices(signal?: AbortSignal): Promise<VoicesData> {
  const data = parseVoices(await request<unknown>("/api/media/voices", signal ? { signal } : {}));
  // `priceFor(studio-voice)` now shows what the server charges.
  setClientClonePrice(data.clone.price);
  return data;
}

/**
 * The voices of a tab: `voices` keeps the last good list across a failed reload, `error` is the failure to show with its
 * retry (`load`). `enabled: false` asks nothing until the tab needs them.
 */
export function useVoices(enabled = true): { voices: VoicesData | null; error: string | null; load: () => void } {
  const [voices, setVoices] = useState<VoicesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    fetchVoices().then(setVoices, (e: unknown) => setError(e instanceof Error ? e.message : "Ovozlar yuklanmadi"));
  }, []);
  const asked = enabled && voices === null;
  useEffect(() => {
    if (asked) load();
  }, [asked, load]);
  return { voices, error, load };
}

/** The recording + the consent checkbox (`consent=1`) → `{ sampleId, seconds }`. */
export async function uploadSample(blob: Blob, fileName: string, consent: boolean): Promise<{ sampleId: string; seconds: number }> {
  const form = new FormData();
  form.append("file", blob, fileName);
  form.append("consent", consent ? "1" : "0");
  const r = await request<unknown>("/api/media/voices/samples", { method: "POST", body: form, timeoutMs: 90_000 });
  const id = isObj(r) ? str(r.sampleId) : null;
  if (!id) throw new Error("Yozuv yuklanmadi");
  return { sampleId: id, seconds: isObj(r) ? num(r.seconds, 0) : 0 };
}

export async function deleteVoice(id: string): Promise<void> {
  await request<unknown>(`/api/media/voices/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** The cached preview of a voice (`elevenlabs:<id>`, `gemini:<name>`, `clone:<id>`). */
export const previewUrl = (key: string): string => `/api/media/voices/preview/${encodeURIComponent(key)}`;
