import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Zap,
  ShieldCheck,
  Loader2,
  Copy,
  Check,
  Sparkles,
  Layers,
  ImageOff,
  CheckCircle2,
  Heart,
  Mail,
  MessageSquare,
  ExternalLink,
  Coffee,
  Trophy,
  Key,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { usePro } from '../../context/ProContext';
import { HallOfFame } from '../community/HallOfFame';
import { resolveApiUrl } from '../../utils/apiConfig';

const BANK_NAME = 'VietinBank (Ngân hàng TMCP Công Thương)';
const ACCOUNT_NUMBER = '0862151811';
const ACCOUNT_NAME = 'NGUYEN DANG KHANH';
const AMOUNT_PRO = '5.000 đ';
const CONTACT_EMAIL = 'dangkhanh1811k@gmail.com';
const FEEDBACK_FORM_URL = 'https://forms.gle/AyhrJSUhaMrFgxcF7';

export const UpgradeModal: React.FC = () => {
  const {
    isModalOpen,
    modalReason,
    modalInitialTab,
    closeProModal,
    activatePro,
    licenseKey: contextLicenseKey,
    verifyAndActivateKey,
  } = usePro();

  const [userSelectedTab, setUserSelectedTab] = useState<'pro' | 'donate' | 'hallOfFame' | null>(null);
  const activeTab = userSelectedTab ?? modalInitialTab ?? 'pro';
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Dynamic Payment Session State
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'IDLE' | 'PENDING' | 'PAID' | 'ERROR'>('IDLE');
  const [donorNameInput, setDonorNameInput] = useState<string>('');
  const donorNameInputRef = useRef(donorNameInput);
  useEffect(() => {
    donorNameInputRef.current = donorNameInput;
  }, [donorNameInput]);

  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');

  const checkTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const clearMsgTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
      if (clearMsgTimeoutRef.current) clearTimeout(clearMsgTimeoutRef.current);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  // Restore License Key State
  const [restoreKeyInput, setRestoreKeyInput] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [isVerifyingRestore, setIsVerifyingRestore] = useState(false);
  const [showRestoreBox, setShowRestoreBox] = useState(false);

  // Hall of Fame refresh trigger
  const [hofRefreshTrigger, setHofRefreshTrigger] = useState(0);

  const handleClose = useCallback(() => {
    if (isChecking || isVerifyingRestore) return;
    setCopiedField(null);
    setUserSelectedTab(null);
    setShowRestoreBox(false);
    setRestoreError(null);
    setRestoreSuccess(false);
    setCheckMessage('');
    if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
    if (clearMsgTimeoutRef.current) clearTimeout(clearMsgTimeoutRef.current);
    closeProModal();
  }, [isChecking, isVerifyingRestore, closeProModal]);

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen && !isChecking && !isVerifyingRestore) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, isChecking, isVerifyingRestore, handleClose]);

  // Create payment session on modal open or tab change
  useEffect(() => {
    if (!isModalOpen || activeTab === 'hallOfFame') return;

    let isMounted = true;
    const createPaymentSession = async () => {
      setIsCreatingSession(true);
      setSessionStatus('IDLE');
      try {
        const url = resolveApiUrl('/api/payment/create-session');
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: activeTab === 'donate' ? 'DONOR' : 'PRO',
            donorName: donorNameInputRef.current.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (isMounted && data.success) {
          setSessionCode(data.code);
          setQrUrl(data.qrUrl);
          setSessionStatus('PENDING');
        }
      } catch (err) {
        console.error('Lỗi khi khởi tạo phiên thanh toán:', err);
        if (isMounted) setSessionStatus('ERROR');
      } finally {
        if (isMounted) setIsCreatingSession(false);
      }
    };

    createPaymentSession();

    return () => {
      isMounted = false;
    };
  }, [isModalOpen, activeTab]);

  // Real-time polling for payment status every 3 seconds
  useEffect(() => {
    if (!isModalOpen || !sessionCode || sessionStatus !== 'PENDING') return;

    const interval = setInterval(async () => {
      try {
        const url = resolveApiUrl(`/api/payment/status/${sessionCode}`);
        const res = await fetch(url);
        const data = await res.json();
        if (data.success && data.status === 'PAID') {
          setSessionStatus('PAID');
          activatePro(data.licenseKey || sessionCode, data.donorName);
          setHofRefreshTrigger((prev) => prev + 1);
        }
      } catch (err) {
        console.warn('Lỗi polling trạng thái thanh toán:', err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isModalOpen, sessionCode, sessionStatus, activatePro]);

  // Update donor name on blur
  const handleDonorNameBlur = async () => {
    if (!sessionCode || !donorNameInput.trim()) return;
    try {
      const url = resolveApiUrl('/api/payment/update-name');
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: sessionCode,
          donorName: donorNameInput.trim(),
        }),
      });
    } catch (err) {
      console.warn('Lỗi cập nhật tên người ủng hộ:', err);
    }
  };

  // Manual payment status check button
  const handleManualCheck = async () => {
    if (!sessionCode || isChecking || sessionStatus === 'PAID') return;

    setIsChecking(true);
    setCheckMessage('');
    if (clearMsgTimeoutRef.current) clearTimeout(clearMsgTimeoutRef.current);

    const startTime = Date.now();
    let isPaid = false;
    let paidData: { licenseKey?: string; donorName?: string } = {};

    try {
      const url = resolveApiUrl(`/api/payment/status/${sessionCode}`);
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.status === 'PAID') {
        isPaid = true;
        paidData = {
          licenseKey: data.licenseKey || sessionCode,
          donorName: data.donorName,
        };
      }
    } catch (err) {
      console.warn('Lỗi kiểm tra thanh toán thủ công:', err);
    }

    const elapsed = Date.now() - startTime;
    const remainingTime = Math.max(0, 5000 - elapsed);

    checkTimeoutRef.current = setTimeout(() => {
      setIsChecking(false);
      if (isPaid) {
        setSessionStatus('PAID');
        activatePro(paidData.licenseKey || sessionCode, paidData.donorName);
        setHofRefreshTrigger((prev) => prev + 1);
      } else {
        setCheckMessage('Chưa nhận được thanh toán. Vui lòng chờ thêm hoặc thử lại!');
        clearMsgTimeoutRef.current = setTimeout(() => {
          setCheckMessage('');
        }, 3000);
      }
    }, remainingTime);
  };

  // Restore PRO with License Key
  const handleRestoreKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restoreKeyInput.trim() || isVerifyingRestore) return;

    setIsVerifyingRestore(true);
    setRestoreError(null);
    setRestoreSuccess(false);

    const result = await verifyAndActivateKey(restoreKeyInput.trim());
    setIsVerifyingRestore(false);

    if (result.success) {
      setRestoreSuccess(true);
      setRestoreKeyInput('');
      setSessionStatus('PAID');
      setHofRefreshTrigger((prev) => prev + 1);
    } else {
      setRestoreError(result.error || 'Mã bản quyền không hợp lệ');
    }
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      // Fallback for non-secure contexts / extension / iframe restrictions
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (fallbackErr) {
        console.error('Không thể sao chép văn bản:', fallbackErr);
        return;
      }
    }

    setCopiedField(field);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => {
      setCopiedField(null);
    }, 2000);
  };

  const currentTransferContent = sessionCode || 'SEVQR';
  const effectiveQrUrl =
    qrUrl ||
    (activeTab === 'pro'
      ? `https://img.vietqr.io/image/ICB-0862151811-compact2.png?amount=5000&addInfo=${currentTransferContent}&accountName=NGUYEN%20DANG%20KHANH`
      : `https://img.vietqr.io/image/ICB-0862151811-compact2.png?addInfo=${currentTransferContent}&accountName=NGUYEN%20DANG%20KHANH`);

  return (
    <AnimatePresence>
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Cửa sổ thanh toán và nâng cấp gói PRO"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-lg shadow-black/20 overflow-hidden flex flex-col max-h-[92vh]"
          >
            {/* Top Navigation & Tabs Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-4 bg-slate-50/70 dark:bg-zinc-950/40 shrink-0">
              {/* Dual Tabs: PRO vs Donate vs Hall of Fame */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-200/70 dark:bg-zinc-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setUserSelectedTab('pro')}
                  className={`relative px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                    activeTab === 'pro'
                      ? 'text-pink-600 dark:text-pink-400'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {activeTab === 'pro' && (
                    <motion.div
                      layoutId="upgradeModalActiveTab"
                      className="absolute inset-0 bg-white dark:bg-zinc-900 rounded-lg shadow-xs z-0"
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    <span>Gói PRO 5.000đ</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setUserSelectedTab('donate')}
                  className={`relative px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                    activeTab === 'donate'
                      ? 'text-pink-600 dark:text-pink-400'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {activeTab === 'donate' && (
                    <motion.div
                      layoutId="upgradeModalActiveTab"
                      className="absolute inset-0 bg-white dark:bg-zinc-900 rounded-lg shadow-xs z-0"
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    <Heart className="w-4 h-4 fill-pink-500 text-pink-500" />
                    <span>Ủng hộ Dev & Liên hệ</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setUserSelectedTab('hallOfFame')}
                  className={`relative px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                    activeTab === 'hallOfFame'
                      ? 'text-pink-600 dark:text-pink-400'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {activeTab === 'hallOfFame' && (
                    <motion.div
                      layoutId="upgradeModalActiveTab"
                      className="absolute inset-0 bg-white dark:bg-zinc-900 rounded-lg shadow-xs z-0"
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    <span>Vinh danh Donors</span>
                  </span>
                </button>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={handleClose}
                disabled={isChecking || isVerifyingRestore}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-40"
                title="Đóng modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body Container */}
            <div className="overflow-y-auto p-6 md:p-8 flex-1 custom-scrollbar">
              <AnimatePresence mode="wait">
                {activeTab === 'pro' && (
                  /* ================= TAB 1: PRO UPGRADE (5.000đ) ================= */
                  <motion.div
                    key="tab-pro"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="grid grid-cols-1 md:grid-cols-12 gap-8"
                  >
                    {/* LEFT COLUMN: VALUE PROPOSITION & NAME INPUT */}
                    <div className="md:col-span-7 space-y-5 flex flex-col justify-between">
                      <div className="space-y-4">
                        {/* Headline */}
                        <div className="space-y-2">
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20 text-sm font-semibold">
                            <Sparkles className="w-4 h-4" />
                            <span>CYTOOLS PRO LIFETIME</span>
                          </div>

                          <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-snug">
                            Nâng Cấp Gói PRO Vĩnh Viễn
                          </h2>

                          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                            {modalReason || 'Mở khóa toàn bộ sức mạnh xử lý media và đồ họa cao cấp.'}{' '}
                            Sở hữu trọn đời chỉ với <strong className="text-pink-600 dark:text-pink-400">5.000đ</strong> một lần duy nhất, không gia hạn định kỳ.
                          </p>
                        </div>

                        {/* Optional Donor Display Name Input */}
                        <div className="p-3.5 rounded-xl bg-slate-100/70 dark:bg-zinc-800/40 border border-slate-200/80 dark:border-zinc-800 space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                            <span>Tên hiển thị trên Bảng Vinh Danh (Tùy chọn)</span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">Tự động cập nhật</span>
                          </label>
                          <input
                            type="text"
                            value={donorNameInput}
                            onChange={(e) => setDonorNameInput(e.target.value)}
                            onBlur={handleDonorNameBlur}
                            placeholder="Nhập tên của bạn (ví dụ: Nguyễn Văn A)..."
                            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-500"
                          />
                        </div>

                        {/* Feature Highlights */}
                        <div className="space-y-2.5 pt-1">
                          <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-slate-100/70 dark:bg-zinc-800/40">
                            <div className="w-9 h-9 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-500 shrink-0 mt-0.5">
                              <Zap className="w-4.5 h-4.5" />
                            </div>
                            <div className="space-y-0.5">
                              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                Tải hàng loạt tốc độ cao
                              </h3>
                              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                                Dán tối đa 10 link cùng lúc từ TikTok, YouTube, Reels, Pinterest và trích xuất album ảnh không watermark.
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-slate-100/70 dark:bg-zinc-800/40">
                            <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-500 shrink-0 mt-0.5">
                              <ImageOff className="w-4.5 h-4.5" />
                            </div>
                            <div className="space-y-0.5">
                              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                Xóa nền AI ưu tiên
                              </h3>
                              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                                Xóa nền batch nhiều ảnh song song, xử lý ưu tiên với mô hình BiRefNet Cloud và ONNX cục bộ.
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-slate-100/70 dark:bg-zinc-800/40">
                            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0 mt-0.5">
                              <Layers className="w-4.5 h-4.5" />
                            </div>
                            <div className="space-y-0.5">
                              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                Không giới hạn dung lượng PDF & Media
                              </h3>
                              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                                Ghép, chia nhỏ file PDF lớn không giới hạn trang và xuất video GIF dài 30 giây chuẩn HD 15 FPS.
                              </p>
                            </div>
                          </div>

                          <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-slate-100/70 dark:bg-zinc-800/40">
                            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0 mt-0.5">
                              <ShieldCheck className="w-4.5 h-4.5" />
                            </div>
                            <div className="space-y-0.5">
                              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                Bảo mật Client-Side Sandbox 100%
                              </h3>
                              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                                Dữ liệu tệp không bao giờ lưu trữ trên máy chủ bên thứ ba, bảo mật tuyệt đối quyền riêng tư.
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* License Key Restore Toggle */}
                        <div className="pt-2 border-t border-slate-200 dark:border-zinc-800 space-y-2">
                          <button
                            type="button"
                            onClick={() => setShowRestoreBox(!showRestoreBox)}
                            className="text-xs font-semibold text-slate-500 hover:text-pink-600 dark:text-slate-400 dark:hover:text-pink-400 flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Key className="w-3.5 h-3.5 text-pink-500" />
                            <span>Đã có Mã Kích Hoạt PRO? Nhập tại đây để khôi phục</span>
                          </button>

                          {showRestoreBox && (
                            <form onSubmit={handleRestoreKey} className="flex flex-col sm:flex-row gap-2 pt-1">
                              <input
                                type="text"
                                value={restoreKeyInput}
                                onChange={(e) => setRestoreKeyInput(e.target.value)}
                                placeholder="Nhập mã (ví dụ: SEVQR8492K, CYPRO01)..."
                                className="flex-1 px-3 py-2 text-sm font-mono uppercase rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-500"
                              />
                              <button
                                type="submit"
                                disabled={isVerifyingRestore || !restoreKeyInput.trim()}
                                className="px-4 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shrink-0 cursor-pointer"
                              >
                                {isVerifyingRestore ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    <span>Đang kiểm tra...</span>
                                  </>
                                ) : (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Kích hoạt</span>
                                  </>
                                )}
                              </button>
                            </form>
                          )}

                          {restoreError && (
                            <p className="text-xs text-rose-500 flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>{restoreError}</span>
                            </p>
                          )}
                          {restoreSuccess && (
                            <p className="text-xs text-emerald-500 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Khôi phục bản quyền PRO thành công!</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* RIGHT COLUMN: PRO PAYMENT AREA OR CELEBRATION */}
                    <div className="md:col-span-5 flex flex-col justify-between space-y-4 bg-slate-100/60 dark:bg-zinc-800/30 p-5 rounded-2xl">
                      {sessionStatus === 'PAID' ? (
                        /* ================= CELEBRATION SCREEN ================= */
                        <div className="space-y-5 text-center my-auto py-4">
                          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto shadow-sm">
                            <CheckCircle2 className="w-9 h-9" />
                          </div>

                          <div className="space-y-1.5">
                            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-mono font-bold uppercase">
                              Đã Xác Nhận Thanh Toán
                            </span>
                            <h3 className="text-lg font-black text-slate-900 dark:text-white">
                              Kích Hoạt PRO Thành Công!
                            </h3>
                            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                              Cảm ơn bạn đã đồng hành và ủng hộ tác giả. Gói PRO của bạn đã được kích hoạt vĩnh viễn trên trình duyệt này!
                            </p>
                          </div>

                          {/* Lifetime License Key Box */}
                          <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-2 text-left">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider block">
                              Mã Kích Hoạt Bản Quyền (License Key)
                            </span>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-base font-black text-pink-600 dark:text-pink-400 tracking-wider">
                                {sessionCode || contextLicenseKey || 'CYPRO_ACTIVE'}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopy(sessionCode || contextLicenseKey || '', 'license-key')}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                                  copiedField === 'license-key'
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-xs'
                                    : 'bg-pink-500/10 hover:bg-pink-500/20 text-pink-600 dark:text-pink-400 border-pink-500/20'
                                }`}
                                title="Sao chép mã kích hoạt"
                              >
                                {copiedField === 'license-key' ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                                    <span>Đã chép</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Sao chép</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                              Lưu lại mã này để khôi phục PRO bất kỳ lúc nào trên máy tính khác hoặc Chrome Extension.
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => setUserSelectedTab('hallOfFame')}
                            className="w-full py-2.5 px-4 rounded-xl bg-[#FF758F] hover:bg-[#ff5d7b] text-white font-bold text-sm transition-all cursor-pointer shadow-xs"
                          >
                            Xem Tên Trên Bảng Vinh Danh 🏆
                          </button>
                        </div>
                      ) : (
                        /* ================= QR PAYMENT FLOW ================= */
                        <div className="space-y-3">
                          <div className="text-center space-y-1">
                            <span className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                              Thanh toán qua VietQR
                            </span>
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                              Số tiền:{' '}
                              <strong className="text-pink-600 dark:text-pink-400 font-mono text-base font-bold">
                                {AMOUNT_PRO}
                              </strong>
                            </p>
                          </div>

                          {/* Dynamic VietQR Code Image */}
                          <div className="flex items-center justify-center p-3 rounded-2xl bg-white shadow-xs relative min-h-[200px]">
                            {isCreatingSession ? (
                              <div className="flex flex-col items-center justify-center gap-2 text-slate-400 py-8">
                                <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                                <span className="text-xs font-medium">Đang tạo mã VietQR...</span>
                              </div>
                            ) : (
                              <img
                                src={effectiveQrUrl}
                                alt="VietQR Cytools Pro Upgrade"
                                className="mx-auto max-w-[200px] w-full h-auto object-contain select-none"
                                loading="eager"
                              />
                            )}
                          </div>

                          {/* Critical Payment Warning Note (Repositioned to Top for Zero Scrolling) */}
                          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 dark:bg-amber-500/10 border border-amber-500/25 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs leading-relaxed shadow-xs">
                            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <p>
                              <strong className="font-bold text-amber-900 dark:text-amber-100">Chú ý: </strong>
                              KHÔNG đóng cửa sổ này trong khi chuyển khoản. Nội dung chuyển khoản sẽ bị thay đổi nếu bạn mở lại, vui lòng giữ nguyên màn hình để hệ thống tự động xác nhận!
                            </p>
                          </div>

                          {/* Status Listener Banner */}
                          <div className="flex items-center justify-center gap-2 p-2 rounded-xl bg-pink-500/10 border border-pink-500/20 text-xs font-semibold text-pink-600 dark:text-pink-400">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
                            </span>
                            <span>Đang lắng nghe thanh toán tự động (3s)...</span>
                          </div>

                          {/* Bank Details Card */}
                          <div className="space-y-2 pt-1 text-sm">
                            <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 shadow-xs space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-slate-500 dark:text-slate-400 font-medium">Ngân hàng:</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{BANK_NAME}</span>
                              </div>

                              <div className="flex items-center justify-between">
                                <span className="text-slate-500 dark:text-slate-400 font-medium">Số tài khoản:</span>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-base text-pink-600 dark:text-pink-400">
                                    {ACCOUNT_NUMBER}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(ACCOUNT_NUMBER, 'acc')}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                                      copiedField === 'acc'
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-xs'
                                        : 'bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-slate-300'
                                    }`}
                                    title="Sao chép số tài khoản"
                                  >
                                    {copiedField === 'acc' ? (
                                      <>
                                        <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                                        <span>Đã chép</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3.5 h-3.5" />
                                        <span>Sao chép</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>

                              <div className="flex items-center justify-between">
                                <span className="text-slate-500 dark:text-slate-400 font-medium">Chủ tài khoản:</span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200 uppercase text-sm">
                                  {ACCOUNT_NAME}
                                </span>
                              </div>

                              <div className="flex items-center justify-between">
                                <span className="text-slate-500 dark:text-slate-400 font-medium">Nội dung CK:</span>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm bg-pink-500/10 px-2 py-0.5 rounded border border-pink-500/20 text-pink-600 dark:text-pink-400">
                                    {currentTransferContent}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(currentTransferContent, 'content')}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                                      copiedField === 'content'
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-xs'
                                        : 'bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-slate-300'
                                    }`}
                                    title="Sao chép nội dung chuyển khoản"
                                  >
                                    {copiedField === 'content' ? (
                                      <>
                                        <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                                        <span>Đã chép</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3.5 h-3.5" />
                                        <span>Sao chép</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Manual Check Button & Fallback Message */}
                          <div className="space-y-2 pt-1">
                            <button
                              type="button"
                              data-testid="manual-check-btn"
                              onClick={handleManualCheck}
                              disabled={isChecking}
                              className="w-full py-2.5 px-4 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 disabled:opacity-60 text-slate-800 dark:text-slate-200 font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed shadow-xs active:scale-[0.99]"
                            >
                              {isChecking ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-pink-500" />
                                  <span>Đang kiểm tra...</span>
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  <span>Kiểm tra giao dịch ngay</span>
                                </>
                              )}
                            </button>

                            {/* Fallback Warning Message with Smooth Animation */}
                            <AnimatePresence>
                              {checkMessage && (
                                <motion.div
                                  initial={{ opacity: 0, y: -4, height: 0 }}
                                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                                  exit={{ opacity: 0, y: -4, height: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 dark:text-rose-400 text-xs text-center font-medium flex items-center justify-center gap-1.5"
                                >
                                  <AlertCircle className="w-4 h-4 shrink-0" />
                                  <span>{checkMessage}</span>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {activeTab === 'donate' && (
                  /* ================= TAB 2: DONATE & DEVELOPER INFO ================= */
                  <motion.div
                    key="tab-donate"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="grid grid-cols-1 md:grid-cols-12 gap-8"
                  >
                    {/* LEFT COLUMN: DEVELOPER PROFILE & STORY */}
                    <div className="md:col-span-7 space-y-5 flex flex-col justify-between">
                      <div className="space-y-4">
                        {/* Creator Badge & Heading */}
                        <div className="space-y-2">
                          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20 text-sm font-semibold">
                            <Coffee className="w-4 h-4" />
                            <span>Nguyen Dang Khanh • CREATOR</span>
                          </div>

                          <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-snug">
                            Ủng Hộ & Kết Nối Tác Giả
                          </h2>

                          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                            Phát triển bởi <strong>Nguyen Dang Khanh</strong>. Cảm ơn bạn đã sử dụng và ủng hộ Cytools!
                          </p>
                        </div>

                        {/* Optional Donor Display Name Input */}
                        <div className="p-3.5 rounded-xl bg-slate-100/70 dark:bg-zinc-800/40 border border-slate-200/80 dark:border-zinc-800 space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                            <span>Tên hiển thị trên Bảng Vinh Danh (Tùy chọn)</span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">Tự động cập nhật</span>
                          </label>
                          <input
                            type="text"
                            value={donorNameInput}
                            onChange={(e) => setDonorNameInput(e.target.value)}
                            onBlur={handleDonorNameBlur}
                            placeholder="Nhập tên của bạn hoặc để trống (ẩn danh)..."
                            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-500"
                          />
                        </div>

                        {/* Developer Story Card */}
                        <div className="p-4 rounded-2xl bg-slate-100/70 dark:bg-zinc-800/40 space-y-3">
                          <div className="flex items-center gap-3.5">
                            <img
                              src="/realtuhzu on TikTok.jpg"
                              alt="Nguyen Dang Khanh"
                              className="w-12 h-12 rounded-xl object-cover shadow-xs"
                            />
                            <div>
                              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                                Nguyen Dang Khanh
                              </h3>
                              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                                Software Engineer & Product Creator
                              </p>
                            </div>
                          </div>

                          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                            Cytools được phát triển với sứ mệnh mang đến bộ tiện ích media & đồ họa hoàn toàn miễn phí, tốc độ cao và 100% bảo mật trong trình duyệt (Client-Side Sandbox). Mọi đóng góp của bạn là nguồn động lực to lớn giúp duy trì máy chủ và phát triển thêm nhiều công cụ mới.
                          </p>
                        </div>

                        {/* Contact & Social Links */}
                        <div className="space-y-2">
                          <span className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                            Kênh kết nối & Đóng góp ý kiến
                          </span>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Email */}
                            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100/70 dark:bg-zinc-800/40 text-sm">
                              <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                                <Mail className="w-4 h-4 text-pink-500 shrink-0" />
                                <span className="font-mono text-sm truncate max-w-[150px]">{CONTACT_EMAIL}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleCopy(CONTACT_EMAIL, 'email')}
                                className="p-1.5 rounded hover:bg-slate-200/60 dark:hover:bg-zinc-700 text-slate-500 dark:text-slate-400 cursor-pointer"
                                title="Sao chép Email"
                              >
                                {copiedField === 'email' ? (
                                  <Check className="w-4 h-4 text-emerald-500" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                            </div>

                            {/* Feedback Form */}
                            <a
                              href={FEEDBACK_FORM_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between p-3 rounded-xl bg-slate-100/70 dark:bg-zinc-800/40 text-sm text-slate-700 dark:text-slate-200 hover:text-pink-600 dark:hover:text-pink-400 transition-colors group cursor-pointer"
                              title="Gửi báo lỗi hoặc đề xuất tính năng mới"
                            >
                              <div className="flex items-center gap-2.5">
                                <MessageSquare className="w-4 h-4 text-slate-700 dark:text-slate-200 group-hover:text-pink-500 transition-colors" />
                                <span className="font-semibold text-sm">Báo lỗi / Góp ý</span>
                              </div>
                              <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-pink-500 transition-colors" />
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* RIGHT COLUMN: DONATE VIETQR */}
                    <div className="md:col-span-5 flex flex-col justify-between space-y-4 bg-slate-100/60 dark:bg-zinc-800/30 p-5 rounded-2xl">
                      <div className="space-y-3">
                        <div className="text-center space-y-1">
                          <span className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1.5">
                            <Coffee className="w-4 h-4 text-pink-500" />
                            <span>Mời Cà Phê Tác Giả</span>
                          </span>
                          <p className="text-sm font-semibold text-pink-600 dark:text-pink-400">
                            Tùy tâm đóng góp • Số tiền tự chọn
                          </p>
                        </div>

                        {/* VietQR Code Image */}
                        <div className="flex items-center justify-center p-3 rounded-2xl bg-white shadow-xs min-h-[200px]">
                          {isCreatingSession ? (
                            <div className="flex flex-col items-center justify-center gap-2 text-slate-400 py-8">
                              <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                              <span className="text-xs font-medium">Đang tạo mã VietQR...</span>
                            </div>
                          ) : (
                            <img
                              src={effectiveQrUrl}
                              alt="VietQR Donate Cytools Nguyen Dang Khanh"
                              className="mx-auto max-w-[200px] w-full h-auto object-contain select-none"
                              loading="eager"
                            />
                          )}
                        </div>

                        {/* Critical Payment Warning Note (Repositioned to Top for Zero Scrolling) */}
                        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 dark:bg-amber-500/10 border border-amber-500/25 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs leading-relaxed shadow-xs">
                          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <p>
                            <strong className="font-bold text-amber-900 dark:text-amber-100">Chú ý: </strong>
                            KHÔNG đóng cửa sổ này trong khi chuyển khoản. Nội dung chuyển khoản sẽ bị thay đổi nếu bạn mở lại, vui lòng giữ nguyên màn hình để hệ thống tự động xác nhận!
                          </p>
                        </div>

                        {/* Helper Text */}
                        <p className="text-sm text-center text-slate-600 dark:text-slate-300 leading-relaxed px-1">
                          Quét mã QR qua ứng dụng ngân hàng. Bạn có thể nhập số tiền tùy ý và gửi kèm lời nhắn cho tác giả!
                        </p>

                        {/* Bank Details Card */}
                        <div className="space-y-2 pt-1 text-sm">
                          <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 shadow-xs space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-500 dark:text-slate-400 font-medium">Ngân hàng:</span>
                              <span className="font-semibold text-slate-800 dark:text-slate-200">{BANK_NAME}</span>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-slate-500 dark:text-slate-400 font-medium">Số tài khoản:</span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-base text-pink-600 dark:text-pink-400">
                                  {ACCOUNT_NUMBER}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(ACCOUNT_NUMBER, 'donate-acc')}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                                    copiedField === 'donate-acc'
                                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-xs'
                                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-slate-300'
                                  }`}
                                  title="Sao chép số tài khoản"
                                >
                                  {copiedField === 'donate-acc' ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                                      <span>Đã chép</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      <span>Sao chép</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-slate-500 dark:text-slate-400 font-medium">Chủ tài khoản:</span>
                              <span className="font-semibold text-slate-800 dark:text-slate-200 uppercase text-sm">
                                {ACCOUNT_NAME}
                              </span>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-slate-500 dark:text-slate-400 font-medium">Nội dung CK:</span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm bg-pink-500/10 px-2 py-0.5 rounded border border-pink-500/20 text-pink-600 dark:text-pink-400">
                                  {currentTransferContent}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(currentTransferContent, 'donate-content')}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                                    copiedField === 'donate-content'
                                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-xs'
                                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-slate-300'
                                  }`}
                                  title="Sao chép nội dung chuyển khoản"
                                >
                                  {copiedField === 'donate-content' ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                                      <span>Đã chép</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      <span>Sao chép</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Gratitude Footer Pill */}
                        <div className="p-3.5 rounded-xl bg-pink-500/10 text-pink-700 dark:text-pink-300 text-sm text-center font-medium">
                          ☕ Một cốc cà phê của bạn là nguồn năng lượng quý giá cho tác giả!
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'hallOfFame' && (
                  /* ================= TAB 3: HALL OF FAME ================= */
                  <motion.div
                    key="tab-hallOfFame"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="p-1"
                  >
                    <HallOfFame variant="compact" showCta={false} refreshTrigger={hofRefreshTrigger} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Modal Bottom Assurance Banner */}
            <div className="px-6 py-3.5 bg-slate-100/70 dark:bg-zinc-950 border-t border-slate-200 dark:border-zinc-800 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300 shrink-0">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-pink-500 dark:text-pink-400" />
                <span>Kích hoạt tự động & bảo lưu vĩnh viễn trên trình duyệt này</span>
              </div>
              <span className="font-semibold text-slate-700 dark:text-slate-200">NAPAS 247 Hỗ Trợ 24/7</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default UpgradeModal;
