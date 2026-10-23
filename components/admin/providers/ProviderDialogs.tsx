"use client";

import { useId, useState } from "react";
import { ConfirmDialog, toast } from "@/components/admin/ui";
import { deleteProviderKey, setProviderEnabled, setProviderKey, type ProviderItem } from "@/lib/admin-api/providers";
import { keyState, propagationNote } from "./format";

const KEY_MIN = 8;
const KEY_MAX = 512;

type SavedProps = { onSaved: (item: ProviderItem) => void; onClose: () => void; propagationSec: number };

/** Mirrors the server check (`isPlausibleKey`): one printable-ASCII token of 8-512 characters. */
export function keyProblem(raw: string): string | null {
  const key = raw.trim();
  if (key.length === 0) return null;
  if (key.length < KEY_MIN) return `Kalit juda qisqa (kamida ${KEY_MIN} belgi)`;
  if (key.length > KEY_MAX) return `Kalit juda uzun (ko'pi bilan ${KEY_MAX} belgi)`;
  if (!/^[\x21-\x7e]+$/.test(key)) return "Kalitda bo'sh joy yoki ASCII bo'lmagan belgi bor";
  return null;
}

/**
 * «Kalitni kiritish» / «Almashtirish»: a password field (never shown again after saving), a reason (audited) and
 * the step-up the admin API core asks for. The typed key lives only in this dialog's state: the body is
 * unmounted on close, and the server answers with the masked hint, never the key.
 */
export function ProviderKeyDialog({ item, onSaved, onClose, propagationSec }: SavedProps & { item: ProviderItem | null }) {
  if (!item) return null;
  return <KeyBody key={item.id} item={item} onSaved={onSaved} onClose={onClose} propagationSec={propagationSec} />;
}

function KeyBody({ item, onSaved, onClose, propagationSec }: SavedProps & { item: ProviderItem }) {
  const id = useId();
  const [key, setKey] = useState("");
  const problem = keyProblem(key);
  const replacing = item.hasDbKey;
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={replacing ? "Kalitni almashtirish" : "Kalitni kiritish"}
      description="Kalit shifrlangan holda bazada saqlanadi va qayta ko'rsatilmaydi: keyin faqat oxirgi 4 belgisi ko'rinadi."
      target={
        <span>
          {item.label} <span className="text-muted-foreground font-mono text-xs">{item.id}</span>
        </span>
      }
      reason={{ minLength: 5 }}
      confirmLabel={replacing ? "Almashtirish" : "Saqlash"}
      confirmDisabled={key.trim().length === 0 || problem !== null}
      onConfirm={async ({ reason }) => {
        const { item: saved } = await setProviderKey(item.id, key.trim(), reason);
        setKey("");
        toast(`Kalit saqlandi. ${propagationNote(propagationSec)}`);
        onSaved(saved);
      }}
    >
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <label htmlFor={`${id}-key`} className="font-semibold">
          API kalit
        </label>
        <input
          id={`${id}-key`}
          name="provider-api-key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={KEY_MAX + 64}
          aria-invalid={problem !== null}
          aria-describedby={`${id}-hint`}
          className="border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 font-mono text-[13px] outline-none focus:ring-2"
        />
        <span id={`${id}-hint`} className={problem ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
          {problem ?? `Ko'rinishi: ${item.keyFormat}`}
        </span>
      </div>
    </ConfirmDialog>
  );
}

/** «O'chirish»: removes the stored key; the environment variable (if any) applies again. */
export function ProviderDeleteKeyDialog({
  item,
  onSaved,
  onClose,
  onStale,
  propagationSec,
}: SavedProps & { item: ProviderItem | null; onStale: () => void }) {
  if (!item) return null;
  return (
    <ConfirmDialog
      key={item.id}
      open
      onClose={onClose}
      title="Saqlangan kalitni o'chirish"
      description={
        item.envPresent
          ? "Bazadagi kalit o'chiriladi, provayder muhitdagi (env) kalitga qaytadi."
          : "Bazadagi kalit o'chiriladi. Muhitda (env) kalit yo'q, shuning uchun provayder ishlamay qoladi."
      }
      target={
        <span>
          {item.label} <span className="text-muted-foreground font-mono text-xs">{item.id}</span>
        </span>
      }
      before={keyState(item).label}
      after={item.envPresent ? "Env" : "Yo'q"}
      reason={{ minLength: 5 }}
      danger
      confirmLabel="Kalitni o'chirish"
      onConfirm={async ({ reason }) => {
        try {
          const { item: saved } = await deleteProviderKey(item.id, reason);
          toast(`Kalit o'chirildi. ${propagationNote(propagationSec)}`);
          onSaved(saved);
        } catch (e) {
          if ((e as { status?: number }).status === 409) onStale();
          throw e;
        }
      }}
    />
  );
}

/** The on/off switch: confirmation with a reason; «o'chirish» is the dangerous direction. */
export function ProviderToggleDialog({
  item,
  onSaved,
  onClose,
  onStale,
  propagationSec,
}: SavedProps & { item: ProviderItem | null; onStale: () => void }) {
  if (!item) return null;
  const next = !item.enabled;
  return (
    <ConfirmDialog
      key={item.id}
      open
      onClose={onClose}
      title={next ? "Provayderni yoqish" : "Provayderni o'chirish"}
      description={
        next
          ? "Provayder yana ishlatiladi: bazadagi yoki muhitdagi kalit bilan."
          : "Provayder ishlatilmaydi, hatto muhitda kalit bo'lsa ham. Zanjirdagi keyingi provayderga o'tiladi; boshqasi bo'lmasa vosita yopiladi."
      }
      target={
        <span>
          {item.label} <span className="text-muted-foreground font-mono text-xs">{item.id}</span>
        </span>
      }
      before={item.enabled ? "Yoqilgan" : "O'chirilgan"}
      after={next ? "Yoqilgan" : "O'chirilgan"}
      reason={{ minLength: 5 }}
      danger={!next}
      confirmLabel={next ? "Yoqish" : "O'chirish"}
      onConfirm={async ({ reason }) => {
        try {
          const { item: saved } = await setProviderEnabled(item.id, next, reason);
          toast(`${next ? "Yoqildi" : "O'chirildi"}. ${propagationNote(propagationSec)}`);
          onSaved(saved);
        } catch (e) {
          if ((e as { status?: number }).status === 409) onStale();
          throw e;
        }
      }}
    />
  );
}
