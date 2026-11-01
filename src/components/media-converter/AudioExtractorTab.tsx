import React, { useState, useRef } from 'react';
import {
  Music,
  Download,
  Terminal,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileAudio,
} from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { useFFmpeg } from '../../hooks/useFFmpeg';

export const AudioExtractorTab: React.FC = () => {
  const {
    taskStatus,
    progressPercent,
    terminalLogs,
    error,
    extractAudioToMp3,
    resetTask,
  } = useFFmpeg();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [resultAudio, setResultAudio] = useState<{ blob: Blob; url: string } | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setResultAudio(null);
      resetTask();
    }
  };

  const handleExtract = async () => {
    if (!selectedFile) return;
    try {
      const res = await extractAudioToMp3(selectedFile);
      setResultAudio(res);
    } catch (err) {
      console.error('Extraction error', err);
    }
  };

  const handleReset = () => {
    if (resultAudio?.url) URL.revokeObjectURL(resultAudio.url);
    setSelectedFile(null);
    setResultAudio(null);
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
            accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/avi"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="w-16 h-16 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
            <Music className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              Chọn hoặc kéo thả video để tách nhạc MP3
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
              Hỗ trợ định dạng MP4, MOV, MKV, WebM, AVI • Xuất MP3 192kbps chuẩn phòng thu
            </p>
          </div>
        </div>
      )}

      {/* Selected File Card */}
      {selectedFile && (
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 shrink-0">
              <FileAudio className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-200 truncate">{selectedFile.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{formatSize(selectedFile.size)}</p>
            </div>
          </div>

          <button
            onClick={handleReset}
            disabled={taskStatus === 'processing'}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Đổi video khác
          </button>
        </div>
      )}

      {/* Processing Progress Bar */}
      {taskStatus === 'processing' && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-pink-500 animate-spin" />
              <span className="font-semibold text-slate-900 dark:text-slate-200">
                Đang biên dịch và trích xuất luồng âm thanh MP3...
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
      {taskStatus === 'processing' && (
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
      {selectedFile && taskStatus !== 'processing' && !resultAudio && (
        <button
          onClick={handleExtract}
          className="w-full py-3.5 px-6 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-sm active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Music className="w-4 h-4" />
          <span>Bắt đầu tách nhạc MP3 (192kbps)</span>
        </button>
      )}

      {/* Result Player & Download */}
      {resultAudio && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span>Trích xuất âm thanh thành công!</span>
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
                download={`${selectedFile?.name.replace(/\.[^/.]+$/, '') || 'audio'}.mp3`}
                className="px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs active:scale-95 transition-all flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Tải file MP3 về máy</span>
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
