import React, { useState, useMemo, useEffect } from 'react';
import {
  DownloadCloud,
  Link as LinkIcon,
  ClipboardPaste,
  Play,
  Pause,
  Music,
  AlertCircle,
  Loader2,
  ArrowRight,
  Copy,
  Check,
  Zap,
  FolderArchive,
  Image as ImageIcon,
  Film,
  ExternalLink,
  Clock,
  X,
} from 'lucide-react';
import { useSocialDownloader } from '../hooks/useSocialDownloader';
import { usePro } from '../context/ProContext';
import { detectPlatform } from '../types/socialDownloader';
import type { SocialPlatform, ExtractionResult } from '../types/socialDownloader';
import { Skeleton } from '../components/ui/Skeleton';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '../utils/apiConfig';

interface BatchItem {
  id: string;
  url: string;
  platform: SocialPlatform;
  status: 'pending' | 'extracting' | 'success' | 'error';
  result?: ExtractionResult;
  error?: string;
}

interface SocialDownloaderPageProps {
  isCompact?: boolean;
}

export const SocialDownloaderPage: React.FC<SocialDownloaderPageProps> = ({ isCompact = false }) => {
  const { isPro, openProModal } = usePro();
  const {
    isExtracting,
    extractError,
    result,
    downloadProgress,
    extractMedia,
    downloadMediaFile,
    downloadAllAsZip,
    clearDownloadError,
    reset,
  } = useSocialDownloader();

  const [inputUrl, setInputUrl] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'single' | 'batch'>('single');
  const [copiedCaption, setCopiedCaption] = useState<boolean>(false);

  // Auto-detect current active tab URL in Chrome Extension environment
  useEffect(() => {
    const chromeApi = typeof window !== 'undefined' ? (window as unknown as { chrome?: any }).chrome : undefined;
    if (chromeApi?.tabs?.query) {
      try {
        chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
          if (tabs && tabs.length > 0 && tabs[0]?.url) {
            const currentTabUrl = tabs[0].url;
            const detected = detectPlatform(currentTabUrl);
            if (detected !== 'unknown') {
              setInputUrl(currentTabUrl);
            }
          }
        });
      } catch (err) {
        console.warn('Chrome extension tab query error:', err);
      }
    }
  }, []);

  // Batch Multi-Link State with Lazy Initializer from localStorage
  const [batchText, setBatchText] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem('cytools_batch_text') || '';
    } catch {
      return '';
    }
  });

  const [batchQueue, setBatchQueue] = useState<BatchItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('cytools_batch_queue');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState<boolean>(false);

  // Chrome Extension storage synchronization (asynchronous)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chromeApi = typeof window !== 'undefined' ? (window as unknown as { chrome?: any }).chrome : undefined;
    if (chromeApi?.storage?.local) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chromeApi.storage.local.get(['cytools_batch_text', 'cytools_batch_queue'], (res: any) => {
        if (res?.cytools_batch_text && typeof res.cytools_batch_text === 'string') {
          setBatchText(res.cytools_batch_text);
        }
        if (res?.cytools_batch_queue && Array.isArray(res.cytools_batch_queue)) {
          setBatchQueue(res.cytools_batch_queue);
        }
      });
    }
  }, []);

  // Save batch text in real-time
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chromeApi = typeof window !== 'undefined' ? (window as unknown as { chrome?: any }).chrome : undefined;
    if (chromeApi?.storage?.local) {
      chromeApi.storage.local.set({ cytools_batch_text: batchText });
    } else if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('cytools_batch_text', batchText);
      } catch {}
    }
  }, [batchText]);

  // Save batch queue in real-time
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chromeApi = typeof window !== 'undefined' ? (window as unknown as { chrome?: any }).chrome : undefined;
    if (chromeApi?.storage?.local) {
      chromeApi.storage.local.set({ cytools_batch_queue: batchQueue });
    } else if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('cytools_batch_queue', JSON.stringify(batchQueue));
      } catch {}
    }
  }, [batchQueue]);

  // Audio preview player state for slideshows
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);

  // Selected images in slideshow
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());

  // Detect platform dynamically from input
  const detectedPlatform = useMemo<SocialPlatform>(() => {
    if (!inputUrl.trim()) return 'unknown';
    return detectPlatform(inputUrl);
  }, [inputUrl]);

  // Valid URLs extracted from batch textarea
  const validBatchUrls = useMemo(() => {
    return batchText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('http://') || line.startsWith('https://'));
  }, [batchText]);

  // Handle single URL submit
  const handleExtract = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputUrl.trim()) return;

    const res = await extractMedia(inputUrl.trim());
    if (res?.slideshowImages) {
      // Select all images by default
      setSelectedImageIds(new Set(res.slideshowImages.map((img) => img.id)));
    }
  };

  // Handle Batch Multi-Link Analyze
  const handleBatchAnalyze = async () => {
    if (!isPro) {
      openProModal(
        'Tính năng Tải Hàng Loạt (Batch Multi-Link) cho phép dán tối đa 10 link cùng lúc. Nâng cấp Pro chỉ 5.000đ vĩnh viễn!'
      );
      return;
    }
    if (validBatchUrls.length === 0) return;

    setIsBatchAnalyzing(true);
    const queue: BatchItem[] = validBatchUrls.slice(0, 10).map((url) => ({
      id: Math.random().toString(36).substring(7),
      url,
      platform: detectPlatform(url),
      status: 'pending',
    }));
    setBatchQueue(queue);

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      setBatchQueue((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: 'extracting' } : it))
      );

      try {
        const response = await apiFetch(`/api/social/extract?url=${encodeURIComponent(item.url)}`);
        const data: ExtractionResult = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Không thể trích xuất phương tiện từ liên kết này');
        }
        setBatchQueue((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, status: 'success', result: data } : it
          )
        );
      } catch (err) {
        setBatchQueue((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, status: 'error', error: err instanceof Error ? err.message : 'Lỗi trích xuất' }
              : it
          )
        );
      }
    }
    setIsBatchAnalyzing(false);
  };

  // Handle Download All Batch Videos
  const handleDownloadAllBatch = async () => {
    const successfulItems = batchQueue.filter(
      (it) => it.status === 'success' && it.result?.mediaOptions?.[0]
    );
    for (const item of successfulItems) {
      const opt = item.result!.mediaOptions[0];
      const cleanName = `${(item.result!.title || 'video').slice(0, 25).replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_')}_${opt.id}.${opt.format}`;
      await downloadMediaFile(opt.url, cleanName);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  };

  // Handle paste from clipboard
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInputUrl(text);
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
    }
  };

  // Copy video caption
  const handleCopyCaption = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCaption(true);
    setTimeout(() => setCopiedCaption(false), 2000);
  };

  // Audio Play/Pause toggle
  const togglePlayAudio = (musicUrl: string) => {
    if (isPlayingAudio && audioRef) {
      audioRef.pause();
      setIsPlayingAudio(false);
    } else {
      if (!audioRef) {
        const audio = new Audio(musicUrl);
        audio.onended = () => setIsPlayingAudio(false);
        setAudioRef(audio);
        audio.play();
        setIsPlayingAudio(true);
      } else {
        audioRef.play();
        setIsPlayingAudio(true);
      }
    }
  };

  // Toggle image selection in slideshow
  const toggleSelectImage = (id: string) => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Handle ZIP Download with Pro Trigger
  const handleDownloadZip = () => {
    if (!result?.slideshowImages) return;

    const selectedImages = result.slideshowImages.filter((img) =>
      selectedImageIds.has(img.id)
    );

    const imagesToDownload =
      selectedImages.length > 0 ? selectedImages : result.slideshowImages;

    downloadAllAsZip(
      imagesToDownload,
      result.title || 'album_anh',
      !isPro
        ? () =>
            openProModal(
              `Album có ${imagesToDownload.length} ảnh. Gói Miễn phí chỉ tải tối đa 3 ảnh. Nâng cấp Pro 5.000đ để tải trọn bộ ZIP không giới hạn!`
            )
        : undefined
    );
  };

  return (
    <div className={`max-w-5xl mx-auto ${isCompact ? 'space-y-4 pb-2' : 'space-y-6 pb-12'}`}>
      {/* Page Header */}
      {!isCompact && (
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Tải Video & Ảnh MXH Đa Nền Tảng
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
            Tải video không logo chất lượng cao từ YouTube, TikTok, Facebook, Instagram, Pinterest và trích xuất album ảnh cực nhanh.
          </p>
        </div>
      )}

      {/* Tabs Selector: Single Link vs Batch Multi-Link */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('single')}
          className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'single'
              ? 'text-pink-600 dark:text-pink-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          {activeTab === 'single' && (
            <motion.div
              layoutId="socialTabIndicator"
              className="absolute inset-0 rounded-xl bg-pink-500/10 border border-pink-500/30 z-0"
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-2">
            <LinkIcon className="w-4 h-4" />
            <span>Tải Đơn Link</span>
          </span>
        </button>

        <button
          onClick={() => {
            if (!isPro) {
              openProModal(
                'Tính năng Tải Hàng Loạt (Batch Multi-Link) cho phép dán tối đa 10 link cùng lúc. Nâng cấp Pro chỉ 5.000đ vĩnh viễn!'
              );
              return;
            }
            setActiveTab('batch');
          }}
          className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
            activeTab === 'batch'
              ? 'text-pink-600 dark:text-pink-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          {activeTab === 'batch' && (
            <motion.div
              layoutId="socialTabIndicator"
              className="absolute inset-0 rounded-xl bg-pink-500/10 border border-pink-500/30 z-0"
              transition={{ type: 'spring', stiffness: 450, damping: 35 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-2">
            <Zap className="w-4 h-4 text-pink-500" />
            <span>Tải Hàng Loạt (Batch Multi-Link)</span>
            {!isPro && (
              <span className="text-xs px-2 py-0.5 rounded-md bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20 font-mono font-semibold">
                PRO
              </span>
            )}
          </span>
        </button>
      </div>

      <AnimatePresence mode="wait">
        {/* CASE 1: BATCH MULTI-LINK STUDIO (Real Textarea & Batch Engine) */}
        {activeTab === 'batch' ? (
          <motion.div
            key="batch"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 md:p-8 space-y-4"
          >
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="batch-urls-input" className="font-bold text-slate-700 dark:text-slate-300">
                Danh sách liên kết (mỗi dòng một link, tối đa 10 link):
              </label>
              <span className="text-slate-500 dark:text-slate-400 font-mono">
                Đã phát hiện: {validBatchUrls.length}/10 link hợp lệ
              </span>
            </div>

            <textarea
              id="batch-urls-input"
              rows={5}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder={`Dán danh sách liên kết video tại đây, ví dụ:\nhttps://www.tiktok.com/@scout2015/video/6718335390845095173\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://www.pinterest.com/pin/1098174690415756357/`}
              className="w-full p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500/30 font-mono transition-all"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text) setBatchText((prev) => (prev ? prev + '\n' + text : text));
                  } catch (e) {
                    console.warn(e);
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-pink-500" />
                <span>Dán từ bộ nhớ tạm</span>
              </button>

              {batchText && (
                <button
                  type="button"
                  onClick={() => {
                    setBatchText('');
                    setBatchQueue([]);
                  }}
                  className="px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-xs transition-colors cursor-pointer"
                >
                  Xóa danh sách
                </button>
              )}
            </div>

            <button
              type="button"
              disabled={isBatchAnalyzing || validBatchUrls.length === 0}
              onClick={handleBatchAnalyze}
              className="px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-600 text-white font-bold text-xs transition-all active:scale-95 flex items-center gap-2 cursor-pointer"
            >
              {isBatchAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    Đang phân tích ({batchQueue.filter((i) => i.status === 'success' || i.status === 'error').length}/
                    {batchQueue.length})...
                  </span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Phân tích hàng loạt ({validBatchUrls.length} link)</span>
                </>
              )}
            </button>
          </div>
          </motion.div>
        ) : (
          /* CASE 2: SINGLE LINK STUDIO */
          <motion.div
            key="single"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 md:p-8 space-y-4"
          >
          <form onSubmit={handleExtract} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="social-url-input" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <span>Nhập liên kết bài viết / video mạng xã hội:</span>
                  {detectedPlatform !== 'unknown' && (
                    <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/25">
                      {detectedPlatform}
                    </span>
                  )}
                </label>
                <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">
                  Hỗ trợ YouTube, TikTok, Facebook, Instagram, Pinterest
                </span>
              </div>

              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-slate-400 dark:text-slate-500 pointer-events-none">
                  <LinkIcon className="w-4 h-4 text-pink-500 dark:text-pink-400" />
                </div>

                <input
                  id="social-url-input"
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="Dán liên kết video TikTok, YouTube, Reels, Pinterest..."
                  className="w-full pl-10 pr-32 sm:pr-52 py-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500/30 transition-all font-sans"
                />

                <div className="absolute right-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePasteClipboard}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 cursor-pointer"
                    title="Dán từ bộ nhớ tạm"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5 text-pink-500 dark:text-pink-400" />
                    <span className="hidden sm:inline">Dán từ bộ nhớ tạm</span>
                    <span className="sm:hidden">Dán</span>
                  </button>

                  <button
                    type="submit"
                    disabled={isExtracting || !inputUrl.trim()}
                    className="px-4 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-600 text-white font-bold text-xs transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Đang bóc tách...</span>
                      </>
                    ) : (
                      <>
                        <span>Bắt đầu tải</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* User help notice for transient network/fetch issues */}
            <p className="text-xs font-normal text-slate-500 dark:text-slate-400 italic ml-auto mt-2.5 pr-1 block text-right">
              Nếu bị báo lỗi fetch hãy reload lại trang xin thông cảm vì sự bất tiện này ạ!
            </p>
          </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Download Error Alert with Close button */}
      {downloadProgress.status === 'error' && !result && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start justify-between gap-3 text-red-600 dark:text-red-300 text-xs">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <div>
              <p className="font-semibold text-red-700 dark:text-red-300">
                Lỗi máy chủ: Không thể tải video
              </p>
              <p className="text-red-600 dark:text-red-400/90 text-xs leading-relaxed">
                {downloadProgress.errorMessage ||
                  'Máy chủ CDN upstream tạm thời không phản hồi hoặc đã giới hạn lưu lượng. Vui lòng thử lại sau.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={clearDownloadError}
            className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-300 text-xs font-semibold border border-red-500/30 transition-colors shrink-0 flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" />
            <span>Đóng</span>
          </button>
        </div>
      )}

      {/* Extract Error Notice with Close button */}
      {extractError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start justify-between gap-3 text-red-600 dark:text-red-300 text-xs">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <div className="space-y-1">
              <p className="font-semibold text-red-700 dark:text-red-300">Lỗi trích xuất phương tiện:</p>
              <p className="text-red-600 dark:text-red-400/90">{extractError}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                Mẹo: Đảm bảo liên kết video/bài đăng được đặt ở chế độ Công khai (Public).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={reset}
            className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-300 text-xs font-semibold border border-red-500/30 transition-colors shrink-0 flex items-center gap-1"
            title="Đóng thông báo"
          >
            <X className="w-3.5 h-3.5" />
            <span>Đóng</span>
          </button>
        </div>
      )}

      {/* BATCH RESULTS QUEUE WORKSPACE */}
      {activeTab === 'batch' && batchQueue.length > 0 && (
        <div className="space-y-4 p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-pink-500" />
                <span>
                  Kết quả phân tích hàng loạt ({batchQueue.filter((i) => i.status === 'success').length}/
                  {batchQueue.length} thành công)
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Bạn có thể tải từng video chuẩn HD hoặc nhấn "Tải tất cả" để lưu toàn bộ.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setBatchQueue([]);
                  setBatchText('');
                }}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                title="Xóa danh sách và link đã nhập"
              >
                <X className="w-3.5 h-3.5" />
                <span>Xóa danh sách</span>
              </button>

              {batchQueue.some((i) => i.status === 'success') && (
                <button
                  type="button"
                  onClick={handleDownloadAllBatch}
                  className="px-4 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <DownloadCloud className="w-4 h-4" />
                  <span>Tải tất cả video về máy</span>
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 bg-slate-50/40 dark:bg-slate-950/30 overflow-hidden">
            {batchQueue.map((item, idx) => (
              <div
                key={item.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/60"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-16 h-12 rounded-lg bg-slate-200 dark:bg-slate-800 shrink-0 overflow-hidden flex items-center justify-center">
                    {item.result?.thumbnail ? (
                      <img
                        src={item.result.thumbnail}
                        alt="Thumbnail"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Film className="w-5 h-5 text-slate-400" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-400">#{idx + 1}</span>
                      <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {item.platform}
                      </span>
                      {item.status === 'extracting' && (
                        <span className="text-xs text-pink-600 dark:text-pink-400 flex items-center gap-1 font-medium">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang phân tích...
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span className="text-xs text-red-500 font-semibold">Lỗi</span>
                      )}
                      {item.status === 'success' && (
                        <span className="text-xs text-emerald-500 font-semibold flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Sẵn sàng
                        </span>
                      )}
                    </div>

                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5 max-w-md">
                      {item.result?.title || item.url}
                    </p>
                    {item.error && (
                      <p className="text-xs text-red-400 truncate">{item.error}</p>
                    )}
                  </div>
                </div>

                {item.status === 'success' && item.result && (
                  <div className="flex items-center gap-2 shrink-0">
                    {item.result.mediaOptions?.[0] && (
                      <button
                        type="button"
                        onClick={() => {
                          const opt = item.result!.mediaOptions[0];
                          const name = `${(item.result!.title || 'video').slice(0, 25).replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_')}_${opt.id}.${opt.format}`;
                          downloadMediaFile(opt.url, name);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <DownloadCloud className="w-3.5 h-3.5" />
                        <span>Tải HD</span>
                      </button>
                    )}
                    {item.result.music?.playUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          const name = `${(item.result!.title || 'audio').slice(0, 25)}_audio.mp3`;
                          downloadMediaFile(item.result!.music!.playUrl, name);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Music className="w-3.5 h-3.5" />
                        <span>MP3</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SKELETON LOADING STATE FOR SINGLE EXTRACTION */}
      {activeTab === 'single' && isExtracting && (
        <div className="p-6 md:p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
          {/* Header Skeleton: Author & Platform Info */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800/80">
            <div className="flex items-center gap-3">
              <Skeleton className="w-12 h-12 rounded-full shrink-0" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32 rounded" />
                  <Skeleton className="h-4 w-16 rounded" />
                </div>
                <Skeleton className="h-3 w-24 rounded" />
              </div>
            </div>
            <Skeleton className="h-7 w-28 rounded-lg self-start sm:self-auto" />
          </div>

          {/* Title & Caption Skeleton */}
          <div className="space-y-2 bg-slate-50 dark:bg-slate-950/50 p-4 rounded-xl">
            <Skeleton className="h-3.5 w-28 rounded" />
            <Skeleton className="h-4 w-5/6 rounded" />
            <Skeleton className="h-4 w-3/5 rounded" />
          </div>

          {/* Video Preview & Options Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Preview Box Skeleton */}
            <div className="w-full lg:col-span-5 aspect-[9/16] max-h-[420px] rounded-xl overflow-hidden">
              <Skeleton className="w-full h-full rounded-xl" />
            </div>

            {/* Media Options Skeleton */}
            <div className="w-full lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-40 rounded" />
                <Skeleton className="h-3.5 w-24 rounded" />
              </div>

              {/* Flattened download options rows */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 overflow-hidden">
                {[1, 2, 3].map((idx) => (
                  <div key={idx} className="p-4 flex items-center justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-20 rounded" />
                        <Skeleton className="h-4 w-14 rounded" />
                      </div>
                      <Skeleton className="h-3 w-32 rounded" />
                    </div>
                    <Skeleton className="h-9 w-28 rounded-lg shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SINGLE LINK EXTRACTION RESULT STUDIO */}
      {activeTab === 'single' && !isExtracting && result && (
        <div className="p-6 md:p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
          {/* Header Result: Author & Platform Info */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800/80">
            <div className="flex items-center gap-3">
              {result.author?.avatar ? (
                <img
                  src={result.author.avatar}
                  alt={result.author.name}
                  className="w-12 h-12 rounded-full object-cover border border-slate-300 dark:border-slate-700"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                  <Film className="w-6 h-6" />
                </div>
              )}

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {result.author?.name || 'Tác giả'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                    {result.platform}
                  </span>
                </div>
                {result.author?.username && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {result.author.username}
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={reset}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors self-start sm:self-auto cursor-pointer"
            >
              Làm mới / Nhập link khác
            </button>
          </div>

          {/* Title & Caption (Flattened background shift, no nested card border) */}
          {result.title && (
            <div className="space-y-1.5 bg-slate-50 dark:bg-slate-950/50 p-4 rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Tiêu đề / Caption:
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyCaption(result.title)}
                  className="text-xs text-pink-600 dark:text-pink-400 hover:underline flex items-center gap-1 font-medium cursor-pointer"
                >
                  {copiedCaption ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Đã chép</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Sao chép</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-sans max-w-prose line-clamp-3 break-words whitespace-normal">
                {result.title}
              </p>
            </div>
          )}

          {/* ============================================================== */}
          {/* CASE 1: VIDEO MODE */}
          {/* ============================================================== */}
          {result.type === 'video' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Video Player Preview */}
              {result.platform === 'youtube' ? (
                <div className="w-full lg:col-span-5 relative aspect-video max-h-[320px] mx-auto rounded-xl overflow-hidden bg-black border border-slate-200 dark:border-slate-800 group flex items-center justify-center">
                  {/* High-Res Thumbnail */}
                  <img
                    src={result.thumbnail || `https://i.ytimg.com/vi/${result.videoId}/hqdefault.jpg`}
                    alt={result.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/30" />

                  {/* Top Badges: Platform + Quality & Duration */}
                  <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                    <span className="px-2.5 py-1 rounded-md bg-red-600 text-white text-xs font-bold tracking-wider uppercase backdrop-blur-md flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                      </svg>
                      YouTube HD
                    </span>
                    {result.duration ? (
                      <span className="px-2.5 py-1 rounded-md bg-black/80 text-zinc-200 text-xs font-semibold tracking-wide backdrop-blur-md border border-white/10 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-zinc-400" />
                        {Math.floor(result.duration / 60)}:{(result.duration % 60).toString().padStart(2, '0')}
                      </span>
                    ) : null}
                  </div>

                  {/* Center Play Button Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <Play className="w-5 h-5 ml-0.5 fill-current" />
                    </div>
                  </div>

                  {/* Bottom Bar: Creator info & External link */}
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-bold text-white truncate drop-shadow">
                        {result.author?.name || 'YouTube Video'}
                      </p>
                    </div>
                    <a
                      href={`https://www.youtube.com/watch?v=${result.videoId || ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-medium backdrop-blur-md border border-white/20 transition-all flex items-center gap-1.5 hover:scale-105"
                    >
                      <span>Xem gốc trên YouTube</span>
                      <ExternalLink className="w-3.5 h-3.5 text-zinc-300" />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="w-full lg:col-span-5 relative aspect-[9/16] max-h-[460px] mx-auto rounded-xl overflow-hidden bg-black border border-slate-200 dark:border-slate-800 flex items-center justify-center">
                  {result.mediaOptions[0]?.url ? (
                    <video
                      src={result.mediaOptions[0].url}
                      poster={result.thumbnail}
                      controls
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <img
                      src={result.thumbnail}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
              )}

              {/* Download Action Options */}
              <div className="w-full lg:col-span-7 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Tùy chọn tải video không logo
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Hệ thống sẽ tải trực tiếp file về máy qua Proxy đính kèm header tải xuống.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-900/60 overflow-hidden">
                  {(result.availableFormats && result.availableFormats.length > 0
                    ? result.availableFormats
                    : result.mediaOptions
                  ).map((opt) => {
                    const optionKey = 'formatId' in opt && opt.formatId ? opt.formatId : 'id' in opt ? opt.id : opt.label;
                    const isAudio = ('type' in opt && opt.type === 'audio') || ('isAudio' in opt && Boolean(opt.isAudio));
                    const isTopRes = opt.quality?.includes('1080') || opt.quality?.includes('2160') || opt.quality?.includes('1440');
                    const cleanName = `${result.title.slice(0, 30).replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_')}_${opt.quality || opt.format}.${opt.format}`;
                    const btnLabel = isAudio ? 'Tải MP3' : `Tải ${opt.quality || 'về'}`;

                    const isThisDownloading = downloadProgress.isDownloading && downloadProgress.activeOptionId === optionKey;
                    const isThisCompleted = downloadProgress.status === 'completed' && downloadProgress.activeOptionId === optionKey;
                    const isThisError = downloadProgress.status === 'error' && downloadProgress.activeOptionId === optionKey;
                    const isAnotherDownloading = downloadProgress.isDownloading && downloadProgress.activeOptionId !== optionKey;

                    return (
                      <div
                        key={optionKey}
                        className={`transition-all duration-200 ${
                          isTopRes
                            ? 'bg-pink-500/[0.04] dark:bg-pink-500/[0.08]'
                            : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/30'
                        } ${isThisDownloading ? 'bg-slate-50/80 dark:bg-slate-900/90' : ''}`}
                      >
                        {/* Main row header */}
                        <div className="p-3.5 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div
                              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                                isThisDownloading || isThisCompleted
                                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                  : isTopRes
                                  ? 'bg-pink-500/15 text-pink-500 dark:text-pink-400'
                                  : 'bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {isThisDownloading ? (
                                <Loader2 className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                              ) : isThisCompleted ? (
                                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              ) : isAudio ? (
                                <Music className="w-4 h-4" />
                              ) : isTopRes ? (
                                <Film className="w-4 h-4" />
                              ) : (
                                <DownloadCloud className="w-4 h-4" />
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                  {opt.label}
                                </span>
                                {opt.quality && (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono shrink-0 border border-slate-200 dark:border-slate-700">
                                    {opt.quality}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                {opt.description || `Định dạng .${opt.format.toUpperCase()} • Tải trực tiếp về máy`}
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={isThisDownloading || isAnotherDownloading}
                            onClick={() => downloadMediaFile(opt.url, cleanName, optionKey)}
                            className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                              isThisCompleted
                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40'
                                : isThisDownloading
                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                                : isTopRes
                                ? 'bg-pink-500 hover:bg-pink-600 text-white'
                                : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {isThisDownloading ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                                <span>Đang tải...</span>
                              </>
                            ) : isThisCompleted ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                <span>Hoàn tất</span>
                              </>
                            ) : (
                              <>
                                <DownloadCloud className="w-3.5 h-3.5" />
                                <span>{btnLabel}</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Inline Expandable Progress Area with 4 Stage Indicators */}
                        <AnimatePresence>
                          {(isThisDownloading || isThisCompleted) && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.25, ease: 'easeOut' }}
                              className="px-4 pb-4 pt-2.5 bg-slate-50/90 dark:bg-slate-950/70 border-t border-slate-200 dark:border-slate-800/80 space-y-3 overflow-hidden"
                            >
                              {/* Slender Progress Bar with Emerald Glow */}
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-mono text-xs text-slate-700 dark:text-slate-200 flex items-center gap-1.5 font-medium">
                                    {isThisCompleted ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    ) : (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400 shrink-0" />
                                    )}
                                    <span>
                                      {isThisCompleted
                                        ? 'Đã tải xong & sẵn sàng phát'
                                        : downloadProgress.stage === 'video'
                                        ? 'Đang chuẩn bị luồng video...'
                                        : downloadProgress.stage === 'audio'
                                        ? 'Đang tải luồng âm thanh...'
                                        : 'Đang ghép nối file chuẩn Faststart...'}
                                    </span>
                                  </span>
                                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-xs">
                                    {Math.round(downloadProgress.percentage)}%
                                  </span>
                                </div>

                                <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                  <motion.div
                                    className="h-full bg-emerald-500 dark:bg-emerald-400 rounded-full shadow-[0_0_10px_rgba(52,211,153,0.5)]"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${downloadProgress.percentage}%` }}
                                    transition={{ duration: 0.3 }}
                                  />
                                </div>
                              </div>

                              {/* 4 Distinct Stage Indicators: Video -> Âm thanh -> Ghép file -> Xong */}
                              <div className="pt-1 flex items-center justify-between text-[11px] font-sans">
                                {/* Stage 1: Video */}
                                {(() => {
                                  const isPassed = downloadProgress.percentage >= 35 || isThisCompleted;
                                  const isActive = downloadProgress.stage === 'video' && !isThisCompleted;
                                  return (
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={`w-2 h-2 rounded-full transition-all ${
                                          isPassed || isActive
                                            ? 'bg-emerald-500 dark:bg-emerald-400 ring-2 ring-emerald-500/30'
                                            : 'bg-slate-300 dark:bg-slate-700'
                                        }`}
                                      />
                                      <span
                                        className={`font-medium ${
                                          isPassed || isActive
                                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                            : 'text-slate-600 dark:text-slate-400'
                                        }`}
                                      >
                                        Video
                                      </span>
                                    </div>
                                  );
                                })()}

                                {/* Connector 1 */}
                                <div
                                  className={`h-0.5 flex-1 mx-2 transition-colors ${
                                    downloadProgress.percentage >= 35
                                      ? 'bg-emerald-500/60 dark:bg-emerald-400/60'
                                      : 'bg-slate-200 dark:bg-slate-800'
                                  }`}
                                />

                                {/* Stage 2: Âm thanh */}
                                {(() => {
                                  const isPassed = downloadProgress.percentage >= 70 || isThisCompleted;
                                  const isActive = downloadProgress.stage === 'audio' && !isThisCompleted;
                                  return (
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={`w-2 h-2 rounded-full transition-all ${
                                          isPassed || isActive
                                            ? 'bg-emerald-500 dark:bg-emerald-400 ring-2 ring-emerald-500/30'
                                            : 'bg-slate-300 dark:bg-slate-700'
                                        }`}
                                      />
                                      <span
                                        className={`font-medium ${
                                          isPassed || isActive
                                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                            : 'text-slate-600 dark:text-slate-400'
                                        }`}
                                      >
                                        Âm thanh
                                      </span>
                                    </div>
                                  );
                                })()}

                                {/* Connector 2 */}
                                <div
                                  className={`h-0.5 flex-1 mx-2 transition-colors ${
                                    downloadProgress.percentage >= 70
                                      ? 'bg-emerald-500/60 dark:bg-emerald-400/60'
                                      : 'bg-slate-200 dark:bg-slate-800'
                                  }`}
                                />

                                {/* Stage 3: Ghép file */}
                                {(() => {
                                  const isPassed = downloadProgress.percentage >= 95 || isThisCompleted;
                                  const isActive = downloadProgress.stage === 'muxing' && !isThisCompleted;
                                  return (
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={`w-2 h-2 rounded-full transition-all ${
                                          isPassed || isActive
                                            ? 'bg-emerald-500 dark:bg-emerald-400 ring-2 ring-emerald-500/30'
                                            : 'bg-slate-300 dark:bg-slate-700'
                                        }`}
                                      />
                                      <span
                                        className={`font-medium ${
                                          isPassed || isActive
                                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                            : 'text-slate-600 dark:text-slate-400'
                                        }`}
                                      >
                                        Ghép file
                                      </span>
                                    </div>
                                  );
                                })()}

                                {/* Connector 3 */}
                                <div
                                  className={`h-0.5 flex-1 mx-2 transition-colors ${
                                    downloadProgress.percentage >= 100 || isThisCompleted
                                      ? 'bg-emerald-500/60 dark:bg-emerald-400/60'
                                      : 'bg-slate-200 dark:bg-slate-800'
                                  }`}
                                />

                                {/* Stage 4: Xong */}
                                {(() => {
                                  const isDone = isThisCompleted || downloadProgress.percentage >= 100;
                                  return (
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={`w-2 h-2 rounded-full transition-all ${
                                          isDone
                                            ? 'bg-emerald-500 dark:bg-emerald-400 ring-2 ring-emerald-500/30'
                                            : 'bg-slate-300 dark:bg-slate-700'
                                        }`}
                                      />
                                      <span
                                        className={`font-medium ${
                                          isDone
                                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                            : 'text-slate-600 dark:text-slate-400'
                                        }`}
                                      >
                                        Xong
                                      </span>
                                    </div>
                                  );
                                })()}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Inline Error Compartment */}
                        <AnimatePresence>
                          {isThisError && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="px-4 py-3 bg-red-500/10 border-t border-red-500/20 flex items-start justify-between gap-3 text-red-600 dark:text-red-300 text-xs"
                            >
                              <div className="flex items-start gap-2.5">
                                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                                <div>
                                  <p className="font-semibold text-red-700 dark:text-red-300">
                                    Lỗi tải xuống {opt.quality || opt.format}:
                                  </p>
                                  <p className="text-red-600 dark:text-red-400/90 text-xs leading-relaxed">
                                    {downloadProgress.errorMessage || 'Máy chủ không phản hồi. Vui lòng thử lại.'}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={clearDownloadError}
                                className="px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-300 text-xs font-semibold border border-red-500/30 transition-colors shrink-0 flex items-center gap-1 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>Đóng</span>
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>

                {/* Background music card if available (Flattened background shift, no nested border) */}
                {result.music && (
                  <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/50 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 truncate">
                      <Music className="w-4 h-4 text-pink-500 dark:text-pink-400 shrink-0" />
                      <div className="truncate text-xs">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                          {result.music.title}
                        </span>
                        {result.music.author && (
                          <span className="text-slate-500 dark:text-slate-400 text-xs truncate block">
                            {result.music.author}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => togglePlayAudio(result.music!.playUrl)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-300 text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      {isPlayingAudio ? (
                        <>
                          <Pause className="w-3.5 h-3.5 text-pink-500 dark:text-pink-400" />
                          <span>Dừng nghe</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 text-pink-500 dark:text-pink-400" />
                          <span>Nghe thử</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* CASE 2: SLIDESHOW / CAROUSEL ALBUM MODE */}
          {/* ============================================================== */}
          {result.type === 'slideshow' && result.slideshowImages && (
            <div className="space-y-6">
              {/* Action Toolbar (Seamless header border, not nested card) */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-0.5">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-pink-500 dark:text-pink-400" />
                    <span>
                      Bộ sưu tập {result.slideshowImages.length} ảnh độ phân giải cao
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Đã chọn {selectedImageIds.size}/{result.slideshowImages.length} ảnh. Bạn có thể tải lẻ hoặc đóng gói ZIP trọn bộ.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedImageIds.size === result.slideshowImages!.length) {
                        setSelectedImageIds(new Set());
                      } else {
                        setSelectedImageIds(
                          new Set(result.slideshowImages!.map((i) => i.id))
                        );
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                  >
                    {selectedImageIds.size === result.slideshowImages.length
                      ? 'Bỏ chọn tất cả'
                      : 'Chọn tất cả'}
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadZip}
                    className="px-4 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <FolderArchive className="w-4 h-4" />
                    <span>Tải Trọn Bộ Ảnh (.ZIP)</span>
                    {!isPro && result.slideshowImages.length > 3 && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-slate-900 text-pink-300 font-mono font-semibold">
                        PRO
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Slideshow Download Progress Bar & Error Alert */}
              {downloadProgress.isDownloading && (
                <div className="p-4 rounded-xl bg-pink-500/10 border border-pink-500/20 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-pink-600 dark:text-pink-400 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-pink-500" />
                      {downloadProgress.status === 'processing_zip'
                        ? `Đang đóng gói ZIP (${downloadProgress.loadedBytes}/${downloadProgress.totalBytes} ảnh)...`
                        : `Đang tải ${downloadProgress.fileName || 'ảnh'} về máy...`}
                    </span>
                    <span className="font-mono font-bold text-pink-600 dark:text-pink-400">
                      {Math.round(downloadProgress.percentage)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-pink-200 dark:bg-pink-950 overflow-hidden">
                    <div
                      className="h-full bg-pink-500 transition-all duration-200"
                      style={{ width: `${downloadProgress.percentage}%` }}
                    />
                  </div>
                </div>
              )}

              {downloadProgress.status === 'error' && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start justify-between gap-3 text-red-600 dark:text-red-300 text-xs">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                    <div>
                      <p className="font-semibold text-red-700 dark:text-red-300">
                        Lỗi tải album
                      </p>
                      <p className="text-red-600 dark:text-red-400/90 text-xs leading-relaxed">
                        {downloadProgress.errorMessage ||
                          'Không thể tải hình ảnh hoặc đóng gói tệp ZIP. Vui lòng thử lại.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearDownloadError}
                    className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-300 text-xs font-semibold border border-red-500/30 transition-colors shrink-0 flex items-center gap-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Đóng</span>
                  </button>
                </div>
              )}

              {/* Music Player for Slideshow */}
              {result.music && (
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 truncate">
                    <Music className="w-4 h-4 text-pink-500 dark:text-pink-400 shrink-0" />
                    <div className="truncate text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block">
                        Nhạc nền album: {result.music.title}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => togglePlayAudio(result.music!.playUrl)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-300 text-xs font-medium flex items-center gap-1"
                    >
                      {isPlayingAudio ? (
                        <>
                          <Pause className="w-3.5 h-3.5 text-pink-500 dark:text-pink-400" />
                          <span>Dừng</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 text-pink-500 dark:text-pink-400" />
                          <span>Nghe nhạc</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        downloadMediaFile(
                          result.music!.playUrl,
                          `${result.title.slice(0, 25)}_audio.mp3`
                        )
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 text-xs font-medium flex items-center gap-1"
                    >
                      <DownloadCloud className="w-3.5 h-3.5" />
                      <span>Tải MP3</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Responsive Image Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {result.slideshowImages.map((img, idx) => {
                  const isChecked = selectedImageIds.has(img.id);
                  const fileName = `${result.title.slice(0, 20)}_img_${idx + 1}.jpg`;

                  return (
                    <div
                      key={img.id}
                      onClick={() => toggleSelectImage(img.id)}
                      className={`group relative rounded-xl overflow-hidden border transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                        isChecked
                          ? 'border-pink-500 ring-2 ring-pink-500/30 bg-pink-50/10'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      {/* Image Preview */}
                      <div className="relative aspect-square overflow-hidden bg-slate-100 dark:bg-slate-950">
                        <img
                          src={img.url}
                          alt={`Slideshow ${idx + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />

                        {/* Top checkmark badge */}
                        <div className="absolute top-2 left-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="w-4 h-4 rounded text-pink-500 bg-black/60 border-slate-600 focus:ring-0 cursor-pointer"
                          />
                        </div>

                        {/* Image Index tag */}
                        <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-mono text-zinc-300">
                          #{idx + 1}
                        </div>
                      </div>

                      {/* Download individual button */}
                      <div className="p-2.5 flex items-center justify-between border-t border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/90">
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          Ảnh {idx + 1}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadMediaFile(img.url, fileName);
                          }}
                          className="px-2 py-1 rounded bg-slate-200 hover:bg-pink-500 hover:text-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-semibold transition-colors flex items-center gap-1"
                        >
                          <DownloadCloud className="w-3 h-3" />
                          <span>Tải</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* CASE 3: SINGLE IMAGE MODE (Pinterest High-Res) */}
          {/* ============================================================== */}
          {result.type === 'image' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="w-full lg:col-span-5 max-h-[460px] rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center p-2">
                <img
                  src={result.thumbnail}
                  alt={result.title}
                  className="max-w-full max-h-[440px] object-contain rounded-xl"
                />
              </div>

              <div className="w-full lg:col-span-7 space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Ảnh Gốc Siêu Nét (Original Master)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Hệ thống đã nâng cấp đường dẫn tải trực tiếp từ máy chủ gốc với độ phân giải lớn nhất.
                  </p>
                </div>

                <div className="space-y-3">
                  {result.mediaOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        downloadMediaFile(
                          opt.url,
                          `${result.title.slice(0, 30)}.${opt.format}`,
                          opt.id
                        )
                      }
                      className="w-full p-4 rounded-xl bg-pink-500/10 hover:bg-pink-500/20 border border-pink-500/30 text-pink-700 dark:text-pink-300 flex items-center justify-between gap-4 transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3 text-left">
                        <div className="w-10 h-10 rounded-xl bg-pink-500/20 text-pink-500 flex items-center justify-center">
                          <DownloadCloud className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold">{opt.label}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Chất lượng: {opt.quality || 'Tối đa'} • Định dạng: .{opt.format}
                          </p>
                        </div>
                      </div>
                      <span className="px-3 py-1.5 rounded-lg bg-pink-500 text-white text-xs font-bold">
                        Tải Ảnh Về Máy
                      </span>
                    </button>
                  ))}
                </div>

                {/* Single Image Download Progress Bar & Error Alert */}
                {downloadProgress.isDownloading && (
                  <div className="p-4 rounded-xl bg-pink-500/10 border border-pink-500/20 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-pink-600 dark:text-pink-400 flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-pink-500" />
                        Đang tải {downloadProgress.fileName || 'ảnh'} về máy...
                      </span>
                      <span className="font-mono font-bold text-pink-600 dark:text-pink-400">
                        {Math.round(downloadProgress.percentage)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-pink-200 dark:bg-pink-950 overflow-hidden">
                      <div
                        className="h-full bg-pink-500 transition-all duration-200"
                        style={{ width: `${downloadProgress.percentage}%` }}
                      />
                    </div>
                  </div>
                )}

                {downloadProgress.status === 'error' && (
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start justify-between gap-3 text-red-600 dark:text-red-300 text-xs">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                      <div>
                        <p className="font-semibold text-red-700 dark:text-red-300">
                          Lỗi tải ảnh
                        </p>
                        <p className="text-red-600 dark:text-red-400/90 text-xs leading-relaxed">
                          {downloadProgress.errorMessage || 'Không thể tải ảnh về máy. Vui lòng thử lại.'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={clearDownloadError}
                      className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-300 text-xs font-semibold border border-red-500/30 transition-colors shrink-0 flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Đóng</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
