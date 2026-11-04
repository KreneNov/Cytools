import React, { useEffect } from 'react';
import { AlertCircle, Info, X } from 'lucide-react';

interface WatermarkToastProps {
  id: number;
  tone: 'info' | 'error';
  message: string;
  onDismiss: () => void;
  durationMs?: number;
}

/**
 * Lightweight local toast used by the watermark remover (WebGPU fallback, model download errors, ...).
 */
export const WatermarkToast: React.FC<WatermarkToastProps> = ({
  id,
  tone,
  message,
  onDismiss,
  durationMs = 5000,
}) => {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [id, durationMs, onDismiss]);

  const isError = tone === 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 right-5 z-50 max-w-sm flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg text-xs backdrop-blur-md ${
        isError
          ? 'bg-red-50/95 dark:bg-red-950/90 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
          : 'bg-slate-50/95 dark:bg-slate-900/95 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
      }`}
    >
      {isError ? (
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      ) : (
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
      )}
      <span className="flex-1 leading-relaxed">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Đóng thông báo"
        className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
