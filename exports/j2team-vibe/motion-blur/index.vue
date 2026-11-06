<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';

type BlurMode = 'standard' | 'motion';
type BrushTool = 'brush' | 'eraser';

interface Point {
  x: number;
  y: number;
}

const MAX_CANVAS_DIMENSION = 2400;
const MAX_UNDO_STEPS = 25;
const MOTION_BLUR_STEPS = 40;

// Visible & Off-screen Canvas References
const displayCanvasRef = ref<HTMLCanvasElement | null>(null);
const effectCanvas = document.createElement('canvas');
const maskCanvas = document.createElement('canvas');
const compCanvas = document.createElement('canvas');
const baseImage = ref<HTMLImageElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

// Interactive UI State
const hasImage = ref<boolean>(false);
const fileName = ref<string>('cytools-blur.png');
const imageDimensions = ref<{ width: number; height: number }>({ width: 0, height: 0 });
const blurMode = ref<BlurMode>('standard');
const brushTool = ref<BrushTool>('brush');
const brushRadius = ref<number>(36);
const blurIntensity = ref<number>(15);
const motionAngle = ref<number>(45);
const undoCount = ref<number>(0);
const isComparingOriginal = ref<boolean>(false);
const isDraggingOver = ref<boolean>(false);
const cursorPreview = ref<{ visible: boolean; x: number; y: number }>({
  visible: false,
  x: 0,
  y: 0,
});

// Drawing Engine State (Non-reactive for maximum 60fps performance)
let isDrawing = false;
let lastPoint: Point | null = null;
let rafId: number | null = null;
const undoStack: ImageData[] = [];

/**
 * Core Compositing Engine:
 * 1. Renders Base Layer (original image) onto the visible canvas.
 * 2. Clears temporary compositing canvas, draws Effect Layer.
 * 3. Applies globalCompositeOperation = 'destination-in' and draws Mask Layer.
 * 4. Overlays the masked effect onto the visible canvas with source-over.
 */
function renderCompositeFrame(showOriginalOnly = false): void {
  const displayCanvas = displayCanvasRef.current;
  const baseImg = baseImage.value;
  if (!displayCanvas || !baseImg) return;

  const width = displayCanvas.width;
  const height = displayCanvas.height;
  if (width === 0 || height === 0) return;

  const displayCtx = displayCanvas.getContext('2d');
  const compCtx = compCanvas.getContext('2d');
  if (!displayCtx || !compCtx) return;

  // 1. Render Base Layer
  displayCtx.save();
  displayCtx.globalCompositeOperation = 'source-over';
  displayCtx.clearRect(0, 0, width, height);
  displayCtx.drawImage(baseImg, 0, 0, width, height);

  if (showOriginalOnly) {
    displayCtx.restore();
    return;
  }

  // 2. Combine Effect Layer + Mask Layer in temporary canvas
  compCtx.save();
  compCtx.globalCompositeOperation = 'source-over';
  compCtx.clearRect(0, 0, width, height);
  compCtx.drawImage(effectCanvas, 0, 0, width, height);

  compCtx.globalCompositeOperation = 'destination-in';
  compCtx.drawImage(maskCanvas, 0, 0, width, height);
  compCtx.restore();

  // 3. Composite over original image
  displayCtx.globalCompositeOperation = 'source-over';
  displayCtx.drawImage(compCanvas, 0, 0, width, height);
  displayCtx.restore();
}

function scheduleCompositeRender(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    renderCompositeFrame(isComparingOriginal.value);
  });
}

/**
 * Pre-renders the Effect Layer whenever image, mode, intensity, or angle changes.
 */
