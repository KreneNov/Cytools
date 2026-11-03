import React, { useRef, useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutGrid,
  DownloadCloud,
  Repeat,
  ImageOff,
  Eraser,
  Sparkles,
  CheckCircle2,
  Loader2,
  Heart,
  Trophy,
} from 'lucide-react';
import { BrandLogo } from '../branding/BrandLogo';
import { usePro } from '../../context/ProContext';

interface NavItem {
  id: string;
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  isAvailable: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'home',
    name: 'Trang chủ',
    path: '/',
    icon: LayoutGrid,
    isAvailable: true,
  },
  {
    id: 'social-downloader',
    name: 'Tải Video & Ảnh MXH',
    path: '/social-downloader',
    icon: DownloadCloud,
    isAvailable: true,
  },
  {
    id: 'converter',
    name: 'Trung Tâm Chuyển Đổi',
    path: '/converter',
    icon: Repeat,
    isAvailable: true,
  },
  {
    id: 'remove-bg',
    name: 'Xóa nền AI HD',
    path: '/remove-bg',
    icon: ImageOff,
    isAvailable: true,
  },
  {
    id: 'watermark-remover',
    name: 'Xóa Watermark',
    path: '/watermark-remover',
    icon: Eraser,
    isAvailable: true,
  },
  {
    id: 'hall-of-fame',
    name: 'Hành lang vinh danh',
    path: '/hall-of-fame',
    icon: Trophy,
    isAvailable: true,
  },
];

