"use client";

import type { Generation } from "@/lib/types";
import type { EditActionsState } from "../files/EditActions";
import { academicDocFromHtml } from "@/lib/viewers/from-html";
import { viewerKind } from "@/lib/viewers/kind";
import { GlossaryViewer } from "./GlossaryViewer";
import { KeysViewer } from "./KeysViewer";
import { LessonViewer } from "./LessonViewer";
import { ResumeViewer } from "./ResumeViewer";
import { SlideViewer } from "./SlideViewer";
import { TableViewer } from "./TableViewer";
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
    case "lesson":
      return <LessonViewer doc={doc} />;
    case "table":
      return <TableViewer doc={doc} />;
    case "glossary":
      return <GlossaryViewer doc={doc} />;
    case "keys":
      return <KeysViewer doc={doc} />;
    case "image":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <ImageViewer doc={doc} />
        </div>
      );
    case "translation":
      return <TranslationViewer doc={doc} gen={{ id: gen.id, format: gen.format }} pdf={pdf} />;
    case "essay":
    case "article":
      return <WordViewer doc={doc} />;
    default:
      return <WordViewer doc={doc} />;
  }
}
