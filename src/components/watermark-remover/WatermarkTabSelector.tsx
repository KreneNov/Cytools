import React from 'react';
import { motion } from 'framer-motion';
import { ImageIcon, FileText, Presentation } from 'lucide-react';
import type { WatermarkTab } from '../../types/watermarkRemover';

interface WatermarkTabSelectorProps {
  activeTab: WatermarkTab;
  onChangeTab: (tab: WatermarkTab) => void;
}

export const WatermarkTabSelector: React.FC<WatermarkTabSelectorProps> = ({
  activeTab,
  onChangeTab,
}) => {
  const tabs: { id: WatermarkTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'image', label: 'Hình ảnh', icon: ImageIcon },
    { id: 'pdf', label: 'Tài liệu PDF', icon: FileText },
    { id: 'pptx', label: 'Slide PowerPoint (.pptx)', icon: Presentation },
  ];

  return (
    <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto no-scrollbar">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChangeTab(tab.id)}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              isActive
                ? 'text-pink-600 dark:text-pink-400'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {isActive && (
              <motion.div
                layoutId="watermarkTabIndicator"
                className="absolute inset-0 rounded-xl bg-pink-500/10 border border-pink-500/30 z-0"
                transition={{ type: 'spring', stiffness: 450, damping: 35 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};
