import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function ZoomFrame({
  zoom,
  width,
  height,
  children,
  className,
}: {
  zoom: number;
  width: number;
  height: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative mx-auto", className)} style={{ width: width * zoom, height: height * zoom }}>
      <div
        className="absolute top-0 left-0"
        style={{ width, height, transform: `scale(${zoom})`, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}

export const Workspace = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(
  function Workspace({ children, className }, ref) {
    return (
      <div ref={ref} className={cn("viewer-workspace min-h-full overflow-auto bg-[#525659] px-3 py-8 sm:px-6", className)}>
        {children}
      </div>
    );
  },
);
