/**
 * Fayldan matn olish chegaralari — BRAUZER uchun yengil barg modul (FE-11).
 *
 * Formalar (`SourceFileField`, `shared/SourceFileRow`) faqat shu ikki
 * qiymatni o'qiydi. Ilgari ular `lib/extract-text.ts` dan olinardi va
 * u orqali JSZip + PDF o'quvchi (~160 KB) HAR vosita sahifasiga tushardi.
 *
 * Server manbasi (`lib/extract-text.ts`) bilan tengligini
 * `tests/bundle-split.test.mts` qulflaydi — birini o'zgartirsangiz,
 * ikkinchisini ham o'zgartiring (yoki `extract-text.ts` shu fayldan
 * qayta eksport qilsin).
 */
export const EXTRACT_ACCEPT = ".txt,.md,.csv,.docx,.pdf,.pptx,.xlsx";
export const EXTRACT_MAX_BYTES = 8 * 1024 * 1024;
