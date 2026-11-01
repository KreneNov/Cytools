import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Shield,
  Sparkles,
  CheckCircle2,
  Loader2,
  Menu,
} from 'lucide-react';
import { usePro } from '../../context/ProContext';
import { AnimatedThemeToggle } from '../theme/AnimatedThemeToggle';
import { Typewriter } from '../ui/Typewriter';
import { ChromeIcon } from '../ui/ChromeIcon';
import { InstallExtensionModal } from '../modals/InstallExtensionModal';

const ROUTE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/': {
    title: 'Cytools Tiện Ích',
    subtitle: 'Bộ công cụ xử lý đồ họa & media 100% chạy trên trình duyệt',
  },
  '/social-downloader': {
    title: 'Tải Video & Ảnh MXH',
    subtitle: 'Trích xuất video TikTok, YouTube, Instagram, Facebook & Pinterest chuẩn HD',
  },
  '/remove-bg': {
    title: 'Xóa nền AI HD',
    subtitle: 'Tách chủ thể sắc nét bằng mô hình ONNX Neural Network cục bộ & BiRefNet Cloud',
  },
  '/converter': {
    title: 'Trung Tâm Chuyển Đổi',
    subtitle: 'Chuyển đổi Video, Âm thanh MP3, Hình ảnh (JPG, PNG, WebP) và Tài liệu trực tiếp',
  },
  '/media-converter': {
    title: 'Trung Tâm Chuyển Đổi',
    subtitle: 'Chuyển đổi Video, Âm thanh MP3, Hình ảnh (JPG, PNG, WebP) và Tài liệu trực tiếp',
  },
};

interface HeaderProps {
  onOpenMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileMenu }) => {
  const location = useLocation();
  const { isPro, isPendingPro, openProModal } = usePro();
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);

  const currentInfo = ROUTE_TITLES[location.pathname] || {
    title: 'Cytools Tiện Ích',
    subtitle: 'Nền tảng công cụ số trực tiếp trong trình duyệt',
  };

  return (
    <header className="h-16 shrink-0 border-b border-zinc-200 dark:border-zinc-800/80 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20 transition-colors duration-200">
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        {/* Mobile Hamburger Menu Toggle */}
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 -ml-1.5 rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
          aria-label="Mở danh mục tiện ích"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="min-w-0">
          <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight truncate">
            {currentInfo.title}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:block">
            {currentInfo.subtitle}
          </p>
        </div>
      </div>

      {/* Dynamic Typewriter Welcome Message */}
      <div className="hidden lg:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300">
        <Sparkles className="w-3.5 h-3.5 text-pink-500 shrink-0" />
        <Typewriter
          words={[
            'Chào mừng bạn đến với Cytools!',
            'Siêu công cụ xử lý Media & Đồ họa',
            '100% Client-Side Sandbox bảo mật',
            'Tải video MXH • Đổi định dạng • Xóa nền AI',
          ]}
          typingSpeed={50}
          pauseDuration={2200}
        />
      </div>

      <div className="flex items-center gap-3">
        {/* Client-Side Sandbox Guarantee Badge */}
        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
          <Shield className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span>Client-Side Sandbox</span>
        </div>

        {/* Install Extension Shortcut Button */}
        <button
          type="button"
          onClick={() => setIsInstallModalOpen(true)}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
          title="Xem hướng dẫn cài đặt tiện ích Chrome"
        >
          <ChromeIcon className="w-3.5 h-3.5 text-[#FF758F]" />
          <span>Cài Extension</span>
        </button>

        {/* Animated Sun/Moon Theme Toggle */}
        <AnimatedThemeToggle />

        {/* Single subtle PRO status indicator at top-right (Pastel pink theme aligned) */}
        {isPro ? (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/30 text-xs font-semibold text-pink-600 dark:text-pink-400">
            <CheckCircle2 className="w-3.5 h-3.5 text-pink-500 dark:text-pink-400" />
            <span>Đã kích hoạt PRO</span>
          </div>
        ) : isPendingPro ? (
          <button
            type="button"
            onClick={() => openProModal('Yêu cầu kích hoạt PRO của bạn đang được hệ thống xử lý.')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-semibold text-amber-600 dark:text-amber-400 transition-all cursor-pointer"
            title="Bấm để xem lại thông tin chuyển khoản"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
            <span>Đang chờ duyệt PRO...</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => openProModal('Nâng cấp gói Pro 5.000đ để trải nghiệm không giới hạn', 'pro')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#FF758F] hover:bg-[#ff5d7b] text-white shadow-sm shadow-pink-500/20 text-xs font-bold transition-all active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 fill-white text-white" />
            <span>Kích hoạt PRO</span>
          </button>
        )}
      </div>

      <InstallExtensionModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
      />
    </header>
  );
};
