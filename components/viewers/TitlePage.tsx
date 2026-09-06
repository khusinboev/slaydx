"use client";

import type { ReactNode } from "react";
import type { AcademicDoc } from "@/lib/generation/types";
import { titleModel, type TitleModel } from "@/lib/viewers/flow";
import { A4, LANDSCAPE } from "@/lib/viewers/metrics";
import { ZoomFrame } from "./sheet";

/**
 * Titul sahifasi — modeldagi TURGA qarab chiziladi.
 *
 * Ilgari bu komponent bitta GOST qolipini bilardi va maqola ham shu
 * qolipda ko'rinardi, DOCX esa jurnal titulini chizardi (AUDIT-5 P0-2).
 * Model endi `kind` bilan keladi, ya'ni yangi titul turi qo'shilsa
 * TypeScript shu yerni ham majburlaydi — jim ajralib ketish mumkin emas.
 */
export function TitlePage({ title, ribbon }: { title: TitleModel; ribbon?: ReactNode }) {
  if (title.kind === "article") {
    /*
     * Jurnal maqolasi: vazirlik sarlavhasi ham, «Bajardi/Rahbar» ham
     * yo'q — muallif bloki bor. `render-docx.ts` dagi `article` tituli
     * bilan bir xil tartib.
     */
    return (
      <div className="word-inner flex flex-col">
        {ribbon}
        <div className="flex-1" />
        <div className="text-center">
          <div className="text-[16pt] font-bold uppercase">{title.workLabel}</div>
          <div className="mt-6 text-[14pt] font-bold italic">«{title.topic}»</div>
        </div>
        <div className="mt-10 text-center text-[14pt] leading-[1.6]">
          {title.authorLine ? <div className="font-bold">{title.authorLine}</div> : null}
          {title.organization ? <div>{title.organization}</div> : null}
          {title.email ? <div>{title.email}</div> : null}
        </div>
        <div className="flex-1" />
        <div className="pb-2 text-center text-[14pt] font-bold">{title.cityYear}</div>
      </div>
    );
  }

  return (
    <div className="word-inner flex flex-col">
      {ribbon}
      <div className="text-center text-[12pt] font-bold uppercase leading-[1.5]">
        {title.ministry.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <div className="mt-4 text-center text-[12pt] font-bold uppercase">{title.university}</div>
      <div className="mt-3 text-center text-[14pt]">
        {title.faculty ? <div>{title.faculty}</div> : null}
        {title.department ? <div>{title.department}</div> : null}
      </div>
      <div className="flex-1" />
      <div className="text-center">
        <div className="text-[16pt] font-bold uppercase">{title.workLabel}</div>
        <div className="mt-4 text-[14pt] font-bold italic">«{title.topic}»</div>
      </div>
      <div className="flex-1" />
      <div className="text-[14pt] leading-[1.5]">
        {/*
          Imzo chizig'i DOCX da bor (`signatureP`) — topshiriladigan ish
          imzolanadi. Ko'ruvchida ham ko'rinsin, aks holda foydalanuvchi
          faylni ochganda kutilmagan qatorni topadi.
        */}
        {title.author ? (
          <div className="flex items-baseline gap-2">
            <span>
              {title.authorLabel}: {title.author}
            </span>
            <span className="flex-1 border-b border-black/60" />
          </div>
        ) : null}
        {title.courseLine ? <div>{title.courseLine}</div> : null}
        {title.teacher ? (
          <div className="flex items-baseline gap-2">
            <span>
              {title.labels.supervisor}: {title.teacher}
            </span>
            <span className="flex-1 border-b border-black/60" />
          </div>
        ) : null}
        {title.subject ? <div>{title.labels.subject}: {title.subject}</div> : null}
      </div>
      <div className="flex-1" />
      <div className="text-center text-[14pt]">{title.academicYear}</div>
      <div className="pb-2 text-center text-[14pt] font-bold">{title.cityYear}</div>
    </div>
  );
}

/**
 * Titul VARAG'I — ko'ruvchilar uchun tayyor sahifa.
 *
 * DOCX har bir akademik va o'qituvchi hujjatida titul chizadi, sayt
 * ko'ruvchilari esa faqat `WordViewer` da ko'rsatardi: glossariy, keys,
 * texnologik xarita va dars rejasi o'z muqovasini chizib, titulni
 * umuman ko'rsatmasdi (AUDIT-5 P1-5). Foydalanuvchi saytda ko'rgan
 * hujjatning BIRINCHI SAHIFASI faylda boshqa edi.
 *
 * Sahifa raqami ATAYIN yo'q: DOCX da ham titul raqamlanmaydi
 * (`blankFooter`).
 */
export function TitleSheet({
  doc,
  zoom,
  landscape = false,
  innerRef,
}: {
  doc: AcademicDoc;
  zoom: number;
  landscape?: boolean;
  innerRef?: (el: HTMLDivElement | null) => void;
}) {
  const size = landscape ? LANDSCAPE : A4;
  return (
    <ZoomFrame zoom={zoom / 100} width={size.wPx} height={size.hPx}>
      <div ref={innerRef} className={landscape ? "word-sheet word-sheet-ls" : "word-sheet"}>
        <TitlePage title={titleModel(doc)} />
      </div>
    </ZoomFrame>
  );
}
