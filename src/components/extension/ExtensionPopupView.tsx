import React from 'react';
import { ExternalLink, Sparkles, CheckCircle2 } from 'lucide-react';
import { BrandLogo } from '../branding/BrandLogo';
import { AnimatedThemeToggle } from '../theme/AnimatedThemeToggle';
import { SocialDownloaderPage } from '../../pages/SocialDownloaderPage';
import { UpgradeModal } from '../modals/UpgradeModal';
import { usePro } from '../../context/ProContext';
import { CYTOOLS_WEB_URL } from '../../config/downloadConfig';

export const ExtensionPopupView: React.FC = () => {
  const { isPro, openProModal } = usePro();

  return (
    <div className="w-[540px] max-w-[560px] h-[580px] bg-slate-50 dark:bg-zinc-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between overflow-hidden font-sans select-none antialiased">
      {/* Extension Mini Topbar */}
      <header className="h-13 shrink-0 px-4 border-b border-slate-200 dark:border-zinc-800/80 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md flex items-center justify-between z-10">
        <div className="flex items-center gap-2.5">
          <BrandLogo size="sm" showText={false} />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm tracking-tight">
                <span className="text-[#FF758F]">Cy</span>tools
              </span>
              <span className="px-1.5 py-0.2 rounded bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-[10px] font-mono font-bold uppercase">
                Extension
              </span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-none">
              Social Video Downloader
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isPro ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-[10px] font-bold font-mono">
              <CheckCircle2 className="w-3 h-3 text-pink-500" />
              <span>PRO ACTIVE</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => openProModal('Nâng cấp Gói PRO 5.000đ mở khóa tải hàng loạt', 'pro')}
              className="px-2 py-1 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 border border-pink-500/25 text-pink-600 dark:text-pink-400 text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
              title="Kích hoạt PRO 5.000đ"
            >
              <Sparkles className="w-3 h-3" />
              <span>PRO 5k</span>
            </button>
          )}

          <AnimatedThemeToggle />
        </div>
      </header>

      {/* Main Extension Workspace: Strictly Social Video Downloader */}
      <main className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <SocialDownloaderPage isCompact={true} />
      </main>

      {/* Minimal Extension Footer Link */}
      <footer className="px-4 py-2.5 bg-white/80 dark:bg-zinc-900/90 border-t border-slate-200 dark:border-zinc-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 shrink-0">
        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
          100% In-Browser Sandbox
        </span>

        <a
          href={CYTOOLS_WEB_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            const chromeApi = typeof window !== 'undefined' ? (window as unknown as { chrome?: any }).chrome : undefined;
            if (chromeApi?.tabs?.create) {
              e.preventDefault();
              chromeApi.tabs.create({ url: CYTOOLS_WEB_URL });
            }
          }}
          className="font-semibold text-pink-600 dark:text-pink-400 hover:text-pink-500 hover:underline flex items-center gap-1 group text-xs cursor-pointer"
          title="Mở toàn bộ công cụ tiện ích tại Cytools Web"
        >
          <span>Trải nghiệm full công cụ tại Cytools Web</span>
          <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </a>
      </footer>

      {/* Pro Modal */}
      <UpgradeModal />
    </div>
  );
};

export default ExtensionPopupView;
