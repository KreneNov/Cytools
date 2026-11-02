import React from 'react';
import { Droplets, Sparkles, ChevronRight } from 'lucide-react';
import { usePro } from '../../context/ProContext';

interface TreeStage {
  level: number;
  name: string;
  badge: string;
  image: string;
  minAmount: number;
  maxAmount: number;
  title: string;
}

const TREE_STAGES: TreeStage[] = [
  {
    level: 1,
    name: 'Hạt Mầm',
    badge: 'CẤP 1 • HẠT MẦM HY VỌNG',
    image: '/seed.png',
    minAmount: 0,
    maxAmount: 50_000,
    title: 'Hạt mầm gieo xuống từ cộng đồng',
  },
  {
    level: 2,
    name: 'Chồi Non',
    badge: 'CẤP 2 • CHỒI NON VƯƠN LÊN',
    image: '/sprout.png',
    minAmount: 50_000,
    maxAmount: 200_000,
    title: 'Chồi non đang đâm chồi nảy lộc',
  },
  {
    level: 3,
    name: 'Cây Sinh Trưởng',
    badge: 'CẤP 3 • CÂY XANH TỎA BÓNG',
    image: '/sapling.png',
    minAmount: 200_000,
    maxAmount: 500_000,
    title: 'Cây xanh vươn cao vững chãi',
  },
  {
    level: 4,
    name: 'Cổ Thụ Sum Suê',
    badge: 'CẤP 4 • ĐẠI THỤ BÁCH NIÊN',
    image: '/mature-tree.png',
    minAmount: 500_000,
    maxAmount: 1_000_000,
    title: 'Đại thụ sum suê bao bọc cộng đồng',
  },
];

function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
}

function getStageByAmount(amount: number): TreeStage {
  if (amount < 50_000) return TREE_STAGES[0];
  if (amount < 200_000) return TREE_STAGES[1];
  if (amount < 500_000) return TREE_STAGES[2];
  return TREE_STAGES[3];
}

interface DonationTreeProps {
  totalDonationAmount: number;
  onWater?: () => void;
}

export const DonationTree: React.FC<DonationTreeProps> = ({
  totalDonationAmount,
  onWater,
}) => {
  const { openProModal } = usePro();

  const handleWaterClick = () => {
    if (onWater) {
      onWater();
    } else {
      openProModal('Tưới nước tiếp sức cho Cây Cytools phát triển', 'donate');
    }
  };

  const currentStage = getStageByAmount(totalDonationAmount);

  return (
    <div className="w-full rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-6 shadow-xs flex flex-col items-center text-center shrink-0">
      {/* Top Header: Badge & Sequential Heading Level (h2) */}
      <div className="space-y-2 mb-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-zinc-700 text-sm font-semibold tracking-wide uppercase">
          <Sparkles className="w-4 h-4 text-pink-500" />
          <span>{currentStage.badge}</span>
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          Cây Tiếp Sức Cytools
        </h2>
      </div>

      {/* Central Living Tree Image Asset - Static, Elegant, No AI Transforms */}
      <div className="my-3 flex items-center justify-center w-full h-52 shrink-0">
        <img
          src={currentStage.image}
          alt={currentStage.name}
          className="w-44 h-44 sm:w-48 sm:h-48 aspect-square shrink-0 object-contain select-none mx-auto"
          loading="lazy"
          decoding="async"
        />
      </div>

      {/* Accumulated Total Fund */}
      <div className="space-y-1 my-2">
        <div className="text-2xl sm:text-3xl font-black font-mono text-slate-900 dark:text-white tracking-tight">
          {formatVnd(totalDonationAmount)}
        </div>
        <div className="text-sm text-slate-600 dark:text-slate-300 font-medium">
          tổng quỹ cộng đồng tiếp sức
        </div>
      </div>

      {/* Motivational Text - High Contrast & Standard text-sm */}
      <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed italic max-w-xs mt-2 mb-5">
        "Cây Cytools đang lớn lên từng ngày nhờ sự tưới tắm của bạn!"
      </p>

      {/* Water Action Button - Brand Rose High-Contrast */}
      <button
        type="button"
        onClick={handleWaterClick}
        className="w-full py-2.5 px-4 rounded-xl bg-[#FF758F] hover:bg-[#ff5d7b] text-white text-sm font-bold shadow-xs transition-transform active:scale-98 cursor-pointer flex items-center justify-center gap-2"
      >
        <Droplets className="w-4 h-4 text-white fill-white/80" />
        <span>Tưới Nước Cho Cây</span>
        <ChevronRight className="w-4 h-4 text-white/80" />
      </button>
    </div>
  );
};
