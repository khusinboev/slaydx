"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useCan } from "@/components/admin/shell";
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Forbidden, Modal, Skeleton, TabPanel, Tabs, toast, useLoad } from "@/components/admin/ui";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { adminErrorMessage, AdminReauthCancelledError } from "@/lib/admin-api/core";
import {
  createPrompt,
  createTemplate,
  deletePrompt,
  deleteTemplate,
  getLibrary,
  reorderLibrary,
  updatePrompt,
  updateTemplate,
  uploadPreview,
  type AdminPrompt,
  type AdminTemplate,
  type LibraryOverview,
} from "@/lib/admin-api/studio-library";

const ID = "studio-lib";
const INPUT = "bg-background focus-visible:ring-ring h-10 w-full rounded-lg border px-3 text-[14px] outline-none focus-visible:ring-2";
const AREA = "bg-background focus-visible:ring-ring w-full rounded-lg border px-3 py-2 text-[14px] outline-none focus-visible:ring-2";

type Kind = "prompts" | "templates";
type Pending =
  | { type: "toggle"; kind: Kind; id: string; title: string; enabled: boolean; updatedAt: string }
  | { type: "delete"; kind: Kind; id: string; title: string; updatedAt: string }
  | { type: "move"; kind: Kind; ids: string[]; title: string };

/**
 * `/admin/studio` «Studio kutubxonasi» (docs/studio/P2B-SPEC.md): the Studio's prompt library («Namuna promptlar») and
 * image templates («Shablonlar»). `settings.view` reads, `settings.edit` (step-up) writes; every write asks for a
 * reason and is audited by the server, which also validates templates against the model's ParamSchema (the error
 * shows inline). Hiding the edit controls without the permission is cosmetic only.
 */
