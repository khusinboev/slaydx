"use client";

import { create } from "zustand";

/**
 * Mandatory channels gate on the client (docs/bonus/BONUS3.md C-Q2/C-Q3). The server decides
 * (`lib/server/mandatory-channels.ts`): `GET /api/channels/required` on a tool page's load and on
 * «✅ Tekshirish», and the 403 `channel_required` / `telegram_required` of `POST /api/generations`
 * (`api-client.ts createGeneration` reports it here). `ChannelGate` (tool pages) renders it.
 */

export type GateChannel = { id: string; title: string; joinUrl: string | null };
export type Gate = { needsTelegram: boolean; channels: GateChannel[] };

type GateStore = { gate: Gate | null; setGate: (g: Gate | null) => void };

export const useChannelGate = create<GateStore>((set) => ({
  gate: null,
  setGate: (gate) => set({ gate }),
}));

const SAFE_JOIN = /^https:\/\/t\.me\/(?:\+[A-Za-z0-9_-]{8,64}|[A-Za-z][A-Za-z0-9_]{3,31})$/;

function channelsOf(raw: unknown): GateChannel[] {
  if (!Array.isArray(raw)) return [];
  const out: GateChannel[] = [];
  for (const c of raw.slice(0, 20)) {
    if (!c || typeof c !== "object") continue;
    const { id, title, joinUrl } = c as Record<string, unknown>;
    if (typeof id !== "string" || typeof title !== "string") continue;
    // Only a t.me link becomes an `href` (never another scheme or host).
    out.push({ id, title, joinUrl: typeof joinUrl === "string" && SAFE_JOIN.test(joinUrl) ? joinUrl : null });
  }
  return out;
}

/** The gate of a 403 body (`{code, channels}`), else `null`. */
export function gateFromError(status: number, data: Record<string, unknown>): Gate | null {
  if (status !== 403) return null;
  if (data.code === "telegram_required") return { needsTelegram: true, channels: channelsOf(data.channels) };
  if (data.code === "channel_required") return { needsTelegram: false, channels: channelsOf(data.channels) };
  return null;
}

/** The gate of a `GET /api/channels/required` answer: `null` when new work may be created. */
export function gateFromStatus(r: { ok?: unknown; needsTelegram?: unknown; channels?: unknown }): Gate | null {
  if (r.ok === true) return null;
  return { needsTelegram: r.needsTelegram === true, channels: channelsOf(r.channels) };
}

/** Called by `createGeneration` on its 403: the tool page shows the card at once. */
export function reportGate(status: number, data: Record<string, unknown>): void {
  const g = gateFromError(status, data);
  if (g) useChannelGate.getState().setGate(g);
}
