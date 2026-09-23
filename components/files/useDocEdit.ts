"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getGeneration, type GenerationDetail } from "@/lib/api-client";
import {
  EDIT_CHUNK_OPS,
  editErrorCode,
  editErrorText,
  patchGenerationDoc,
  rebuildGeneration,
  restoreGenerationDoc,
} from "@/lib/api-edit";
import { UNDO_DEPTH } from "@/lib/generation/slide-limits";
import type { AcademicDoc } from "@/lib/generation/types";

/**
 * Ko'ruvchidagi tahrirning KLIENT OQIMI — hujjat TURIDAN mustaqil.
 *
 * Bitta qoida butun faylni tushuntiradi: **ekrandagi hujjat darhol
 * o'zgaradi, serverga esa FAQAT foydalanuvchi «Saqlash» deganda
 * boriladi**. Foydalanuvchi Enter bosgan zahoti `apply` yangi `doc`
 * beradi va ko'ruvchi uni qayta chizadi — tarmoqni kutish yo'q.
 *
 * AVTOMATIK SAQLASH YO'Q (AUDIT-10 talabi). Ilgari har tahrir 400 ms
 * dan keyin `PATCH`, undan 3 s keyin `rebuild` chaqirardi: bir necha
 * so'z yozgan foydalanuvchi o'nlab PATCH va bir nechta qayta yasashni
 * ishga tushirardi va «qachon saqlandi?» degan savolga javob yo'q edi.
 * Endi operatsiyalar navbatda YIG'ILADI, `pending` ularning sonini
 * beradi, `save()` esa ularni ≤{@link EDIT_CHUNK_OPS} lik bo'laklarda
 * (server bitta so'rovda 50 tadan ortig'ini rad etadi) ketma-ket
 * yuboradi va oxirida bir marta `rebuild` qiladi. Sahifadan chiqishda
 * saqlanmagan navbat bo'lsa brauzer ogohlantiradi (`beforeunload`).
 *
 * Serverdan kelgan `generation` — YAGONA haqiqat: uning `doc` i
 * optimistik nusxaning o'rniga qo'yiladi (server chegara bo'yicha
 * qisqartirgan bo'lishi mumkin); hali yuborilmagan op lar uning ustiga
 * qayta qo'llanadi.
 *
 * Saqlanmagan tahrir HECH QACHON jim yo'qolmaydi (FE-03):
 *   • navbatdan faqat server QABUL QILGAN op lar olinadi;
 *   • tarmoq/vaqt tugashi/429/5xx/413 — navbat va steklar joyida, xabar
 *     «Saqlanmadi — …», «Saqlash» qayta urinadi;
 *   • 409 (`version`/`status`/`legacy`), 400, 422 — server bu navbatni
 *     qabul qilmaydi: hujjat serverdan QAYTA YUKLANADI, steklar tozalanadi
 *     (eski stek boshqa hujjatga tegishli bo'lardi) va nechta o'zgarish
 *     qo'llanmagani AYTILADI; qayta yuklash ham yiqilsa navbat qoladi.
 *
 * Rezyume 2 (AUDIT-15) da bu mantiq `useSlideEdit` dan SO'ZMA-SO'Z
 * ko'chirildi va generik qilindi: farq atigi to'rt nuqta — qaysi
 * vositalar, hujjatda model bormi, oplar qanday qo'llanadi va
 * teskarilanadi. `useSlideEdit`/`useResumeEdit` — yupqa o'ramlar.
 */

/** Bitta undo qadami — oldinga va orqaga operatsiyalar juftligi. */
type UndoEntry<Op> = { forward: Op[]; inverse: Op[] };

/** Tahrirga yaroqli generatsiyaning KERAKLI qismi (`unknown` dan tekshirilgan). */
export type EditGen = {
  id: string;
  doc: AcademicDoc | null;
  docVersion: number;
  fileVersion: number;
  /**
   * Serverda `doc_prev` bormi — «Asl holatga qaytarish» tugmasi shuni
   * ko'rsatadi. `lib/api-client.ts` dagi tur bu maydonni hali e'lon
   * qilmagani uchun xom `gen` dan o'qiladi (server `rowToSummary` da
   * `has_prev` ustunidan beradi).
   */
  hasPrev: boolean;
  /** `onGen` uchun — versiyalarni ustiga qo'yib qaytaramiz. */
  raw: Record<string, unknown>;
};

