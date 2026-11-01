import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Download, Check, Paintbrush, Eraser, Eye, RotateCcw } from 'lucide-react';
import type { BackgroundPreset } from '../../types/removeBg';

interface CanvasPreviewProps {
  processedBlob: Blob;
  originalBlob?: Blob | null;
  preset: BackgroundPreset;
  customColor: string;
  originalFileName: string;
}

type BrushMode = 'none' | 'erase' | 'restore';

export const CanvasPreview: React.FC<CanvasPreviewProps> = ({
  processedBlob,
  originalBlob,
  preset,
  customColor,
  originalFileName,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const subjectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);

  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [isExporting, setIsExporting] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  // Refine Brush State
  const [brushMode, setBrushMode] = useState<BrushMode>('none');
  const [brushSize, setBrushSize] = useState<number>(24);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [hasEdits, setHasEdits] = useState<boolean>(false);

  // Render combined view (Background + Subject) to main display canvas
  const renderComposite = useCallback(() => {
    const canvas = canvasRef.current;
    const subjectCanvas = subjectCanvasRef.current;
    if (!canvas || !subjectCanvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Render Background Preset
    if (preset === 'white') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (preset === 'id_red') {
      ctx.fillStyle = '#cc0000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (preset === 'id_blue') {
      ctx.fillStyle = '#0066cc';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (preset === 'custom') {
      ctx.fillStyle = customColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // If 'transparent', background remains cleared!

    // 2. Draw Subject on top
    ctx.drawImage(subjectCanvas, 0, 0);
  }, [preset, customColor]);

  // Initialize and load both Subject and Original Image
  const initCanvases = useCallback(() => {
    const procUrl = URL.createObjectURL(processedBlob);
    const procImg = new Image();

    procImg.onload = () => {
      const width = procImg.naturalWidth;
      const height = procImg.naturalHeight;
      setDimensions({ width, height });

      // Create or resize offscreen subject canvas
      const subCanvas = document.createElement('canvas');
      subCanvas.width = width;
      subCanvas.height = height;
      const subCtx = subCanvas.getContext('2d');
      if (subCtx) {
        subCtx.clearRect(0, 0, width, height);
        subCtx.drawImage(procImg, 0, 0);
      }
      subjectCanvasRef.current = subCanvas;

      // Set display canvas dimensions
      if (canvasRef.current) {
        canvasRef.current.width = width;
        canvasRef.current.height = height;
      }

      renderComposite();
      URL.revokeObjectURL(procUrl);
      setHasEdits(false);
    };

    procImg.src = procUrl;

    // Load original image for restoration brush
    if (originalBlob) {
      const origUrl = URL.createObjectURL(originalBlob);
      const origImg = new Image();
      origImg.onload = () => {
        originalImageRef.current = origImg;
      };
      origImg.src = origUrl;
    }
  }, [processedBlob, originalBlob, renderComposite]);

  useEffect(() => {
    initCanvases();
  }, [initCanvases]);

  useEffect(() => {
    renderComposite();
  }, [preset, customColor, renderComposite]);

  // Handle Brush strokes on canvas
  const applyBrush = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      const subjectCanvas = subjectCanvasRef.current;
      if (!canvas || !subjectCanvas || brushMode === 'none') return;

      const subCtx = subjectCanvas.getContext('2d');
      if (!subCtx) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      const radius = (brushSize * scaleX) / 2;

      if (brushMode === 'erase') {
        // Erase unwanted background leftovers
        subCtx.save();
        subCtx.globalCompositeOperation = 'destination-out';
        subCtx.beginPath();
        subCtx.arc(x, y, radius, 0, Math.PI * 2);
        subCtx.fill();
        subCtx.restore();
      } else if (brushMode === 'restore' && originalImageRef.current) {
        // Restore pixels from the original image
        subCtx.save();
        subCtx.beginPath();
        subCtx.arc(x, y, radius, 0, Math.PI * 2);
        subCtx.clip();
        subCtx.globalCompositeOperation = 'source-over';
        subCtx.drawImage(originalImageRef.current, 0, 0, subjectCanvas.width, subjectCanvas.height);
        subCtx.restore();
      }

      setHasEdits(true);
      renderComposite();
    },
    [brushMode, brushSize, renderComposite]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (brushMode === 'none') return;
    setIsDrawing(true);
    applyBrush(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || brushMode === 'none') return;
    applyBrush(e.clientX, e.clientY);
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const handleMouseLeave = () => {
    setIsDrawing(false);
  };

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsExporting(true);

    const isTransparent = preset === 'transparent';
    const mimeType = isTransparent ? 'image/png' : 'image/jpeg';
    const extension = isTransparent ? 'png' : 'jpg';

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setIsExporting(false);
          return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const cleanName = originalFileName.substring(0, originalFileName.lastIndexOf('.')) || 'image';
        link.download = `${cleanName}_nobg_${preset}.${extension}`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setIsExporting(false);
        setDownloadSuccess(true);
        setTimeout(() => setDownloadSuccess(false), 2500);
      },
      mimeType,
      0.95
    );
  }, [preset, originalFileName]);

  return (
    <div className="space-y-4">
      {/* Refine Brush Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-zinc-900 border border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-300 mr-1 flex items-center gap-1.5">
            <Paintbrush className="w-3.5 h-3.5 text-sky-400" />
            Cọ Tinh Chỉnh Nhanh:
          </span>

          <div className="flex rounded-lg bg-zinc-950 p-1 border border-zinc-800">
            <button
              onClick={() => setBrushMode('none')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all ${brushMode === 'none' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <Eye className="w-3.5 h-3.5" />
              Xem
            </button>
            <button
              onClick={() => setBrushMode('erase')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all ${brushMode === 'erase' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <Eraser className="w-3.5 h-3.5" />
              Cọ Xóa Nền
            </button>
            <button
              onClick={() => setBrushMode('restore')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all ${brushMode === 'restore' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <Paintbrush className="w-3.5 h-3.5" />
              Cọ Khôi Phục
            </button>
          </div>
        </div>

        {/* Brush size & Reset */}
        <div className="flex items-center gap-4">
          {brushMode !== 'none' && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-400 font-mono">Cỡ cọ: {brushSize}px</span>
              <input
                type="range"
                min="8"
                max="64"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-24 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-sky-400"
              />
            </div>
          )}

          {hasEdits && (
            <button
              onClick={initCanvases}
              className="px-2.5 py-1 rounded text-[11px] font-medium text-zinc-400 hover:text-zinc-100 bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 transition-all flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              Đặt lại nét vẽ
            </button>
          )}
        </div>
      </div>

      {/* Canvas Viewport Container */}
      <div
        className={`relative w-full rounded-xl overflow-hidden border border-zinc-800 flex items-center justify-center aspect-video md:aspect-[16/10] select-none ${preset === 'transparent' ? 'bg-checkerboard' : 'bg-zinc-950'}`}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          className={`max-w-full max-h-full object-contain transition-all ${brushMode === 'none' ? 'cursor-default' : brushMode === 'erase' ? 'cursor-crosshair' : 'cursor-crosshair'}`}
        />

        {/* Dynamic Brush Mode Hint */}
        {brushMode !== 'none' && (
          <div className="absolute top-3 left-3 px-3 py-1.5 rounded-lg bg-black/80 backdrop-blur-md text-xs font-medium text-zinc-200 border border-zinc-700/80 flex items-center gap-2">
            {brushMode === 'erase' ? (
              <>
                <Eraser className="w-3.5 h-3.5 text-rose-400" />
                <span>Đang bật Cọ Xóa: Di chuột để xóa các mảng nền còn sót lại</span>
              </>
            ) : (
              <>
                <Paintbrush className="w-3.5 h-3.5 text-emerald-400" />
                <span>Đang bật Cọ Khôi Phục: Di chuột để lấy lại các chi tiết gốc bị lẹm</span>
              </>
            )}
          </div>
        )}

        {/* Resolution Badge */}
        {dimensions.width > 0 && (
          <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded bg-black/60 backdrop-blur-md text-[11px] font-mono text-zinc-300 border border-zinc-700/60">
            Độ phân giải HD: {dimensions.width} × {dimensions.height} px {hasEdits && '• Đã chỉnh sửa'}
          </div>
        )}
      </div>

      {/* Download Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-zinc-900 border border-zinc-800">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-zinc-200">
            Xuất file chất lượng cao (HD Resolution)
          </p>
          <p className="text-[11px] text-zinc-400">
            Giữ nguyên độ sắc nét {dimensions.width} × {dimensions.height} px gốc cùng toàn bộ tinh chỉnh cọ vẽ.
          </p>
        </div>

        <button
          onClick={handleDownload}
          disabled={isExporting}
          className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-zinc-950 font-bold text-xs active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
        >
          {downloadSuccess ? (
            <>
              <Check className="w-4 h-4 text-zinc-950" />
              <span>Đã Tải Thành Công!</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>
                {preset === 'transparent' ? 'Tải Ảnh PNG Trong Suốt HD' : 'Tải Ảnh Với Phông Nền HD'}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
