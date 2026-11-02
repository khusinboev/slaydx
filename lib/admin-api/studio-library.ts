"use client";

import { ApiError, request } from "../api-client";
import { adminGet, adminSend, runStepUp, AdminReauthCancelledError, type AdminCallOptions } from "./core";
import type { TemplateSlot } from "../media/library";

/**
 * «Studio kutubxonasi» API (docs/studio/P2B-SPEC.md; `settings.view` / `settings.edit` with step-up). Thin typed
 * wrappers over `core.ts`; types declared here (admin client code never reaches `lib/server/**`).
 */

export type AdminPrompt = {
  id: string;
  category: string;
  title: string;
  prompt: string;
  previewId: string | null;
  previewUrl: string | null;
  sort: number;
  enabled: boolean;
  updatedAt: string;
};

export type AdminTemplate = {
  id: string;
  category: string;
  title: string;
  modelId: string;
  modelLabel: string | null;
  params: Record<string, unknown>;
  skeleton: string;
  slots: TemplateSlot[];
  previewId: string | null;
  previewUrl: string | null;
  sort: number;
  enabled: boolean;
  updatedAt: string;
  error: string | null;
  modelAvailable: boolean;
};

export type LibraryModel = { id: string; label: string; available: boolean; params: unknown };

export type LibraryOverview = {
  categories: { id: string; label: string }[];
  models: LibraryModel[];
  prompts: AdminPrompt[];
  templates: AdminTemplate[];
};

export type PromptWrite = Partial<Pick<AdminPrompt, "category" | "title" | "prompt" | "sort" | "enabled" | "previewId">> & { reason: string; expectedUpdatedAt?: string };
export type TemplateWrite = Partial<Pick<AdminTemplate, "category" | "title" | "modelId" | "params" | "skeleton" | "slots" | "sort" | "enabled" | "previewId">> & {
  reason: string;
  expectedUpdatedAt?: string;
};

const BASE = "/api/admin/studio-library";

export const getLibrary = (opts?: AdminCallOptions) => adminGet<LibraryOverview>(BASE, undefined, opts);
export const createPrompt = (body: PromptWrite) => adminSend<AdminPrompt>("POST", `${BASE}/prompts`, body);
export const updatePrompt = (id: string, body: PromptWrite) => adminSend<AdminPrompt>("PUT", `${BASE}/prompts/${id}`, body);
export const deletePrompt = (id: string, body: { reason: string; expectedUpdatedAt?: string }) => adminSend<{ id: string }>("DELETE", `${BASE}/prompts/${id}`, body);
export const createTemplate = (body: TemplateWrite) => adminSend<AdminTemplate>("POST", `${BASE}/templates`, body);
export const updateTemplate = (id: string, body: TemplateWrite) => adminSend<AdminTemplate>("PUT", `${BASE}/templates/${id}`, body);
export const deleteTemplate = (id: string, body: { reason: string; expectedUpdatedAt?: string }) => adminSend<{ id: string }>("DELETE", `${BASE}/templates/${id}`, body);
export const reorderLibrary = (body: { kind: "prompts" | "templates"; ids: string[]; reason: string }) => adminSend<{ ids: string[] }>("POST", `${BASE}/reorder`, body);

/** Multipart preview upload (`core.ts` sends JSON only): the same 401 `reauth` → step-up → one retry rule. */
export async function uploadPreview(file: File, reason: string): Promise<{ id: string; url: string }> {
  const send = () => {
    const form = new FormData();
    form.append("file", file, file.name || "preview");
    form.append("reason", reason);
    return request<{ id: string; url: string }>(`${BASE}/previews`, { method: "POST", body: form, timeoutMs: 60_000 });
  };
  try {
    return await send();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && (e.data as { code?: unknown } | undefined)?.code === "reauth") {
      if (!(await runStepUp())) throw new AdminReauthCancelledError(e.data);
      return send();
    }
    throw e;
  }
}
