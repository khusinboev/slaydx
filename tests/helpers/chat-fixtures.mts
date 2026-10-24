/**
 * Shared fixtures for the AI chat tests: a stubbed LLM (`complete`) and user / wallet / setting helpers.
 * Nothing here reaches a provider.
 */
import type { complete as CompleteFn } from "../../lib/generation/llm-roles.ts";
import { recordLlmUsage } from "../../lib/generation/job-cost.ts";

export type Answer = { reply?: string; propose?: unknown; raw?: string };

/** A stub for `llm-roles.complete`: returns the next queued answer (or a default one) and records every call. */
export function stubLlm(answers: Answer[] = []) {
  const calls: Array<{ role: string; system: string; user: string }> = [];
  const queue = [...answers];
  const complete = (async (role: string, system: string, user: string) => {
    calls.push({ role, system, user });
    const a = queue.shift() ?? { reply: "Salom! Qanday yordam bera olaman?", propose: null };
    const text = a.raw ?? JSON.stringify({ reply: a.reply ?? "", propose: a.propose ?? null });
    const usage = { provider: "gemini", model: "stub", inputTokens: 120, outputTokens: 30 };
    // The real `complete` meters every answer into the surrounding job / free-call meter; so does the stub.
    recordLlmUsage(usage);
    return { text, usage };
  }) as unknown as typeof CompleteFn;
  return { complete, calls, push: (a: Answer) => queue.push(a) };
}

/** An LLM that never answers (`null` -- timeout / empty chain). */
export const silentLlm = (async () => null) as unknown as typeof CompleteFn;

export type Db = typeof import("../../lib/server/db.ts");

export async function mkUser(query: Db["query"], opts: { points?: number; balance?: number; name?: string } = {}): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance, university, author) VALUES ($1, $2, $3, 0, $4, 'TATU', 'Aliyev Ali') RETURNING id::text AS id`,
    [`chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, opts.name ?? "Test", opts.points ?? 0, opts.balance ?? 0],
  );
  return rows[0]!.id;
}

export async function wallet(query: Db["query"], uid: string): Promise<{ points: number; balance: number; total: number }> {
  const r = (await query<{ points: string; balance: string }>("SELECT points, balance FROM users WHERE id = $1", [uid]))[0]!;
  return { points: Number(r.points), balance: Number(r.balance), total: Number(r.points) + Number(r.balance) };
}

export async function setSetting(query: Db["query"], key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
  const { invalidateSettingsCache } = await import("../../lib/server/settings.ts");
  invalidateSettingsCache();
  const { invalidateKnowledgeCache } = await import("../../lib/server/chat/knowledge.ts");
  invalidateKnowledgeCache();
}

export async function clearSetting(query: Db["query"], key: string): Promise<void> {
  await query("DELETE FROM app_settings WHERE key = $1", [key]);
  const { invalidateSettingsCache } = await import("../../lib/server/settings.ts");
  invalidateSettingsCache();
}

let seq = 0;
/** A fresh, valid client message id. */
export const cid = (): string => `cm-${process.pid}-${Date.now()}-${++seq}`;
