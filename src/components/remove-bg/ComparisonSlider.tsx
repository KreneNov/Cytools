import React, { useState, useRef, useCallback } from 'react';
import { GripVertical } from 'lucide-react';

interface ComparisonSliderProps {
  originalUrl: string;
  processedUrl: string;
  className?: string;
}

export const ComparisonSlider: React.FC<ComparisonSliderProps> = ({
  originalUrl,
  processedUrl,
  className = '',
}) => {
  const [sliderPosition, setSliderPosition] = useState(50); // percentage 0 - 100
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSliderPosition(percentage);
    },
    [isDragging]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      setSliderPosition(percentage);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`relative w-full overflow-hidden rounded-xl border border-zinc-800 select-none cursor-ew-resize aspect-video md:aspect-[16/10] bg-zinc-950 flex items-center justify-center ${className}`}
    >
      {/* Background Layer: Processed Image (Transparent Checkerboard) */}
      <div className="absolute inset-0 w-full h-full bg-checkerboard flex items-center justify-center">
        <img
          src={processedUrl}
          alt="Đã xóa nền"
          className="w-full h-full object-contain pointer-events-none"
        />
        <div className="absolute top-3 right-3 px-2 py-1 rounded bg-black/60 backdrop-blur-md text-[11px] font-semibold text-emerald-400 border border-emerald-500/30">
          Đã Tách Nền AI
        </div>
      </div>

      {/* Foreground Layer: Original Image (Clipped by slider position) */}
      <div
        className="absolute inset-0 w-full h-full overflow-hidden flex items-center justify-center"
        style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
      >
        <img
          src={originalUrl}
          alt="Ảnh gốc"
          className="w-full h-full object-contain pointer-events-none"
        />
        <div className="absolute top-3 left-3 px-2 py-1 rounded bg-black/60 backdrop-blur-md text-[11px] font-semibold text-zinc-300 border border-zinc-700/60">
          Ảnh Gốc
        </div>
      </div>

      {/* Draggable Divider Line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-2xl pointer-events-none z-10 flex items-center justify-center"
        style={{ left: `${sliderPosition}%` }}
      >
        <div className="w-8 h-8 -ml-4 rounded-full bg-white text-zinc-900 shadow-xl flex items-center justify-center border border-zinc-300 pointer-events-auto cursor-ew-resize">
          <GripVertical className="w-4 h-4 text-zinc-700" />
        </div>
      </div>
    </div>
  );
};
