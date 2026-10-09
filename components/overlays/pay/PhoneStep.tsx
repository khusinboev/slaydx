"use client";

import { useId, useState, type FormEvent } from "react";
import * as api from "@/lib/api-client";
import { formatPhoneLocal, normalizePhone, phoneError } from "@/lib/click-input";
import { groupDigits } from "@/lib/format";
import { fieldError, fieldLabel, inputCls, primaryBtn, textBtn } from "./ui";

/**
 * «Telefon raqam»: an invoice for the order goes to the Click app registered on this phone
 * (+998 is fixed, the user types the 9 digits). The user confirms it in the app; Click then
 * calls our Shop API and the dialog (`WaitStep`) sees the order paid.
 */
export function PhoneStep({
  orderId,
  amount,
  onBack,
  onSent,
}: {
  orderId: string;
  amount: number;
  onBack: () => void;
  onSent: () => void;
}) {
  const uid = useId();
  const [phone, setPhone] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const err = phoneError(phone);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    const normalized = normalizePhone(phone);
    if (!normalized) return;
    setBusy(true);
    try {
      await api.clickInvoice({ orderId, phone: normalized });
      onSent();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Hisob yuborilmadi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate data-pay-step="phone">
      <p className="text-muted-foreground mb-4 text-[14.5px] leading-snug">
        Click ilovasi ulangan telefon raqamni kiriting — {groupDigits(amount)} so&apos;mlik hisob ilovaga yuboriladi, uni ilovada tasdiqlaysiz.
      </p>
      <label htmlFor={`${uid}-phone`} className={fieldLabel}>
        Telefon raqam
      </label>
      <div className="relative">
        <span aria-hidden className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-base tabular-nums">
          +998
        </span>
        <input
          id={`${uid}-phone`}
          data-pay-phone
          value={phone}
          inputMode="tel"
          autoComplete="tel-national"
          disabled={busy}
          autoFocus
          aria-invalid={touched && err !== null}
          aria-describedby={touched && err ? `${uid}-phone-err` : undefined}
          onChange={(e) => setPhone(formatPhoneLocal(e.target.value))}
          placeholder="90 123 45 67"
          className={`${inputCls} pl-[3.75rem]`}
        />
      </div>
      {touched && err ? (
        <p id={`${uid}-phone-err`} role="alert" className={fieldError}>
          {err}
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-pay-error className={fieldError}>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={`${primaryBtn} mt-4`} data-pay-submit>
        {busy ? "Yuborilmoqda..." : "Hisob yuborish"}
      </button>
      <div className="mt-2">
        <button type="button" disabled={busy} className={textBtn} onClick={onBack}>
          Orqaga
        </button>
      </div>
    </form>
  );
}
