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
} from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { useFFmpeg } from '../../hooks/useFFmpeg';
import { usePro } from '../../context/ProContext';

export const GifCreatorTab: React.FC = () => {
  const { isPro, openProModal } = usePro();
  const { taskStatus, progressPercent, error, generateGif, resetTask } = useFFmpeg();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [resultGif, setResultGif] = useState<{ blob: Blob; url: string } | null>(null);

  // Settings
  const [startTime, setStartTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(5); // default 5s
  const [fps, setFps] = useState<10 | 15>(10);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setVideoPreviewUrl(url);
      setResultGif(null);
      setStartTime(0);
      setDuration(5);
      resetTask();
    }
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

  const handleCreateGif = async () => {
    if (!selectedFile) return;

    if (duration > 10 && !isPro) {
      openProModal(
        'Thời lượng tạo GIF vượt quá 10 giây cho gói Miễn Phí. Vui lòng nâng cấp Pro 5.000đ.'
      );
      return;
    }

    try {
      const res = await generateGif(selectedFile, {
        startTime,
        duration,
        fps,
        width: 480,
      });
      setResultGif(res);
    } catch (err) {
      console.error('GIF generation error', err);
    }
  };

  const handleReset = () => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    if (resultGif?.url) URL.revokeObjectURL(resultGif.url);
    setSelectedFile(null);
    setVideoPreviewUrl(null);
    setResultGif(null);
    resetTask();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
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
            accept="video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="w-16 h-16 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
            <Video className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              Chọn video để biến thành ảnh động GIF
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
              Hỗ trợ MP4, MOV, WebM • Tối ưu 2-pass palettegen mượt mà chống nhòe hạt
            </p>
          </div>
        </div>
      )}

      {/* Video Loaded Workspace */}
      {selectedFile && videoPreviewUrl && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Video Preview & Timeline Scrubber */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Xem trước & chọn mốc thời gian:</span>
              <button
                onClick={handleReset}
                disabled={taskStatus === 'processing'}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Đổi video
              </button>
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
              {taskStatus === 'processing' ? (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-pink-600 dark:text-pink-400 font-semibold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Đang xử lý 2-pass Lanczos palette...
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
                  onClick={handleCreateGif}
                  className="w-full py-3 px-5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Bắt đầu tạo ảnh động GIF</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SKELETON RESULT PLACEHOLDER DURING GIF GENERATION */}
      {taskStatus === 'processing' && (
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

      {/* Generated Result GIF */}
      {resultGif && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-semibold">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <span>Tạo ảnh động GIF thành công!</span>
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
                download={`${selectedFile?.name.replace(/\.[^/.]+$/, '') || 'animation'}.gif`}
                className="px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs active:scale-95 transition-all flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Tải ảnh GIF về máy</span>
              </a>

              <button
                onClick={() => setResultGif(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Tạo đoạn khác
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