function buildEffectLayer(mode: BlurMode, intensityPx: number, angleDeg: number): void {
  const baseImg = baseImage.value;
  if (!baseImg) return;

  const width = effectCanvas.width;
  const height = effectCanvas.height;
  if (width === 0 || height === 0) return;

  const ctx = effectCanvas.getContext('2d');
  if (!ctx) return;

  const resolutionScale = Math.max(1, Math.min(width, height) / 900);

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';

  if (mode === 'standard') {
    // 1. Standard Gaussian Blur via Canvas Filter
    const effectiveBlur = Math.max(4, Math.round(intensityPx * resolutionScale));
    const margin = effectiveBlur * 2;

    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.drawImage(baseImg, 0, 0, width, height);

    ctx.filter = `blur(${effectiveBlur}px)`;
    ctx.drawImage(baseImg, -margin, -margin, width + margin * 2, height + margin * 2);
    ctx.filter = 'none';
  } else {
    // 2. Directional Motion Blur (40-step iterative offset accumulation)
    const maxDistance = Math.max(16, Math.round(intensityPx * 3.4 * resolutionScale));
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    const margin = Math.ceil(maxDistance * 0.65);
    const drawW = width + margin * 2;
    const drawH = height + margin * 2;

    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.drawImage(baseImg, -margin, -margin, drawW, drawH);

    for (let i = 0; i < MOTION_BLUR_STEPS; i++) {
      const t = i / (MOTION_BLUR_STEPS - 1) - 0.5;
      const dx = cosA * maxDistance * t;
      const dy = sinA * maxDistance * t;

      ctx.globalAlpha = i === 0 ? 1 : Math.max(0.025, 2 / (i + 2));
      ctx.drawImage(baseImg, -margin + dx, -margin + dy, drawW, drawH);
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
  renderCompositeFrame(isComparingOriginal.value);
}

function pushMaskUndoSnapshot(): void {
  if (maskCanvas.width === 0 || maskCanvas.height === 0) return;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  const snapshot = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  undoStack.push(snapshot);
  if (undoStack.length > MAX_UNDO_STEPS) {
    undoStack.shift();
  }
  undoCount.value = Math.max(0, undoStack.length - 1);
}

function handleUndo(): void {
  if (undoStack.length <= 1) return;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  undoStack.pop();
  const previousState = undoStack[undoStack.length - 1];
  if (previousState) {
    maskCtx.putImageData(previousState, 0, 0);
    undoCount.value = Math.max(0, undoStack.length - 1);
    renderCompositeFrame(false);
  }
}

function handleClearMask(): void {
  if (undoCount.value === 0) return;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  pushMaskUndoSnapshot();
  renderCompositeFrame(false);
}

function loadImageFile(file: File): void {
  if (!file.type.startsWith('image/')) return;

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
  fileName.value = `[cytools.io.vn]_${baseName}_blurred.png`;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target?.result;
    if (typeof dataUrl !== 'string') return;

    const img = new Image();
    img.onload = () => {
      let targetW = img.naturalWidth || img.width;
      let targetH = img.naturalHeight || img.height;

      if (targetW > MAX_CANVAS_DIMENSION || targetH > MAX_CANVAS_DIMENSION) {
        const ratio = Math.min(MAX_CANVAS_DIMENSION / targetW, MAX_CANVAS_DIMENSION / targetH);
        targetW = Math.round(targetW * ratio);
        targetH = Math.round(targetH * ratio);
      }

      baseImage.value = img;
      imageDimensions.value = { width: targetW, height: targetH };

      const canvases = [displayCanvasRef.value, effectCanvas, maskCanvas, compCanvas];
      for (const c of canvases) {
        if (c) {
          c.width = targetW;
          c.height = targetH;
          const ctx = c.getContext('2d');
          ctx?.clearRect(0, 0, targetW, targetH);
        }
      }

      undoStack.length = 0;
      pushMaskUndoSnapshot();

      hasImage.value = true;
      buildEffectLayer(blurMode.value, blurIntensity.value, motionAngle.value);
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function getCanvasPointAndScale(e: PointerEvent): { point: Point; scale: number; cssPos: Point } | null {
  const canvas = displayCanvasRef.current;
  if (!canvas) return null;

  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;

  return {
    point: { x: cssX * scaleX, y: cssY * scaleY },
    scale: (scaleX + scaleY) * 0.5,
    cssPos: { x: cssX, y: cssY },
  };
}

function paintMaskSegment(from: Point, to: Point, canvasScale: number): void {
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  const scaledDiameter = Math.max(4, brushRadius.value * 2 * canvasScale);
  const featherBlur = Math.max(2, scaledDiameter * 0.35);

  maskCtx.save();
  maskCtx.lineCap = 'round';
  maskCtx.lineJoin = 'round';
  maskCtx.lineWidth = scaledDiameter;

  if (brushTool.value === 'eraser') {
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
}

function handlePointerDown(e: PointerEvent): void {
  if (!hasImage.value) return;
  e.preventDefault();
  try {
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  } catch {
    // Ignore if unsupported
  }

  const mapped = getCanvasPointAndScale(e);
  if (!mapped) return;

  isDrawing = true;
  lastPoint = mapped.point;
  cursorPreview.value = { visible: true, x: mapped.cssPos.x, y: mapped.cssPos.y };

  paintMaskSegment(mapped.point, { x: mapped.point.x + 0.01, y: mapped.point.y + 0.01 }, mapped.scale);
}

function handlePointerMove(e: PointerEvent): void {
  if (!hasImage.value) return;
  const mapped = getCanvasPointAndScale(e);
  if (!mapped) return;

  cursorPreview.value = { visible: true, x: mapped.cssPos.x, y: mapped.cssPos.y };

  if (!isDrawing || !lastPoint) return;
  e.preventDefault();

  paintMaskSegment(lastPoint, mapped.point, mapped.scale);
  lastPoint = mapped.point;
}

function finishStroke(e: PointerEvent): void {
  if (!isDrawing) return;
  isDrawing = false;
  lastPoint = null;
  try {
    if ((e.currentTarget as HTMLElement)?.hasPointerCapture?.(e.pointerId)) {
      (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    }
  } catch {
    // Ignore
  }
  pushMaskUndoSnapshot();
}

function handleExportImage(): void {
  const displayCanvas = displayCanvasRef.current;
  if (!displayCanvas || !hasImage.value) return;

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
}

function onFileInputChange(e: Event): void {
  const target = e.target as HTMLInputElement;
  const f = target.files?.[0];
  if (f) loadImageFile(f);
  target.value = '';
}

function onDropFile(e: DragEvent): void {
  e.preventDefault();
  isDraggingOver.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) loadImageFile(f);
}

watch([blurMode, blurIntensity, motionAngle], () => {
  if (!hasImage.value) return;
  buildEffectLayer(blurMode.value, blurIntensity.value, motionAngle.value);
});

watch(isComparingOriginal, (val) => {
  if (!hasImage.value) return;
  renderCompositeFrame(val);
});

onMounted(() => {
  // Canvases are initialized above
});

onUnmounted(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
});
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6 pb-12 font-sans text-slate-100">
    <!-- Top Back Navigation Required by J2TEAM Vibe -->
    <div class="flex items-center justify-between">
      <router-link
        to="/"
        class="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors py-1 px-2.5 rounded-lg hover:bg-slate-800"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        <span>Quay lại trang chủ</span>
      </router-link>

      <span class="text-xs text-slate-500 font-mono">100% Client-Side Canvas</span>
    </div>

    <!-- Header Banner -->
    <div class="rounded-2xl bg-slate-900 border border-slate-800 p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div class="space-y-2">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-400 text-xs font-semibold">
          <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.2-6.3-4.6-6.3 4.6 2.3-7.2-6-4.6h7.6z"/>
          </svg>
          <span>Hypic Canvas Brush Engine • 60fps Layering</span>
        </div>
        <h1 class="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
          Motion Blur Studio — Cọ Làm Mờ Ảnh
        </h1>
        <p class="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
          Bôi trực tiếp lên vùng ảnh cần che mờ biển số, khuôn mặt, thông tin nhạy cảm hoặc tạo hiệu ứng vệt chuyển động nghệ thuật (Motion Blur) chuẩn phong cách Hypic.
        </p>
      </div>

      <div class="flex items-center gap-2.5 shrink-0">
        <input
          ref="fileInputRef"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          class="hidden"
          @change="onFileInputChange"
        />
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-bold transition-all active:scale-95 cursor-pointer"
          @click="fileInputRef?.click()"
        >
          <svg class="w-4 h-4 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <span>{{ hasImage ? 'Đổi Ảnh Khác' : 'Tải Ảnh Lên' }}</span>
        </button>

        <button
          v-if="hasImage"
          type="button"
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold shadow-sm shadow-pink-500/20 transition-all active:scale-95 cursor-pointer"
          @click="handleExportImage"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Tải Ảnh Xuống (.PNG)</span>
        </button>
      </div>
    </div>

    <!-- Main Workspace -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <!-- Left Controls Panel -->
      <div class="lg:col-span-4 rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-6">
        <!-- 1. Blur Mode Selector -->
        <div class="space-y-2.5">
          <label class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            <span>Chế độ hiệu ứng</span>
          </label>
          <div class="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              :class="[
                'flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-xl border text-xs font-bold transition-all cursor-pointer',
                blurMode === 'standard' && brushTool === 'brush'
                  ? 'bg-pink-500/10 border-pink-500 text-pink-400 shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-pink-500/40'
              ]"
              @click="blurMode = 'standard'; brushTool = 'brush'"
            >
              <svg class="w-5 h-5 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              <span>Cọ Mờ Thường</span>
              <span class="text-[10px] font-normal text-slate-500">Gaussian Smooth</span>
            </button>

            <button
              type="button"
              :class="[
                'flex flex-col items-center justify-center gap-1.5 p-3.5 rounded-xl border text-xs font-bold transition-all cursor-pointer',
                blurMode === 'motion' && brushTool === 'brush'
                  ? 'bg-pink-500/10 border-pink-500 text-pink-400 shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-pink-500/40'
              ]"
              @click="blurMode = 'motion'; brushTool = 'brush'"
            >
              <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>Mờ Chuyển Động</span>
              <span class="text-[10px] font-normal text-slate-500">Hypic Motion Blur</span>
            </button>
          </div>
        </div>

        <!-- 2. Brush Tool vs Eraser -->
        <div class="space-y-2">
          <span class="text-xs font-bold text-slate-300">Công cụ thao tác:</span>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              :class="[
                'py-2 px-3 rounded-lg text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 cursor-pointer',
                brushTool === 'brush'
                  ? 'bg-pink-500 text-white border-pink-500'
                  : 'bg-slate-950 text-slate-300 border-slate-800'
              ]"
              @click="brushTool = 'brush'"
            >
              <span>Cọ Vẽ Mờ</span>
            </button>
            <button
              type="button"
              :class="[
                'py-2 px-3 rounded-lg text-xs font-semibold border transition-all flex items-center justify-center gap-1.5 cursor-pointer',
                brushTool === 'eraser'
                  ? 'bg-slate-200 text-slate-900 border-slate-200'
                  : 'bg-slate-950 text-slate-300 border-slate-800'
              ]"
              @click="brushTool = 'eraser'"
            >
              <span>Tẩy Khôi Phục</span>
            </button>
          </div>
        </div>

        <!-- 3. Brush Size Slider -->
        <div class="space-y-2 pt-1 border-t border-slate-800">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-300">Kích thước đầu cọ (Radius):</span>
            <span class="font-mono font-bold text-pink-400">{{ brushRadius }}px</span>
          </div>
          <input
            v-model.number="brushRadius"
            type="range"
            min="8"
            max="120"
            class="w-full accent-pink-500 cursor-pointer"
          />
        </div>

        <!-- 4. Blur Intensity Slider -->
        <div class="space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-300">Cường độ làm mờ:</span>
            <span class="font-mono font-bold text-pink-400">{{ blurIntensity }}px</span>
          </div>
          <input
            v-model.number="blurIntensity"
            type="range"
            min="5"
            max="35"
            class="w-full accent-pink-500 cursor-pointer"
          />
        </div>

        <!-- 5. Motion Angle Selector (Only in Motion mode) -->
        <div v-if="blurMode === 'motion'" class="space-y-2 pt-1 border-t border-slate-800">
          <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-slate-300">Góc vệt chuyển động:</span>
            <span class="font-mono font-bold text-indigo-400">{{ motionAngle }}°</span>
          </div>
          <div class="grid grid-cols-4 gap-1.5">
            <button
              v-for="deg in [0, 45, 90, 135]"
              :key="deg"
              type="button"
              :class="[
                'py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer',
                motionAngle === deg
                  ? 'bg-indigo-500/15 border-indigo-500 text-indigo-400'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              ]"
              @click="motionAngle = deg"
            >
              {{ deg }}° {{ deg === 0 ? 'Ngang' : deg === 45 ? 'Chéo' : deg === 90 ? 'Dọc' : '' }}
            </button>
          </div>
        </div>

        <!-- 6. History & Action Buttons -->
        <div class="space-y-2.5 pt-3 border-t border-slate-800">
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              :disabled="!hasImage || undoCount === 0"
              class="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              @click="handleUndo"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a5 5 0 015 5v2m0 0l-4-4m4 4l4-4" />
              </svg>
              <span>Hoàn tác ({{ undoCount }})</span>
            </button>

            <button
              type="button"
              :disabled="!hasImage || undoCount === 0"
              class="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              @click="handleClearMask"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Xóa Hết Mờ</span>
            </button>
          </div>

          <button
            type="button"
            :disabled="!hasImage"
            class="w-full py-2.5 px-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs font-semibold flex items-center justify-center gap-2 transition-all select-none cursor-pointer"
            @pointerdown="isComparingOriginal = true"
            @pointerup="isComparingOriginal = false"
            @pointerleave="isComparingOriginal = false"
            @pointercancel="isComparingOriginal = false"
          >
            <svg class="w-4 h-4 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span>Nhấn giữ để so sánh Ảnh Gốc</span>
          </button>
        </div>
      </div>

      <!-- Right Interactive Canvas Workspace -->
      <div
        :class="[
          'lg:col-span-8 rounded-2xl bg-slate-900 border transition-colors p-4 sm:p-6 min-h-[460px] flex flex-col items-center justify-center relative overflow-hidden',
          isDraggingOver ? 'border-pink-500 bg-pink-500/5' : 'border-slate-800'
        ]"
        @dragover.prevent="isDraggingOver = true"
        @dragleave="isDraggingOver = false"
        @drop="onDropFile"
      >
        <!-- Empty Upload Dropzone -->
        <div
          v-if="!hasImage"
          class="w-full max-w-lg py-16 px-6 rounded-2xl border-2 border-dashed border-slate-700 hover:border-pink-500 bg-slate-950/60 flex flex-col items-center text-center gap-4 cursor-pointer transition-all"
          @click="fileInputRef?.click()"
        >
          <div class="w-16 h-16 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div class="space-y-1.5">
            <p class="text-base font-bold text-white">Kéo thả ảnh vào đây hoặc nhấn để chọn ảnh</p>
            <p class="text-xs text-slate-400">Hỗ trợ PNG, JPG, WebP độ nét cao • Xử lý 100% trên trình duyệt</p>
          </div>
          <span class="px-4 py-2 rounded-xl bg-pink-500 text-white text-xs font-bold shadow-sm">
            Chọn Ảnh Từ Thiết Bị
          </span>
        </div>

        <!-- Active Canvas Stage -->
        <div v-show="hasImage" class="relative inline-flex items-center justify-center max-w-full">
          <canvas
            ref="displayCanvasRef"
            class="max-w-full max-h-[72vh] w-auto h-auto object-contain rounded-lg shadow-md border border-slate-800 touch-none select-none cursor-crosshair"
            @pointerdown="handlePointerDown"
            @pointermove="handlePointerMove"
            @pointerup="finishStroke"
            @pointercancel="finishStroke"
            @pointerleave="(e) => { cursorPreview.visible = false; finishStroke(e); }"
          />

          <!-- Floating Brush Circle Indicator -->
          <div
            v-if="cursorPreview.visible && hasImage"
            aria-hidden="true"
            class="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)] transition-transform duration-75"
            :style="{
              width: `${brushRadius * 2}px`,
              height: `${brushRadius * 2}px`,
              left: `${cursorPreview.x - brushRadius}px`,
              top: `${cursorPreview.y - brushRadius}px`,
              backgroundColor: brushTool === 'eraser' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(236, 72, 153, 0.15)'
            }"
          />

          <!-- Resolution Pill -->
          <div
            v-if="hasImage"
            class="absolute top-3 left-3 pointer-events-none flex items-center gap-2 px-3 py-1 rounded-full bg-black/65 text-white text-[11px] font-semibold backdrop-blur-md"
          >
            <span>
              {{ isComparingOriginal ? 'Đang xem: Ảnh Gốc' : brushTool === 'eraser' ? 'Chế độ: Tẩy Khôi Phục' : blurMode === 'standard' ? 'Cọ Mờ Thường' : `Mờ Chuyển Động (${motionAngle}°)` }}
            </span>
            <span class="text-slate-400 font-mono">• {{ imageDimensions.width }}×{{ imageDimensions.height }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Sleek Credit Footer Required by J2TEAM Vibe Rules -->
    <footer class="mt-12 pt-6 border-t border-slate-800 text-center text-xs text-slate-400">
      <p>
        Phát triển bởi
        <a
          href="https://cytools.io.vn"
          target="_blank"
          rel="noopener noreferrer"
          class="text-pink-400 hover:underline font-semibold"
        >
          Nguyễn Đăng Khánh
        </a>
        — Bộ công cụ đa năng tại
        <a
          href="https://cytools.io.vn"
          target="_blank"
          rel="noopener noreferrer"
          class="text-pink-400 hover:underline font-semibold"
        >
          cytools.io.vn
        </a>
      </p>
    </footer>
  </div>
</template>
