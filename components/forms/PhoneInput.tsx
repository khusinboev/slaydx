"use client";

import { formatPhone, normalizePhone } from "@/lib/phone";

/**
 * Telefon maydoni (Rezyume 2, 1-band).
 *
 * Foydalanuvchi raqamlarni yozadi — maydon `+` va guruhlarni O'ZI qo'yadi
 * (`+998 90 123 45 67`). Tashqariga esa DOIM normal shakl chiqadi
 * (`+998901234567`): rezyumeda va profilda bir xil raqam ikki xil
 * yozilmasin. Kursor formatlashdan keyin oxirida qoladi — o'rtasiga
 * yozish bu maydonda kam uchraydi, kursorni saqlashga urinish esa
 * guruh chegaralarida sakrashga olib kelardi.
 */
export function PhoneInput({
  value,
  onChange,
  id,
  placeholder = "+998 90 123 45 67",
}: {
  value: string;
  onChange: (normalized: string) => void;
  id?: string;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      aria-label="Telefon"
      value={formatPhone(value)}
      placeholder={placeholder}
      onChange={(e) => onChange(normalizePhone(e.target.value))}
      className="border-input bg-card focus:ring-ring h-9 w-full max-w-xs rounded-lg border px-2.5 text-[13px] outline-none focus:ring-2"
    />
  );
}
