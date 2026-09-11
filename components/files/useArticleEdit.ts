"use client";

import { useEffect, useRef } from "react";
import { applyArticleOps, inverseArticleOps, type ArticleOp } from "@/lib/generation/article/edit";
import type { AcademicDoc } from "@/lib/generation/types";
import { asEditGen, useDocEdit, SAVED_FLASH_MS, type DocEdit } from "./useDocEdit";

/**
 * Maqola tahririning klient oqimi (Maqola 2, AUDIT-17 WP7) —
 * `useResumeEdit`/`useSlideEdit` bilan bir xil o'ram (`useDocEdit`),
 * faqat op tili boshqa. Eski maqola (`doc.article` yo'q) ham qabul
 * qilinadi: `applyArticleOps` unda faqat matn op larini o'tkazadi —
 * server (`articleAdapter`) bilan bir xil qoida.
 *
 * SERVER TAHRIRI («Tuzatish», `POST …/rewrite`) sahifadan (`ResultView`)
 * boshlanadi va yangi generatsiya `gen` propi orqali keladi. `useDocEdit`
 * tashqi `gen` yangiroq bo'lsa hujjatni o'zlashtiradi, lekin undo/redo
 * steklarini TOZALAMAYDI — ular endi boshqa hujjatga tegishli bo'lardi
 * (Ctrl+Z qayta yozilgan bo'limga eski matnni qaytarib qo'yardi). Shuning
 * uchun bu o'ram versiya SAKRASHINI kuzatadi va steklarni `discard` bilan
 * bo'shatadi (navbat o'sha paytda bo'sh — sahifa «Tuzatish» dan oldin
 * `save` ni chaqiradi).
 */

export type ArticleEdit = DocEdit<ArticleOp>;

const ARTICLE_TOOLS = ["article"] as const;

/** Bo'limli maqola — tahrirlanadi (yangi ham, eski ham). */
const hasArticle = (doc: AcademicDoc) => Boolean(doc.sections?.length);

export function useArticleEdit({
  gen,
  onGen,
  savedFlashMs = SAVED_FLASH_MS,
}: {
  gen?: unknown;
  onGen?: (g: unknown) => void;
  savedFlashMs?: number;
}): ArticleEdit {
  const ed = useDocEdit<ArticleOp>({
    gen,
    onGen,
    savedFlashMs,
    tools: ARTICLE_TOOLS,
    hasModel: hasArticle,
    apply: (doc, ops, ctx) => applyArticleOps(doc, ops, ctx),
    inverse: (doc, ops, ctx) => inverseArticleOps(doc, ops, ctx),
  });

  /*
   * Tashqi versiya sakradi (server tahriri — «Tuzatish») → steklar
   * tozalanadi. `useDocEdit` ning o'z effekti (hujjatni o'zlashtirish)
   * ilgari e'lon qilingani uchun OLDIN ishlaydi; `discard` shu yangi
   * asosga qaytaradi. Oddiy `save` dan keyin `ed.version` allaqachon
   * yangi — sakrash yo'q, steklar saqlanadi.
   */
  const seenRef = useRef(ed.version);
  const external = asEditGen(gen, ARTICLE_TOOLS)?.docVersion ?? 0;
  const { discard } = ed;
  useEffect(() => {
    if (external > seenRef.current && external > ed.version) discard();
    seenRef.current = Math.max(seenRef.current, external, ed.version);
  }, [external, ed.version, discard]);

  return ed;
}
