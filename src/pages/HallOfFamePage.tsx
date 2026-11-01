import React from 'react';
import { Trophy, Heart } from 'lucide-react';
import { HallOfFame } from '../components/community/HallOfFame';

export const HallOfFamePage: React.FC = () => {
  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      {/* Page Header */}
      <div className="space-y-1.5">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs font-bold uppercase tracking-wider">
          <Trophy className="w-3.5 h-3.5" />
          <span>Hành Lang Vinh Danh</span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
          <span>Bảng Vinh Danh Cộng Đồng</span>
          <Heart className="w-5 h-5 text-pink-500 fill-pink-500" />
        </h1>

        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xl leading-relaxed">
          Tri ân những người bạn đồng hành tiếp sức cho Cytools duy trì phát triển công cụ miễn phí, tốc độ cao và bảo mật 100% trong trình duyệt.
        </p>
      </div>

      {/* Main Hall of Fame Component */}
      <HallOfFame variant="full" showCta={true} />
    </div>
  );
};
