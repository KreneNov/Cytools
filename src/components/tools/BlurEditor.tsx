import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  Undo2,
  RotateCcw,
  Download,
  Sparkles,
  Wind,
  Droplets,
  Eraser,
  Eye,
  Image as ImageIcon,
  Sliders,
} from 'lucide-react';

export type BlurMode = 'standard' | 'motion';
export type BrushTool = 'brush' | 'eraser';

interface Point {
  x: number;
  y: number;
}

const MAX_CANVAS_DIMENSION = 2400;
const MAX_UNDO_STEPS = 25;
const MOTION_BLUR_STEPS = 40;

export const BlurEditor: React.FC = () => {
  // Visible & Off-screen Canvas References
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Drawing & Animation Frame Refs
  const isDrawingRef = useRef<boolean>(false);
  const lastPointRef = useRef<Point | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);

  // Component UI State
  const [hasImage, setHasImage] = useState<boolean>(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [blurMode, setBlurMode] = useState<BlurMode>('standard');
  const [brushTool, setBrushTool] = useState<BrushTool>('brush');
  const [brushRadius, setBrushRadius] = useState<number>(36);
  const [blurIntensity, setBlurIntensity] = useState<number>(15);
  const [motionAngle, setMotionAngle] = useState<number>(45);
  const [undoCount, setUndoCount] = useState<number>(0);
  const [isComparingOriginal, setIsComparingOriginal] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [cursorPreview, setCursorPreview] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({ visible: false, x: 0, y: 0 });

  /**
   * Initialize off-screen canvases once on mount
   */
  useEffect(() => {
    effectCanvasRef.current = document.createElement('canvas');
    maskCanvasRef.current = document.createElement('canvas');
    compCanvasRef.current = document.createElement('canvas');

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  /**
   * Core Compositing Engine:
   * 1. Clears the temporary compositing canvas (`compCanvasRef`).
   * 2. Draws the pre-rendered Effect Layer (`effectCanvasRef`).
   * 3. Applies `globalCompositeOperation = 'destination-in'` and draws the Mask Layer (`maskCanvasRef`).
   * 4. Renders the original Base Layer (`baseImageRef`) onto the visible canvas, followed by the composited result (`source-over`).
   */
  const renderCompositeFrame = useCallback((showOriginalOnly = false) => {
    const displayCanvas = displayCanvasRef.current;
    const effectCanvas = effectCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const compCanvas = compCanvasRef.current;
    const baseImg = baseImageRef.current;

    if (!displayCanvas || !effectCanvas || !maskCanvas || !compCanvas || !baseImg) {
      return;
    }

    const width = displayCanvas.width;
    const height = displayCanvas.height;
    if (width === 0 || height === 0) return;

    const displayCtx = displayCanvas.getContext('2d');
    const compCtx = compCanvas.getContext('2d');
    if (!displayCtx || !compCtx) return;

    // 1. Render Base Layer (original image) on visible canvas
    displayCtx.save();
    displayCtx.globalCompositeOperation = 'source-over';
    displayCtx.clearRect(0, 0, width, height);
    displayCtx.drawImage(baseImg, 0, 0, width, height);

    if (showOriginalOnly) {
      displayCtx.restore();
      return;
    }

    // 2. Clear temporary compositing canvas and combine Effect Layer + Mask Layer
    compCtx.save();
    compCtx.globalCompositeOperation = 'source-over';
    compCtx.clearRect(0, 0, width, height);
    compCtx.drawImage(effectCanvas, 0, 0, width, height);

    compCtx.globalCompositeOperation = 'destination-in';
    compCtx.drawImage(maskCanvas, 0, 0, width, height);
    compCtx.restore();

    // 3. Overlay masked effect onto Base Layer
    displayCtx.globalCompositeOperation = 'source-over';
    displayCtx.drawImage(compCanvas, 0, 0, width, height);
    displayCtx.restore();
  }, []);

  /**
   * Schedules a single compositing pass on the next animation frame for 60fps smoothness.
   */
  const scheduleCompositeRender = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      renderCompositeFrame(isComparingOriginal);
    });
  }, [renderCompositeFrame, isComparingOriginal]);

  /**
   * Pre-renders the Effect Layer (`effectCanvasRef`) whenever the image, blur mode,
   * blur intensity, or directional motion angle changes.
   */
  const buildEffectLayer = useCallback(
    (mode: BlurMode, intensityPx: number, angleDeg: number) => {
      const effectCanvas = effectCanvasRef.current;
      const baseImg = baseImageRef.current;
      if (!effectCanvas || !baseImg) return;

      const width = effectCanvas.width;
      const height = effectCanvas.height;
      if (width === 0 || height === 0) return;

      const ctx = effectCanvas.getContext('2d');
      if (!ctx) return;

      // Scale blur distance proportionally to canvas resolution so high-res photos blur richly
      const resolutionScale = Math.max(1, Math.min(width, height) / 900);

      ctx.save();
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';

      if (mode === 'standard') {
        // Algorithm 1: Standard Gaussian Blur via native Canvas filter
        const effectiveBlur = Math.max(4, Math.round(intensityPx * resolutionScale));
        const margin = effectiveBlur * 2;

        // First draw an unblurred edge-clamped base so borders never become semi-transparent
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.drawImage(baseImg, 0, 0, width, height);

        // Apply native CSS canvas blur filter with slightly expanded bounds to prevent edge vignette
        ctx.filter = `blur(${effectiveBlur}px)`;
        ctx.drawImage(
          baseImg,
          -margin,
          -margin,
          width + margin * 2,
          height + margin * 2
        );
        ctx.filter = 'none';
      } else {
        // Algorithm 2: Directional Motion Blur (40-step iterative offset accumulation)
        const maxDistance = Math.max(16, Math.round(intensityPx * 3.4 * resolutionScale));
        const rad = (angleDeg * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);

        // Slightly scale up image bounds so directional offsets never expose transparent edges
        const margin = Math.ceil(maxDistance * 0.65);
        const drawW = width + margin * 2;
        const drawH = height + margin * 2;

        // Opaque base pass to ensure alpha channel stays 1.0 everywhere before directional accumulation
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.drawImage(baseImg, -margin, -margin, drawW, drawH);

        // 40-iteration directional motion streak loop (globalAlpha = 0.025 as specified, plus harmonic pass)
        for (let i = 0; i < MOTION_BLUR_STEPS; i++) {
          const t = i / (MOTION_BLUR_STEPS - 1) - 0.5; // [-0.5, +0.5]
          const dx = cosA * maxDistance * t;
          const dy = sinA * maxDistance * t;

          // Combine the requested 0.025 alpha step with a normalized blend weight so all 40 samples
          // contribute evenly without washing out or biasing toward the final iteration
          ctx.globalAlpha = i === 0 ? 1 : Math.max(0.025, 2 / (i + 2));
          ctx.drawImage(baseImg, -margin + dx, -margin + dy, drawW, drawH);
        }
        ctx.globalAlpha = 1;
      }

      ctx.restore();
      renderCompositeFrame(isComparingOriginal);
    },
    [renderCompositeFrame, isComparingOriginal]
  );

  // Re-generate the Effect Layer whenever blur parameters change
  useEffect(() => {
    if (!hasImage) return;
    buildEffectLayer(blurMode, blurIntensity, motionAngle);
  }, [hasImage, blurMode, blurIntensity, motionAngle, buildEffectLayer]);

  // Re-render when holding the "Compare Original" button
  useEffect(() => {
    if (!hasImage) return;
    renderCompositeFrame(isComparingOriginal);
  }, [hasImage, isComparingOriginal, renderCompositeFrame]);

  /**
   * Saves a snapshot of the current Mask Layer into the Undo stack.
   */
  const pushMaskUndoSnapshot = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || maskCanvas.width === 0 || maskCanvas.height === 0) return;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    const snapshot = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > MAX_UNDO_STEPS) {
      undoStackRef.current.shift();
    }
    setUndoCount(undoStackRef.current.length - 1);
  }, []);

  /**
   * Loads an uploaded image file onto the 4-layer canvas pipeline.
   */
  const loadImageFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result;
        if (typeof dataUrl !== 'string') return;

        const img = new Image();
        img.onload = () => {
          let targetW = img.naturalWidth || img.width;
          let targetH = img.naturalHeight || img.height;

          if (targetW > MAX_CANVAS_DIMENSION || targetH > MAX_CANVAS_DIMENSION) {
            const ratio = Math.min(
              MAX_CANVAS_DIMENSION / targetW,
              MAX_CANVAS_DIMENSION / targetH
            );
            targetW = Math.round(targetW * ratio);
            targetH = Math.round(targetH * ratio);
          }

          baseImageRef.current = img;
          setImageDimensions({ width: targetW, height: targetH });

          const canvases = [
            displayCanvasRef.current,
            effectCanvasRef.current,
            maskCanvasRef.current,
            compCanvasRef.current,
          ];
          for (const c of canvases) {
            if (c) {
              c.width = targetW;
              c.height = targetH;
              const ctx = c.getContext('2d');
              ctx?.clearRect(0, 0, targetW, targetH);
            }
          }

          // Initialize Undo stack with the clean empty mask state
          undoStackRef.current = [];
          pushMaskUndoSnapshot();

          setHasImage(true);
          buildEffectLayer(blurMode, blurIntensity, motionAngle);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    [blurMode, blurIntensity, motionAngle, buildEffectLayer, pushMaskUndoSnapshot]
  );

  /**
   * Maps pointer client coordinates `(clientX, clientY)` to internal Canvas pixel coordinates
   * accounting for responsive CSS width/height scaling.
   */
  const getCanvasPointAndScale = (
    e: React.PointerEvent<HTMLCanvasElement>
  ): { point: Point; scale: number; cssPos: Point } | null => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    return {
      point: {
        x: cssX * scaleX,
        y: cssY * scaleY,
      },
      scale: (scaleX + scaleY) * 0.5,
      cssPos: { x: cssX, y: cssY },
    };
  };

  /**
   * Paints a soft, feathered brush stroke segment onto the Off-screen Mask Layer (`maskCanvasRef`).
   */
  const paintMaskSegment = useCallback(
    (from: Point, to: Point, canvasScale: number) => {
      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) return;
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) return;

      const scaledDiameter = Math.max(4, brushRadius * 2 * canvasScale);
      const featherBlur = Math.max(2, scaledDiameter * 0.35);

      maskCtx.save();
      maskCtx.lineCap = 'round';
      maskCtx.lineJoin = 'round';
      maskCtx.lineWidth = scaledDiameter;

      if (brushTool === 'eraser') {
        maskCtx.globalCompositeOperation = 'destination-out';
        maskCtx.strokeStyle = 'rgba(0, 0, 0, 1)';
        maskCtx.shadowColor = 'rgba(0, 0, 0, 1)';
        maskCtx.shadowBlur = featherBlur;
      } else {
        maskCtx.globalCompositeOperation = 'source-over';
        maskCtx.strokeStyle = 'rgba(255, 255, 255, 1)';
        maskCtx.shadowColor = 'rgba(255, 255, 255, 0.95)';
        maskCtx.shadowBlur = featherBlur;
      }

      maskCtx.beginPath();
      maskCtx.moveTo(from.x, from.y);
      maskCtx.lineTo(to.x, to.y);
      maskCtx.stroke();
      maskCtx.restore();

      scheduleCompositeRender();
    },
    [brushRadius, brushTool, scheduleCompositeRender]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!hasImage) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported
    }

    const mapped = getCanvasPointAndScale(e);
    if (!mapped) return;

    isDrawingRef.current = true;
    lastPointRef.current = mapped.point;
    setCursorPreview({ visible: true, x: mapped.cssPos.x, y: mapped.cssPos.y });

    // Draw initial dot even on a stationary tap/click
    paintMaskSegment(
      mapped.point,
      { x: mapped.point.x + 0.01, y: mapped.point.y + 0.01 },
      mapped.scale
    );
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!hasImage) return;
    const mapped = getCanvasPointAndScale(e);
    if (!mapped) return;

    setCursorPreview({ visible: true, x: mapped.cssPos.x, y: mapped.cssPos.y });

    if (!isDrawingRef.current || !lastPointRef.current) return;
    e.preventDefault();

    paintMaskSegment(lastPointRef.current, mapped.point, mapped.scale);
    lastPointRef.current = mapped.point;
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    pushMaskUndoSnapshot();
  };

  /**
   * Restores the previous Mask Layer state from the Undo stack.
   */
  const handleUndo = () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || undoStackRef.current.length <= 1) return;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    // Pop current state and restore the top of the remaining stack
    undoStackRef.current.pop();
    const previousState = undoStackRef.current[undoStackRef.current.length - 1];
    if (previousState) {
      maskCtx.putImageData(previousState, 0, 0);
      setUndoCount(undoStackRef.current.length - 1);
      renderCompositeFrame(false);
    }
  };

  /**
   * Clears all painted blur strokes on the Mask Layer.
   */
  const handleClearMask = () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || undoCount === 0) return;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    pushMaskUndoSnapshot();
    renderCompositeFrame(false);
  };

  /**
   * Merges the Base and Composited layers on the visible canvas and triggers a direct download.
   */
  const handleExportImage = () => {
    const displayCanvas = displayCanvasRef.current;
    if (!displayCanvas || !hasImage) return;

    // Ensure the final composite is rendered (not the original comparison view)
    renderCompositeFrame(false);

    displayCanvas.toBlob(
      (blob) => {
        if (!blob) return;
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `[cytools.io.vn]_edited_image_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
      },
      'image/png',
      1.0
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>100% Client-Side Canvas 60fps • Chuẩn Hypic Studio</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Cọ Làm Mờ Ảnh & Mờ Chuyển Động (Motion Blur Brush)
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
            Bôi trực tiếp lên vùng ảnh cần làm mờ biển số, khuôn mặt, thông tin nhạy cảm hoặc tạo hiệu ứng chuyển động nghệ thuật (Motion Blur) như ứng dụng Hypic.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadImageFile(f);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 text-xs font-bold transition-all active:scale-95 cursor-pointer"
          >
            <Upload className="w-4 h-4 text-pink-500" />
            <span>{hasImage ? 'Đổi Ảnh Khác' : 'Tải Ảnh Lên'}</span>
          </button>

          {hasImage && (
            <button
              type="button"
              onClick={handleExportImage}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold shadow-sm shadow-pink-500/20 transition-all active:scale-95 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Tải Ảnh Xuống</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Control Panel */}
        <div className="lg:col-span-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-6">
          {/* 1. Effect Selector */}
          <div className="space-y-2.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-pink-500" />
              <span>Chế độ hiệu ứng mờ</span>
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setBlurMode('standard');
                  setBrushTool('brush');
                }}
                className={`flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  blurMode === 'standard' && brushTool === 'brush'
                    ? 'bg-pink-500/10 border-pink-500 text-pink-600 dark:text-pink-400 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-pink-500/40'
                }`}
              >
                <Droplets className="w-5 h-5 text-pink-500" />
                <span>Cọ Mờ Thường</span>
                <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                  Gaussian Smooth
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBlurMode('motion');
                  setBrushTool('brush');
                }}
                className={`flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  blurMode === 'motion' && brushTool === 'brush'
                    ? 'bg-pink-500/10 border-pink-500 text-pink-600 dark:text-pink-400 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-pink-500/40'
                }`}
              >
                <Wind className="w-5 h-5 text-indigo-500" />
                <span>Mờ Chuyển Động</span>
                <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                  Hypic Motion Blur
                </span>
              </button>
            </div>
          </div>

          {/* 2. Brush vs Eraser Mode */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Công cụ thao tác:
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBrushTool('brush')}
                className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  brushTool === 'brush'
                    ? 'bg-pink-500 text-white border-pink-500'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Cọ Vẽ Mờ</span>
              </button>
              <button
                type="button"
                onClick={() => setBrushTool('eraser')}
                className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  brushTool === 'eraser'
                    ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 border-slate-800 dark:border-slate-200'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>Tẩy Khôi Phục</span>
              </button>
            </div>
          </div>

          {/* 3. Brush Radius Slider */}
          <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="brush-size-slider" className="font-bold text-slate-700 dark:text-slate-300">
                Kích thước đầu cọ (Radius):
              </label>
              <span className="font-mono font-bold text-pink-600 dark:text-pink-400">
                {brushRadius}px
              </span>
            </div>
            <input
              id="brush-size-slider"
              type="range"
              min={8}
              max={120}
              value={brushRadius}
              onChange={(e) => setBrushRadius(Number(e.target.value))}
              className="w-full accent-pink-500 cursor-pointer"
            />
          </div>

          {/* 4. Blur Intensity Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="blur-intensity-slider" className="font-bold text-slate-700 dark:text-slate-300">
                Cường độ làm mờ:
              </label>
              <span className="font-mono font-bold text-pink-600 dark:text-pink-400">
                {blurIntensity}px
              </span>
            </div>
            <input
              id="blur-intensity-slider"
              type="range"
              min={5}
              max={35}
              value={blurIntensity}
              onChange={(e) => setBlurIntensity(Number(e.target.value))}
              className="w-full accent-pink-500 cursor-pointer"
            />
          </div>

          {/* 5. Directional Angle Selector (Only for Motion Blur) */}
          {blurMode === 'motion' && (
            <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  Góc vệt chuyển động:
                </span>
                <span className="font-mono font-bold text-indigo-500">{motionAngle}°</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { deg: 0, label: '0° Ngang' },
                  { deg: 45, label: '45° Chéo' },
                  { deg: 90, label: '90° Dọc' },
                  { deg: 135, label: '135°' },
                ].map((preset) => (
                  <button
                    key={preset.deg}
                    type="button"
                    onClick={() => setMotionAngle(preset.deg)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                      motionAngle === preset.deg
                        ? 'bg-indigo-500/15 border-indigo-500 text-indigo-600 dark:text-indigo-400'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 6. History & Action Controls */}
          <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!hasImage || undoCount === 0}
                onClick={handleUndo}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              >
                <Undo2 className="w-4 h-4" />
                <span>Hoàn tác ({undoCount})</span>
              </button>

              <button
                type="button"
                disabled={!hasImage || undoCount === 0}
                onClick={handleClearMask}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Xóa Hết Mờ</span>
              </button>
            </div>

            <button
              type="button"
              disabled={!hasImage}
              onPointerDown={() => setIsComparingOriginal(true)}
              onPointerUp={() => setIsComparingOriginal(false)}
              onPointerLeave={() => setIsComparingOriginal(false)}
              onPointerCancel={() => setIsComparingOriginal(false)}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center justify-center gap-2 transition-all select-none cursor-pointer"
            >
              <Eye className="w-4 h-4 text-pink-500" />
              <span>Nhấn giữ để so sánh Ảnh Gốc</span>
            </button>

            <button
              type="button"
              disabled={!hasImage}
              onClick={handleExportImage}
              className="w-full py-3 px-4 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold shadow-sm shadow-pink-500/25 flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Tải Ảnh Xuống (.PNG)</span>
            </button>
          </div>
        </div>

        {/* Right Interactive Canvas Workspace */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) loadImageFile(f);
          }}
          className={`lg:col-span-8 rounded-xl bg-white dark:bg-slate-900 border transition-colors p-4 sm:p-6 min-h-[460px] flex flex-col items-center justify-center relative overflow-hidden ${
            isDraggingOver
              ? 'border-pink-500 bg-pink-500/5'
              : 'border-slate-200 dark:border-slate-800'
          }`}
        >
          {/* Empty Upload State */}
          {!hasImage && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-full max-w-lg py-16 px-6 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-pink-500 dark:hover:border-pink-500/70 bg-slate-50/60 dark:bg-slate-950/50 flex flex-col items-center text-center gap-4 cursor-pointer transition-all"
            >
              <div className="w-16 h-16 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
                <ImageIcon className="w-8 h-8" />
              </div>
              <div className="space-y-1.5">
                <p className="text-base font-bold text-slate-900 dark:text-white">
                  Kéo thả ảnh vào đây hoặc nhấn để chọn ảnh
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Hỗ trợ PNG, JPG, WebP độ phân giải cao • Xử lý 100% trên trình duyệt, không tải lên máy chủ
                </p>
              </div>
              <span className="px-4 py-2 rounded-xl bg-pink-500 text-white text-xs font-bold shadow-sm">
                Chọn Ảnh Từ Thiết Bị
              </span>
            </div>
          )}

          {/* Active Canvas Stage */}
          <div
            className={`relative inline-flex items-center justify-center max-w-full ${
              hasImage ? 'block' : 'hidden'
            }`}
          >
            <canvas
              ref={displayCanvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
              onPointerLeave={(e) => {
                setCursorPreview((prev) => ({ ...prev, visible: false }));
                finishStroke(e);
              }}
              className="max-w-full max-h-[72vh] w-auto h-auto object-contain rounded-lg shadow-md border border-slate-200 dark:border-slate-800 touch-none select-none cursor-crosshair"
            />

            {/* Floating Brush Circle Preview */}
            {cursorPreview.visible && hasImage && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)] transition-transform duration-75"
                style={{
                  width: `${brushRadius * 2}px`,
                  height: `${brushRadius * 2}px`,
                  left: `${cursorPreview.x - brushRadius}px`,
                  top: `${cursorPreview.y - brushRadius}px`,
                  backgroundColor:
                    brushTool === 'eraser'
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'rgba(236, 72, 153, 0.15)',
                }}
              />
            )}

            {/* Status Pill Overlay */}
            {hasImage && (
              <div className="absolute top-3 left-3 pointer-events-none flex items-center gap-2 px-3 py-1 rounded-full bg-black/65 text-white text-[11px] font-semibold backdrop-blur-md">
                <span>
                  {isComparingOriginal
                    ? 'Đang xem: Ảnh Gốc'
                    : brushTool === 'eraser'
                      ? 'Chế độ: Tẩy Khôi Phục'
                      : blurMode === 'standard'
                        ? 'Cọ Mờ Thường (Gaussian)'
                        : `Mờ Chuyển Động (${motionAngle}°)`}
                </span>
                <span className="text-slate-300 font-mono">
                  • {imageDimensions.width}×{imageDimensions.height}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BlurEditor;
