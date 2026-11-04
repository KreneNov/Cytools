import React, { useRef, useState, useEffect, useCallback, useReducer } from 'react';
import {
  Upload,
  Brush,
  Eraser,
  Undo2,
  Redo2,
  RotateCcw,
  Sparkles,
  Download,
  Eye,
  Loader2,
  Sliders,
  Image as ImageIcon,
  Cpu,
} from 'lucide-react';
import { detectWatermarkRegions } from '../../utils/imageWatermarkDetector';
import { rgbaMaskHasPaint } from '../../utils/inpaintImageOps';
import { useWatermarkRemover } from '../../hooks/useWatermarkRemover';
import { editorReducer, deriveEditorUi } from './imageEditorMachine';
import { WatermarkToast } from './WatermarkToast';

interface ImageWatermarkViewProps {
  isCompact?: boolean;
}

export const ImageWatermarkView: React.FC<ImageWatermarkViewProps> = ({ isCompact = false }) => {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  // Explicit Deterministic Finite State Machine: IDLE | PAINTING | PROCESSING | DONE
  const [editorState, dispatch] = useReducer(editorReducer, 'IDLE');
  const ui = deriveEditorUi(editorState);

  // Brush / Eraser configuration
  const [toolMode, setToolMode] = useState<'brush' | 'eraser'>('brush');
  const [brushSize, setBrushSize] = useState<number>(28);
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [autoDetectedCount, setAutoDetectedCount] = useState<number | null>(null);
  const [historyState, setHistoryState] = useState<{ canUndo: boolean; canRedo: boolean }>({
    canUndo: false,
    canRedo: false,
  });

  // ONNX Web Worker & Cache API Hook
  const {
    model,
    modelStatus,
    aiModelProgress,
    isAiModelCached,
    backend,
    inferenceProgress,
    notice,
    dismissNotice,
    preloadModel,
    runInpaint,
  } = useWatermarkRemover();

  // Canvas & image buffer refs
  const containerRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const firstOriginalImageDataRef = useRef<ImageData | null>(null);
  const committedBaseImageDataRef = useRef<ImageData | null>(null);
  const latestResultImageDataRef = useRef<ImageData | null>(null);

  // Undo & Redo stacks for the mask layer
  const maskUndoStackRef = useRef<ImageData[]>([]);
  const maskRedoStackRef = useRef<ImageData[]>([]);
  const isDrawingRef = useRef<boolean>(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const syncHistoryFlags = useCallback(() => {
    setHistoryState({
      canUndo: maskUndoStackRef.current.length > 1,
      canRedo: maskRedoStackRef.current.length > 0,
    });
  }, []);

  // Inspect current mask canvas and dispatch MASK_CHANGED to the FSM
  const evaluateMaskAndDispatch = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const hasMask = rgbaMaskHasPaint(data.data);
    dispatch({ type: 'MASK_CHANGED', hasMask });
  }, []);

  // Push current mask snapshot onto Undo stack and clear Redo stack
  const recordMaskSnapshot = useCallback(() => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    maskUndoStackRef.current.push(snapshot);
    if (maskUndoStackRef.current.length > 25) {
      maskUndoStackRef.current.shift();
    }
    maskRedoStackRef.current = [];
    syncHistoryFlags();
    const hasMask = rgbaMaskHasPaint(snapshot.data);
    dispatch({ type: 'MASK_CHANGED', hasMask });
  }, [syncHistoryFlags]);

  // Undo mask stroke
  const handleUndo = useCallback(() => {
    if (!ui.toolsEnabled) return;
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || maskUndoStackRef.current.length <= 1) return;
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const current = maskUndoStackRef.current.pop();
    if (current) {
      maskRedoStackRef.current.push(current);
    }
    const previous = maskUndoStackRef.current[maskUndoStackRef.current.length - 1];
    if (previous) {
      ctx.putImageData(previous, 0, 0);
      const hasMask = rgbaMaskHasPaint(previous.data);
      dispatch({ type: 'MASK_CHANGED', hasMask });
    }
    syncHistoryFlags();
  }, [syncHistoryFlags, ui.toolsEnabled]);

  // Redo mask stroke
  const handleRedo = useCallback(() => {
    if (!ui.toolsEnabled) return;
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || maskRedoStackRef.current.length === 0) return;
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const next = maskRedoStackRef.current.pop();
    if (next) {
      maskUndoStackRef.current.push(next);
      ctx.putImageData(next, 0, 0);
      const hasMask = rgbaMaskHasPaint(next.data);
      dispatch({ type: 'MASK_CHANGED', hasMask });
    }
    syncHistoryFlags();
  }, [syncHistoryFlags, ui.toolsEnabled]);

  // Clear mask completely -> transitions PAINTING back to IDLE
  const handleClearMask = useCallback(() => {
    if (!ui.toolsEnabled) return;
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    const blank = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    maskUndoStackRef.current = [blank];
    maskRedoStackRef.current = [];
    syncHistoryFlags();
    setAutoDetectedCount(null);
    dispatch({ type: 'MASK_CHANGED', hasMask: false });
  }, [syncHistoryFlags, ui.toolsEnabled]);

  // Load new image file and initialize FSM to IDLE
  const loadImage = useCallback(
    (file: File) => {
      setImageFile(file);
      setIsComparing(false);
      setAutoDetectedCount(null);
      latestResultImageDataRef.current = null;
      dispatch({ type: 'IMAGE_LOADED' });

      // Start warming up / checking the cached ONNX model in the background
      preloadModel();

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
        const initialData = baseCtx.getImageData(0, 0, width, height);
        firstOriginalImageDataRef.current = initialData;
        committedBaseImageDataRef.current = initialData;

        maskCtx.clearRect(0, 0, width, height);
        const blankMask = maskCtx.getImageData(0, 0, width, height);
        maskUndoStackRef.current = [blankMask];
        maskRedoStackRef.current = [];
        syncHistoryFlags();
      };

      img.src = url;
    },
    [preloadModel, syncHistoryFlags]
  );

  // Dropzone handler
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!ui.toolsEnabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        loadImage(file);
      }
    }
  };

  // Clipboard paste handler (disabled during PROCESSING)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!ui.toolsEnabled) return;
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        if (file.type.startsWith('image/')) {
          loadImage(file);
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [loadImage, ui.toolsEnabled]);

  // Coordinate mapping from mouse / touch to native canvas coordinates
  const getCanvasCoordinates = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
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

  const drawStroke = (x1: number, y1: number, x2: number, y2: number, modeOverride?: 'brush' | 'eraser') => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    const ctx = maskCanvas.getContext('2d');
    if (!ctx) return;

    const activeMode = modeOverride ?? toolMode;

    ctx.save();
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (activeMode === 'brush') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.58)';
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

  // Start painting on mask canvas
  // Crucial FSM requirement: If user paints while in DONE, commit current result as base,
  // reset mask layer, and immediately transition to PAINTING.
  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!ui.canvasInteractive) return;
    const pos = getCanvasCoordinates(e);
    if (!pos) return;

    let effectiveMode = toolMode;

    if (editorState === 'DONE') {
      const baseCanvas = baseCanvasRef.current;
      const maskCanvas = maskCanvasRef.current;
      if (baseCanvas && maskCanvas) {
        const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
        if (baseCtx && maskCtx) {
          if (latestResultImageDataRef.current) {
            baseCtx.putImageData(latestResultImageDataRef.current, 0, 0);
            committedBaseImageDataRef.current = latestResultImageDataRef.current;
          } else {
            committedBaseImageDataRef.current = baseCtx.getImageData(
              0,
              0,
              baseCanvas.width,
              baseCanvas.height
            );
          }
          maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
          const freshBlank = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
          maskUndoStackRef.current = [freshBlank];
          maskRedoStackRef.current = [];
          syncHistoryFlags();
        }
      }
      // Switch to brush if user was on eraser when starting a new pass from DONE
      if (toolMode === 'eraser') {
        setToolMode('brush');
        effectiveMode = 'brush';
      }
    }

    isDrawingRef.current = true;
    lastPosRef.current = pos;
    drawStroke(pos.x, pos.y, pos.x, pos.y, effectiveMode);

    if (effectiveMode === 'brush') {
      dispatch({ type: 'MASK_CHANGED', hasMask: true });
    }
  };

  const moveDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawingRef.current || !ui.canvasInteractive) return;
    const pos = getCanvasCoordinates(e);
    if (!pos || !lastPosRef.current) return;

    drawStroke(lastPosRef.current.x, lastPosRef.current.y, pos.x, pos.y);
    lastPosRef.current = pos;
  };

  const endDrawing = () => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      lastPosRef.current = null;
      recordMaskSnapshot();
    }
  };

  // Auto-Detect Watermark Regions
  const handleAutoDetect = () => {
    if (!ui.toolsEnabled || !baseCanvasRef.current || !maskCanvasRef.current) return;
    const baseCanvas = baseCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!baseCtx || !maskCtx) return;

    // If running Auto-Detect from DONE, commit the current result as the new base first
    if (editorState === 'DONE' && latestResultImageDataRef.current) {
      baseCtx.putImageData(latestResultImageDataRef.current, 0, 0);
      committedBaseImageDataRef.current = latestResultImageDataRef.current;
    }

    const baseData = baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
    const { boxes, maskImageData } = detectWatermarkRegions(baseData);

    if (boxes.length === 0) {
      setAutoDetectedCount(0);
      evaluateMaskAndDispatch();
      return;
    }

    maskCtx.putImageData(maskImageData, 0, 0);
    recordMaskSnapshot();
    setAutoDetectedCount(boxes.length);
  };

  // Execute ONNX AI Inpainting (transitions PAINTING -> PROCESSING -> DONE or back to PAINTING on error)
  const handleExecuteInpaint = async () => {
    if (editorState !== 'PAINTING') return;
    const baseCanvas = baseCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!baseCanvas || !maskCanvas) return;

    const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!baseCtx || !maskCtx) return;

    const currentBase =
      committedBaseImageDataRef.current ??
      baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
    const currentMask = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

    dispatch({ type: 'INPAINT_STARTED' });

    try {
      const resultImageData = await runInpaint(currentBase, currentMask);
      baseCtx.putImageData(resultImageData, 0, 0);
      latestResultImageDataRef.current = resultImageData;
      committedBaseImageDataRef.current = resultImageData;

      // Clear mask layer upon entering DONE
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      const blankMask = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      maskUndoStackRef.current = [blankMask];
      maskRedoStackRef.current = [];
      syncHistoryFlags();
      setAutoDetectedCount(null);

      dispatch({ type: 'INPAINT_SUCCEEDED' });
    } catch {
      dispatch({ type: 'INPAINT_FAILED' });
    }
  };

  // Download result matching source image format (PNG, JPEG, or WebP)
  const handleDownloadResult = () => {
    if (editorState !== 'DONE' || !baseCanvasRef.current || !imageFile) return;
    const canvas = baseCanvasRef.current;

    const srcType = imageFile.type.toLowerCase();
    let targetMime = 'image/png';
    let ext = 'png';
    if (srcType === 'image/jpeg' || srcType === 'image/jpg') {
      targetMime = 'image/jpeg';
      ext = 'jpg';
    } else if (srcType === 'image/webp') {
      targetMime = 'image/webp';
      ext = 'webp';
    }

    const nameWithoutExt = imageFile.name.replace(/\.[^/.]+$/, '');
    const filename = `${nameWithoutExt}_no_watermark.${ext}`;

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      },
      targetMime,
      0.95
    );
  };

  // Hold-to-Compare in DONE state (pressing shows original image, releasing shows inpainted result)
  const handleCompareStart = () => {
    if (editorState !== 'DONE' || !firstOriginalImageDataRef.current || !baseCanvasRef.current) return;
    setIsComparing(true);
    const ctx = baseCanvasRef.current.getContext('2d');
    if (ctx) ctx.putImageData(firstOriginalImageDataRef.current, 0, 0);
  };

  const handleCompareEnd = () => {
    if (editorState !== 'DONE' || !latestResultImageDataRef.current || !baseCanvasRef.current) return;
    setIsComparing(false);
    const ctx = baseCanvasRef.current.getContext('2d');
    if (ctx) ctx.putImageData(latestResultImageDataRef.current, 0, 0);
  };

  const handleResetImage = () => {
    if (!ui.toolsEnabled) return;
    setImageFile(null);
    setImageDimensions(null);
    setAutoDetectedCount(null);
    setIsComparing(false);
    firstOriginalImageDataRef.current = null;
    committedBaseImageDataRef.current = null;
    latestResultImageDataRef.current = null;
    maskUndoStackRef.current = [];
    maskRedoStackRef.current = [];
    dispatch({ type: 'RESET' });
  };

  const displayProgress =
    modelStatus === 'downloading'
      ? aiModelProgress
      : inferenceProgress > 0
      ? inferenceProgress
      : aiModelProgress;

  return (
    <div className={`space-y-6 ${isCompact ? 'p-1' : ''}`}>
      {/* Toast Notification for WebGPU->WASM fallback or model download errors */}
      {notice && (
        <WatermarkToast
          id={notice.id}
          tone={notice.tone}
          message={notice.message}
          onDismiss={dismissNotice}
        />
      )}

      {/* Upload Dropzone (when no image is loaded) */}
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
            Kéo thả ảnh cần xóa Watermark bằng AI vào đây
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-md mx-auto">
            Hỗ trợ PNG, JPG, WebP. Hoặc nhấn phím{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-xs">
              Ctrl + V
            </kbd>{' '}
            để dán ảnh trực tiếp từ clipboard.
          </p>
          <button
            type="button"
            className="px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-xs sm:text-sm font-bold shadow-md shadow-pink-500/20 transition-all active:scale-95 cursor-pointer"
          >
            Chọn ảnh từ máy tính
          </button>
        </div>
      ) : (
        /* Dual-Canvas Editor Workspace controlled by Strict FSM */
        <div className="space-y-4">
          {/* Top Control Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              {/* Tool Mode: Brush vs Eraser */}
              <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  disabled={!ui.toolsEnabled}
                  onClick={() => setToolMode('brush')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
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
                  disabled={!ui.toolsEnabled}
                  onClick={() => setToolMode('eraser')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
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
                  disabled={!ui.toolsEnabled}
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
                  className="w-20 sm:w-28 accent-pink-500 cursor-pointer disabled:opacity-40"
                />
                <span className="font-mono text-slate-700 dark:text-slate-300 w-8">{brushSize}px</span>
              </div>

              {/* Auto-Detect Watermark Button */}
              <button
                type="button"
                onClick={handleAutoDetect}
                disabled={!ui.toolsEnabled}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-pink-500/10 hover:bg-pink-500/20 text-pink-600 dark:text-pink-400 border border-pink-500/20 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Tự động dò Watermark</span>
              </button>

              {/* Undo / Redo / Clear Mask Controls (Shown in PAINTING state) */}
              {ui.showHistoryControls && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={!ui.toolsEnabled || !historyState.canUndo}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-40 cursor-pointer"
                    title="Hoàn tác (Undo)"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRedo}
                    disabled={!ui.toolsEnabled || !historyState.canRedo}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-40 cursor-pointer"
                    title="Làm lại (Redo)"
                  >
                    <Redo2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleClearMask}
                    disabled={!ui.toolsEnabled}
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-40 cursor-pointer"
                    title="Xóa toàn bộ vùng chọn (Clear Mask)"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Right Action Area: Strictly governed by FSM state (IDLE | PAINTING | PROCESSING | DONE) */}
            <div className="flex items-center gap-2">
              {/* ONNX AI Model Cache Status Badge */}
              <div
                className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-400"
                title={`Mô hình ${model.label} • Bộ nhớ đệm Cache API`}
              >
                <Cpu className="w-3.5 h-3.5 text-pink-500" />
                <span>
                  {modelStatus === 'ready'
                    ? `AI sẵn sàng · ${(backend || 'wasm').toUpperCase()}`
                    : modelStatus === 'downloading'
                    ? `Tải AI: ${aiModelProgress}%`
                    : isAiModelCached
                    ? 'AI Cache: Sẵn sàng'
                    : model.label}
                </span>
              </div>

              {/* IDLE or PAINTING: Show "Xóa Watermark" (Disabled in IDLE, Enabled in PAINTING) */}
              {ui.showInpaintButton && (
                <button
                  type="button"
                  onClick={handleExecuteInpaint}
                  disabled={!ui.inpaintEnabled}
                  className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all ${
                    ui.inpaintEnabled
                      ? 'bg-pink-500 hover:bg-pink-600 text-white shadow-md shadow-pink-500/20 active:scale-95 cursor-pointer'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-70'
                  }`}
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>Xóa Watermark</span>
                </button>
              )}

              {/* PROCESSING: Replace action button with loading spinner */}
              {ui.showProcessing && (
                <button
                  type="button"
                  disabled
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-pink-500/80 text-white text-xs font-bold opacity-90 cursor-wait"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang xóa Watermark... ({displayProgress}%)</span>
                </button>
              )}

              {/* DONE: Reveal ONLY "Giữ để so sánh" and "Tải ảnh đã xóa" */}
              {ui.showResultActions && (
                <>
                  <button
                    type="button"
                    onMouseDown={handleCompareStart}
                    onMouseUp={handleCompareEnd}
                    onMouseLeave={handleCompareEnd}
                    onTouchStart={handleCompareStart}
                    onTouchEnd={handleCompareEnd}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors select-none cursor-pointer ${
                      isComparing
                        ? 'bg-amber-500 text-white'
                        : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{isComparing ? 'Đang xem ảnh gốc' : 'Giữ để so sánh'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadResult}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all active:scale-95 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Tải ảnh đã xóa</span>
                  </button>
                </>
              )}

              {/* Change Image Button */}
              <button
                type="button"
                disabled={!ui.toolsEnabled}
                onClick={handleResetImage}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Đổi ảnh
              </button>
            </div>
          </div>

          {/* Auto-detect Notification Banner */}
          {autoDetectedCount !== null && (
            <div className="flex items-center justify-between px-4 py-2 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs">
              <span>
                {autoDetectedCount > 0
                  ? `Đã tự động khoanh vùng ${autoDetectedCount} vị trí watermark tiềm năng. Nhấn "Xóa Watermark" hoặc dùng cọ vẽ/tẩy để tinh chỉnh thêm.`
                  : 'Không tìm thấy vùng watermark tự động. Hãy dùng Cọ vẽ tô lên vùng chữ/logo cần xóa.'}
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

          {/* Dual-Canvas Surface */}
          <div
            ref={containerRef}
            className="relative w-full overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950/90 flex items-center justify-center min-h-[380px] sm:min-h-[500px]"
          >
            {/* Base Image Canvas */}
            <canvas
              ref={baseCanvasRef}
              className="max-w-full max-h-[70vh] object-contain block select-none pointer-events-none"
            />

            {/* Mask Overlay Canvas */}
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
                ui.canvasInteractive ? 'cursor-crosshair' : 'pointer-events-none'
              }`}
            />

            {/* Processing Overlay during ONNX Inference */}
            {ui.showProcessing && (
              <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex flex-col items-center justify-center gap-3 text-white z-10">
                <Loader2 className="w-9 h-9 text-pink-500 animate-spin" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-bold">
                    {modelStatus === 'downloading'
                      ? `Đang tải mô hình AI vào bộ nhớ đệm (${aiModelProgress}%)...`
                      : `Đang phục hồi vùng ảnh bằng ONNX AI (${inferenceProgress}%)...`}
                  </p>
                  <p className="text-xs text-slate-300">
                    Xử lý 100% trên trình duyệt qua WebGPU / WebAssembly
                  </p>
                </div>
              </div>
            )}

            {/* State & Resolution Hint Pill */}
            <div className="absolute bottom-3 left-3 px-3 py-1 rounded-lg bg-black/60 backdrop-blur-md text-white/80 text-[11px] font-medium pointer-events-none flex items-center gap-2">
              <ImageIcon className="w-3.5 h-3.5 text-pink-400" />
              <span>
                {imageDimensions
                  ? `${imageDimensions.width} × ${imageDimensions.height} px • ${
                      editorState === 'DONE'
                        ? 'Đã xóa xong (Tô tiếp lên ảnh nếu muốn xóa thêm vùng khác)'
                        : editorState === 'PAINTING'
                        ? 'Đã chọn vùng mask • Nhấn "Xóa Watermark" để chạy AI'
                        : 'Tô cọ hồng lên vùng watermark để kích hoạt nút xóa'
                    }`
                  : 'Tô cọ lên vùng logo / chữ cần xóa'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
