import React, { useState, useRef, useCallback } from 'react';
import {
  UploadCloud,
  RotateCcw,
  SlidersHorizontal,
  Palette,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Zap,
} from 'lucide-react';
import { useBackgroundRemoval } from '../hooks/useBackgroundRemoval';
import type { BgEngineType } from '../hooks/useBackgroundRemoval';
import { ComparisonSlider } from '../components/remove-bg/ComparisonSlider';
import { CanvasPreview } from '../components/remove-bg/CanvasPreview';
import { BgPresetsBar } from '../components/remove-bg/BgPresetsBar';
import type { BackgroundPreset, ImageProcessingItem } from '../types/removeBg';
import { Skeleton } from '../components/ui/Skeleton';
import { usePro } from '../context/ProContext';

export const RemoveBgPage: React.FC = () => {
  const { isPro, openProModal } = usePro();
  const { progress, isProcessing, error, removeBg, reset: resetHook } = useBackgroundRemoval();

  const [selectedEngine, setSelectedEngine] = useState<BgEngineType>('cloud');
  const [activeTab, setActiveTab] = useState<'slider' | 'canvas'>('slider');
  const [selectedPreset, setSelectedPreset] = useState<BackgroundPreset>('transparent');
  const [customColor, setCustomColor] = useState<string>('#3b82f6');

  // Single file state
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);

  // Batch files state (for Pro users)
  const [batchQueue, setBatchQueue] = useState<ImageProcessingItem[]>([]);
  const [isBatchMode, setIsBatchMode] = useState(false);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file drop / selection
  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) =>
        ['image/jpeg', 'image/png', 'image/webp'].includes(f.type)
      );

      if (files.length === 0) return;

      // Single file mode
      if (files.length === 1) {
        setIsBatchMode(false);
        const file = files[0];
        setCurrentFile(file);
        const origUrl = URL.createObjectURL(file);
        setOriginalUrl(origUrl);

        try {
          const resultBlob = await removeBg(file, selectedEngine);
          const pUrl = URL.createObjectURL(resultBlob);
          setProcessedBlob(resultBlob);
          setProcessedUrl(pUrl);
        } catch (err) {
          console.error('Failed to remove background', err);
        }
        return;
      }

      // Batch Mode (Multi-file)
      if (!isPro) {
        openProModal('Tính năng Xóa nền hàng loạt yêu cầu mở khóa gói Pro 5.000đ.');
        return;
      }

      setIsBatchMode(true);
      const queue: ImageProcessingItem[] = files.map((file) => ({
        id: Math.random().toString(36).substring(7),
        originalFile: file,
        originalUrl: URL.createObjectURL(file),
        processedBlob: null,
        processedUrl: null,
        width: 0,
        height: 0,
        status: 'pending',
      }));
      setBatchQueue(queue);

      // Process batch sequentially
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        setBatchQueue((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: 'processing' } : it))
        );

        try {
          const resBlob = await removeBg(item.originalFile, selectedEngine);
          const resUrl = URL.createObjectURL(resBlob);
          setBatchQueue((prev) =>
            prev.map((it) =>
              it.id === item.id
                ? { ...it, status: 'success', processedBlob: resBlob, processedUrl: resUrl }
                : it
            )
          );
        } catch {
          setBatchQueue((prev) =>
            prev.map((it) =>
              it.id === item.id ? { ...it, status: 'error', error: 'Lỗi bóc tách nền' } : it
            )
          );
        }
      }
    },
    [isPro, openProModal, removeBg, selectedEngine]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleReset = () => {
    resetHook();
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (processedUrl) URL.revokeObjectURL(processedUrl);
    setCurrentFile(null);
    setOriginalUrl(null);
    setProcessedBlob(null);
    setProcessedUrl(null);
    setBatchQueue([]);
    setIsBatchMode(false);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          Xóa Phông Ảnh Bằng AI
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
          Tách nền hình ảnh chuẩn từng sợi tóc với công nghệ AI BiRefNet hoặc xử lý nhanh 100% trên trình duyệt.
        </p>
      </div>

      {/* Compact Modern AI Engine Segmented Control */}
      <div className="flex items-center justify-between gap-4 py-1">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Engine xử lý:
        </span>

        <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setSelectedEngine('cloud')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              selectedEngine === 'cloud'
                ? 'bg-white dark:bg-slate-800 text-pink-600 dark:text-pink-400 font-semibold border border-slate-200/60 dark:border-slate-700/60'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Studio (Cloud)
          </button>
          <button
            type="button"
            onClick={() => setSelectedEngine('local')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              selectedEngine === 'local'
                ? 'bg-white dark:bg-slate-800 text-pink-600 dark:text-pink-400 font-semibold border border-slate-200/60 dark:border-slate-700/60'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Nhanh (Local)
          </button>
        </div>
      </div>

      {/* Main Upload Dropzone (When no file or batch selected) */}
      {!currentFile && batchQueue.length === 0 && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-4 ${
            isDraggingOver
              ? 'border-pink-500 bg-pink-500/5'
              : 'border-slate-300 dark:border-slate-800 hover:border-pink-500/40 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/70'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />

          <div className="w-16 h-16 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
            <UploadCloud className="w-8 h-8" />
          </div>

          <div className="space-y-1">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              Kéo thả hình ảnh vào đây hoặc click để chọn file
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
              Hỗ trợ định dạng JPG, PNG, WebP • Đang kích hoạt:{' '}
              {selectedEngine === 'cloud' ? 'Studio (Cloud)' : 'Nhanh (Local)'}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {selectedEngine === 'cloud' ? 'BiRefNet Deep Learning' : '100% Client-Side WASM'}
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              Cọ Khôi Phục & Xóa Tức Thì
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              Độ nét HD gốc
            </span>
          </div>
        </div>
      )}

      {/* Progress Bar Display */}
      {isProcessing && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-pink-500 animate-spin shrink-0" />
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {selectedEngine === 'cloud'
                  ? 'Đang xử lý qua Cloud AI (BiRefNet)... Vui lòng đợi vài giây'
                  : progress.message}
              </span>
            </div>
            <span className="font-mono font-bold text-pink-500">{progress.percentage}%</span>
          </div>

          {/* Animated Progress Bar */}
          <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-pink-500 transition-all duration-300 ease-out"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {progress.message}
            </span>
            <span className="hidden sm:inline">
              {selectedEngine === 'cloud'
                ? 'BiRefNet Studio • Tự động fallback RMBG-1.4 nếu cần'
                : 'Mô hình RMBG-1.4 FP32 WASM/WebGPU'}
            </span>
          </div>
        </div>
      )}

      {/* SKELETON RESULT PLACEHOLDER DURING BACKGROUND REMOVAL */}
      {isProcessing && currentFile && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-48 rounded" />
            <Skeleton className="h-4 w-28 rounded" />
          </div>

          <div className="rounded-xl overflow-hidden aspect-[4/3] max-h-96 mx-auto">
            <Skeleton className="w-full h-full rounded-xl" />
          </div>

          <div className="flex items-center justify-between pt-2">
            <Skeleton className="h-4 w-36 rounded" />
            <Skeleton className="h-10 w-32 rounded-xl" />
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-red-600 dark:text-red-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
          <div className="space-y-1">
            <p className="font-semibold">Đã xảy ra lỗi khi tách nền:</p>
            <p className="text-red-600 dark:text-red-400/90">{error}</p>
            <button
              onClick={handleReset}
              className="mt-2 px-3 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-700 dark:text-red-200 border border-red-500/40 text-xs transition-colors"
            >
              Thử lại với ảnh khác
            </button>
          </div>
        </div>
      )}

      {/* Single Image Result Workspace */}
      {currentFile && originalUrl && processedBlob && processedUrl && (
        <div className="space-y-6">
          {/* Workspace Navigation Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('slider')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'slider'
                    ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>So sánh Trước / Sau</span>
              </button>

              <button
                onClick={() => setActiveTab('canvas')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  activeTab === 'canvas'
                    ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/30'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Palette className="w-4 h-4" />
                <span>Thay Phông Nền & Cọ Tinh Chỉnh HD</span>
              </button>
            </div>

            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Xóa ảnh & thử ảnh khác</span>
            </button>
          </div>

          {/* Active Workspace View */}
          {activeTab === 'slider' ? (
            <div className="space-y-4">
              <ComparisonSlider originalUrl={originalUrl} processedUrl={processedUrl} />
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-2">
                <span>Kéo thả thanh trượt ở giữa để kiểm tra độ chính xác của viền tách.</span>
                <button
                  onClick={() => setActiveTab('canvas')}
                  className="text-pink-600 dark:text-pink-400 hover:underline font-medium cursor-pointer"
                >
                  Chuyển sang Thay Phông Nền & Cọ Tinh Chỉnh →
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <BgPresetsBar
                selectedPreset={selectedPreset}
                customColor={customColor}
                onSelectPreset={setSelectedPreset}
                onChangeCustomColor={setCustomColor}
              />

              <CanvasPreview
                processedBlob={processedBlob}
                originalBlob={currentFile}
                preset={selectedPreset}
                customColor={customColor}
                originalFileName={currentFile.name}
              />
            </div>
          )}
        </div>
      )}

      {/* Batch Mode Queue Workspace (For Pro users) */}
      {isBatchMode && batchQueue.length > 0 && (
        <div className="space-y-4 p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-pink-500 dark:text-pink-400" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Hàng đợi Batch Mode ({batchQueue.filter((i) => i.status === 'success').length}/
                {batchQueue.length} đã hoàn tất)
              </h3>
            </div>
            <button
              onClick={handleReset}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Làm mới hàng đợi</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {batchQueue.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-3"
              >
                <div className="relative aspect-video rounded-lg overflow-hidden bg-checkerboard flex items-center justify-center">
                  <img
                    src={item.processedUrl || item.originalUrl}
                    alt="Batch item"
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute top-2 right-2">
                    {item.status === 'processing' && (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-pink-500 text-white flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Đang tách
                      </span>
                    )}
                    {item.status === 'success' && (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500 text-white flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Hoàn tất
                      </span>
                    )}
                    {item.status === 'pending' && (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        Chờ xử lý
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="truncate max-w-[140px] text-slate-700 dark:text-slate-300 font-medium">
                    {item.originalFile.name}
                  </span>
                  {item.processedBlob && item.processedUrl && (
                    <a
                      href={item.processedUrl}
                      download={`nobg_${item.originalFile.name.replace(/\.[^/.]+$/, '')}.png`}
                      className="px-2.5 py-1 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 text-pink-600 dark:text-pink-400 border border-pink-500/30 text-xs font-semibold transition-colors"
                    >
                      Tải PNG
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
