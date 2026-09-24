"use client";

import { lazy, Suspense } from "react";
import type { Generation } from "@/lib/types";
import type { AcademicDoc } from "@/lib/generation/types";
import type { EditActionsState } from "../files/EditActions";
import { academicDocFromHtml } from "@/lib/viewers/from-html";
import { viewerKind } from "@/lib/viewers/kind";

/*
 * Har ko'ruvchi ALOHIDA bo'lakda (FE-11): ilgari hujjat sahifasi har
 * turdagi hujjat uchun barcha ko'ruvchilarni (KaTeX, `planSlide`,
 * `planResume`, `planTeacher`, `planGame` — bitta ~530 KB bo'lak)
 * birinchi yuklanishda olardi. Endi faqat shu hujjat turining ko'ruvchisi.
 */
const ResumeViewer = lazy(() => import("./ResumeViewer").then((m) => ({ default: m.ResumeViewer })));
// Bitta `lazy` o'rami — `ResultView` (jonli) ham shuni ishlatadi: jonli → tayyor o'tishda
// ikkinchi o'ram bir kadr «Yuklanmoqda...» ko'rsatmasin (W4-D N3).
export const SlideViewer = lazy(() => import("./SlideViewer").then((m) => ({ default: m.SlideViewer })));
const WordViewer = lazy(() => import("./WordViewer").then((m) => ({ default: m.WordViewer })));
const TranslationViewer = lazy(() => import("./TranslationViewer").then((m) => ({ default: m.TranslationViewer })));
const ImageViewer = lazy(() => import("./ImageViewer").then((m) => ({ default: m.ImageViewer })));
const AudioViewer = lazy(() => import("./AudioViewer").then((m) => ({ default: m.AudioViewer })));

const VIEWER_LOADING = <div className="text-muted-foreground p-8 text-sm">Yuklanmoqda...</div>;

export function ArtifactViewer({
  gen,
  detail,
  onDetail,
  onEditState,
  pdf = false,
}: {
  gen: Generation;
  /** Serverda LibreOffice bor (`features.pdf`) — tarjima ko'ruvchisi PDF ko'rinishini shunda ko'rsatadi. */
  pdf?: boolean;
  /**
   * Serverdagi TO'LIQ generatsiya (`api.GenerationDetail`) — tahrir
   * uchun (`docVersion`, `fileVersion`, `imageRedraws`). Ko'ruvchilar
   * hali eski `Generation` shaklini kutgani uchun alohida prop:
   * berilmasa hech narsa o'zgarmaydi va tahrir yoqilmaydi.
   */
  detail?: unknown;
  /** Tahrirdan keyingi yangi holat — sahifa (`ResultView`) uni o'zlashtiradi. */
  onDetail?: (g: unknown) => void;
  /** Tahrir holati (saqlanmagan soni, saqlash, bekor qilish) — sahifa sarlavhasidagi `EditActions` ga. */
  onEditState?: (s: EditActionsState | null) => void;
}) {
  const doc = gen.doc ?? academicDocFromHtml(gen.html, gen);
  return <Suspense fallback={VIEWER_LOADING}>{viewerFor({ gen, doc, detail, onDetail, onEditState, pdf })}</Suspense>;
}

