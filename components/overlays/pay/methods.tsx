"use client";

import type { ComponentType } from "react";
import { ChevronRight, CreditCard, Smartphone, Wallet } from "lucide-react";
import type { Features } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { ClickMark, PaynetMark } from "./brand";

/**
 * Top-up methods (owner 2026-11-12): ONE catalog that the wallet page's «To'ldirish usullari» list and
 * the top-up sheet's chooser both draw, so the two can never disagree.
 *
 *   - `app` / `card` / `phone`: the Click Merchant API methods (`payments.clickDirect`);
 *   - `click`: the plain Click checkout page, only while the Merchant API is not set up;
 *   - `paynet`: pay at a Paynet agent by the SlaydX ID (`payments.paynet`);
 *   - `payme`: the Payme checkout page (`payments.payme`).
 */
export type PayMethodId = "app" | "card" | "phone" | "click" | "paynet" | "payme";

export type PayMethod = {
  id: PayMethodId;
  name: string;
  hint: string;
  /** The wizard's step names after «Summa» (the step indicator). */
  steps: readonly string[];
};

const CATALOG: Record<PayMethodId, PayMethod> = {
  app: { id: "app", name: "Click ilovasi", hint: "Click ilovasida bir bosishda", steps: ["Tasdiqlash"] },
  card: { id: "card", name: "Bank kartasi", hint: "Uzcard, Humo va boshqa kartalar · SMS kod bilan", steps: ["Karta", "Tasdiqlash"] },
  phone: { id: "phone", name: "Telefon raqam", hint: "Click hisob-fakturasi telefoningizga keladi", steps: ["Telefon", "Tasdiqlash"] },
  click: { id: "click", name: "Click", hint: "Click sahifasida to'laysiz", steps: ["To'lov"] },
  paynet: { id: "paynet", name: "Paynet", hint: "Paynet ilovasi yoki terminali orqali", steps: ["Paynet"] },
  payme: { id: "payme", name: "Payme", hint: "Payme sahifasiga o'tasiz", steps: ["To'lov"] },
};

export function payMethod(id: PayMethodId): PayMethod {
  return CATALOG[id];
}

/** The methods the server has switched on, in the wallet's order: Click app, card, phone (or plain Click), Paynet, Payme. */
export function enabledPayMethods(payments: Features["payments"] | null | undefined): PayMethod[] {
  if (!payments) return [];
  const ids: PayMethodId[] = [];
  if (payments.click) {
    if (payments.clickDirect === true) ids.push("app", "card", "phone");
    else ids.push("click");
  }
  if (payments.paynet === true) ids.push("paynet");
  if (payments.payme) ids.push("payme");
  return ids.map((id) => CATALOG[id]);
}

const ICONS: Partial<Record<PayMethodId, ComponentType<{ className?: string; "aria-hidden"?: boolean }>>> = {
  card: CreditCard,
  phone: Smartphone,
  payme: Wallet,
};

/** The 40 px square badge of a method: the brand mark for Click / Paynet, an icon otherwise. */
export function MethodBadge({ id, className }: { id: PayMethodId; className?: string }) {
  const Icon = ICONS[id];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-[12px]",
        id === "app" || id === "click"
          ? "bg-[#0065FF]/10 dark:bg-[#4d8fff]/15"
          : id === "paynet"
            ? "bg-emerald-500/12 dark:bg-emerald-400/15"
            : "bg-accent-soft text-accent-soft-foreground",
        className,
      )}
    >
      {id === "app" || id === "click" ? (
        <ClickMark className="size-[22px]" />
      ) : id === "paynet" ? (
        <PaynetMark className="size-[22px]" />
      ) : Icon ? (
        <Icon aria-hidden className="size-5" />
      ) : null}
    </span>
  );
}

/**
 * The vertical list of method rows (badge, name, one-line hint, chevron) inside one card.
 * `hook` names the `data-*` attributes: `wallet` → `data-wallet-method`, `pay` → `data-pay-method`.
 */
export function MethodList({
  methods,
  hook,
  onPick,
  disabled = false,
  className,
}: {
  methods: readonly PayMethod[];
  hook: "wallet" | "pay";
  onPick: (id: PayMethodId) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("bg-card divide-y overflow-hidden rounded-[20px] border", className)}>
      {methods.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            {...{ [hook === "wallet" ? "data-wallet-method" : "data-pay-method"]: m.id }}
            disabled={disabled}
            onClick={() => onPick(m.id)}
            className="enabled:hover:bg-accent focus-visible:ring-ring flex min-h-[68px] w-full items-center gap-3 px-3.5 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-50"
          >
            <MethodBadge id={m.id} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] leading-tight font-semibold">{m.name}</span>
              <span className="text-muted-foreground mt-0.5 block text-[13px] leading-snug">{m.hint}</span>
            </span>
            <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
