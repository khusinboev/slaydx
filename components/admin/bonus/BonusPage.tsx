"use client";

import { useState } from "react";
import { Info, Megaphone, Plus } from "lucide-react";
import { useCan } from "@/components/admin/shell";
import { Button, Card, CardHeader, EmptyState, ErrorState, Forbidden, Skeleton, toast } from "@/components/admin/ui";
import { fmtNumber } from "@/lib/admin-format";
import { adminErrorMessage, AdminReauthCancelledError, isAbortError } from "@/lib/admin-api/core";
import { updateBonusChannel, type BonusChannel } from "@/lib/admin-api/bonus";
import { ChannelAddDialog } from "./ChannelAddDialog";
import { ChannelDeleteDialog } from "./ChannelDeleteDialog";
import { ChannelEditDialog } from "./ChannelEditDialog";
import { ChannelRow } from "./ChannelRow";
import { useBonusChannels } from "./useBonusChannels";

export const BOT_ADMIN_NOTE =
  "Bot har bir kanalda admin bo'lishi shart: aks holda u obunani tekshira olmaydi va bonus berilmaydi. Kanal sozlamalari → Administratorlar → Admin qo'shish → botni tanlang.";

function Loading() {
  return (
    <Card>
      <div aria-busy="true" aria-label="Yuklanmoqda">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2 border-t px-4 py-4 first:border-t-0">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * `/admin/bonus` «Bonus kanallar» (docs/bonus/PLAN.md K2, `bonus.view`; edits `bonus.edit`
 * with step-up). Channels the bot's «🎁 Bonus olish» screen offers: amounts, order, active
 * switch, claim stats and the bot's live admin status per channel. Permissions are enforced
 * by the API; hiding the edit controls is cosmetic.
 */
export function BonusPage() {
  const canEdit = useCan("bonus.edit");
  const { state, bot, reload, recheck, upsert, remove, setBotStatus } = useBonusChannels();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BonusChannel | null>(null);
  const [deleting, setDeleting] = useState<BonusChannel | null>(null);
  const [toggling, setToggling] = useState<ReadonlySet<string>>(new Set());

  const items = state.status === "ready" ? state.items : [];
  const active = items.filter((c) => c.active).length;
  const paid = items.reduce((sum, c) => sum + c.stats.joinPaidSum + c.stats.stayPaidSum, 0);

  async function toggle(item: BonusChannel) {
    setToggling((s) => new Set(s).add(item.id));
    try {
      const { item: saved } = await updateBonusChannel(item.id, { active: !item.active });
      upsert(saved);
      toast(saved.active ? `«${saved.title}» yoqildi` : `«${saved.title}» o'chirildi — botda ko'rinmaydi`);
    } catch (e) {
      if (!isAbortError(e) && !(e instanceof AdminReauthCancelledError)) toast(adminErrorMessage(e), { tone: "error" });
    } finally {
      setToggling((s) => {
        const next = new Set(s);
        next.delete(item.id);
        return next;
      });
    }
  }

  const addButton = canEdit ? (
    <Button variant="primary" onClick={() => setAdding(true)} icon={<Plus className="size-4" aria-hidden="true" />}>
      Kanal qo&apos;shish
    </Button>
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Bonus kanallar</h1>
          <p className="text-muted-foreground text-[13px]">
            Foydalanuvchi kanalga obuna bo&apos;lib ball oladi: obuna uchun darhol, kanalda qolsa — belgilangan kundan keyin yana.
            {canEdit ? "" : " Sizda faqat ko'rish huquqi bor."}
          </p>
        </div>
        {state.status === "ready" && items.length > 0 ? addButton : null}
      </header>

      <div role="note" className="bg-info/10 text-foreground flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]">
        <Info className="text-info mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{BOT_ADMIN_NOTE}</p>
      </div>

      {state.status === "loading" ? <Loading /> : null}
      {state.status === "forbidden" ? <Forbidden /> : null}
      {state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        </Card>
      ) : null}
      {state.status === "ready" && items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Megaphone className="size-8" />}
            title="Hali bonus kanal yo'q"
            description={
              <>
                Avval botni kanalga admin qilib qo&apos;shing, so&apos;ng kanalning @username yoki t.me havolasini kiriting. Birinchi kanal
                odatda yangiliklar kanali bo&apos;ladi: 2 000 ball, qo&apos;shimcha yo&apos;q.
              </>
            }
            action={addButton}
          />
        </Card>
      ) : null}
      {state.status === "ready" && items.length > 0 ? (
        <Card>
          <CardHeader
            title="Kanallar"
            description="Botda tartib raqami bo'yicha ko'rsatiladi (kichigi yuqorida)."
            aside={
              <span className="text-muted-foreground tabular-nums">
                Faol: {active} / {items.length} · To&apos;langan: {fmtNumber(paid)} ball
              </span>
            }
          />
          <ul>
            {items.map((item) => (
              <ChannelRow
                key={item.id}
                item={item}
                bot={bot[item.id] ?? { status: "checking" }}
                canEdit={canEdit}
                toggling={toggling.has(item.id)}
                onToggle={toggle}
                onEdit={setEditing}
                onDelete={setDeleting}
                onRecheck={recheck}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      <ChannelAddDialog
        open={adding}
        existingCount={items.length}
        onClose={() => setAdding(false)}
        onCreated={(item, check) => {
          upsert(item);
          setBotStatus(item.id, check);
          setAdding(false);
        }}
      />
      <ChannelEditDialog
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={(item) => {
          upsert(item);
          setEditing(null);
        }}
      />
      <ChannelDeleteDialog
        item={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          remove(id);
          setDeleting(null);
        }}
        onStale={reload}
      />
    </div>
  );
}
