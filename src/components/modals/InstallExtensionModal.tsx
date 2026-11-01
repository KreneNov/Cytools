import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  CheckCircle2,
  Copy,
  Check,
  Pin,
  Download,
} from 'lucide-react';
import { ChromeIcon } from '../ui/ChromeIcon';

interface InstallExtensionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallExtensionModal: React.FC<InstallExtensionModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [downloadTimestamp] = useState(() => Date.now());

  const handleCopy = useCallback(async (textToCopy: string = 'chrome://extensions') => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Lỗi khi sao chép:', err);
    }
  }, []);

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[92vh] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-lg shadow-black/20 overflow-hidden flex flex-col font-sans select-none"
          >
            {/* Modal Header */}
            <div className="p-6 pb-4 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
                  <ChromeIcon className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      Cài Đặt Tiện Ích Cytools Chrome
                    </h2>
                    <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20">
                      Manifest V3
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Bóc tách và tải video MXH 1-chạm mọi lúc từ thanh công cụ
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body: Download Action & 3 Quick Steps */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              {/* Hero Download Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-pink-500/10 via-rose-500/5 to-pink-500/10 border border-pink-500/20 flex flex-col sm:flex-row items-center justify-between gap-3.5">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-pink-500 text-white flex items-center justify-center shrink-0">
                    <Download className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <span>Bản Tiện Ích Đóng Gói Sẵn (.zip)</span>
                      <span className="px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-pink-500/10 text-pink-600 dark:text-pink-400">
                        v1.0.0
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Tải về, giải nén và dùng ngay trên Chrome, Cốc Cốc, Edge
                    </p>
                  </div>
                </div>

                <a
                  href={`/cytools-extension.zip?t=${downloadTimestamp}`}
                  download="cytools-extension.zip"
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#FF758F] hover:bg-[#ff5d7b] text-white text-sm font-bold transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2 shadow-xs shrink-0 no-underline"
                >
                  <Download className="w-4 h-4" />
                  <span>Tải Xuống Tiện Ích (.zip)</span>
                </a>
              </div>

              {/* 3 Quick Steps */}
              <div className="space-y-3">
                {/* Step 1: Download & Extract */}
                <div className="p-4 rounded-2xl bg-slate-100/70 dark:bg-zinc-800/40 flex items-start gap-3.5">
                  <div className="w-6 h-6 rounded-full bg-pink-500 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Tải về & Giải nén (Download & Extract)
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      Nhấn nút <strong className="text-slate-900 dark:text-slate-100">Tải Xuống Tiện Ích (.zip)</strong> ở trên, sau đó nhấp chuột phải vào file <code className="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 font-mono text-pink-500 text-sm">cytools-extension.zip</code> và chọn <strong className="text-slate-900 dark:text-slate-100">Extract All</strong> (hoặc Giải nén tại đây) để nhận thư mục tiện ích.
                    </p>
                  </div>
                </div>

                {/* Step 2: Open Extensions & Enable Developer Mode */}
                <div className="p-4 rounded-2xl bg-slate-100/70 dark:bg-zinc-800/40 flex items-start gap-3.5">
                  <div className="w-6 h-6 rounded-full bg-pink-500 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </div>
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Mở quản lý tiện ích & Bật Developer Mode
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      Truy cập đường dẫn quản lý tiện ích và gạt bật công tắc <strong className="text-slate-900 dark:text-slate-100">Chế độ cho nhà phát triển (Developer mode)</strong> ở góc trên bên phải màn hình:
                    </p>
                    <div className="flex items-center gap-2 pt-0.5">
                      <code
                        className="text-sm font-mono px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-pink-600 dark:text-pink-400 select-text cursor-text transition-colors"
                        style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                      >
                        chrome://extensions
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopy('chrome://extensions')}
                        className={`copy copy-btn-interactive p-1.5 rounded-lg border transition-all cursor-pointer ${
                          isCopied
                            ? 'is-copied bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400'
                            : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-zinc-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-700'
                        }`}
                        aria-label="Sao chép đường dẫn tiện ích"
                        data-text-initial="Copy"
                        data-text-end="Copied!"
                      >
                        <span
                          className="tooltip px-2.5 py-1 text-xs font-semibold rounded-md shadow-md bg-slate-900 dark:bg-zinc-800 text-white border border-slate-700 dark:border-zinc-600"
                          data-text-initial="Copy"
                          data-text-end="Copied!"
                        >
                          {isCopied ? 'Copied!' : 'Copy'}
                        </span>
                        {isCopied ? (
                          <Check className="w-4 h-4 text-emerald-500 dark:text-emerald-400 stroke-[2.5]" />
                        ) : (
                          <Copy className="w-4 h-4 stroke-[2]" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Step 3: Load Unpacked */}
                <div className="p-4 rounded-2xl bg-slate-100/70 dark:bg-zinc-800/40 flex items-start gap-3.5">
                  <div className="w-6 h-6 rounded-full bg-pink-500 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Tải tiện ích đã giải nén (Load unpacked)
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      Nhấn nút <strong className="text-slate-900 dark:text-slate-100">Tải tiện ích đã giải nén (Load unpacked)</strong> ở góc trên bên trái thanh công cụ, rồi duyệt chọn đúng thư mục tiện ích bạn vừa giải nén ở Bước 1.
                    </p>
                  </div>
                </div>
              </div>

              {/* Pin Tip */}
              <div className="p-3.5 rounded-2xl bg-pink-500/5 border border-pink-500/20 flex items-center gap-3">
                <Pin className="w-4 h-4 text-pink-500 shrink-0" />
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  <strong className="text-pink-600 dark:text-pink-400">Mẹo nhỏ:</strong> Nhấn biểu tượng mảnh ghép trên Chrome Toolbar và ghim (Pin) Cytools để tự động bắt link và tải video với 1 cú nhấp chuột!
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 px-6 bg-slate-50/80 dark:bg-zinc-900/80 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
              <span className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>100% Client-Side Sandbox Bảo Mật</span>
              </span>

              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-sm font-bold transition-all active:scale-95 cursor-pointer shadow-xs"
              >
                Đã hiểu
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default InstallExtensionModal;