/** «Saqlandi ✓» belgisining ko'rinish vaqti (ms). */
export const SAVED_FLASH_MS = 2000;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * `gen` propi `unknown` bo'lib keladi (ko'ruvchi uni sahifadan xom
 * oladi). Tahrir MOLIYAVIY emas, lekin `PATCH` yuboradi — shakl shu
 * yerda BIR MARTA tekshiriladi: nimasidir yetishmasa tahrir umuman
 * yoqilmaydi va ko'ruvchi eskicha, passiv ishlaydi.
 */
export function asEditGen(gen: unknown, tools: readonly string[]): EditGen | null {
  if (!gen || typeof gen !== "object") return null;
  const g = gen as Record<string, unknown>;
  if (typeof g.id !== "string" || !g.id) return null;
  // Tahrir FAQAT tayyor hujjatda: ish ketayotganda `doc_json` hali yakuniy emas.
  if (g.status !== "COMPLETED") return null;
  if (typeof g.type !== "string" || !tools.includes(g.type)) return null;
  const doc = g.doc && typeof g.doc === "object" ? (g.doc as AcademicDoc) : null;
  if (!doc) return null;
  return {
    id: g.id,
    doc,
    docVersion: num(g.docVersion),
    fileVersion: num(g.fileVersion),
    hasPrev: g.hasPrev === true,
    raw: g,
  };
}

export type ApplyOk = { ok: true; doc: AcademicDoc };
export type ApplyFail = { ok: false; error: string; at: number };

export type DocEditOptions<Op> = {
  gen?: unknown;
  onGen?: (g: unknown) => void;
  /** Testlar uchun — standart {@link SAVED_FLASH_MS}. */
  savedFlashMs?: number;
  /** Shu hujjat turining vosita idlari (`generation.type`). */
  tools: readonly string[];
  /** Hujjatda tahrir modeli bormi — yo'q bo'lsa `legacy` (tahrir o'chadi). */
  hasModel: (doc: AcademicDoc) => boolean;
  apply: (doc: AcademicDoc, ops: Op[], ctx: { genId: string }) => ApplyOk | ApplyFail;
  inverse: (doc: AcademicDoc, ops: Op[], ctx: { genId: string }) => Op[];
};

