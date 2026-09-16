"use client";

import type { Generation } from "@/lib/types";
import type { EditActionsState } from "../files/EditActions";
import { academicDocFromHtml } from "@/lib/viewers/from-html";
import { viewerKind } from "@/lib/viewers/kind";
import { ResumeViewer } from "./ResumeViewer";
import { SlideViewer } from "./SlideViewer";
import { WordViewer } from "./WordViewer";
import { TranslationViewer } from "./TranslationViewer";
import { ImageViewer } from "./ImageViewer";

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
