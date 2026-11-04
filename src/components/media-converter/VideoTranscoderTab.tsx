import React, { useState, useRef } from 'react';
import {
  Video,
  Download,
  Terminal,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileVideo,
  Zap,
  Trash2,
  Plus,
  Crown,
  Clock,
} from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { useFFmpeg } from '../../hooks/useFFmpeg';
import { usePro } from '../../context/ProContext';

interface BatchVideoQueueItem {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  errorMsg?: string;
}

const PRO_BATCH_MESSAGE =
  'Tính năng chuyển đổi hàng loạt (Batch Processing) chỉ dành riêng cho tài khoản PRO. Hãy nâng cấp để tiết kiệm thời gian!';

export const VideoTranscoderTab: React.FC = () => {
  const {
    progressPercent,
    terminalLogs,
    error,
    convertVideoToMp4,
    resetTask,
  } = useFFmpeg();
  const { isPro, openProModal } = usePro();

  const [queue, setQueue] = useState<BatchVideoQueueItem[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
  const [resultVideo, setResultVideo] = useState<{ blob: Blob; url: string; fileName: string } | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerDownload = (url: string, originalFileName: string) => {
    const baseName = originalFileName.replace(/\.[^/.]+$/, '') || 'cytools';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleFilesSelected = (incomingFiles: FileList | File[]) => {
    const fileArray = Array.from(incomingFiles).filter(
      (f) => f.type.startsWith('video/') || /\.(mov|mp4|mkv|webm|avi|wmv|flv|m4v)$/i.test(f.name)
    );
    if (fileArray.length === 0) return;

    if (resultVideo?.url) {
      URL.revokeObjectURL(resultVideo.url);
      setResultVideo(null);
    }
    resetTask();

    // PRO Gatekeeper for Batch Processing
    if ((fileArray.length > 1 || (queue.length > 0 && fileArray.length >= 1)) && !isPro) {
      openProModal(PRO_BATCH_MESSAGE);
      const firstFile = queue.length > 0 ? queue[0].file : fileArray[0];
      setQueue([
        {
          id: `${firstFile.name}_${Date.now()}_0`,
          file: firstFile,
          status: 'pending',
        },
      ]);
      return;
    }

    const newItems: BatchVideoQueueItem[] = fileArray.map((file, idx) => ({
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
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const handleConvertQueue = async () => {
    if (queue.length === 0 || isBatchProcessing) return;

    setIsBatchProcessing(true);
    if (resultVideo?.url) {
      URL.revokeObjectURL(resultVideo.url);
      setResultVideo(null);
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
        const res = await convertVideoToMp4(item.file);

        // Immediately trigger download as each file finishes
        triggerDownload(res.url, item.file.name);

        if (isSingleItem) {
          setResultVideo({ blob: res.blob, url: res.url, fileName: item.file.name });
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
        console.error('Video conversion error on file:', item.file.name, err);
        const msg = err instanceof Error ? err.message : 'Lỗi chuyển đổi MP4';
        setQueue((prev) =>
          prev.map((q, idx) => (idx === i ? { ...q, status: 'error', errorMsg: msg } : q))
        );
      }
    }

    setIsBatchProcessing(false);
  };

  const handleReset = () => {
    if (isBatchProcessing) return;
    if (resultVideo?.url) URL.revokeObjectURL(resultVideo.url);
    setQueue([]);
    setResultVideo(null);
    setActiveFileIndex(0);
    resetTask();
  };

  const formatSize = (bytes: number) => {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const hasPendingOrError = queue.some((item) => item.status === 'pending' || item.status === 'error');
  const completedCount = queue.filter((item) => item.status === 'done').length;

  return (
    <div className="space-y-6">
      {/* Hidden Multiple File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/quicktime,video/mp4,video/x-matroska,video/webm,video/avi,.mov,.mkv,.webm,.avi,.wmv"
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
              Chọn hoặc kéo thả video MOV / MKV / WebM cần chuyển sang MP4 (Hỗ trợ nhiều file)
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
              Chuẩn hóa H.264 + AAC tương thích 100% trên mọi nền tảng • Xử lý 100% offline bằng FFmpeg WebAssembly
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              🎬 Apple QuickTime (.mov) sang MP4
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              ⚡ Transcode H.264 ultrafast
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 inline-flex items-center gap-1">
              <Crown className="w-3 h-3" />
              PRO: Chuyển đổi hàng loạt (Batch Queue)
            </span>
          </div>
        </div>
      )}

      {/* Selected Files Queue UI */}
      {queue.length > 0 && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Hàng đợi chuyển đổi MP4 ({queue.length} video)
              </h3>
              {queue.length > 1 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  <Crown className="w-3 h-3" />
                  PRO Batch ({completedCount}/{queue.length})
                </span>
              )}
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
                className="text-xs text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
              >
                {queue.length > 1 ? 'Xóa tất cả' : 'Đổi file'}
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
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
                  <div className="w-9 h-9 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 shrink-0">
                    <FileVideo className="w-4 h-4" />
                  </div>
                  <div className="overflow-hidden min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-200 truncate">
                      {idx + 1}. {item.file.name}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatSize(item.file.size)} • Định dạng đích: MP4 (H.264/AAC)
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
                      Đang xử lý ({progressPercent}%)
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

                  {!isBatchProcessing && queue.length > 1 && (
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

      {/* Progress & Error Status */}
      {isBatchProcessing && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-pink-600 dark:text-pink-400 font-semibold">
              <Loader2 className="w-4 h-4 animate-spin text-pink-500" />
              Đang transcode video sang MP4 chuẩn H.264 ({activeFileIndex + 1}/{queue.length}):{' '}
              {queue[activeFileIndex]?.file.name}
            </span>
            <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">
              {progressPercent}%
            </span>
          </div>

          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-pink-500 h-full transition-all duration-300 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Tác vụ được thực thi tuần tự trong RAM máy tính của bạn qua WebAssembly và tự động giải phóng bộ nhớ sau mỗi file.
          </p>
        </div>
      )}

      {/* SKELETON RESULT PLACEHOLDER DURING TRANSCODING */}
      {isBatchProcessing && queue.length === 1 && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-52 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
          </div>

          <div className="rounded-xl overflow-hidden aspect-video max-h-80 mx-auto">
            <Skeleton className="w-full h-full rounded-xl" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-600 dark:text-red-400 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
          <p>{error}</p>
        </div>
      )}

      {/* Action Button */}
      {queue.length > 0 && !isBatchProcessing && hasPendingOrError && (
        <button
          type="button"
          onClick={handleConvertQueue}
          className="w-full py-3.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer"
        >
          <Zap className="w-4 h-4" />
          <span>
            {queue.length > 1
              ? `Bắt đầu chuyển đổi hàng loạt (${queue.length} video sang MP4)`
              : 'Bắt đầu chuyển sang MP4'}
          </span>
        </button>
      )}

      {/* Result Section (Single File Preview) */}
      {resultVideo && queue.length === 1 && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-bold">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span>Chuyển đổi sang MP4 thành công! File đã tự động tải về máy.</span>
          </div>

          <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-black aspect-video max-h-80 mx-auto flex items-center justify-center">
            <video
              src={resultVideo.url}
              controls
              className="w-full h-full object-contain"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Dung lượng: {formatSize(resultVideo.blob.size)} • Container: MP4 • Video: H.264 • Audio: AAC
            </span>

            <a
              href={resultVideo.url}
              download={`${resultVideo.fileName.replace(/\.[^/.]+$/, '') || 'cytools'}.mp4`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs transition-all active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>Tải lại Video MP4 (.mp4)</span>
            </a>
          </div>
        </div>
      )}

      {/* Batch Completion Banner */}
      {!isBatchProcessing && queue.length > 1 && completedCount === queue.length && (
        <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-emerald-600 dark:text-emerald-400 text-sm font-bold">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <span>
              Đã chuyển đổi và tự động tải về thành công {completedCount}/{queue.length} file MP4!
            </span>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            Chuyển đổi đợt mới
          </button>
        </div>
      )}

      {/* Terminal Logs Toggle */}
      {terminalLogs.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-800/80 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-950/60">
          <button
            type="button"
            onClick={() => setShowLogs(!showLogs)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2 font-mono">
              <Terminal className="w-3.5 h-3.5 text-pink-500" />
              Nhật ký FFmpeg Console ({terminalLogs.length} dòng)
            </span>
            <span>{showLogs ? 'Thu gọn' : 'Xem chi tiết'}</span>
          </button>

          {showLogs && (
            <div className="p-3 bg-slate-950 font-mono text-[11px] text-slate-300 max-h-48 overflow-y-auto space-y-0.5 border-t border-slate-800">
              {terminalLogs.map((log, i) => (
                <div key={i} className="leading-tight opacity-80">
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
