"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGeneration, type GenerationDetail } from "@/lib/api-client";
import {
  editErrorCode,
  editErrorText,
  patchGenerationDoc,
  rebuildGeneration,
  regenerateSlideImage,
  uploadSlideImage,
} from "@/lib/api-edit";
import { applyDocOps, inverseOps, type DocOp } from "@/lib/generation/slide-edit";
import { IMAGE_REDRAW_LIMIT, UNDO_DEPTH } from "@/lib/generation/slide-limits";
import type { AcademicDoc } from "@/lib/generation/types";

/**
 * Ko'ruvchidagi tahrirning KLIENT OQIMI.
 *
 * Bitta qoida butun faylni tushuntiradi: **ekrandagi hujjat darhol
 * o'zgaradi, serverga esa FAQAT foydalanuvchi «Saqlash» deganda
 * boriladi**. Foydalanuvchi Enter bosgan zahoti `applyDocOps` yangi
 * `doc` beradi va `planSlide` uni qayta chizadi (shrift o'zi qayta
 * hisoblanadi) — tarmoqni kutish yo'q.
 *
 * AVTOMATIK SAQLASH YO'Q (AUDIT-10 talabi). Ilgari har tahrir 400 ms
 * dan keyin `PATCH`, undan 3 s keyin `rebuild` chaqirardi: bir necha
 * so'z yozgan foydalanuvchi o'nlab PATCH va bir nechta PPTX qayta
 * yasashni ishga tushirardi va «qachon saqlandi?» degan savolga javob
 * yo'q edi. Endi operatsiyalar navbatda YIG'ILADI, `pending` ularning
 * sonini beradi, `save()` esa hammasini BITTA `PATCH` bilan yuboradi va
 * darhol `rebuild` qiladi. Sahifadan chiqishda saqlanmagan navbat
 * bo'lsa brauzer ogohlantiradi (`beforeunload`).
 *
 * Serverdan kelgan `generation` — YAGONA haqiqat: uning `doc` i
 * optimistik nusxaning o'rniga qo'yiladi (server chegara bo'yicha
 * qisqartirgan yoki `renumberSlides` qilgan bo'lishi mumkin).
 *
 * Har qanday PATCH xatosida (409 `version`/`status`, tarmoq, 422)
 * hujjat serverdan QAYTA YUKLANADI va undo/redo steklari tozalanadi:
 * eski stek endi boshqa hujjatga tegishli bo'lardi va Ctrl+Z boshqa
 * slaydni buzardi.
 */

/** Bitta undo qadami — oldinga va orqaga operatsiyalar juftligi. */
type UndoEntry = { forward: DocOp[]; inverse: DocOp[] };

/** Tahrirga yaroqli generatsiyaning KERAKLI qismi (`unknown` dan tekshirilgan). */
export type EditGen = {
  id: string;
  doc: AcademicDoc | null;
  docVersion: number;
  fileVersion: number;
  imageRedraws: number;
  /** `onGen` uchun — versiyalarni ustiga qo'yib qaytaramiz. */
  raw: Record<string, unknown>;
};

/** «Saqlandi ✓» belgisining ko'rinish vaqti (ms). */
export const SAVED_FLASH_MS = 2000;

/**
 * `gen` propi `unknown` bo'lib keladi (ko'ruvchi uni sahifadan xom
 * oladi). Tahrir MOLIYAVIY emas, lekin `PATCH` yuboradi — shakl shu
 * yerda BIR MARTA tekshiriladi: nimasidir yetishmasa tahrir umuman
 * yoqilmaydi va ko'ruvchi eskicha, passiv ishlaydi.
 */