export function StudioLibraryPage() {
  const canEdit = useCan("settings.edit");
  const [state, reload] = useLoad<LibraryOverview>((signal) => getLibrary({ signal }));
  const [tab, setTab] = useState<Kind>("prompts");
  const [category, setCategory] = useState("");
  const [editPrompt, setEditPrompt] = useState<AdminPrompt | "new" | null>(null);
  const [editTemplate, setEditTemplate] = useState<AdminTemplate | "new" | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  if (state.status === "loading") {
    return (
      <Card>
        <div aria-busy="true" className="flex flex-col gap-2 p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      </Card>
    );
  }
  if (state.status === "forbidden") return <Forbidden />;
  if (state.status === "error") {
    return (
      <Card>
        <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
      </Card>
    );
  }
  const data = state.data;
  const catLabel = (id: string) => data.categories.find((c) => c.id === id)?.label ?? id;
  const prompts = data.prompts.filter((p) => !category || p.category === category);

  /** Swaps a row with its neighbour inside the visible list (prompts: one category). */
  function move(kind: Kind, list: readonly { id: string; title: string }[], index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((x) => x.id);
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    setPending({ type: "move", kind, ids, title: list[index]!.title });
  }

  async function confirm(reason: string) {
    if (!pending) return;
    try {
      if (pending.type === "move") await reorderLibrary({ kind: pending.kind, ids: pending.ids, reason });
      else if (pending.type === "toggle") {
        const body = { enabled: !pending.enabled, reason, expectedUpdatedAt: pending.updatedAt };
        await (pending.kind === "prompts" ? updatePrompt(pending.id, body) : updateTemplate(pending.id, body));
      } else {
        const body = { reason, expectedUpdatedAt: pending.updatedAt };
        await (pending.kind === "prompts" ? deletePrompt(pending.id, body) : deleteTemplate(pending.id, body));
      }
      toast("Saqlandi");
      setPending(null);
      reload();
    } catch (e) {
      if (e instanceof AdminReauthCancelledError) return;
      throw e;
    }
  }

  const rowActions = (kind: Kind, item: { id: string; title: string; enabled: boolean; updatedAt: string }, list: readonly { id: string; title: string }[], i: number, onEdit: () => void) =>
    canEdit ? (
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" aria-label="Yuqoriga" disabled={i === 0 || (kind === "prompts" && !category)} onClick={() => move(kind, list, i, -1)} icon={<ArrowUp className="size-4" />} />
        <Button size="sm" variant="ghost" aria-label="Pastga" disabled={i === list.length - 1 || (kind === "prompts" && !category)} onClick={() => move(kind, list, i, 1)} icon={<ArrowDown className="size-4" />} />
        <Button size="sm" variant="secondary" data-lib-toggle={item.id} onClick={() => setPending({ type: "toggle", kind, id: item.id, title: item.title, enabled: item.enabled, updatedAt: item.updatedAt })}>
          {item.enabled ? "O'chirish" : "Yoqish"}
        </Button>
        <Button size="sm" variant="ghost" aria-label="Tahrirlash" onClick={onEdit} icon={<Pencil className="size-4" />} />
        <Button size="sm" variant="ghost" aria-label="Butunlay o'chirish" onClick={() => setPending({ type: "delete", kind, id: item.id, title: item.title, updatedAt: item.updatedAt })} icon={<Trash2 className="size-4" />} />
      </div>
    ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-studio-library-admin>
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Studio kutubxonasi</h1>
        <p className="text-muted-foreground text-[13px]">
          Studio «Rasm» bo&apos;limidagi «Namuna promptlar» va «Shablonlar». Shablon parametrlari model katalogi bo&apos;yicha tekshiriladi; modeli hozir mavjud
          bo&apos;lmagan shablon foydalanuvchiga ko&apos;rinmaydi.{canEdit ? "" : " Sizda faqat ko'rish huquqi bor."}
        </p>
      </header>
      <Tabs
        idPrefix={ID}
        ariaLabel="Kutubxona bo'limlari"
        value={tab}
        onChange={(v) => setTab(v as Kind)}
        tabs={[
          { id: "prompts", label: "Namuna promptlar", badge: data.prompts.length },
          { id: "templates", label: "Shablonlar", badge: data.templates.length },
        ]}
      />
      {tab === "prompts" ? (
        <TabPanel idPrefix={ID} id="prompts">
          <Card>
            <CardHeader
              title="Promptlar"
              description="Tartiblash uchun toifani tanlang (kichik tartib raqami yuqorida)."
              aside={
                <div className="flex items-center gap-2">
                  <select aria-label="Toifa" className={INPUT + " w-44"} value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">Barcha toifalar</option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  {canEdit ? (
                    <Button variant="primary" onClick={() => setEditPrompt("new")} icon={<Plus className="size-4" />}>
                      Qo&apos;shish
                    </Button>
                  ) : null}
                </div>
              }
            />
            {prompts.length === 0 ? (
              <EmptyState title="Prompt yo'q" description="Yangi namuna prompt qo'shing." />
            ) : (
              <ul>
                {prompts.map((p, i) => (
                  <li key={p.id} data-lib-prompt={p.id} className="flex flex-wrap items-start justify-between gap-3 border-t px-4 py-3 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold">
                        {p.title} <Badge tone="neutral">{catLabel(p.category)}</Badge> {p.enabled ? null : <Badge tone="warning">o&apos;chiq</Badge>}
                      </p>
                      <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[13px]">{p.prompt}</p>
                    </div>
                    {rowActions("prompts", p, prompts, i, () => setEditPrompt(p))}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabPanel>
      ) : (
        <TabPanel idPrefix={ID} id="templates">
          <Card>
            <CardHeader
              title="Shablonlar"
              aside={
                canEdit ? (
                  <Button variant="primary" onClick={() => setEditTemplate("new")} icon={<Plus className="size-4" />}>
                    Qo&apos;shish
                  </Button>
                ) : null
              }
            />
            {data.templates.length === 0 ? (
              <EmptyState title="Shablon yo'q" description="Yangi shablon qo'shing." />
            ) : (
              <ul>
                {data.templates.map((t, i) => (
                  <li key={t.id} data-lib-template={t.id} className="flex flex-wrap items-start justify-between gap-3 border-t px-4 py-3 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold">
                        {t.title} <Badge tone="neutral">{catLabel(t.category)}</Badge> <Badge tone="info">{t.modelLabel ?? t.modelId}</Badge>{" "}
                        {t.enabled ? null : <Badge tone="warning">o&apos;chiq</Badge>} {t.modelAvailable ? null : <Badge tone="warning">model mavjud emas</Badge>}
                      </p>
                      <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[13px]">{t.skeleton}</p>
                      {t.error ? (
                        <p className="text-destructive mt-0.5 text-[13px]" data-lib-template-error>
                          Yaroqsiz: {t.error}
                        </p>
                      ) : null}
                    </div>
                    {rowActions("templates", t, data.templates, i, () => setEditTemplate(t))}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabPanel>
      )}

      {editPrompt ? <PromptDialog item={editPrompt === "new" ? null : editPrompt} data={data} onClose={() => setEditPrompt(null)} onSaved={() => (setEditPrompt(null), reload())} /> : null}
      {editTemplate ? <TemplateDialog item={editTemplate === "new" ? null : editTemplate} data={data} onClose={() => setEditTemplate(null)} onSaved={() => (setEditTemplate(null), reload())} /> : null}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.type === "delete" ? "Butunlay o'chirish" : pending?.type === "move" ? "Tartibni o'zgartirish" : pending?.enabled ? "O'chirish" : "Yoqish"}
        target={pending ? <span>{pending.title}</span> : null}
        danger={pending?.type === "delete"}
        reason={{ label: "Sabab" }}
        onConfirm={({ reason }) => confirm(reason)}
      />
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-medium">
      {label}
      {children}
    </label>
  );
}

/** Preview picture: file → upload (audited with the dialog's reason) → id; or remove. */
function PreviewField({ previewId, url, reason, onChange }: { previewId: string | null; url: string | null; reason: string; onChange: (id: string | null, url: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3 text-[13px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- curated preview, served by our own byte route */}
      {url ? <img src={url} alt="" className="size-14 rounded-lg border object-cover" /> : <span className="bg-muted size-14 rounded-lg border" />}
      <input
        type="file"
        accept="image/png,image/jpeg"
        aria-label="Ko'rinish rasmi"
        disabled={busy || reason.trim().length < 5}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          setError(null);
          try {
            const got = await uploadPreview(f, reason.trim());
            onChange(got.id, got.url);
          } catch (err) {
            setError(adminErrorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      {previewId ? (
        <Button size="sm" variant="ghost" onClick={() => onChange(null, null)}>
          Olib tashlash
        </Button>
      ) : null}
      {reason.trim().length < 5 ? <span className="text-muted-foreground">Avval sababni yozing</span> : null}
      {error ? <span className="text-destructive">{error}</span> : null}
    </div>
  );
}

function SaveFooter({ busy, error, onSave, onClose, disabled }: { busy: boolean; error: string | null; onSave: () => void; onClose: () => void; disabled: boolean }) {
  return (
    <div className="flex w-full flex-col gap-2">
      {error ? (
        <p role="alert" className="text-destructive text-[13px]" data-lib-save-error>
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Bekor qilish
        </Button>
        <Button variant="primary" onClick={onSave} disabled={busy || disabled} data-lib-save>
          {busy ? "Saqlanmoqda…" : "Saqlash"}
        </Button>
      </div>
    </div>
  );
}

function useSave(run: () => Promise<unknown>, onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await run();
      toast("Saqlandi");
      onSaved();
    } catch (e) {
      if (!(e instanceof AdminReauthCancelledError)) setError(adminErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save, setError };
}

function PromptDialog({ item, data, onClose, onSaved }: { item: AdminPrompt | null; data: LibraryOverview; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState(item?.category ?? data.categories[0]?.id ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [prompt, setPrompt] = useState(item?.prompt ?? "");
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [preview, setPreview] = useState<{ id: string | null; url: string | null }>({ id: item?.previewId ?? null, url: item?.previewUrl ?? null });
  const [reason, setReason] = useState("");
  const body = { category, title, prompt, enabled, previewId: preview.id, reason: reason.trim() };
  const { busy, error, save } = useSave(() => (item ? updatePrompt(item.id, { ...body, expectedUpdatedAt: item.updatedAt }) : createPrompt(body)), onSaved);
  return (
    <Modal open onClose={onClose} dismissible={!busy} title={item ? "Promptni tahrirlash" : "Yangi prompt"} footer={<SaveFooter busy={busy} error={error} onSave={save} onClose={onClose} disabled={reason.trim().length < 5} />}>
      <div className="flex flex-col gap-3" data-lib-prompt-dialog>
        <Labeled label="Toifa">
          <select className={INPUT} value={category} onChange={(e) => setCategory(e.target.value)}>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Sarlavha">
          <input className={INPUT} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </Labeled>
        <Labeled label="Prompt (500 belgigacha)">
          <AutoTextarea className={AREA} value={prompt} maxLength={500} minRows={3} onChange={(e) => setPrompt(e.target.value)} />
        </Labeled>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Foydalanuvchilarga ko&apos;rinadi
        </label>
        <Labeled label="Sabab (kamida 5 belgi)">
          <input className={INPUT} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-lib-reason />
        </Labeled>
        <Labeled label="Ko'rinish rasmi (ixtiyoriy, PNG/JPEG ≤ 512 KB)">
          <PreviewField previewId={preview.id} url={preview.url} reason={reason} onChange={(id, url) => setPreview({ id, url })} />
        </Labeled>
      </div>
    </Modal>
  );
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: JSON noto'g'ri`);
  }
}

function TemplateDialog({ item, data, onClose, onSaved }: { item: AdminTemplate | null; data: LibraryOverview; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState(item?.category ?? data.categories[0]?.id ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [modelId, setModelId] = useState(item?.modelId ?? data.models[0]?.id ?? "");
  const [params, setParams] = useState(JSON.stringify(item?.params ?? { imageRatio: "1:1", imageCount: 1 }, null, 2));
  const [skeleton, setSkeleton] = useState(item?.skeleton ?? "");
  const [slots, setSlots] = useState(JSON.stringify(item?.slots ?? [{ name: "mavzu", label: "Mavzu", placeholder: "", max: 60 }], null, 2));
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [preview, setPreview] = useState<{ id: string | null; url: string | null }>({ id: item?.previewId ?? null, url: item?.previewUrl ?? null });
  const [reason, setReason] = useState("");
  const model = data.models.find((m) => m.id === modelId);
  const { busy, error, save } = useSave(async () => {
    const body = {
      category,
      title,
      modelId,
      params: parseJson(params, "Parametrlar") as Record<string, unknown>,
      skeleton,
      slots: parseJson(slots, "Slotlar") as AdminTemplate["slots"],
      enabled,
      previewId: preview.id,
      reason: reason.trim(),
    };
    return item ? updateTemplate(item.id, { ...body, expectedUpdatedAt: item.updatedAt }) : createTemplate(body);
  }, onSaved);
  const paramNames = Array.isArray(model?.params) ? (model!.params as { name?: unknown }[]).map((p) => String(p.name)).filter((n) => n !== "prompt") : [];
  return (
    <Modal open size="lg" onClose={onClose} dismissible={!busy} title={item ? "Shablonni tahrirlash" : "Yangi shablon"} footer={<SaveFooter busy={busy} error={error} onSave={save} onClose={onClose} disabled={reason.trim().length < 5} />}>
      <div className="flex flex-col gap-3" data-lib-template-dialog>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Toifa">
            <select className={INPUT} value={category} onChange={(e) => setCategory(e.target.value)}>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Model">
            <select className={INPUT} value={modelId} onChange={(e) => setModelId(e.target.value)} data-lib-model>
              {data.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.available ? "" : " (hozir mavjud emas)"}
                </option>
              ))}
            </select>
          </Labeled>
        </div>
        <Labeled label="Sarlavha">
          <input className={INPUT} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </Labeled>
        <Labeled label={`Parametrlar (JSON; bu modelda: ${paramNames.join(", ") || "—"})`}>
          <AutoTextarea className={AREA + " font-mono"} value={params} minRows={3} onChange={(e) => setParams(e.target.value)} />
        </Labeled>
        <Labeled label="Prompt skeleti ({slot} bilan)">
          <AutoTextarea className={AREA} value={skeleton} maxLength={500} minRows={2} onChange={(e) => setSkeleton(e.target.value)} />
        </Labeled>
        <Labeled label='Slotlar (JSON: [{"name","label","placeholder","max"}])'>
          <AutoTextarea className={AREA + " font-mono"} value={slots} minRows={3} onChange={(e) => setSlots(e.target.value)} />
        </Labeled>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Foydalanuvchilarga ko&apos;rinadi
        </label>
        <Labeled label="Sabab (kamida 5 belgi)">
          <input className={INPUT} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-lib-reason />
        </Labeled>
        <Labeled label="Ko'rinish rasmi (ixtiyoriy, PNG/JPEG ≤ 512 KB)">
          <PreviewField previewId={preview.id} url={preview.url} reason={reason} onChange={(id, url) => setPreview({ id, url })} />
        </Labeled>
      </div>
    </Modal>
  );
}