interface SidebarProps {
  isCompact?: boolean;
  isMobileDrawer?: boolean;
  onNavigate?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isCompact = false,
  isMobileDrawer = false,
  onNavigate,
}) => {
  const location = useLocation();
  const { isPro, isPendingPro, openProModal } = usePro();
  const navContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  const [indicatorStyle, setIndicatorStyle] = useState<{
    top: number;
    height: number;
    opacity: number;
  }>({
    top: 0,
    height: 0,
    opacity: 0,
  });

  const [hasMounted, setHasMounted] = useState(false);

  const isNavActive = useCallback(
    (itemPath: string) => {
      if (itemPath === '/') {
        return location.pathname === '/';
      }
      return location.pathname === itemPath || location.pathname.startsWith(itemPath + '/');
    },
    [location.pathname]
  );

  // Recalculate indicator position whenever route changes or window resizes
  useEffect(() => {
    const updateIndicator = () => {
      const activeItem = NAV_ITEMS.find((item) => isNavActive(item.path));
      if (activeItem) {
        const el = itemRefs.current.get(activeItem.id);
        if (el) {
          setIndicatorStyle({
            top: el.offsetTop,
            height: el.offsetHeight,
            opacity: 1,
          });
        }
      } else {
        setIndicatorStyle((prev) => ({ ...prev, opacity: 0 }));
      }
    };

    updateIndicator();

    // Enable smooth transitions only AFTER initial positioning
    const timer = setTimeout(() => {
      setHasMounted(true);
    }, 50);

    window.addEventListener('resize', updateIndicator);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateIndicator);
    };
  }, [isNavActive]);

  return (
    <aside
      className={`shrink-0 bg-white dark:bg-zinc-950/95 flex flex-col h-screen sticky top-0 select-none transition-all duration-200 ${
        isMobileDrawer
          ? 'w-full h-full border-r-0'
          : isCompact
          ? 'w-16 border-r border-zinc-200 dark:border-zinc-800/80'
          : 'w-64 border-r border-zinc-200 dark:border-zinc-800/80'
      }`}
    >
      {/* Brand Header */}
      <div
        className={`border-b border-zinc-200 dark:border-zinc-800/80 ${
          isCompact ? 'p-3 flex justify-center' : 'p-5'
        }`}
      >
        <NavLink
          to="/"
          onClick={() => {
            onNavigate?.();
            window.scrollTo({ top: 0, behavior: 'instant' });
          }}
          className="block"
        >
          <BrandLogo size={isCompact ? 'sm' : 'md'} showText={!isCompact} />
        </NavLink>
      </div>

      {/* Navigation List */}
      <div
        ref={navContainerRef}
        className={`flex-1 overflow-y-auto space-y-1 relative ${
          isCompact ? 'px-2 py-3' : 'px-3 py-4'
        }`}
      >
        {!isCompact && (
          <div className="px-3 pb-2 text-xs font-bold tracking-wider text-slate-500 dark:text-slate-400 uppercase">
            Công cụ tiện ích
          </div>
        )}

        {/* Sliding Active Background Indicator */}
        <div
          aria-hidden="true"
          className={`absolute ${
            isCompact ? 'left-1.5 right-1.5' : 'left-3 right-3'
          } rounded-lg bg-pink-500/10 border border-pink-500/20 dark:border-pink-500/25 pointer-events-none z-0 ${
            hasMounted
              ? 'transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]'
              : 'transition-none'
          }`}
          style={{
            top: 0,
            transform: `translateY(${indicatorStyle.top}px)`,
            height: `${indicatorStyle.height}px`,
            opacity: indicatorStyle.opacity,
          }}
        />

        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = isNavActive(item.path);

          if (!item.isAvailable) {
            return (
              <div
                key={item.id}
                className={`flex items-center ${
                  isCompact ? 'justify-center p-2.5' : 'justify-between px-3 py-2.5'
                } rounded-lg text-slate-400 dark:text-slate-500 cursor-not-allowed group hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors relative z-10`}
                title="Tính năng đang được phát triển"
              >
                <div className={`flex items-center ${isCompact ? 'justify-center' : 'gap-3'}`}>
                  <Icon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                  {!isCompact && <span className="text-sm font-medium">{item.name}</span>}
                </div>
                {!isCompact && item.badge && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-750">
                    {item.badge}
                  </span>
                )}
              </div>
            );
          }

          return (
            <NavLink
              key={item.id}
              to={item.path}
              onClick={() => {
                onNavigate?.();
                window.scrollTo({ top: 0, behavior: 'instant' });
              }}
              ref={(el) => {
                if (el) {
                  itemRefs.current.set(item.id, el);
                } else {
                  itemRefs.current.delete(item.id);
                }
              }}
              title={item.name}
              className={`flex items-center ${
                isCompact ? 'justify-center p-2.5' : 'justify-between px-3 py-2.5'
              } rounded-lg text-sm transition-colors relative z-10 ${
                isActive
                  ? 'text-pink-600 dark:text-pink-400 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/60 dark:hover:bg-slate-900/60 font-medium'
              }`}
            >
              <div className={`flex items-center ${isCompact ? 'justify-center' : 'gap-3'}`}>
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    isActive ? 'text-pink-600 dark:text-pink-400' : 'text-slate-500 dark:text-slate-400'
                  }`}
                />
                {!isCompact && <span>{item.name}</span>}
              </div>
              {!isCompact && item.badge && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-pink-500/10 text-pink-600 dark:text-pink-300 border border-pink-500/20">
                  {item.badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </div>

      {/* Sidebar PRO Upsell / Status Action */}
      <div className={isCompact ? 'px-2 pb-2' : 'px-3 pb-2'}>
        {isCompact ? (
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              openProModal('Nâng cấp Gói PRO 5.000đ để sở hữu tính năng không giới hạn', 'pro');
            }}
            title="Kích hoạt PRO 5.000đ"
            className="w-full p-2.5 rounded-xl bg-pink-500/10 hover:bg-pink-500/20 border border-pink-500/30 flex items-center justify-center text-pink-600 dark:text-pink-400 font-bold transition-all cursor-pointer shadow-xs active:scale-95"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        ) : isPro ? (
          <div className="p-2.5 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-between text-xs text-pink-600 dark:text-pink-400 font-semibold">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-pink-500 shrink-0" />
              <span>Gói PRO Hoạt Động</span>
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pink-500/20">VĨNH VIỄN</span>
          </div>
        ) : isPendingPro ? (
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              openProModal('Xem lại thông tin chuyển khoản gói PRO 5.000đ', 'pro');
            }}
            className="w-full p-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 flex items-center justify-between text-xs text-amber-600 dark:text-amber-400 font-semibold transition-all cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500 shrink-0" />
              <span>Đang chờ duyệt PRO...</span>
            </span>
            <span className="text-[10px] underline">Chi tiết</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              openProModal('Nâng cấp Gói PRO 5.000đ để sở hữu tính năng không giới hạn', 'pro');
            }}
            className="w-full p-2.5 rounded-xl bg-gradient-to-r from-pink-500/10 via-pink-500/15 to-pink-500/10 hover:from-pink-500/20 hover:to-pink-500/20 border border-pink-500/30 flex items-center justify-between text-xs text-pink-600 dark:text-pink-400 font-bold transition-all cursor-pointer shadow-xs active:scale-[0.98]"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-pink-500 flex items-center justify-center text-white shadow-xs shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="leading-tight">Kích hoạt PRO</div>
                <div className="text-[10.5px] font-normal text-slate-500 dark:text-slate-400">5.000đ • Trọn đời</div>
              </div>
            </div>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#FF758F] text-white shadow-xs">
              MỞ
            </span>
          </button>
        )}
      </div>

      {/* Donate & Contact Dev Quick Trigger */}
      <div className={isCompact ? 'px-2 pb-2' : 'px-3 pb-2'}>
        {isCompact ? (
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              openProModal('Ủng hộ nhà phát triển Cytools', 'donate');
            }}
            title="Liên hệ & Ủng hộ Dev"
            className="w-full p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-900/60 dark:hover:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800 text-xs font-semibold text-pink-500 transition-colors flex items-center justify-center cursor-pointer group"
          >
            <Heart className="w-4 h-4 fill-pink-500/30 group-hover:scale-110 transition-transform" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              openProModal('Ủng hộ nhà phát triển Cytools', 'donate');
            }}
            className="w-full px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-900/60 dark:hover:bg-slate-800/80 border border-slate-200/80 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors flex items-center justify-between cursor-pointer group"
            title="Ủng hộ cà phê & liên hệ tác giả"
          >
            <span className="flex items-center gap-2">
              <Heart className="w-3.5 h-3.5 text-pink-500 fill-pink-500/30 group-hover:scale-110 transition-transform" />
              <span>Liên hệ & Ủng hộ</span>
            </span>
            <span className="text-[10.5px] text-slate-400 font-normal">Dev</span>
          </button>
        )}
      </div>

      {/* Clean minimal footer without AI-slop cards */}
      {!isCompact && (
        <div className="p-3 border-t border-slate-200 dark:border-slate-800/80 text-xs font-medium text-slate-500 dark:text-slate-400 text-center">
          <span>Cytools Engine • 100% In-Browser</span>
        </div>
      )}
    </aside>
  );
};
