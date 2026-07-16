"use client";

import { useRef, useCallback } from "react";

interface ImagePositionPickerProps {
  src: string;
  positionX: number;
  positionY: number;
  onChange: (x: number, y: number) => void;
  aspectRatio?: string;
}

export function ImagePositionPicker({
  src,
  positionX,
  positionY,
  onChange,
  aspectRatio = "5/3",
}: ImagePositionPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updatePosition = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.round(
        Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
      );
      const y = Math.round(
        Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100))
      );
      onChange(x, y);
    },
    [onChange]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      updatePosition(e.clientX, e.clientY);
    },
    [updatePosition]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      updatePosition(e.clientX, e.clientY);
    },
    [updatePosition]
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative cursor-crosshair overflow-hidden rounded border"
      style={{ aspectRatio }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover pointer-events-none"
        style={{ objectPosition: `${positionX}% ${positionY}%` }}
        draggable={false}
      />
      <div
        className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
        style={{ left: `${positionX}%`, top: `${positionY}%` }}
      />
      <div className="absolute inset-0 pointer-events-none border border-white/30" />
    </div>
  );
}