/** Hujjat turi → uning ko'ruvchisi (bo'lagi kerak bo'lganda yuklanadi). */
function viewerFor({
  gen,
  doc,
  detail,
  onDetail,
  onEditState,
  pdf,
}: {
  gen: Generation;
  doc: AcademicDoc;
  detail?: unknown;
  onDetail?: (g: unknown) => void;
  onEditState?: (s: EditActionsState | null) => void;
  pdf: boolean;
}) {
  const kind = viewerKind(gen.type);
  switch (kind) {
    case "slides":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <SlideViewer doc={doc} gen={detail} onGen={onDetail} onEditState={onEditState} />
        </div>
      );
    case "resume":
      // Tahrir proplari `SlideViewer` bilan AYNAN bir xil uzatiladi —
      // ilgari rezyume ko'ruvchisiga hech narsa berilmasdi va tahrir
      // umuman yoqilmasdi (Rezyume 2, AUDIT-15).
      return <ResumeViewer doc={doc} gen={detail} onGen={onDetail} onEditState={onEditState} />;
    case "teacher":
      /*
       * O'qituvchi hujjatlari 2 (AUDIT-20 WP-C): beshala vosita umumiy
       * Word ko'ruvchisida — `planTeacher` → `teacherFlow` rasmiy DOCX
       * ko'rinishini chizadi (shapka, bosqich/chorak jadvallari, test
       * variant betlari, albom xarita). Brend-muqovali to'rt ko'ruvchi
       * (`LessonViewer`/`TableViewer`/`GlossaryViewer`/`KeysViewer`)
       * O'CHIRILDI: ular saytda faylda yo'q birinchi bet chizardi
       * (egasi qarori 12 — «sayt = fayl»).
       *
       * Tahrir (WP-D) shu proplar orqali ishlaydi: `WordViewer`
       * `useTeacherEdit` bilan uchinchi oqimni yoqadi. Proplar WP-C da
       * OLDINDAN berilgan edi — talaba ishlaridagi xato aynan shu edi
       * (proplar berilmagani uchun tahrir jimgina o'chiq qolgandi).
       */
      return <WordViewer doc={doc} gen={detail} onGen={onDetail} onEditState={onEditState} />;
    case "game":
      /*
       * Bosma o'yinlar (AUDIT-21 R0): krossvord va flesh kartalar umumiy
       * Word ko'ruvchisida — `planGame` → `gameFlow` (WP-A/WP-B)
       * DOCX ko'rinishini chizadi (raqamlangan to'r, ikki ustunli savol
       * ro'yxati, javob varag'i; A7 karta panjarasi).
       *
       * Proplar HOZIRDAN beriladi: talaba ishlaridagi xato aynan shu edi
       * — ko'ruvchi proplarsiz ulangani uchun tahrir jimgina o'chiq
       * qolgandi va buni faqat smoke topgan edi. `WordViewer` R0 da
       * `doc.game` ni bilmaydi va `editable` false bo'lib qoladi.
       */
      return <WordViewer doc={doc} gen={detail} onGen={onDetail} onEditState={onEditState} />;
    case "audio":
      /*
       * AUDIO (AUDIT-22 R0): podkast va tabriknoma — pleer + transkript.
       * Ko'ruvchiga `gen` beriladi, chunki fayl HAVOLASI (aynan yuklab
       * olinadigan MP3) generatsiya id sidan quriladi — hujjatda audio
       * baytlari yo'q. Tahrir proplari ATAYLAB berilmaydi: transkriptni
       * tahrirlash audio bilan ajralib ketardi (fayl qayta sintez
       * qilinmaydi), ya'ni «ko'rdim = oldim» buzilardi.
       */
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <AudioViewer doc={doc} gen={{ id: gen.id, fileName: gen.fileName }} />
        </div>
      );
    case "image":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <ImageViewer doc={doc} />
        </div>
      );
    case "translation":
      return <TranslationViewer doc={doc} gen={{ id: gen.id, format: gen.format }} pdf={pdf} />;
    case "essay":
      // AUDIT-19: inshoda ham tahrir — `design` ramkasi va bitta bo'lim
      // o'zgarmaydi, proplar maqola bilan AYNAN bir xil (`useArticleEdit`).
      return <WordViewer doc={doc} gen={detail} onGen={onDetail} onEditState={onEditState} />;
    case "article":
      // Maqola 2 (WP7): tahrir proplari slayd/rezyume bilan bir xil — `WordViewer`
      // ularni faqat maqola dvigateli generatsiyasida ishlatadi (tezis ham — `viewerKind`, AUDIT-19).
      return <WordViewer doc={doc} gen={detail} onGen={onDetail} onEditState={onEditState} />;
    default:
      /*
       * AUDIT-19: kurs ishi/referat/mustaqil ish `academic` turida qoladi
       * (eski hujjatlar ham shu yo'ldan), tahrir proplari DOIM beriladi —
       * `WordViewer` `doc.work` bo'lsa `useWorkEdit` ni yoqadi, aks holda
       * `editable` false (dars rejasi va h.k. avvalgidek). Smoke: propsiz
       * `[data-path]` chiqmas, «Tahrirlash» ko'rinmas edi.
       */
      return <WordViewer doc={doc} gen={detail} onGen={onDetail} onEditState={onEditState} />;
  }
}
