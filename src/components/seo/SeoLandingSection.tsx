import React, { useState } from 'react';
import {
  HelpCircle,
  ChevronDown,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

export interface SeoStepItem {
  step: string;
  title: string;
  description: string;
}

export interface SeoFaqItem {
  question: string;
  answer: string;
}

export interface SeoRelatedTool {
  name: string;
  path: string;
  badge: string;
}

export interface SeoLandingSectionProps {
  badge: string;
  h1: string;
  introParagraph: string;
  steps: SeoStepItem[];
  faqs: SeoFaqItem[];
  relatedTools?: SeoRelatedTool[];
}

export const SeoLandingSection: React.FC<SeoLandingSectionProps> = ({
  badge,
  h1,
  introParagraph,
  steps,
  faqs,
  relatedTools = [
    { name: 'Tải Video TikTok Không Logo', path: '/tai-video-tiktok-khong-logo', badge: 'TikTok HD' },
    { name: 'Tải Video YouTube 1080p', path: '/tai-video-youtube-1080p', badge: 'YouTube 1080p' },
    { name: 'Làm Mờ Ảnh & Motion Blur', path: '/lam-mo-anh-online', badge: 'Canvas Studio' },
    { name: 'Xóa Nền AI HD Studio', path: '/remove-bg', badge: 'BiRefNet' },
  ],
}) => {
  const [openFaqIndices, setOpenFaqIndices] = useState<Set<number>>(new Set([0]));

  const toggleFaq = (index: number) => {
    setOpenFaqIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <section className="w-full mt-12 pt-10 border-t border-slate-200 dark:border-slate-800 space-y-12">
      {/* 1. Header & Intro */}
      <div className="max-w-3xl mx-auto text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{badge}</span>
        </div>

        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
          {h1}
        </h1>

        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed font-sans">
          {introParagraph}
        </p>
      </div>

      {/* 2. Trust Highlights Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-500 shrink-0">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">Tốc độ tức thì</div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Xử lý ngay trong trình duyệt không chờ đợi</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">Bảo mật tuyệt đối</div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Không lưu trữ file hay dữ liệu cá nhân</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">Miễn phí 100%</div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Không giới hạn số lượt tải mỗi ngày</p>
          </div>
        </div>
      </div>

      {/* 3. Three-Step Quick Guide */}
      <div className="space-y-6">
        <div className="text-center space-y-1.5">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Hướng dẫn sử dụng nhanh trong 3 bước
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Dễ dàng thao tác trên cả máy tính, máy tính bảng và điện thoại di động
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {steps.map((st, idx) => (
            <div
              key={idx}
              className="relative rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-6 space-y-3"
            >
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs font-bold">
                <span>{st.step}</span>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {st.title}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-sans">
                {st.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 4. FAQ Accordion Section */}
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-pink-600 dark:text-pink-400">
            <HelpCircle className="w-4 h-4" />
            <span>Giải đáp thắc mắc</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Câu hỏi thường gặp (FAQ)
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, idx) => {
            const isOpen = openFaqIndices.has(idx);
            return (
              <div
                key={idx}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(idx)}
                  className="w-full p-4 sm:p-5 flex items-center justify-between gap-4 text-left font-bold text-sm text-slate-900 dark:text-white hover:text-pink-600 dark:hover:text-pink-400 transition-colors cursor-pointer"
                  aria-expanded={isOpen}
                >
                  <span>{faq.question}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-pink-500' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 sm:px-5 sm:pb-5 pt-0 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-800/80 font-sans">
                    <p className="pt-3">{faq.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Related Tools Internal Links */}
      {relatedTools && relatedTools.length > 0 && (
        <div className="pt-6 border-t border-slate-200 dark:border-slate-800/80 space-y-4">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider text-center">
            Khám phá thêm công cụ trực tuyến tại Cytools
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {relatedTools.map((tool, idx) => (
              <NavLink
                key={idx}
                to={tool.path}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700/80 text-xs font-medium transition-all group cursor-pointer"
              >
                <span className="font-semibold">{tool.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-600 dark:text-pink-400 font-mono">
                  {tool.badge}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default SeoLandingSection;
