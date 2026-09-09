"use client";

import type { Generation } from "@/lib/types";
import { academicDocFromHtml } from "@/lib/viewers/from-html";
import { viewerKind } from "@/lib/viewers/kind";
import { GlossaryViewer } from "./GlossaryViewer";
import { KeysViewer } from "./KeysViewer";
import { LessonViewer } from "./LessonViewer";
import { ResumeViewer } from "./ResumeViewer";
import { SlideViewer } from "./SlideViewer";
import { TableViewer } from "./TableViewer";
import { WordViewer } from "./WordViewer";
import { ImageViewer } from "./ImageViewer";

export function ArtifactViewer({
  gen,
  detail,
  onDetail,
}: {
  gen: Generation;
  /**
   * Serverdagi TO'LIQ generatsiya (`api.GenerationDetail`) — tahrir
   * uchun (`docVersion`, `fileVersion`, `imageRedraws`). Ko'ruvchilar
   * hali eski `Generation` shaklini kutgani uchun alohida prop:
   * berilmasa hech narsa o'zgarmaydi va tahrir yoqilmaydi.
   */
  detail?: unknown;
  /** Tahrirdan keyingi yangi holat — sahifa (`ResultView`) uni o'zlashtiradi. */
  onDetail?: (g: unknown) => void;
}) {
  const doc = gen.doc ?? academicDocFromHtml(gen.html, gen);
  const kind = viewerKind(gen.type);

  switch (kind) {
    case "slides":
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <SlideViewer doc={doc} gen={detail} onGen={onDetail} />
        </div>
      );
    case "resume":
      return <ResumeViewer doc={doc} />;
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
    case "essay":
    case "article":
    case "translation":
      return <WordViewer doc={doc} />;
    default:
      return <WordViewer doc={doc} />;
  }
}
