import React, { useState, useRef } from 'react';
import {
  Video,
  Download,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Gauge,
  Trash2,
  Plus,
  Crown,
  FileVideo,
} from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { useFFmpeg } from '../../hooks/useFFmpeg';
import { usePro } from '../../context/ProContext';

interface BatchGifQueueItem {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  errorMsg?: string;
}

const PRO_BATCH_MESSAGE =
  'Tính năng chuyển đổi hàng loạt (Batch Processing) chỉ dành riêng cho tài khoản PRO. Hãy nâng cấp để tiết kiệm thời gian!';

export const GifCreatorTab: React.FC = () => {
  const { isPro, openProModal } = usePro();
  const { progressPercent, error, generateGif, resetTask } = useFFmpeg();

  const [queue, setQueue] = useState<BatchGifQueueItem[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [resultGif, setResultGif] = useState<{ blob: Blob; url: string; fileName: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Settings
  const [startTime, setStartTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(5); // default 5s
  const [fps, setFps] = useState<10 | 15>(10);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerDownload = (url: string, originalFileName: string) => {
    const baseName = originalFileName.replace(/\.[^/.]+$/, '') || 'animation';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.gif`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleFilesSelected = (incomingFiles: FileList | File[]) => {
    const fileArray = Array.from(incomingFiles).filter(
      (f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi)$/i.test(f.name)
    );
    if (fileArray.length === 0) return;

    if (resultGif?.url) {
      URL.revokeObjectURL(resultGif.url);
      setResultGif(null);
    }
    resetTask();

    // PRO Gatekeeper for Batch Processing
    if ((fileArray.length > 1 || (queue.length > 0 && fileArray.length >= 1)) && !isPro) {
      openProModal(PRO_BATCH_MESSAGE);
      const firstFile = queue.length > 0 ? queue[0].file : fileArray[0];
      if (!videoPreviewUrl) {
        setVideoPreviewUrl(URL.createObjectURL(firstFile));
      }
      setQueue([
        {
          id: `${firstFile.name}_${Date.now()}_0`,
          file: firstFile,
          status: 'pending',
        },
      ]);
      return;
    }

    if (queue.length === 0 && fileArray[0]) {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      setVideoPreviewUrl(URL.createObjectURL(fileArray[0]));
      setStartTime(0);
      setDuration(5);
    }

    const newItems: BatchGifQueueItem[] = fileArray.map((file, idx) => ({
      id: `${file.name}_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      file,
      status: 'pending',
    }));

    setQueue((prev) => [...prev, ...newItems]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesSelected(e.target.files);
      e.target.value = '';
    }
  };

  const handleRemoveItem = (id: string) => {
    if (isBatchProcessing) return;
    setQueue((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (next.length === 0 && videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
        setVideoPreviewUrl(null);
      }
      return next;
    });
  };

  const handleSyncCurrentTime = () => {
    if (videoRef.current) {
      const current = Math.floor(videoRef.current.currentTime);
      setStartTime(current);
    }
  };

  const handleDurationChange = (newVal: number) => {
    if (newVal > 10 && !isPro) {
      setDuration(10);
      openProModal(
        'Gói Miễn Phí giới hạn thời lượng GIF tối đa 10 giây. Nâng cấp Pro 5.000đ để mở khóa thời lượng tới 30 giây!'
      );
      return;
    }
    setDuration(newVal);
  };

  const handleCreateGifQueue = async () => {
    if (queue.length === 0 || isBatchProcessing) return;

    if (duration > 10 && !isPro) {
      openProModal(
        'Thời lượng tạo GIF vượt quá 10 giây cho gói Miễn Phí. Vui lòng nâng cấp Pro 5.000đ.'
      );
      return;
    }

    setIsBatchProcessing(true);
    if (resultGif?.url) {
      URL.revokeObjectURL(resultGif.url);
      setResultGif(null);
    }

    const isSingleItem = queue.length === 1;

    // MEMORY-SAFE SEQUENTIAL PROCESSING (STRICT for...of LOOP)
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.status === 'done') continue;

      setActiveFileIndex(i);
      setQueue((prev) =>
        prev.map((q, idx) => (idx === i ? { ...q, status: 'processing', errorMsg: undefined } : q))
      );

      try {
        const res = await generateGif(item.file, {
          startTime,
          duration,
          fps,
          width: 480,
        });

        // Immediately trigger download as each file finishes
        triggerDownload(res.url, item.file.name);

        if (isSingleItem) {
          setResultGif({ blob: res.blob, url: res.url, fileName: item.file.name });
        } else {
          // Explicitly clean up Object URL memory before processing the next video in the queue
          setTimeout(() => {
            URL.revokeObjectURL(res.url);
          }, 1500);
        }

        setQueue((prev) =>
          prev.map((q, idx) => (idx === i ? { ...q, status: 'done' } : q))
        );
      } catch (err) {
        console.error('GIF generation error on file:', item.file.name, err);
        const msg = err instanceof Error ? err.message : 'Lỗi tạo GIF';
        setQueue((prev) =>
          prev.map((q, idx) => (idx === i ? { ...q, status: 'error', errorMsg: msg } : q))
        );
      }
    }

    setIsBatchProcessing(false);
  };

  const handleReset = () => {
    if (isBatchProcessing) return;
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    if (resultGif?.url) URL.revokeObjectURL(resultGif.url);
    setQueue([]);
    setVideoPreviewUrl(null);
    setResultGif(null);
    setActiveFileIndex(0);
    resetTask();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const completedCount = queue.filter((item) => item.status === 'done').length;

  return (
    <div className="space-y-6">
      {/* Hidden Multiple File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Upload Zone */}
      {queue.length === 0 && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              handleFilesSelected(e.dataTransfer.files);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-4 ${
            isDragging
              ? 'border-pink-500 bg-pink-500/5'
              : 'border-slate-300 dark:border-slate-800 hover:border-pink-500/60 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/70'
          }`}
        >
          <div className="w-16 h-16 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
            <Video className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              Chọn hoặc kéo thả video để biến thành ảnh động GIF (Hỗ trợ nhiều file)
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
              Hỗ trợ MP4, MOV, WebM • Tối ưu 2-pass palettegen mượt mà chống nhòe hạt
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold">
            <Crown className="w-3.5 h-3.5" />
            <span>PRO: Hỗ trợ tạo GIF hàng loạt (Batch Queue) & mở khóa thời lượng 30s</span>
          </div>
        </div>
      )}

      {/* Batch Queue List */}
      {queue.length > 1 && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Hàng đợi tạo GIF ({queue.length} video)
              </h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <Crown className="w-3 h-3" />
                PRO Batch ({completedCount}/{queue.length})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBatchProcessing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-pink-500" />
                <span>Thêm video</span>
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={isBatchProcessing}
                className="text-xs text-slate-500 hover:text-red-600 dark:hover:text-red-400 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Xóa tất cả
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {queue.map((item, idx) => (
              <div
                key={item.id}
                className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                  item.status === 'processing'
                    ? 'bg-pink-500/5 border-pink-500/40'
                    : item.status === 'done'
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : item.status === 'error'
                    ? 'bg-red-500/5 border-red-500/20'
                    : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 shrink-0">
                    <FileVideo className="w-4 h-4" />
                  </div>
                  <div className="overflow-hidden min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-200 truncate">
                      {idx + 1}. {item.file.name}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatSize(item.file.size)}
                      {item.errorMsg ? ` • ${item.errorMsg}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {item.status === 'pending' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      <Clock className="w-3 h-3" />
                      Chờ xử lý
                    </span>
                  )}
                  {item.status === 'processing' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Đang tạo ({progressPercent}%)
                    </span>
                  )}
                  {item.status === 'done' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" />
                      Đã tải về
                    </span>
                  )}
                  {item.status === 'error' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                      <AlertCircle className="w-3 h-3" />
                      Lỗi
                    </span>
                  )}

                  {!isBatchProcessing && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                      title="Xóa khỏi hàng đợi"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Video Loaded Workspace */}
      {queue.length > 0 && videoPreviewUrl && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Video Preview & Timeline Scrubber */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Xem trước & chọn mốc thời gian:
              </span>
              <div className="flex items-center gap-2">
                {queue.length === 1 && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isBatchProcessing}
                    className="inline-flex items-center gap-1 text-xs text-pink-600 dark:text-pink-400 hover:underline px-2 py-1 rounded cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm video (PRO)</span>
                  </button>
                )}
                <button
                  onClick={handleReset}
                  disabled={isBatchProcessing}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Đổi video
                </button>
              </div>
            </div>

            <div className="rounded-xl overflow-hidden bg-black border border-slate-200 dark:border-slate-800 aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                src={videoPreviewUrl}
                controls
                className="w-full h-full object-contain"
              />
            </div>

            <button
              onClick={handleSyncCurrentTime}
              type="button"
              className="w-full py-2 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5 text-pink-500" />
              <span>Đặt thời điểm bắt đầu theo vị trí video đang dừng ({startTime}s)</span>
            </button>
          </div>

          {/* Right Column: Settings & Actions */}
          <div className="space-y-5 p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200">Cấu hình xuất GIF</h3>

              {/* Start Time Input */}
              <div className="space-y-1.5">
                <label htmlFor="gif-start-time" className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>Thời gian bắt đầu (giây)</span>
                  <span className="font-mono text-pink-500 font-semibold">{startTime}s</span>
                </label>
                <input
                  id="gif-start-time"
                  type="number"
                  min={0}
                  value={startTime}
                  onChange={(e) => setStartTime(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-pink-500 font-mono"
                />
              </div>

              {/* Duration Slider (Free max 10s, Pro max 30s) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Thời lượng GIF</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">{duration} giây</span>
                    {!isPro && duration >= 10 && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                        Max Free
                      </span>
                    )}
                  </div>
                </div>

                <input
                  type="range"
                  min={1}
                  max={isPro ? 30 : 15}
                  value={duration}
                  onChange={(e) => handleDurationChange(Number(e.target.value))}
                  className="w-full accent-pink-500 cursor-pointer"
                />

                <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                  <span>1s</span>
                  <span>10s (Free limit)</span>
                  <span>{isPro ? '30s (Pro)' : '15s'}</span>
                </div>
              </div>

              {/* FPS Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-pink-500" />
                  <span>Tốc độ khung hình (FPS)</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFps(10)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border text-center transition-all cursor-pointer ${
                      fps === 10
                        ? 'bg-pink-500/10 border-pink-500 text-pink-600 dark:text-pink-400 font-bold'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    10 FPS (Dung lượng nhẹ)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFps(15)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border text-center transition-all cursor-pointer ${
                      fps === 15
                        ? 'bg-pink-500/10 border-pink-500 text-pink-600 dark:text-pink-400 font-bold'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    15 FPS (Chuyển động mượt)
                  </button>
                </div>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2 text-red-600 dark:text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            {/* Execute Button */}
            <div>
              {isBatchProcessing ? (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-pink-600 dark:text-pink-400 font-semibold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Đang xử lý 2-pass Lanczos ({activeFileIndex + 1}/{queue.length})...
                    </span>
                    <span className="font-mono font-bold text-pink-500">{progressPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-pink-500 transition-all duration-200"
                      style={{ width: `${Math.max(5, progressPercent)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateGifQueue}
                  className="w-full py-3 px-5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {queue.length > 1
                      ? `Bắt đầu tạo GIF hàng loạt (${queue.length} video)`
                      : 'Bắt đầu tạo ảnh động GIF'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SKELETON RESULT PLACEHOLDER DURING GIF GENERATION */}
      {isBatchProcessing && queue.length === 1 && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-44 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
          </div>

          <div className="rounded-xl overflow-hidden aspect-video max-h-80 mx-auto">
            <Skeleton className="w-full h-full rounded-xl" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Skeleton className="h-4 w-40 rounded" />
            <Skeleton className="h-9 w-32 rounded-xl" />
          </div>
        </div>
      )}

      {/* Generated Result GIF (Single File Preview) */}
      {resultGif && queue.length === 1 && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <span>Tạo ảnh động GIF thành công! File đã tự động tải về máy.</span>
            </div>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              Dung lượng: {formatSize(resultGif.blob.size)}
            </span>
          </div>

          <div className="rounded-xl overflow-hidden bg-checkerboard border border-slate-200 dark:border-slate-800 p-2 flex items-center justify-center max-h-96">
            <img
              src={resultGif.url}
              alt="Generated GIF"
              className="max-h-80 object-contain rounded"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Tỷ lệ 480p • {fps} FPS • Thời lượng: {duration}s
            </span>

            <div className="flex items-center gap-3">
              <a
                href={resultGif.url}
                download={`${resultGif.fileName.replace(/\.[^/.]+$/, '') || 'animation'}.gif`}
                className="px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs active:scale-95 transition-all flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Tải lại ảnh GIF</span>
              </a>

              <button
                onClick={() => {
                  URL.revokeObjectURL(resultGif.url);
                  setResultGif(null);
                  setQueue((prev) => prev.map((q) => ({ ...q, status: 'pending' })));
                }}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Tạo đoạn khác
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Completion Banner */}
      {!isBatchProcessing && queue.length > 1 && completedCount === queue.length && (
        <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-emerald-600 dark:text-emerald-400 text-sm font-bold">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <span>
              Đã tạo GIF và tự động tải về thành công {completedCount}/{queue.length} file!
            </span>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            Tạo đợt mới
          </button>
        </div>
      )}
    </div>
  );
};
