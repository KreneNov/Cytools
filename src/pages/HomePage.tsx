import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ImageOff,
  Eraser,
  Repeat,
  DownloadCloud,
  ImageIcon,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Lock,
  Sparkles,
  Zap,
} from 'lucide-react';
import { usePro } from '../context/ProContext';
import { ChromeIcon } from '../components/ui/ChromeIcon';
import { InstallExtensionModal } from '../components/modals/InstallExtensionModal';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { isPro, openProModal } = usePro();
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);

  return (
    <div className="space-y-10">
      {/* Hero Welcome Banner */}
      <div className="relative overflow-hidden rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 md:p-10 transition-colors duration-200">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs font-semibold">
            <Cpu className="w-3.5 h-3.5" />
            <span>Nền tảng Tiện ích & Media Trực tuyến</span>
          </div>

          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight">
            Bộ Công Cụ Tải Video MXH & Đồ Họa Đa Năng
          </h1>

          <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
            Tải video TikTok không logo, trích xuất album ảnh lướt & Pinterest siêu nét trực tiếp về máy tính. Kết hợp xóa phông AI studio và convert media mượt mà, bảo mật 100%.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => navigate('/social-downloader')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-sm transition-all active:scale-95 cursor-pointer"
            >
              <DownloadCloud className="w-4 h-4 text-white" />
              <span>Tải Video & Ảnh MXH ngay</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => navigate('/converter')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-medium text-sm transition-all active:scale-95 cursor-pointer"
            >
              <Repeat className="w-4 h-4 text-pink-500 dark:text-pink-400" />
              <span>Trung Tâm Chuyển Đổi</span>
            </button>

            <button
              onClick={() => navigate('/remove-bg')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-medium text-sm transition-all active:scale-95 cursor-pointer"
            >
              <ImageOff className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>Xóa nền AI HD Studio</span>
            </button>

            <button
              onClick={() => navigate('/watermark-remover')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-medium text-sm transition-all active:scale-95 cursor-pointer"
            >
              <Eraser className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
              <span>Xóa Watermark Đa Nền Tảng</span>
            </button>

            <button
              onClick={() => setIsInstallModalOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pink-500/10 hover:bg-pink-500/20 text-pink-600 dark:text-pink-400 border border-pink-500/30 font-bold text-sm transition-all active:scale-95 cursor-pointer"
            >
              <ChromeIcon className="w-4 h-4 text-pink-500" />
              <span>Cài Tiện Ích Chrome</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Utilities */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Bộ công cụ trực tuyến
          </h2>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            5 công cụ hoạt động sẵn sàng • 100% Client-Side Sandbox
          </span>
        </div>

        {/* FEATURED CARD: Tải Video & Ảnh MXH */}
        <div
          onClick={() => navigate('/social-downloader')}
          className="group relative rounded-xl bg-white hover:bg-slate-50/80 dark:bg-slate-900/80 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-pink-500/40 dark:hover:border-pink-500/50 p-6 md:p-8 transition-all duration-200 cursor-pointer"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-4 max-w-2xl">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 group-hover:scale-105 transition-transform">
                  <DownloadCloud className="w-7 h-7" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20">
                      PHỔ BIẾN NHẤT
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-pink-500 dark:text-pink-400" />
                      Zero CORS • Tải Thẳng Về Máy
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors mt-0.5">
                    Tải Video & Ảnh MXH Đa Nền Tảng
                  </h3>
                </div>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
                Tải video TikTok không logo (chuẩn HD 1080p), trích xuất toàn bộ album ảnh lướt TikTok Slideshow đóng gói file .ZIP trọn bộ, tải video & ảnh gốc Pinterest, Facebook Reels và Instagram Story tốc độ cao.
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
                  🎵 TikTok HD & MP3
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
                  📸 TikTok Slideshow (.ZIP)
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
                  📌 Pinterest Video & Ảnh Master
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
                  📱 Facebook & Instagram
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start md:self-auto px-5 py-3 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs transition-all shrink-0 cursor-pointer">
              <span>Mở Trình Tải Media</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>

        {/* 4 Companion Utilities Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Card 1: Convert Hub (Media & Tools) */}
          <div
            onClick={() => navigate('/converter')}
            className="group relative flex flex-col justify-between rounded-xl bg-white hover:bg-slate-50/80 dark:bg-slate-900/50 dark:hover:bg-slate-900/90 border border-slate-200 dark:border-slate-800 hover:border-pink-500/40 p-6 transition-all duration-200 cursor-pointer"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 group-hover:scale-105 transition-transform">
                  <Repeat className="w-6 h-6 text-pink-500" />
                </div>
                <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  FFmpeg & PDF.js
                </span>
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
                  Trung Tâm Chuyển Đổi
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed max-w-md">
                  Tách MP3 192kbps, chuyển đổi MOV sang MP4, tạo GIF động, trích xuất PDF sang ảnh JPG/ZIP và gộp PDF trực tiếp trên trình duyệt.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-pink-600 dark:text-pink-400 font-semibold">
              <span>Mở bộ chuyển đổi</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Card 2: Image Converter & Compressor */}
          <div
            onClick={() => navigate('/converter?tab=image')}
            className="group relative flex flex-col justify-between rounded-xl bg-white hover:bg-slate-50/80 dark:bg-slate-900/50 dark:hover:bg-slate-900/90 border border-slate-200 dark:border-slate-800 hover:border-pink-500/40 p-6 transition-all duration-200 cursor-pointer"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 group-hover:scale-105 transition-transform">
                  <ImageIcon className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20">
                  HEIC & Canvas
                </span>
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
                  Nén & Đổi Định Dạng Ảnh
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed max-w-md">
                  Chuyển đổi tức thì giữa JPG, PNG, WebP, BMP, ICO với bộ nén HTML5 Canvas chất lượng cao và giải mã ảnh Apple HEIC/HEIF tự động.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-pink-600 dark:text-pink-400 font-semibold">
              <span>Chuyển đổi ảnh</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Card 3: Xóa Watermark Đa Nền Tảng */}
          <div
            onClick={() => navigate('/watermark-remover')}
            className="group relative flex flex-col justify-between rounded-xl bg-white hover:bg-slate-50/80 dark:bg-slate-900/50 dark:hover:bg-slate-900/90 border border-slate-200 dark:border-slate-800 hover:border-indigo-500/40 p-6 transition-all duration-200 cursor-pointer"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 group-hover:scale-105 transition-transform">
                  <Eraser className="w-6 h-6" />
                </div>
                <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  Telea & PDF-Lib & JSZip
                </span>
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  Xóa Watermark Đa Năng
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed max-w-md">
                  Inpainting xóa dấu mờ ảnh bằng Fast Marching Telea, loại bỏ watermark / stamp trong PDF và bóc tách logo slide PowerPoint.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
              <span>Mở bộ xóa watermark</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>

          {/* Card 4: Xóa nền AI HD Studio */}
          <div
            onClick={() => navigate('/remove-bg')}
            className="group relative flex flex-col justify-between rounded-xl bg-white hover:bg-slate-50/80 dark:bg-slate-900/50 dark:hover:bg-slate-900/90 border border-slate-200 dark:border-slate-800 hover:border-pink-500/40 p-6 transition-all duration-200 cursor-pointer"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 group-hover:scale-105 transition-transform">
                  <ImageOff className="w-6 h-6 text-pink-500" />
                </div>
                <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                  BiRefNet & RMBG-1.4
                </span>
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-pink-600 dark:group-hover:text-pink-400 transition-colors">
                  Xóa nền AI HD Studio
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 leading-relaxed max-w-md">
                  Dual-Engine bóc tách lông thú cưng và tóc tơ siêu mượt. Tích hợp cọ xóa/cọ giữ khôi phục chi tiết và thay phông ảnh thẻ Đỏ/Xanh chuẩn quốc tế.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-xs text-pink-600 dark:text-pink-400 font-semibold">
              <span>Bắt đầu xóa phông</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>
      </div>

      {/* Trust & Performance Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
        <div className="p-5 rounded-xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/60 space-y-2">
          <div className="w-8 h-8 rounded-lg bg-pink-500/10 text-pink-600 dark:text-pink-400 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-200">
            Bảo Mật & Riêng Tư Tuyệt Đối
          </h3>
          <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
            Các tác vụ đồ họa và video chạy 100% trên phần cứng máy khách thông qua WASM/WebGPU. Không lưu trữ bất kỳ dữ liệu cá nhân nào.
          </p>
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/60 space-y-2">
          <div className="w-8 h-8 rounded-lg bg-pink-500/10 text-pink-600 dark:text-pink-400 flex items-center justify-center">
            <Zap className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-200">
            Tải Media Trực Tiếp Về Ổ Đĩa
          </h3>
          <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
            Hệ thống Proxy đính kèm header tải xuống tự động, triệt tiêu lỗi bị trình duyệt chuyển hướng mở tab mới thay vì tải file.
          </p>
        </div>

        <div className="p-5 rounded-xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/60 space-y-2">
          <div className="w-8 h-8 rounded-lg bg-pink-500/10 text-pink-600 dark:text-pink-400 flex items-center justify-center">
            <Lock className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-200">
            Chi Phí Minh Bạch 5.000đ Vĩnh Viễn
          </h3>
          <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
            Miễn phí không giới hạn các tác vụ đơn lẻ. Nâng cấp Pro 5.000đ một lần duy nhất qua VietQR để mở khóa chế độ Batch Mode và xuất ZIP album.
          </p>
        </div>
      </div>

      {/* Pro Membership Upsell Banner */}
      {!isPro && (
        <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-pink-500/30 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-1.5 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2">
              <Sparkles className="w-4 h-4 text-pink-500 dark:text-pink-400" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Nâng cấp Cytools Pro — Chỉ 5.000đ thanh toán 1 lần duy nhất
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-xl">
              Mở khóa toàn bộ tính năng Tải Hàng Loạt (Batch Multi-Link), đóng gói ZIP trọn bộ album ảnh TikTok/Pinterest, và xóa phông cùng lúc nhiều ảnh.
            </p>
          </div>

          <button
            onClick={() => openProModal('Nâng cấp gói Pro 5.000đ từ Trang chủ')}
            className="px-6 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs active:scale-95 transition-all shrink-0 cursor-pointer"
          >
            Quét mã VietQR 5.000đ
          </button>
        </div>
      )}
      {/* Install Extension Modal */}
      <InstallExtensionModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
      />
    </div>
  );
};
