import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Upload,
  Brush,
  Eraser,
  Undo2,
  RotateCcw,
  Sparkles,
  Download,
  Eye,
  Loader2,
  Sliders,
  Image as ImageIcon,
} from 'lucide-react';
import { detectWatermarkRegions } from '../../utils/imageWatermarkDetector';
import { inpaintTelea } from '../../workers/inpaintWorker';
import type { InpaintWorkerResponse } from '../../types/watermarkRemover';

interface ImageWatermarkViewProps {
  isCompact?: boolean;
}

export const ImageWatermarkView: React.FC<ImageWatermarkViewProps> = ({ isCompact = false }) => {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  // Tools state
  const [toolMode, setToolMode] = useState<'brush' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState<number>(24);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processProgress, setProcessProgress] = useState<number>(0);
  const [hasInpainted, setHasInpainted] = useState<boolean>(false);
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [autoDetectedCount, setAutoDetectedCount] = useState<number | null>(null);
  const [historyCount, setHistoryCount] = useState<number>(0);

  // Canvas refs
  const containerRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const originalImageDataRef = useRef<ImageData | null>(null);
  const inpaintedImageDataRef = useRef<ImageData | null>(null);

  // Undo history stack for mask canvas (stores ImageData snapshots of mask)
  const maskHistoryRef = useRef<ImageData[]>([]);
  const isDrawingRef = useRef<boolean>(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Save current mask state to undo stack
  const saveMaskSnapshot = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    maskHistoryRef.current.push(snapshot);
    if (maskHistoryRef.current.length > 20) {
      maskHistoryRef.current.shift();
    }
    setHistoryCount(maskHistoryRef.current.length);
  }, []);

  // Handle Undo
  const handleUndo = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || maskHistoryRef.current.length <= 1) return;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;

    // Pop current and restore previous
    maskHistoryRef.current.pop();
    const previous = maskHistoryRef.current[maskHistoryRef.current.length - 1];
    if (previous) {
      ctx.putImageData(previous, 0, 0);
    }
    setHistoryCount(maskHistoryRef.current.length);
  }, []);

  // Handle Reset Mask
  const handleResetMask = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskHistoryRef.current = [];
    saveMaskSnapshot();
    setAutoDetectedCount(null);
  }, [saveMaskSnapshot]);

  // Load new image
  const loadImage = useCallback((file: File) => {
    setImageFile(file);
    setHasInpainted(false);
    setAutoDetectedCount(null);
    inpaintedImageDataRef.current = null;

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      setImageDimensions({ width, height });

      const baseCanvas = baseCanvasRef.current;
      const maskCanvas = maskCanvasRef.current;
      if (!baseCanvas || !maskCanvas) return;

      baseCanvas.width = width;
      baseCanvas.height = height;
      maskCanvas.width = width;
      maskCanvas.height = height;

      const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
      if (!baseCtx || !maskCtx) return;

      baseCtx.drawImage(img, 0, 0);
      originalImageDataRef.current = baseCtx.getImageData(0, 0, width, height);

      maskCtx.clearRect(0, 0, width, height);
      maskHistoryRef.current = [maskCtx.getImageData(0, 0, width, height)];
      setHistoryCount(1);
    };

    img.src = url;
  }, []);

  // File drop handler
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        loadImage(file);
      }
    }
  };

  // Clipboard paste handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        if (file.type.startsWith('image/')) {
          loadImage(file);
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [loadImage]);

  // Coordinate mapping from client mouse event to native canvas coordinates
  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else {
      return null;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  // Drawing strokes
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (isProcessing) return;
    const pos = getCanvasCoordinates(e);
    if (!pos) return;

    isDrawingRef.current = true;
    lastPosRef.current = pos;
    drawStroke(pos.x, pos.y, pos.x, pos.y);
  };

  const drawStroke = (x1: number, y1: number, x2: number, y2: number) => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (toolMode === 'brush') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.55)'; // Neon Pink mask
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
    }

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  };

  const moveDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || isProcessing) return;
    const pos = getCanvasCoordinates(e);
    if (!pos || !lastPosRef.current) return;

    drawStroke(lastPosRef.current.x, lastPosRef.current.y, pos.x, pos.y);
    lastPosRef.current = pos;
  };

  const endDrawing = () => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      lastPosRef.current = null;
      saveMaskSnapshot();
    }
  };

  // Auto-Detect Watermark using Sobel edge density
  const handleAutoDetect = () => {
    if (!baseCanvasRef.current || !maskCanvasRef.current) return;
    const baseCtx = baseCanvasRef.current.getContext('2d');
    const maskCtx = maskCanvasRef.current.getContext('2d');
    if (!baseCtx || !maskCtx) return;

    const baseData = baseCtx.getImageData(0, 0, baseCanvasRef.current.width, baseCanvasRef.current.height);
    const { boxes, maskImageData } = detectWatermarkRegions(baseData);

    if (boxes.length === 0) {
      setAutoDetectedCount(0);
      return;
    }

    // Overlay auto-detected mask onto existing mask canvas
    maskCtx.putImageData(maskImageData, 0, 0);
    saveMaskSnapshot();
    setAutoDetectedCount(boxes.length);
  };

  // Execute Telea Inpainting via Web Worker (with synchronous fallback)
  const handleExecuteInpaint = async () => {
    if (!baseCanvasRef.current || !maskCanvasRef.current || !originalImageDataRef.current) return;
    const baseCanvas = baseCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const baseCtx = baseCanvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    if (!baseCtx || !maskCtx) return;

    const currentBase = baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
    const currentMask = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

    setIsProcessing(true);
    setProcessProgress(0);

    const onComplete = (cleanedData: ImageData) => {
      baseCtx.putImageData(cleanedData, 0, 0);
      inpaintedImageDataRef.current = cleanedData;
      setHasInpainted(true);
      setIsProcessing(false);
      setProcessProgress(100);
      // Clear mask so user can review output directly
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      saveMaskSnapshot();
    };

    try {
      // Try Web Worker execution for non-blocking 60fps UI
      if (typeof Worker !== 'undefined') {
        if (!workerRef.current) {
          workerRef.current = new Worker(
            new URL('../../workers/inpaintWorker.ts', import.meta.url),
            { type: 'module' }
          );
        }

        const worker = workerRef.current;

        worker.onmessage = (e: MessageEvent<InpaintWorkerResponse>) => {
          const resp = e.data;
          if (resp.type === 'INPAINT_PROGRESS') {
            setProcessProgress(resp.progress);
          } else if (resp.type === 'INPAINT_SUCCESS') {
            onComplete(resp.resultData);
          } else if (resp.type === 'INPAINT_ERROR') {
            console.warn('[InpaintWorker Error]:', resp.error);
            // Fallback to direct Telea inpainting on main thread
            const direct = inpaintTelea(currentBase, currentMask, 6, setProcessProgress);
            onComplete(direct);
          }
        };

        worker.postMessage({
          type: 'INPAINT_REQUEST',
          imageData: currentBase,
          maskData: currentMask,
          radius: 6,
        });
      } else {
        // Direct execution fallback
        const result = inpaintTelea(currentBase, currentMask, 6, setProcessProgress);
        onComplete(result);
      }
    } catch (err) {
      console.warn('Worker instantiation failed, running direct fallback:', err);
      const result = inpaintTelea(currentBase, currentMask, 6, setProcessProgress);
      onComplete(result);
    }
  };

  // Download cleaned image
  const handleDownloadResult = () => {
    if (!baseCanvasRef.current || !imageFile) return;
    const link = document.createElement('a');
    const nameWithoutExt = imageFile.name.replace(/\.[^/.]+$/, '');
    link.download = `${nameWithoutExt}_no_watermark.png`;
    link.href = baseCanvasRef.current.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Compare toggle (mouse down / touch start switches to original)
  const handleCompareStart = () => {
    if (!hasInpainted || !originalImageDataRef.current || !baseCanvasRef.current) return;
    setIsComparing(true);
    const ctx = baseCanvasRef.current.getContext('2d');
    if (ctx) ctx.putImageData(originalImageDataRef.current, 0, 0);
  };

  const handleCompareEnd = () => {
    if (!hasInpainted || !inpaintedImageDataRef.current || !baseCanvasRef.current) return;
    setIsComparing(false);
    const ctx = baseCanvasRef.current.getContext('2d');
    if (ctx) ctx.putImageData(inpaintedImageDataRef.current, 0, 0);
  };

  return (
    <div className={`space-y-6 ${isCompact ? 'p-1' : ''}`}>
      {/* Upload Dropzone (if no image loaded) */}
      {!imageFile ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          className="border-2 border-dashed border-slate-300 dark:border-slate-800 hover:border-pink-500/50 dark:hover:border-pink-500/50 rounded-2xl p-8 sm:p-12 text-center transition-all bg-white dark:bg-slate-900/60 shadow-sm cursor-pointer"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/webp';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) loadImage(file);
            };
            input.click();
          }}
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
            <Upload className="w-8 h-8" />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mb-1">
            Kéo thả ảnh cần xóa Watermark vào đây
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-md mx-auto">
            Hỗ trợ PNG, JPG, WebP. Hoặc nhấn phím <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-xs">Ctrl + V</kbd> để dán ảnh trực tiếp từ clipboard.
          </p>
          <button
            type="button"
            className="px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-xs sm:text-sm font-bold shadow-md shadow-pink-500/20 transition-all active:scale-95 cursor-pointer"
          >
            Chọn ảnh từ máy tính
          </button>
        </div>
      ) : (
        /* Dual-Canvas Editor Workspace */
        <div className="space-y-4">
          {/* Top Control Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              {/* Tool Mode: Brush vs Eraser */}
              <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setToolMode('brush')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    toolMode === 'brush'
                      ? 'bg-pink-500 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Brush className="w-3.5 h-3.5" />
                  <span>Cọ vẽ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setToolMode('eraser')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    toolMode === 'eraser'
                      ? 'bg-pink-500 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>Tẩy</span>
                </button>
              </div>

              {/* Brush Size Slider */}
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
                <Sliders className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-500">Cỡ:</span>
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
                  className="w-20 sm:w-28 accent-pink-500 cursor-pointer"
                />
                <span className="font-mono text-slate-700 dark:text-slate-300 w-7">{brushSize}px</span>
              </div>

              {/* Auto-Detect Button */}
              <button
                type="button"
                onClick={handleAutoDetect}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-pink-500/10 hover:bg-pink-500/20 text-pink-600 dark:text-pink-400 border border-pink-500/20 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Tự động dò Watermark</span>
              </button>

              {/* Undo Button */}
              <button
                type="button"
                onClick={handleUndo}
                disabled={isProcessing || historyCount <= 1}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-40 cursor-pointer"
                title="Hoàn tác (Undo)"
              >
                <Undo2 className="w-4 h-4" />
              </button>

              {/* Reset Mask Button */}
              <button
                type="button"
                onClick={handleResetMask}
                disabled={isProcessing}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-40 cursor-pointer"
                title="Đặt lại nét vẽ"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            {/* Action Buttons: Compare, Inpaint & Download */}
            <div className="flex items-center gap-2">
              {hasInpainted && (
                <button
                  type="button"
                  onMouseDown={handleCompareStart}
                  onMouseUp={handleCompareEnd}
                  onMouseLeave={handleCompareEnd}
                  onTouchStart={handleCompareStart}
                  onTouchEnd={handleCompareEnd}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors select-none cursor-pointer ${
                    isComparing
                      ? 'bg-amber-500 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{isComparing ? 'Đang xem ảnh gốc' : 'Giữ để so sánh'}</span>
                </button>
              )}

              {hasInpainted ? (
                <button
                  type="button"
                  onClick={handleDownloadResult}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all active:scale-95 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Tải ảnh đã xóa</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleExecuteInpaint}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold shadow-md shadow-pink-500/20 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang xử lý ({processProgress}%)...</span>
                    </>
                  ) : (
                    <>
                      <Eraser className="w-3.5 h-3.5" />
                      <span>Xóa Watermark</span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => setImageFile(null)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 text-xs font-medium transition-colors cursor-pointer"
              >
                Đổi ảnh
              </button>
            </div>
          </div>

          {/* Auto-detect Notification Badge */}
          {autoDetectedCount !== null && (
            <div className="flex items-center justify-between px-4 py-2 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs">
              <span>
                {autoDetectedCount > 0
                  ? `Đã tự động khoanh vùng ${autoDetectedCount} vị trí watermark tiềm năng. Bạn có thể dùng cọ vẽ/tẩy để điều chỉnh thêm nếu cần.`
                  : 'Không tìm thấy vùng watermark rõ ràng ở 4 góc hoặc trung tâm. Hãy dùng Cọ vẽ để tô thủ công lên vùng cần xóa.'}
              </span>
              <button
                type="button"
                onClick={() => setAutoDetectedCount(null)}
                className="underline ml-3 font-semibold cursor-pointer"
              >
                Đóng
              </button>
            </div>
          )}

          {/* Dual-Canvas Visual Surface */}
          <div
            ref={containerRef}
            className="relative w-full overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950/90 flex items-center justify-center min-h-[380px] sm:min-h-[500px]"
          >
            {/* Base Image Canvas */}
            <canvas
              ref={baseCanvasRef}
              className="max-w-full max-h-[70vh] object-contain block select-none pointer-events-none"
            />

            {/* Selection Mask Overlay Canvas */}
            <canvas
              ref={maskCanvasRef}
              onMouseDown={startDrawing}
              onMouseMove={moveDrawing}
              onMouseUp={endDrawing}
              onMouseLeave={endDrawing}
              onTouchStart={startDrawing}
              onTouchMove={moveDrawing}
              onTouchEnd={endDrawing}
              className={`absolute max-w-full max-h-[70vh] object-contain block touch-none ${
                toolMode === 'eraser' ? 'cursor-crosshair' : 'cursor-crosshair'
              }`}
            />

            {/* Canvas Hint Badge */}
            <div className="absolute bottom-3 left-3 px-3 py-1 rounded-lg bg-black/60 backdrop-blur-md text-white/80 text-[11px] font-medium pointer-events-none flex items-center gap-2">
              <ImageIcon className="w-3.5 h-3.5 text-pink-400" />
              <span>
                {imageDimensions
                  ? `${imageDimensions.width} × ${imageDimensions.height} px • Tô hồng lên vùng cần xóa`
                  : 'Tô cọ lên vùng logo / chữ cần xóa'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