export type DocEdit<Op> = {
  /** Ekranga chiziladigan hujjat — tahrir yoqilmagan bo'lsa ham optimistik nusxa. */
  doc: AcademicDoc | null;
  /** Tahrir mumkinmi (tayyor hujjat + yangi format). */
  editable: boolean;
  /** Model yo'q — eski format, tahrir mumkin emas. */
  legacy: boolean;
  /** Operatsiyalarni qo'llaydi; `false` — mahalliy tekshiruv rad etdi (xato `error` da). */
  run: (ops: Op[]) => boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** SAQLANMAGAN operatsiyalar soni — «Saqlash (N o'zgarish)». */
  pending: number;
  /**
   * Navbatdagi operatsiyalarni (≤50 lik bo'laklarda) yuboradi va faylni
   * yangilaydi. `false` — hammasi saqlanmadi (sabab `error` da, navbat
   * joyida yoki qayta yuklangan); chaqiruvchi server tahririni boshlamaydi.
   */
  save: () => Promise<boolean>;
  /** PATCH uchayotgani. */
  saving: boolean;
  /** Endigina saqlandi — «Saqlandi ✓» ({@link SAVED_FLASH_MS} ms). */
  justSaved: boolean;
  /** Fayl hujjatdan orqada (yoki qayta yasalmoqda). */
  stale: boolean;
  rebuilding: boolean;
  error: string | null;
  clearError: () => void;
  /** Serverda BIRINCHI tahrirdan oldingi nusxa bormi («Asl holatga qaytarish»). */
  hasPrev: boolean;
  /**
   * Hujjatni birinchi tahrirdan OLDINGI holatga qaytaradi.
   *
   * Saqlanmagan navbat TASHLANADI (uni yuborish qaytarilgan hujjat
   * ustiga eski tahrirni qayta yozardi) va steklar tozalanadi.
   */
  restore: () => Promise<void>;
  /** Navbatni bo'shatadi va kerak bo'lsa faylni qayta yasaydi (yuklab olishdan oldin). */
  ensureFresh: () => Promise<void>;
  /**
   * «Asliga qaytarish» — SAQLANMAGAN o'zgarishlarni bekor qiladi.
   *
   * Faqat klientda: navbat tashlanadi, ekran oxirgi serverdan qabul
   * qilingan hujjatga (`baseDocRef`) qaytadi, undo/redo tozalanadi.
   * Serverga so'rov KETMAYDI (`restore` dan farqi shu).
   */
  discard: () => void;
  /** Generatsiya id (o'ramlar server chaqiruvlari uchun ishlatadi). */
  genId: string;
  /** Joriy `doc_version` — server chaqiruvidagi `baseVersion`. */
  version: number;
  /**
   * SERVERDA bajariladigan o'zgarish (rasm/surat yuklash).
   *
   * Ular hujjat versiyasini o'zgartirgani uchun avval navbat SAQLANADI,
   * keyin steklar tozalanadi: undo eski holatni qaytarsa yangi rasm jim
   * yo'qolardi. Optimistik nusxa yo'q.
   */
  serverEdit: (call: (baseVersion: number) => Promise<{ generation: GenerationDetail }>) => Promise<void>;
};

export function useDocEdit<Op>({
  gen,
  onGen,
  savedFlashMs = SAVED_FLASH_MS,
  tools,
  hasModel,
  apply,
  inverse,
}: DocEditOptions<Op>): DocEdit<Op> {
  const g = useMemo(() => asEditGen(gen, tools), [gen, tools]);
  const genId = g?.id ?? "";
  const legacy = Boolean(g && (!g.doc || !hasModel(g.doc)));
  const editable = Boolean(g && !legacy);

  const [doc, setDoc] = useState<AcademicDoc | null>(g?.doc ?? null);
  const [version, setVersion] = useState(g?.docVersion ?? 0);
  const [fileVersion, setFileVersion] = useState(g?.fileVersion ?? 0);
  const [hasPrev, setHasPrev] = useState(g?.hasPrev ?? false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saqlanmagan operatsiyalar REF da (async oqim ularni ko'radi), soni holatda.
  const queueRef = useRef<Op[]>([]);
  const [pending, setPending] = useState(0);
  // Steklar REF da, uzunliklari holatda (render).
  const undoRef = useRef<UndoEntry<Op>[]>([]);
  const redoRef = useRef<UndoEntry<Op>[]>([]);
  const [stacks, setStacks] = useState({ undo: 0, redo: 0 });
  const bump = useCallback(() => {
    setStacks({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, []);

  const docRef = useRef(doc);
  // Oxirgi SAQLANGAN (serverdan kelgan) hujjat — `discard` shunga qaytaradi.
  const baseDocRef = useRef<AcademicDoc | null>(g?.doc ?? null);
  const versionRef = useRef(version);
  const fileRef = useRef(fileVersion);
  const onGenRef = useRef(onGen);
  const rawRef = useRef<Record<string, unknown>>(g?.raw ?? {});
  onGenRef.current = onGen;
  /*
   * `apply` REF da: o'ramlar uni har renderda yangi funksiya qilib beradi
   * (`useResumeEdit`), `save` esa unga bog'lansa har renderda yangilanib,
   * ko'ruvchining `onEditState` effekti → sahifa holati → render halqasiga
   * tushardi.
   */
  const applyRef = useRef(apply);
  applyRef.current = apply;
  rawRef.current = g?.raw ?? rawRef.current;

  const inflightRef = useRef<Promise<boolean> | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (flashRef.current) clearTimeout(flashRef.current);
    };
  }, []);

  /** Serverdan kelgan generatsiyani o'zlashtiradi (haqiqat manbai). */
  const adopt = useCallback((gd: Partial<GenerationDetail> & Record<string, unknown>) => {
    if (gd.doc && typeof gd.doc === "object") {
      docRef.current = gd.doc as AcademicDoc;
      baseDocRef.current = gd.doc as AcademicDoc;
      setDoc(gd.doc as AcademicDoc);
    }
    versionRef.current = num(gd.docVersion);
    fileRef.current = num(gd.fileVersion);
    setVersion(versionRef.current);
    setFileVersion(fileRef.current);
    setHasPrev((gd as Record<string, unknown>).hasPrev === true);
    rawRef.current = gd as Record<string, unknown>;
    onGenRef.current?.(gd);
  }, []);

  /*
   * Tashqi `gen` o'zgarganda hujjatni FAQAT server bizdan yangiroq
   * bo'lsa olamiz. Aks holda `onGen` → sahifa holati → qayta render
   * halqasi optimistik tahrirni har safar orqaga tashlardi.
   */
  useEffect(() => {
    if (!g) return;
    if (docRef.current === null || g.docVersion > versionRef.current) {
      docRef.current = g.doc;
      baseDocRef.current = g.doc;
      versionRef.current = g.docVersion;
      fileRef.current = g.fileVersion;
      setDoc(g.doc);
      setVersion(g.docVersion);
      setFileVersion(g.fileVersion);
      setHasPrev(g.hasPrev);
    }
  }, [g]);

  /*
   * Saqlanmagan tahrir bilan sahifadan chiqish — OGOHLANTIRISH.
   *
   * Avtomatik saqlash olib tashlangani uchun bu himoya majburiy:
   * yopilgan yorliq bilan birga yigirma daqiqalik tahrir yo'qolardi.
   * Navbat bo'sh bo'lsa tinglovchi umuman ulanmaydi — brauzer bekorga
   * «chiqasizmi?» so'ramasin.
   */
  useEffect(() => {
    if (!pending) return;
    if (typeof window === "undefined") return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Eski brauzerlar uchun (matn ko'rsatilmaydi, faqat bayroq).
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [pending]);

  /**
   * Serverdan qayta yuklaydi va steklarni tozalaydi (409 va boshqa
   * xatolardan keyin). `false` — qayta yuklash ham yiqildi: ekrandagi
   * hujjat VA steklar joyida qoladi (chaqiruvchi navbatni ham saqlaydi,
   * aks holda ekrandagi tahrir «saqlangan»dek ko'rinardi).
   */
  const reload = useCallback(async (): Promise<boolean> => {
    if (!genId) return false;
    try {
      const { generation } = await getGeneration(genId);
      if (!aliveRef.current) return false;
      adopt(generation);
    } catch {
      // Xato matnini chaqiruvchi ko'rsatadi (u `false` ni ko'radi).
      return false;
    }
    undoRef.current = [];
    redoRef.current = [];
    bump();
    return true;
  }, [genId, adopt, bump]);

  /**
   * Server javobini o'zlashtiradi va hali YUBORILMAGAN op larni uning
   * ustiga qayta qo'llaydi: saqlash davomida yoki yiqilgan bo'lakdan
   * keyin navbatda qolgan tahrir ekrandan yo'qolmasin.
   */
  const adoptKeepingQueue = useCallback(
    (gd: GenerationDetail) => {
      adopt(gd);
      const rest = queueRef.current;
      if (!rest.length || !gd.doc) return;
      const res = applyRef.current(gd.doc, rest, { genId });
      if (res.ok) {
        docRef.current = res.doc;
        setDoc(res.doc);
      } else {
        // Server hujjatni qisqartirgan bo'lsa navbatdagi op endi qo'llanmaydi.
        setError(`Saqlanmagan o‘zgarishni qo‘llab bo‘lmadi: ${res.error}`);
      }
    },
    [adopt, genId],
  );

  const doRebuild = useCallback(async () => {
    if (!genId) return;
    if (fileRef.current >= versionRef.current) return;
    setRebuilding(true);
    try {
      const r = await rebuildGeneration(genId);
      if (!aliveRef.current) return;
      fileRef.current = r.fileVersion;
      setFileVersion(r.fileVersion);
      const merged = { ...rawRef.current, fileVersion: r.fileVersion, docVersion: r.docVersion };
      rawRef.current = merged;
      onGenRef.current?.(merged);
    } catch (e) {
      if (aliveRef.current) setError(editErrorText(e));
    } finally {
      if (aliveRef.current) setRebuilding(false);
    }
  }, [genId]);

  /**
   * Yiqilgan saqlashni hal qiladi. `sent` — shu saqlashda server qabul
   * qilgan op lar (ular navbatdan allaqachon olingan), `unsent` — yuborilmay
   * qolgan snapshot qismi.
   *
   * Server bu navbatni HECH QACHON qabul qilmaydigan xatolar (409
   * `version`/`status`/`legacy`, 400 yaroqsiz op, 422 qo'llanmaydi) —
   * hujjat qayta yuklanadi va navbat tashlanadi, lekin JIM emas: nechta
   * o'zgarish qo'llanmagani aytiladi. Qayta yuklash ham yiqilsa navbat
   * QOLADI (ekrandagi tahrir «saqlangan»dek ko'rinmasin). Qolgan hamma
   * xato (tarmoq, vaqt tugashi, 429, 5xx, 413, 401) — navbat va steklar
   * joyida, «Saqlash» qayta urinadi.
   */
  const settleFailure = useCallback(
    async (e: unknown, unsent: number) => {
      const text = editErrorText(e);
      const rejected =
        e instanceof ApiError && (e.status === 400 || e.status === 422 || editErrorCode(e) !== null);
      if (!rejected) {
        if (aliveRef.current) setError(`Saqlanmadi — qayta urinish uchun «Saqlash» ni bosing. ${text}`);
        return;
      }
      const reloaded = await reload();
      if (!aliveRef.current) return;
      if (reloaded) {
        queueRef.current = [];
        setPending(0);
        setError(`${text} Saqlanmagan ${unsent} ta o‘zgarish qo‘llanmadi.`);
      } else {
        setError(`${text} Hujjatni qayta yuklab bo‘lmadi — saqlanmagan o‘zgarishlar hali ekranda.`);
      }
    },
    [reload],
  );

  /**
   * «Saqlash» — navbat ≤{@link EDIT_CHUNK_OPS} lik bo'laklarda, ketma-ket
   * (har bo'lak oldingisining javobidagi `docVersion` bilan), keyin bitta
   * `rebuild`. Bir vaqtda faqat bitta saqlash uchadi (ikkinchi bosish
   * birinchisini kutadi), aks holda ikki PATCH bir xil `baseVersion` bilan
   * yo'lga chiqib, ikkinchisi 409 olardi.
   *
   * Saqlash boshida navbat uzunligi olinadi (snapshot): shu vaqt ichida
   * kiritilgan yangi tahrir navbat oxiriga qo'shiladi va keyingi
   * «Saqlash» gacha kutadi. Navbatdan FAQAT server qabul qilgan op lar
   * olinadi. 413 (tana juda katta) — bo'lak ikkiga bo'linib qayta ketadi.
   */
  const save = useCallback(async (): Promise<boolean> => {
    if (inflightRef.current) await inflightRef.current;
    if (!genId) return true;
    const total = queueRef.current.length;
    if (!total) return true;
    setSaving(true);
    setError(null);
    if (flashRef.current) clearTimeout(flashRef.current);
    setJustSaved(false);
    const p = (async (): Promise<boolean> => {
      let sent = 0;
      let size = EDIT_CHUNK_OPS;
      let last: GenerationDetail | null = null;
      let failure: { e: unknown } | null = null;
      try {
        while (sent < total) {
          const chunk = queueRef.current.slice(0, Math.min(size, total - sent));
          let generation: GenerationDetail;
          try {
            ({ generation } = await patchGenerationDoc(genId, versionRef.current, chunk as unknown[]));
          } catch (e) {
            if (e instanceof ApiError && e.status === 413 && chunk.length > 1) {
              size = Math.ceil(chunk.length / 2);
              continue;
            }
            throw e;
          }
          // Server shu bo'lakni qabul qildi — endi u navbatda emas.
          queueRef.current = queueRef.current.slice(chunk.length);
          sent += chunk.length;
          versionRef.current = num(generation.docVersion);
          fileRef.current = num(generation.fileVersion);
          last = generation;
          if (aliveRef.current) setPending(queueRef.current.length);
        }
      } catch (e) {
        failure = { e };
      }
      // Qisman muvaffaqiyat ham serverdagi haqiqat — ekranga olinadi.
      if (last && aliveRef.current) adoptKeepingQueue(last);
      if (failure) {
        // Qayta yuklash tugaguncha keyingi «Saqlash» kutadi (`inflightRef`).
        await settleFailure(failure.e, total - sent);
        inflightRef.current = null;
        if (aliveRef.current) {
          setPending(queueRef.current.length);
          setSaving(false);
        }
        return false;
      }
      inflightRef.current = null;
      if (aliveRef.current) setSaving(false);
      // Fayl darhol quvib yetadi: «Saqlash» dan keyin «Yuklab olish»
      // eski faylni bermasligi kerak.
      await doRebuild();
      if (!aliveRef.current) return true;
      setJustSaved(true);
      flashRef.current = setTimeout(() => {
        flashRef.current = null;
        if (aliveRef.current) setJustSaved(false);
      }, savedFlashMs);
      return true;
    })();
    inflightRef.current = p;
    return p;
  }, [genId, adoptKeepingQueue, settleFailure, doRebuild, savedFlashMs]);

  const saveRef = useRef(save);
  saveRef.current = save;

  /** Optimistik qo'llash + navbatga qo'shish. Stek juftligi chaqiruvchida hal qilinadi. */
  const push = useCallback(
    (ops: Op[], stack: "undo" | "redo" | "new"): boolean => {
      const base = docRef.current;
      if (!base || !genId || !ops.length) return false;
      const res = apply(base, ops, { genId });
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      const inv = inverse(base, ops, { genId });
      docRef.current = res.doc;
      setDoc(res.doc);
      const entry: UndoEntry<Op> = { forward: ops, inverse: inv };
      if (stack === "new") {
        undoRef.current = [...undoRef.current, entry].slice(-UNDO_DEPTH);
        // Yangi tahrir «kelajakni» o'chiradi — brauzer tarixi kabi.
        redoRef.current = [];
      } else if (stack === "undo") {
        undoRef.current = [...undoRef.current, entry].slice(-UNDO_DEPTH);
      } else {
        redoRef.current = [...redoRef.current, entry].slice(-UNDO_DEPTH);
      }
      bump();
      queueRef.current.push(...ops);
      setPending(queueRef.current.length);
      setError(null);
      setJustSaved(false);
      return true;
    },
    [genId, bump, apply, inverse],
  );

  const run = useCallback((ops: Op[]) => push(ops, "new"), [push]);

  const undo = useCallback(() => {
    const e = undoRef.current[undoRef.current.length - 1];
    if (!e) return;
    undoRef.current = undoRef.current.slice(0, -1);
    // Teskarisini qo'llaymiz; uning o'zining teskarisi — REDO qadami.
    if (!push(e.inverse, "redo")) undoRef.current = [...undoRef.current, e];
    bump();
  }, [push, bump]);

  const redo = useCallback(() => {
    const e = redoRef.current[redoRef.current.length - 1];
    if (!e) return;
    redoRef.current = redoRef.current.slice(0, -1);
    if (!push(e.inverse, "undo")) redoRef.current = [...redoRef.current, e];
    bump();
  }, [push, bump]);

  const ensureFresh = useCallback(async () => {
    // Saqlash yiqilsa ham saqlangan qism uchun fayl yangilanadi; saqlanmagan
    // qism `pending` da ko'rinib turadi.
    await saveRef.current();
    await doRebuild();
  }, [doRebuild]);

  const discard = useCallback(() => {
    queueRef.current = [];
    setPending(0);
    const base = baseDocRef.current;
    if (base) {
      docRef.current = base;
      setDoc(base);
    }
    // Steklar ham tozalanadi: Ctrl+Z endi bekor qilingan tahrirni «qaytarib» qo'ymasin.
    undoRef.current = [];
    redoRef.current = [];
    bump();
    setError(null);
    setJustSaved(false);
  }, [bump]);

  /**
   * «Asl holatga qaytarish» — server `doc_prev` dan tiklaydi.
   *
   * Navbat OLDIN tashlanadi, keyin so'rov ketadi: qaytarilgan hujjat
   * ustiga saqlanmagan tahrirni yuborish «qaytardim, lekin baribir
   * o'zgargan» degan holatga olib kelardi. Muvaffaqiyatdan keyin
   * steklar ham bo'shaydi va fayl darhol quvib yetadi.
   */
  const restore = useCallback(async () => {
    if (!genId) return;
    if (inflightRef.current) await inflightRef.current;
    // Tiklash YIQILSA (tarmoq, 5xx) navbat qaytariladi — aks holda
    // ekrandagi tahrir «saqlangan»dek ko'rinib, jim yo'qolardi.
    const dropped = queueRef.current;
    queueRef.current = [];
    setPending(0);
    setSaving(true);
    try {
      const { generation } = await restoreGenerationDoc(genId);
      if (!aliveRef.current) return;
      adopt(generation);
      undoRef.current = [];
      redoRef.current = [];
      bump();
    } catch (e) {
      if (aliveRef.current) setError(editErrorText(e));
      // 409 (`no_prev`/`status`) — serverdagi haqiqat boshqa; qayta yuklaymiz.
      if (editErrorCode(e) && (await reload())) return;
      queueRef.current = [...dropped, ...queueRef.current];
      if (aliveRef.current) setPending(queueRef.current.length);
      return;
    } finally {
      if (aliveRef.current) setSaving(false);
    }
    await doRebuild();
  }, [genId, adopt, bump, reload, doRebuild]);

  /*
   * Rasm/surat operatsiyalari SERVERDA bajariladi (bayt yuklash) —
   * optimistik nusxa yo'q. Ular hujjat versiyasini o'zgartirgani uchun
   * avval navbat SAQLANADI, keyin steklar tozalanadi.
   */
  const serverEdit = useCallback(
    async (call: (baseVersion: number) => Promise<{ generation: GenerationDetail }>) => {
      if (!genId) return;
      // Navbat saqlanmagan bo'lsa server tahriri BOSHLANMAYDI: u versiyani
      // oshirib, navbatdagi op larni eski asosga osiltirib qo'yardi.
      if (!(await saveRef.current())) return;
      setSaving(true);
      try {
        const { generation } = await call(versionRef.current);
        if (aliveRef.current) {
          adopt(generation);
          undoRef.current = [];
          redoRef.current = [];
          bump();
        }
      } catch (e) {
        if (aliveRef.current) setError(editErrorText(e));
        if (editErrorCode(e)) await reload();
      } finally {
        if (aliveRef.current) setSaving(false);
      }
    },
    [genId, adopt, bump, reload],
  );

  return {
    doc: doc ?? g?.doc ?? null,
    editable,
    legacy,
    run,
    undo,
    redo,
    canUndo: stacks.undo > 0,
    canRedo: stacks.redo > 0,
    pending,
    save,
    saving,
    justSaved,
    stale: fileVersion < version,
    rebuilding,
    error,
    clearError: useCallback(() => setError(null), []),
    hasPrev,
    restore,
    ensureFresh,
    discard,
    genId,
    version,
    serverEdit,
  };
}
