"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDialog } from "@/components/overlays/useDialog";
import { CROP_MAX_ZOOM, CROP_MIN_ZOOM, CROP_OUT_SIZE, DEFAULT_CROP, clampZoom, cropRect, panCrop, type Crop } from "@/lib/photo-crop";
import { cn } from "@/lib/cn";

/**
 * Surat kesish oynasi (Rezyume 2, 6-band): sudrab markazlash, g'ildirak
 * yoki slayder bilan yaqinlashtirish, doira/kvadrat niqob.
 *
 * Nega klientda: doira shaklidagi shablonlar uchun burchaklari SHAFFOF
 * PNG kerak — `docx` `ImageRun` rasmni doiraga kesa olmaydi. Kvadrat
 * uchun JPEG (hajmi kichik). Hisob-kitob `lib/photo-crop.ts` da —
 * canvas'siz test yozish uchun.
 */

const FRAME = 320;

export function PhotoCropDialog({
  file,
  src,
  shape,
  crop: initial,
  onCancel,
  onDone,
}: {
  /** Yangi tanlangan fayl (asl nusxa sifatida ham yuboriladi). */
  file: File | null;
  /** Mavjud suratni qayta markazlash uchun URL (asl nusxa). */
  src?: string;
  shape: "circle" | "square";
  crop?: Crop;
  onCancel: () => void;
  onDone: (out: { blob: Blob; crop: Crop; shape: "circle" | "square" }) => void;
}) {
  const panelRef = useDialog(true, onCancel);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>(initial ?? DEFAULT_CROP);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const url = useRef<string>("");
  useEffect(() => {
    const u = file ? URL.createObjectURL(file) : src || "";
    url.current = u;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setReady(true);
    };
    img.src = u;
    return () => {
      if (file && u) URL.revokeObjectURL(u);
    };
  }, [file, src]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { sx, sy, size } = cropRect(img.naturalWidth || img.width, img.naturalHeight || img.height, crop);
    ctx.clearRect(0, 0, FRAME, FRAME);
    ctx.drawImage(img, sx, sy, size, size, 0, 0, FRAME, FRAME);
  }, [crop]);

  useEffect(() => {
    if (ready) draw();
  }, [ready, draw]);

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const img = imgRef.current;
    if (!d || !img) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setCrop((c) => panCrop(c, dx, dy, FRAME, img.naturalWidth || img.width, img.naturalHeight || img.height));
  }
  function onPointerUp() {
    drag.current = null;
  }

  async function done() {
    const img = imgRef.current;
    if (!img) return;
    setBusy(true);
    try {
      const out = document.createElement("canvas");
      out.width = CROP_OUT_SIZE;
      out.height = CROP_OUT_SIZE;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      const { sx, sy, size } = cropRect(img.naturalWidth || img.width, img.naturalHeight || img.height, crop);
      if (shape === "circle") {
        // Doira: tashqarisi SHAFFOF qoladi — DOCX uchun oldindan niqoblangan PNG.
        ctx.save();
        ctx.beginPath();
        ctx.arc(CROP_OUT_SIZE / 2, CROP_OUT_SIZE / 2, CROP_OUT_SIZE / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
      }
      ctx.drawImage(img, sx, sy, size, size, 0, 0, CROP_OUT_SIZE, CROP_OUT_SIZE);
      if (shape === "circle") ctx.restore();
      const blob = await new Promise<Blob | null>((res) =>
        out.toBlob(res, shape === "circle" ? "image/png" : "image/jpeg", 0.9),
      );
      if (blob) onDone({ blob, crop, shape });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Suratni moslash"
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full max-w-sm rounded-2xl border p-4 shadow-xl"
      >
        <h2 className="mb-3 text-[15px] font-semibold">Suratni moslash</h2>
        <div
          className="relative mx-auto touch-none select-none"
          style={{ width: FRAME, height: FRAME }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => setCrop((c) => ({ ...c, zoom: clampZoom(c.zoom + (e.deltaY < 0 ? 0.1 : -0.1)) }))}
        >
          <canvas
            ref={canvasRef}
            width={FRAME}
            height={FRAME}
            data-crop-canvas
            className={cn("bg-muted cursor-move", shape === "circle" ? "rounded-full" : "rounded-xl")}
          />
        </div>
        <label className="mt-3 flex items-center gap-2 text-[12px]">
          <span className="text-muted-foreground">Kattalik</span>
          <input
            type="range"
            aria-label="Kattalik"
            min={CROP_MIN_ZOOM}
            max={CROP_MAX_ZOOM}
            step={0.05}
            value={crop.zoom}
            onChange={(e) => setCrop((c) => ({ ...c, zoom: clampZoom(Number(e.target.value)) }))}
            className="flex-1"
          />
        </label>
        <p className="text-muted-foreground mt-2 text-[11px]">Suratni sudrab markazga qo‘ying.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="hover:bg-muted rounded-lg px-3 py-1.5 text-[13px]">
            Bekor qilish
          </button>
          <button
            type="button"
            onClick={done}
            disabled={!ready || busy}
            className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
          >
            {busy ? "Saqlanmoqda…" : "Tayyor"}
          </button>
        </div>
      </div>
    </div>
  );
}
