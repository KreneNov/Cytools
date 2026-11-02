import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  Trophy,
  Sparkles,
  Coffee,
  Heart,
  ShieldCheck,
  ChevronRight,
} from 'lucide-react';
import { HALL_OF_FAME_DATA, type DonorEntry } from '../../data/hallOfFame';
import { usePro } from '../../context/ProContext';
import { DonationTree } from './DonationTree';
import { getApiUrl } from '../../utils/api';

function parseDonationAmount(amountStr?: string): number {
  if (!amountStr) return 0;
  const str = amountStr.trim().toLowerCase();
  if (str.endsWith('k')) {
    const num = parseFloat(str.replace(/[^\d.]/g, ''));
    return Number.isNaN(num) ? 0 : Math.round(num * 1000);
  }
  const cleaned = str.replace(/[^\d]/g, '');
  const parsed = parseInt(cleaned, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ';
}

interface HallOfFameProps {
  variant?: 'full' | 'compact';
  showCta?: boolean;
  refreshTrigger?: number;
}

export const HallOfFame: React.FC<HallOfFameProps> = ({
  variant = 'full',
  showCta = true,
  refreshTrigger = 0,
}) => {
  const { openProModal } = usePro();
  const [filter, setFilter] = useState<'all' | 'pro' | 'donate'>('all');
  const [donorsList, setDonorsList] = useState<DonorEntry[]>(HALL_OF_FAME_DATA);
  const [serverTotalAmount, setServerTotalAmount] = useState<number | null>(null);

  // Fetch live Hall of Fame data from backend API with fallback
  useEffect(() => {
    let isMounted = true;
    const fetchLiveHallOfFame = async () => {
      try {
        const url = getApiUrl(`/api/hall-of-fame?t=${Date.now()}`);
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data.success && Array.isArray(data.donors)) {
          setDonorsList(data.donors);
          setServerTotalAmount(typeof data.totalAmount === 'number' ? data.totalAmount : 0);
        }
      } catch (err) {
        console.warn('Lỗi khi nạp Bảng Vinh Danh trực tuyến, sử dụng dữ liệu tĩnh:', err);
      }
    };

    fetchLiveHallOfFame();

    const handleHofEvent = () => {
      fetchLiveHallOfFame();
    };
    window.addEventListener('cytools:hof-updated', handleHofEvent);

    return () => {
      isMounted = false;
      window.removeEventListener('cytools:hof-updated', handleHofEvent);
    };
  }, [refreshTrigger]);

  const filteredDonors = useMemo(() => {
    if (filter === 'pro') {
      return donorsList.filter((d) => d.role === 'PRO Member' || d.badgeType === 'pro');
    }
    if (filter === 'donate') {
      return donorsList.filter((d) => d.role !== 'PRO Member' && d.badgeType !== 'pro');
    }
    return donorsList;
  }, [filter, donorsList]);

  const proCount = useMemo(
    () => donorsList.filter((d) => d.role === 'PRO Member' || d.badgeType === 'pro').length,
    [donorsList]
  );

  const donateCount = useMemo(
    () => donorsList.filter((d) => d.role !== 'PRO Member' && d.badgeType !== 'pro').length,
    [donorsList]
  );

  const totalDonationAmount = useMemo(() => {
    if (typeof serverTotalAmount === 'number') {
      return serverTotalAmount;
    }
    return donorsList.reduce(
      (sum, item) => sum + parseDonationAmount(item.amount),
      0
    );
  }, [serverTotalAmount, donorsList]);

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.04,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.2,
        ease: 'easeOut' as const,
      },
    },
  };

  // Compact View for UpgradeModal
  if (variant === 'compact') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-1 border-b border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
              Cộng Đồng Tri Ân Cytools ({donorsList.length})
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs font-bold font-mono">
            <span>Tổng quỹ:</span>
            <span>{formatVnd(totalDonationAmount)}</span>
          </div>
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="max-h-[380px] overflow-y-auto pr-1 divide-y divide-slate-100 dark:divide-zinc-800 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 custom-scrollbar"
        >
          {donorsList.length === 0 ? (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-sm">
              <Sparkles className="w-8 h-8 text-pink-500/50 mx-auto mb-2" />
              <p className="font-semibold text-slate-700 dark:text-slate-300">Chưa có người ủng hộ nào</p>
              <p className="text-xs mt-1 text-slate-500">Hãy là người đầu tiên tiếp sức cho Cytools!</p>
            </div>
          ) : (
            donorsList.map((donor) => (
              <motion.div
                key={donor.id}
                variants={itemVariants}
                className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-zinc-800/40 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {donor.name}
                  </span>
                  <span className="text-sm font-mono text-slate-500 dark:text-slate-400 shrink-0">
                    {donor.date}
                  </span>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="text-sm font-mono font-bold text-slate-800 dark:text-slate-200">
                    {donor.amount}
                  </span>
                  {donor.role === 'PRO Member' || donor.badgeType === 'pro' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs font-bold font-mono">
                      <Sparkles className="w-3 h-3" />
                      <span>PRO</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold font-mono">
                      <Coffee className="w-3 h-3" />
                      <span>DONOR</span>
                    </span>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </motion.div>
      </div>
    );
  }

  // Full Page View with List on the LEFT, Donation Tree on the RIGHT
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* LEFT COLUMN: Summary Cards, Tabs, Donor List, and Bottom CTA */}
      <div className="lg:col-span-7 xl:col-span-8 space-y-6 order-2 lg:order-1">
        {/* Metric Cards Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center gap-3.5 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 shrink-0">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xl font-black text-slate-800 dark:text-slate-100 font-mono">
                {donorsList.length}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-300 font-medium">
                Người bạn đồng hành
              </div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center gap-3.5 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xl font-black text-slate-800 dark:text-slate-100 font-mono">
                {proCount}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-300 font-medium">
                Thành viên PRO Lifetime
              </div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center gap-3.5 shadow-xs">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 shrink-0">
              <Coffee className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xl font-black text-slate-800 dark:text-slate-100 font-mono">
                {donateCount}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-300 font-medium">
                Ly cà phê tiếp sức
              </div>
            </div>
          </div>
        </div>

        {/* Filter Tabs & Assurance */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-sm">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                filter === 'all'
                  ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Tất cả ({donorsList.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('pro')}
              className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                filter === 'pro'
                  ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Thành viên PRO ({proCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('donate')}
              className={`px-3.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                filter === 'donate'
                  ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Ủng hộ Cà phê ({donateCount})
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Cập nhật minh bạch & trực tiếp</span>
          </div>
        </div>

        {/* Sleek Minimal High-Contrast List */}
        <AnimatePresence mode="wait">
          <motion.div
            key={filter}
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-slate-100 dark:divide-zinc-800 overflow-hidden shadow-xs"
          >
            {filteredDonors.length === 0 ? (
              <div className="p-12 text-center text-slate-500 dark:text-slate-400">
                <Sparkles className="w-10 h-10 text-pink-500/50 mx-auto mb-3" />
                <p className="font-bold text-base text-slate-800 dark:text-slate-200">
                  Chưa có người ủng hộ nào trong danh mục này
                </p>
                <p className="text-sm mt-1.5 text-slate-500 max-w-md mx-auto">
                  Hãy là người tiên phong tiếp sức cho Cytools phát triển các công cụ miễn phí cho cộng đồng!
                </p>
              </div>
            ) : (
              filteredDonors.map((donor: DonorEntry) => (
                <motion.div
                  key={donor.id}
                  variants={itemVariants}
                  className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-zinc-800/40 transition-colors"
                >
                  {/* Left: Name & Date */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                      {donor.name}
                    </span>
                    <span className="text-sm text-slate-500 dark:text-slate-400 font-mono">
                      {donor.date}
                    </span>
                  </div>

                  {/* Right: Amount & Specific Badge */}
                  <div className="flex items-center gap-3.5 shrink-0">
                    <span className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100">
                      {donor.amount}
                    </span>
                    {donor.role === 'PRO Member' || donor.badgeType === 'pro' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs font-bold font-mono">
                        <Sparkles className="w-3 h-3" />
                        <span>PRO</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold font-mono">
                        <Coffee className="w-3 h-3" />
                        <span>DONOR</span>
                      </span>
                    )}
                  </div>
                </motion.div>
              ))
            )}
          </motion.div>
        </AnimatePresence>

        {/* Bottom CTA Box */}
        {showCta && (
          <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-pink-500/10 via-rose-500/5 to-pink-500/10 border border-pink-500/20 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="space-y-1.5 text-center sm:text-left">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center justify-center sm:justify-start gap-2">
                <Heart className="w-4 h-4 text-pink-500 fill-pink-500" />
                <span>Bạn muốn tên mình xuất hiện tại Hành lang vinh danh?</span>
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Chỉ từ 5.000đ mở khóa gói PRO trọn đời hoặc một cốc cà phê tùy tâm để tiếp sức cho Cytools!
              </p>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 flex-wrap justify-center">
              <button
                type="button"
                onClick={() => openProModal('Nâng cấp Gói PRO để xuất hiện trên Bảng Vinh Danh', 'pro')}
                className="px-4 py-2.5 rounded-xl bg-[#FF758F] hover:bg-[#ff5d7b] text-white text-sm font-bold shadow-xs transition-transform active:scale-95 cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-4 h-4" />
                <span>Nâng cấp PRO 5.000đ</span>
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => openProModal('Ủng hộ cà phê tác giả Cytools', 'donate')}
                className="px-4 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:border-pink-500/40 text-slate-700 dark:text-slate-200 text-sm font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Coffee className="w-4 h-4 text-amber-500" />
                <span>Mời Cà Phê</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: Sticky Donation Tree Sidebar */}
      <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-6 order-1 lg:order-2">
        <DonationTree totalDonationAmount={totalDonationAmount} />
      </div>
    </div>
  );
};

export default HallOfFame;
