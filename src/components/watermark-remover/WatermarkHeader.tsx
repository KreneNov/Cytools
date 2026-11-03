import React from 'react';
import { Eraser, ShieldCheck } from 'lucide-react';

interface WatermarkHeaderProps {
  isCompact?: boolean;
}

export const WatermarkHeader: React.FC<WatermarkHeaderProps> = ({ isCompact = false }) => {
  if (isCompact) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-600 dark:text-pink-400">
            <Eraser className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Xóa Watermark Đa Nền Tảng
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Loại bỏ logo chìm, chữ đóng dấu trên hình ảnh, tài liệu PDF và slide PowerPoint trực tiếp trong trình duyệt.
            </p>
          </div>
        </div>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Xử lý 100% trên máy của bạn • Không tải file lên máy chủ</span>
        </div>
      </div>
    </div>
  );
};
