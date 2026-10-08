import type { Permission } from "@/lib/server/admin-rbac";

/**
 * Uzbek names of the RBAC permissions (docs/admin/02-plan.md §4.2–§4.3) for
 * the UI ("Mening hisobim" lists them). Typed as a full `Record<Permission, …>`
 * so a new server permission without a label fails the typecheck;
 * tests/admin-permission-labels.test.mts checks the same at runtime against
 * the server matrix. Type-only import: no server code reaches the client.
 */
export const PERMISSION_LABELS: Readonly<Record<Permission, string>> = Object.freeze({
  "dashboard.view": "Bosh sahifani ko'rish",
  "users.view": "Foydalanuvchilarni ko'rish",
  "users.pii": "Foydalanuvchi telefon raqamini ochish",
  "users.export": "Foydalanuvchilarni eksport qilish",
  "users.block": "Foydalanuvchini bloklash",
  "users.sessions": "Foydalanuvchi sessiyalarini bekor qilish",
  "users.wallet": "Hamyonni tuzatish",
  "users.message": "Foydalanuvchiga xabar yuborish",
  "jobs.view": "Generatsiyalarni ko'rish",
  "jobs.input": "Generatsiya kiritmalari va fayllarini ko'rish",
  "jobs.export": "Generatsiyalarni eksport qilish",
  "jobs.cancel": "Generatsiyani bekor qilish yoki to'xtatish",
  "jobs.refund": "Generatsiya uchun pulni qaytarish",
  "payments.view": "To'lovlarni ko'rish",
  "payments.export": "To'lovlarni eksport qilish",
  "payments.refund_record": "Tashqi qaytarishni qayd etish",
  "finance.view": "Moliyani ko'rish",
  "finance.export": "Moliya jurnalini eksport qilish",
  "ai.view": "AI xarajatlarini ko'rish",
  "moderation.view": "Moderatsiyani ko'rish",
  "moderation.act": "Moderatsiya amallarini bajarish",
  "broadcasts.view": "E'lonlarni ko'rish",
  "broadcasts.send": "E'lon yuborish",
  "settings.view": "Sozlamalarni ko'rish",
  "settings.edit": "Sozlamalarni o'zgartirish",
  "system.view": "Tizim holatini ko'rish",
  "errors.view": "Xatolarni ko'rish",
  "errors.resolve": "Xatolarni hal qilingan deb belgilash",
  "audit.view": "Audit jurnalini ko'rish",
  "audit.export": "Audit jurnalini eksport qilish",
  "pricing.view": "Narxlarni ko'rish",
  "pricing.edit": "Narxlarni o'zgartirish",
  "bonus.view": "Bonus kanallarni ko'rish",
  "bonus.edit": "Bonus kanallarni boshqarish",
  "admins.view": "Adminlarni ko'rish",
  "admins.manage": "Adminlarni boshqarish",
  self: "O'z hisobim: sessiyalar va tiklash kodlari",
});

/** Uzbek label of a permission; an unknown key (newer server than client) falls back to the raw key. */
export function permissionLabel(permission: string): string {
  return Object.prototype.hasOwnProperty.call(PERMISSION_LABELS, permission) ? PERMISSION_LABELS[permission as Permission] : permission;
}
