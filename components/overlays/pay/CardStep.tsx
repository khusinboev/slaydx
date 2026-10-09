"use client";

import { useId, useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import * as api from "@/lib/api-client";
import { cardNumberError, formatCardNumber, formatExpiry, parseExpiry, smsCodeError } from "@/lib/click-input";
import { groupDigits } from "@/lib/format";
import { fieldError, fieldLabel, inputCls, primaryBtn, textBtn } from "./ui";

export type PayStatus = "paid" | "pending" | "cancelled";

/**
 * «Karta»: our own card form (Click one-time card token + SMS confirmation).
 *
 * Step 1 — card number + expiry -> Click texts a code to the card owner;
 * step 2 — the code -> Click charges the card; the balance is credited by Click's
 * Shop API call, so the dialog then waits for the order (`WaitStep`).
 *
 * The card number, expiry and code live ONLY in this component's state: nothing is stored
 * (no store, no storage, no URL, no logging) and they disappear when the step unmounts.
 */
export function CardStep({
  orderId,
  amount,
  onBack,
  onSubmitted,
}: {
  orderId: string;
  amount: number;
  onBack: () => void;
  onSubmitted: (status: "paid" | "pending") => void;
}) {
  const uid = useId();
  const [stage, setStage] = useState<"form" | "sms">("form");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [sms, setSms] = useState("");
  const [phoneMasked, setPhoneMasked] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numberErr = cardNumberError(number);
  const exp = parseExpiry(expiry);
  const expiryErr = exp.ok ? null : exp.error;
  const smsErr = smsCodeError(sms);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (numberErr || !exp.ok) return;
    setBusy(true);
    try {
      const r = await api.clickCardStart({ orderId, cardNumber: number, expireDate: exp.mmyy });
      setPhoneMasked(r.phoneMasked);
      setSms("");
      setTouched(false);
      setStage("sms");
    } catch (err) {
      setError(err instanceof Error ? err.message : "SMS kod yuborilmadi");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (smsErr) return;
    setBusy(true);
    try {
      const r = await api.clickCardConfirm({ orderId, smsCode: sms });
      if (r.status === "cancelled") {
        setError("To'lov bekor qilindi. Qayta urinib ko'ring");
        return;
      }
      // Done with the card: drop it from memory before the next step.
      setNumber("");
      setExpiry("");
      setSms("");
      onSubmitted(r.status);
    } catch (err) {
      const code = err instanceof api.ApiError ? err.data.code : undefined;
      setError(err instanceof Error ? err.message : "To'lov o'tmadi");
      // The one-time token is gone (spent, expired or never issued): start over from the card.
      if (code === "no_token") {
        setStage("form");
        setSms("");
        setTouched(false);
      }
    } finally {
      setBusy(false);
    }
  }

  if (stage === "sms") {
    return (
      <form onSubmit={confirm} noValidate data-pay-step="card-sms">
        <p className="text-muted-foreground mb-4 text-[14.5px] leading-snug">
          Click {phoneMasked ? <span className="text-foreground font-semibold tabular-nums">{phoneMasked}</span> : "karta egasining"} raqamiga
          SMS kod yubordi. Kodni kiriting — {groupDigits(amount)} so&apos;m to&apos;lanadi.
        </p>
        <label htmlFor={`${uid}-sms`} className={fieldLabel}>
          SMS kod
        </label>
        <input
          id={`${uid}-sms`}
          data-pay-sms
          value={sms}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          disabled={busy}
          autoFocus
          aria-invalid={touched && smsErr !== null}
          aria-describedby={touched && smsErr ? `${uid}-sms-err` : undefined}
          onChange={(e) => setSms(e.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder="••••••"
          className={`${inputCls} text-center text-lg tracking-[0.4em]`}
        />
        {touched && smsErr ? (
          <p id={`${uid}-sms-err`} role="alert" className={fieldError}>
            {smsErr}
          </p>
        ) : null}
        {error ? (
          <p role="alert" data-pay-error className={fieldError}>
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={`${primaryBtn} mt-4`} data-pay-submit>
          {busy ? "To'lanmoqda..." : `To'lash — ${groupDigits(amount)} so'm`}
        </button>
        <div className="mt-2 flex justify-between">
          <button
            type="button"
            disabled={busy}
            className={textBtn}
            onClick={() => {
              setStage("form");
              setError(null);
              setSms("");
            }}
          >
            Kartani o&apos;zgartirish
          </button>
          <button type="button" disabled={busy} className={textBtn} onClick={onBack}>
            Orqaga
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} noValidate data-pay-step="card">
      <label htmlFor={`${uid}-number`} className={fieldLabel}>
        Karta raqami
      </label>
      <input
        id={`${uid}-number`}
        data-pay-card-number
        value={number}
        inputMode="numeric"
        autoComplete="cc-number"
        disabled={busy}
        autoFocus
        aria-invalid={touched && numberErr !== null}
        aria-describedby={touched && numberErr ? `${uid}-number-err` : undefined}
        onChange={(e) => setNumber(formatCardNumber(e.target.value))}
        placeholder="8600 0000 0000 0000"
        className={inputCls}
      />
      {touched && numberErr ? (
        <p id={`${uid}-number-err`} role="alert" className={fieldError}>
          {numberErr}
        </p>
      ) : null}

      <label htmlFor={`${uid}-exp`} className={`${fieldLabel} mt-3`}>
        Amal qilish muddati
      </label>
      <input
        id={`${uid}-exp`}
        data-pay-card-expiry
        value={expiry}
        inputMode="numeric"
        autoComplete="cc-exp"
        disabled={busy}
        aria-invalid={touched && expiryErr !== null}
        aria-describedby={touched && expiryErr ? `${uid}-exp-err` : undefined}
        onChange={(e) => setExpiry(formatExpiry(e.target.value))}
        placeholder="OO/YY"
        maxLength={5}
        className={`${inputCls} max-w-40`}
      />
      {touched && expiryErr ? (
        <p id={`${uid}-exp-err`} role="alert" className={fieldError}>
          {expiryErr}
        </p>
      ) : null}

      <p className="text-muted-foreground mt-3 flex items-start gap-1.5 text-[13px] leading-snug">
        <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Uzcard va Humo kartalari. Karta ma&apos;lumotlari saqlanmaydi — ular faqat Click&apos;ga yuboriladi.
      </p>

      {error ? (
        <p role="alert" data-pay-error className={fieldError}>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={`${primaryBtn} mt-4`} data-pay-submit>
        {busy ? "Yuborilmoqda..." : "SMS kod olish"}
      </button>
      <div className="mt-2">
        <button type="button" disabled={busy} className={textBtn} onClick={onBack}>
          Orqaga
        </button>
      </div>
    </form>
  );
}
