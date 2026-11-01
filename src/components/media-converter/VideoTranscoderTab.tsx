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
} from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { useFFmpeg } from '../../hooks/useFFmpeg';

export const VideoTranscoderTab: React.FC = () => {
  const {
    taskStatus,
    progressPercent,
    terminalLogs,
    error,
    convertVideoToMp4,
    resetTask,
  } = useFFmpeg();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resultVideo, setResultVideo] = useState<{ blob: Blob; url: string } | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setResultVideo(null);
      resetTask();
    }
  };

  const handleConvert = async () => {
    if (!selectedFile) return;
    try {
      const res = await convertVideoToMp4(selectedFile);
      setResultVideo(res);
    } catch (err) {
      console.error('Video conversion error:', err);
    }
  };

  const handleReset = () => {
    if (resultVideo?.url) URL.revokeObjectURL(resultVideo.url);
    setSelectedFile(null);
    setResultVideo(null);
    resetTask();
  };

  const formatSize = (bytes: number) => {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
    <div className="space-y-6">
      {/* Upload Zone */}
      {!selectedFile && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-300 dark:border-slate-800 hover:border-pink-500/60 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/70 rounded-xl p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-4"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/quicktime,video/mp4,video/x-matroska,video/webm,video/avi,.mov,.mkv,.webm,.avi,.wmv"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="w-16 h-16 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
            <Video className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              Chọn hoặc kéo thả video MOV / MKV / WebM cần chuyển sang MP4
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
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              🔒 Không tải lên máy chủ
            </span>
          </div>
        </div>
      )}

      {/* Selected File Card */}
      {selectedFile && (
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 shrink-0">
              <FileVideo className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-200 truncate">
                {selectedFile.name}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {formatSize(selectedFile.size)} • Định dạng đích: MP4 (H.264/AAC)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleReset}
            disabled={taskStatus === 'processing'}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-50 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Đổi file
          </button>
        </div>
      )}

      {/* Progress & Error Status */}
      {taskStatus === 'processing' && (
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-pink-600 dark:text-pink-400 font-semibold">
              <Loader2 className="w-4 h-4 animate-spin text-pink-500" />
              Đang transcode video sang MP4 chuẩn H.264...
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
            Tác vụ được thực thi hoàn toàn trong RAM máy tính của bạn qua WebAssembly. Không tốn băng thông upload.
          </p>
        </div>
      )}

      {/* SKELETON RESULT PLACEHOLDER DURING TRANSCODING */}
      {taskStatus === 'processing' && (
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
      {selectedFile && !resultVideo && taskStatus !== 'processing' && (
        <button
          type="button"
          onClick={handleConvert}
          className="w-full py-3.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer"
        >
          <Zap className="w-4 h-4" />
          <span>Bắt đầu chuyển sang MP4</span>
        </button>
      )}

      {/* Result Section */}
      {resultVideo && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-bold">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span>Chuyển đổi sang MP4 thành công!</span>
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
              download={`${selectedFile?.name.replace(/\.[^/.]+$/, '') || 'cytools'}.mp4`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs transition-all active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>Tải Video MP4 (.mp4)</span>
            </a>
          </div>
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
