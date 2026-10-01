"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "./Button";

/** Error with the server message, the request id (for support) and a retry button. */
export function ErrorState({
  message,
  requestId,
  onRetry,
}: {
  message: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <TriangleAlert className="text-destructive size-8" aria-hidden="true" />
      <h3 className="text-sm font-semibold">Xatolik yuz berdi</h3>
      <p className="text-muted-foreground max-w-md text-[13px]">{message}</p>
      {requestId ? (
        <p className="text-muted-foreground text-xs">
          So&apos;rov ID: <span className="font-mono select-all">{requestId}</span>
        </p>
      ) : null}
      {onRetry ? (
        <Button size="sm" onClick={onRetry} className="mt-1">
          Qayta urinish
        </Button>
      ) : null}
    </div>
  );
}