export function asEditGen(gen: unknown): EditGen | null {
  if (!gen || typeof gen !== "object") return null;
  const g = gen as Record<string, unknown>;
  if (typeof g.id !== "string" || !g.id) return null;
  // Tahrir FAQAT tayyor dekada: ish ketayotganda `doc_json` hali yakuniy emas.
  if (g.status !== "COMPLETED") return null;
  if (g.type !== "slide" && g.type !== "pro-slide") return null;
  const doc = g.doc && typeof g.doc === "object" ? (g.doc as AcademicDoc) : null;
  if (!doc) return null;
  return {
    id: g.id,
    doc,
    docVersion: num(g.docVersion),
    fileVersion: num(g.fileVersion),
    imageRedraws: num(g.imageRedraws),
    raw: g,
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export type SlideEdit = {
  /** Ekranga chiziladigan hujjat — tahrir yoqilmagan bo'lsa ham optimistik nusxa. */
  doc: AcademicDoc | null;
  /** Tahrir mumkinmi (tayyor slayd dekasi + yangi format). */
  editable: boolean;
  /** `doc.slides` yo'q — eski format, tahrir mumkin emas. */
  legacy: boolean;
  /** Operatsiyalarni qo'llaydi; `false` — mahalliy tekshiruv rad etdi (xato `error` da). */
  run: (ops: DocOp[]) => boolean;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** SAQLANMAGAN operatsiyalar soni — «Saqlash (N o'zgarish)». */
  pending: number;
  /** Navbatdagi hamma operatsiyani bitta PATCH bilan yuboradi va PPTX ni yangilaydi. */
  save: () => Promise<void>;
  /** PATCH uchayotgani. */
  saving: boolean;
  /** Endigina saqlandi — «Saqlandi ✓» ({@link SAVED_FLASH_MS} ms). */
  justSaved: boolean;
  /** PPTX hujjatdan orqada (yoki qayta yasalmoqda). */
  stale: boolean;
  rebuilding: boolean;
  error: string | null;
  clearError: () => void;
  /** Qolgan bepul qayta chizish. */
  redrawsLeft: number;
  uploadImage: (index: number, file: File) => Promise<void>;
  regenerateImage: (index: number, hint?: string) => Promise<void>;
  /** Navbatni bo'shatadi va kerak bo'lsa PPTX ni qayta yasaydi (yuklab olishdan oldin). */
  ensureFresh: () => Promise<void>;
};

export function useSlideEdit({
  gen,
  onGen,
  savedFlashMs = SAVED_FLASH_MS,
}: {
  gen?: unknown;
  onGen?: (g: unknown) => void;
  /** Testlar uchun — standart {@link SAVED_FLASH_MS}. */
  savedFlashMs?: number;
}): SlideEdit {
  const g = useMemo(() => asEditGen(gen), [gen]);
  const genId = g?.id ?? "";
  const legacy = Boolean(g && !g.doc?.slides?.length);
  const editable = Boolean(g && !legacy);

  const [doc, setDoc] = useState<AcademicDoc | null>(g?.doc ?? null);
  const [version, setVersion] = useState(g?.docVersion ?? 0);
  const [fileVersion, setFileVersion] = useState(g?.fileVersion ?? 0);
  const [redraws, setRedraws] = useState(g?.imageRedraws ?? 0);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saqlanmagan operatsiyalar REF da (async oqim ularni ko'radi), soni holatda.
  const queueRef = useRef<DocOp[]>([]);
  const [pending, setPending] = useState(0);
  // Steklar REF da, uzunliklari holatda (render).
  const undoRef = useRef<UndoEntry[]>([]);
  const redoRef = useRef<UndoEntry[]>([]);
  const [stacks, setStacks] = useState({ undo: 0, redo: 0 });
  const bump = useCallback(() => {
    setStacks({ undo: undoRef.current.length, redo: redoRef.current.length });
  }, []);

  const docRef = useRef(doc);
  const versionRef = useRef(version);
  const fileRef = useRef(fileVersion);
  const onGenRef = useRef(onGen);
  const rawRef = useRef<Record<string, unknown>>(g?.raw ?? {});
  onGenRef.current = onGen;
  rawRef.current = g?.raw ?? rawRef.current;

  const inflightRef = useRef<Promise<void> | null>(null);
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
  const adopt = useCallback(
    (gd: Partial<GenerationDetail> & Record<string, unknown>) => {
      if (gd.doc && typeof gd.doc === "object") {
        docRef.current = gd.doc as AcademicDoc;
        setDoc(gd.doc as AcademicDoc);
      }
      versionRef.current = num(gd.docVersion);
      fileRef.current = num(gd.fileVersion);
      setVersion(versionRef.current);
      setFileVersion(fileRef.current);
      setRedraws(num(gd.imageRedraws));
      rawRef.current = gd as Record<string, unknown>;
      onGenRef.current?.(gd);
    },
    [],
  );

  /*
   * Tashqi `gen` o'zgarganda hujjatni FAQAT server bizdan yangiroq
   * bo'lsa olamiz. Aks holda `onGen` → sahifa holati → qayta render
   * halqasi optimistik tahrirni har safar orqaga tashlardi.
   */
  useEffect(() => {
    if (!g) return;
    if (docRef.current === null || g.docVersion > versionRef.current) {
      docRef.current = g.doc;
      versionRef.current = g.docVersion;
      fileRef.current = g.fileVersion;
      setDoc(g.doc);
      setVersion(g.docVersion);
      setFileVersion(g.fileVersion);
      setRedraws(g.imageRedraws);
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

  /** Serverdan qayta yuklaydi va steklarni tozalaydi (409 va boshqa xatolardan keyin). */
  const reload = useCallback(async () => {
    if (!genId) return;
    try {
      const { generation } = await getGeneration(genId);
      if (!aliveRef.current) return;
      adopt(generation);
    } catch {
      // Qayta yuklash ham yiqilsa ekrandagi holat qoladi — xato matni allaqachon ko'rsatilgan.
    }
    undoRef.current = [];
    redoRef.current = [];
    bump();
  }, [genId, adopt, bump]);

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
   * «Saqlash» — navbatdagi HAMMA operatsiya bitta `PATCH` da, keyin
   * `rebuild`. Bir vaqtda faqat bitta so'rov uchadi (ikkinchi bosish
   * birinchisini kutadi), aks holda ikki PATCH bir xil `baseVersion`
   * bilan yo'lga chiqib, ikkinchisi 409 olardi.
   */
  const save = useCallback(async (): Promise<void> => {
    if (inflightRef.current) await inflightRef.current;
    if (!genId) return;
    const ops = queueRef.current;
    if (!ops.length) return;
    queueRef.current = [];
    setPending(0);
    setSaving(true);
    if (flashRef.current) clearTimeout(flashRef.current);
    setJustSaved(false);
    const p = (async () => {
      let ok = false;
      try {
        const { generation } = await patchGenerationDoc(genId, versionRef.current, ops);
        if (aliveRef.current) adopt(generation);
        ok = true;
      } catch (e) {
        if (aliveRef.current) setError(editErrorText(e));
        // Server HECH NARSANI qo'llamagan (PATCH atomar) — navbat tashlanadi
        // va haqiqat serverdan qayta olinadi.
        queueRef.current = [];
        setPending(0);
        await reload();
      } finally {
        inflightRef.current = null;
        if (aliveRef.current) setSaving(false);
      }
      if (!ok) return;
      if (ok) return;
      // PPTX darhol quvib yetadi: «Saqlash» dan keyin «Yuklab olish»
      // eski faylni bermasligi kerak.
      await doRebuild();
      if (!aliveRef.current) return;
      setJustSaved(true);
      flashRef.current = setTimeout(() => {
        flashRef.current = null;
        if (aliveRef.current) setJustSaved(false);
      }, savedFlashMs);
    })();
    inflightRef.current = p;
    await p;
  }, [genId, adopt, reload, doRebuild, savedFlashMs]);

  const saveRef = useRef(save);
  saveRef.current = save;

  /** Optimistik qo'llash + navbatga qo'shish. Stek juftligi chaqiruvchida hal qilinadi. */
  const push = useCallback(
    (ops: DocOp[], stack: "undo" | "redo" | "new"): boolean => {
      const base = docRef.current;
      if (!base || !genId || !ops.length) return false;
      const res = applyDocOps(base, ops, { genId });
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      const inverse = inverseOps(base, ops, { genId });
      docRef.current = res.doc;
      setDoc(res.doc);
      const entry: UndoEntry = { forward: ops, inverse };
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
    [genId, bump],
  );

  const run = useCallback((ops: DocOp[]) => push(ops, "new"), [push]);

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
    await saveRef.current();
    await doRebuild();
  }, [doRebuild]);

  /*
   * Rasm operatsiyalari SERVERDA bajariladi (bayt yuklash, provayder
   * chaqiruvi) — optimistik nusxa yo'q. Ular hujjat versiyasini
   * o'zgartirgani uchun avval navbat SAQLANADI, keyin steklar
   * tozalanadi: undo eski slaydni qaytarsa yangi rasm jim yo'qolardi.
   */
  const afterImage = useCallback(
    (generation: GenerationDetail) => {
      adopt(generation);
      undoRef.current = [];
      redoRef.current = [];
      bump();
    },
    [adopt, bump],
  );

  const uploadImage = useCallback(
    async (index: number, file: File) => {
      if (!genId) return;
      await saveRef.current();
      setSaving(true);
      try {
        const { generation } = await uploadSlideImage(genId, index, file, versionRef.current);
        if (aliveRef.current) afterImage(generation);
      } catch (e) {
        if (aliveRef.current) setError(editErrorText(e));
        if (editErrorCode(e)) await reload();
      } finally {
        if (aliveRef.current) setSaving(false);
      }
    },
    [genId, afterImage, reload],
  );

  const regenerateImage = useCallback(
    async (index: number, hint?: string) => {
      if (!genId) return;
      await saveRef.current();
      setSaving(true);
      try {
        const { generation } = await regenerateSlideImage(genId, index, versionRef.current, hint);
        if (aliveRef.current) afterImage(generation);
      } catch (e) {
        if (aliveRef.current) setError(editErrorText(e));
        if (editErrorCode(e) === "version") await reload();
      } finally {
        if (aliveRef.current) setSaving(false);
      }
    },
    [genId, afterImage, reload],
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
    redrawsLeft: Math.max(0, IMAGE_REDRAW_LIMIT - redraws),
    uploadImage,
    regenerateImage,
    ensureFresh,
  };
}
