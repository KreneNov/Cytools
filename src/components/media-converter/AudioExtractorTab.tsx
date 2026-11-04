import React, { useState, useRef } from 'react';
import {
  Music,
  Download,
  Terminal,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileAudio,
  Trash2,
  Plus,
  Crown,
  Clock,
} from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { useFFmpeg } from '../../hooks/useFFmpeg';
import { usePro } from '../../context/ProContext';

interface BatchAudioQueueItem {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  errorMsg?: string;
}

const PRO_BATCH_MESSAGE =
  'Tính năng chuyển đổi hàng loạt (Batch Processing) chỉ dành riêng cho tài khoản PRO. Hãy nâng cấp để tiết kiệm thời gian!';

export const AudioExtractorTab: React.FC = () => {
  const {
    progressPercent,
    terminalLogs,
    error,
    extractAudioToMp3,
    resetTask,
  } = useFFmpeg();
  const { isPro, openProModal } = usePro();

  const [queue, setQueue] = useState<BatchAudioQueueItem[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
  const [resultAudio, setResultAudio] = useState<{ blob: Blob; url: string; fileName: string } | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerDownload = (url: string, originalFileName: string) => {
    const baseName = originalFileName.replace(/\.[^/.]+$/, '') || 'audio';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleFilesSelected = (incomingFiles: FileList | File[]) => {
    const fileArray = Array.from(incomingFiles).filter(
      (f) => f.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|flv|m4v)$/i.test(f.name)
    );
    if (fileArray.length === 0) return;

    if (resultAudio?.url) {
      URL.revokeObjectURL(resultAudio.url);
      setResultAudio(null);
    }
    resetTask();

    // Check PRO Gatekeeper for Batch Processing
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

    const newItems: BatchAudioQueueItem[] = fileArray.map((file, idx) => ({
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

  const handleExtractQueue = async () => {
    if (queue.length === 0 || isBatchProcessing) return;

    setIsBatchProcessing(true);
    if (resultAudio?.url) {
      URL.revokeObjectURL(resultAudio.url);
      setResultAudio(null);
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
        const res = await extractAudioToMp3(item.file);

        // Immediately trigger download as each file finishes
        triggerDownload(res.url, item.file.name);

        if (isSingleItem) {
          setResultAudio({ blob: res.blob, url: res.url, fileName: item.file.name });
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
        console.error('Extraction error on file:', item.file.name, err);
        const msg = err instanceof Error ? err.message : 'Lỗi trích xuất MP3';
        setQueue((prev) =>
          prev.map((q, idx) => (idx === i ? { ...q, status: 'error', errorMsg: msg } : q))
        );
      }
    }

    setIsBatchProcessing(false);
  };

  const handleReset = () => {
    if (isBatchProcessing) return;
    if (resultAudio?.url) URL.revokeObjectURL(resultAudio.url);
    setQueue([]);
    setResultAudio(null);
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
        accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/avi"
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
            <Music className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              Chọn hoặc kéo thả video để tách nhạc MP3 (Hỗ trợ chọn nhiều file)
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
              Hỗ trợ định dạng MP4, MOV, MKV, WebM, AVI • Xuất MP3 192kbps chuẩn phòng thu
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-semibold">
            <Crown className="w-3.5 h-3.5" />
            <span>PRO: Hỗ trợ xử lý hàng loạt (Batch Queue) tự động tải về</span>
          </div>
        </div>
      )}

      {/* Selected Files Queue UI */}
      {queue.length > 0 && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Hàng đợi tách nhạc MP3 ({queue.length} video)
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
                className="text-xs text-slate-500 hover:text-red-600 dark:hover:text-red-400 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {queue.length > 1 ? 'Xóa tất cả' : 'Đổi video khác'}
              </button>
            </div>
          </div>

          {/* Queue List */}
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
                    <FileAudio className="w-4 h-4" />
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
                      Đang tách ({progressPercent}%)
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

      {/* Processing Progress Bar */}
      {isBatchProcessing && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-pink-500 animate-spin" />
              <span className="font-semibold text-slate-900 dark:text-slate-200">
                Đang tách nhạc MP3 ({activeFileIndex + 1}/{queue.length}):{' '}
                {queue[activeFileIndex]?.file.name}
              </span>
            </div>
            <span className="font-mono font-bold text-pink-500">{progressPercent}%</span>
          </div>

          <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-pink-500 transition-all duration-200"
              style={{ width: `${Math.max(5, progressPercent)}%` }}
            />
          </div>
        </div>
      )}

      {/* SKELETON RESULT PLACEHOLDER DURING PROCESSING */}
      {isBatchProcessing && queue.length === 1 && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-52 rounded" />
            <Skeleton className="h-4 w-20 rounded" />
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>

          <div className="flex items-center justify-between pt-2">
            <Skeleton className="h-4 w-48 rounded" />
            <Skeleton className="h-9 w-36 rounded-xl" />
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 text-red-600 dark:text-red-400 text-xs">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Lỗi trích xuất:</p>
            <p className="text-red-500/90">{error}</p>
          </div>
        </div>
      )}

      {/* Execute Button */}
      {queue.length > 0 && !isBatchProcessing && hasPendingOrError && (
        <button
          onClick={handleExtractQueue}
          className="w-full py-3.5 px-6 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-sm active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Music className="w-4 h-4" />
          <span>
            {queue.length > 1
              ? `Bắt đầu tách nhạc hàng loạt (${queue.length} file MP3 - 192kbps)`
              : 'Bắt đầu tách nhạc MP3 (192kbps)'}
          </span>
        </button>
      )}

      {/* Result Player & Download (Single File Preview) */}
      {resultAudio && queue.length === 1 && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span>Trích xuất âm thanh thành công! File đã tự động tải về máy.</span>
          </div>

          {/* HTML5 Audio Player */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <audio controls src={resultAudio.url} className="w-full" autoPlay={false} />
          </div>

          {/* Download & Reset row */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Định dạng: MP3 • Bitrate: 192kbps • Dung lượng: {formatSize(resultAudio.blob.size)}
            </span>

            <div className="flex items-center gap-3">
              <a
                href={resultAudio.url}
                download={`${resultAudio.fileName.replace(/\.[^/.]+$/, '') || 'audio'}.mp3`}
                className="px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs active:scale-95 transition-all flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Tải lại file MP3</span>
              </a>

              <button
                onClick={handleReset}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Tách video khác
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
              Đã tách nhạc và tự động tải về thành công {completedCount}/{queue.length} file MP3!
            </span>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            Tách đợt mới
          </button>
        </div>
      )}

      {/* Terminal logs disclosure */}
      {terminalLogs.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-950 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5" />
              <span>FFmpeg Terminal Log ({terminalLogs.length} dòng)</span>
            </div>
            <span>{showLogs ? 'Thu gọn ▲' : 'Xem chi tiết ▼'}</span>
          </button>

          {showLogs && (
            <div className="p-3 bg-black/90 font-mono text-[11px] text-zinc-400 max-h-48 overflow-y-auto space-y-0.5">
              {terminalLogs.map((log, idx) => (
                <div key={idx} className="leading-relaxed">
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
