/* oxlint-disable react/only-export-components */
import React, { createContext, useState, useEffect, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { resolveApiUrl } from '../utils/apiConfig';

interface ProContextType {
  isPro: boolean;
  isPendingPro: boolean;
  isModalOpen: boolean;
  modalReason: string;
  modalInitialTab: 'pro' | 'donate' | 'hallOfFame';
  proSince: string | null;
  licenseKey: string | null;
  proDonorName: string | null;
  openProModal: (reason?: string, initialTab?: 'pro' | 'donate' | 'hallOfFame') => void;
  closeProModal: () => void;
  activatePro: (licenseKey?: string, donorName?: string) => void;
  markProAsPending: () => void;
  resetPro: () => void;
  verifyAndActivateKey: (key: string) => Promise<{ success: boolean; donorName?: string; error?: string }>;
}

const STORAGE_KEY = 'cytools_pro_status_v1';
const LEGACY_STORAGE_KEY = 'omnihub_pro_status_v1';
const PENDING_STORAGE_KEY = 'cytools_pro_pending_v1';
const LICENSE_STORAGE_KEY = 'cytools_pro_license_key_v1';

export const ProContext = createContext<ProContextType | undefined>(undefined);

export const ProProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isPro, setIsPro] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return Boolean(parsed.isPro);
      }
    } catch {
      // fallback to false
    }
    return false;
  });

  const [isPendingPro, setIsPendingPro] = useState<boolean>(() => {
    try {
      const pendingRaw = localStorage.getItem('isPendingPro') || localStorage.getItem(PENDING_STORAGE_KEY);
      if (pendingRaw === 'true') return true;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return Boolean(parsed.isPendingPro);
      }
    } catch {
      // fallback
    }
    return false;
  });

  const [proSince, setProSince] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.proSince || null;
      }
    } catch {
      // fallback
    }
    return null;
  });

  const [licenseKey, setLicenseKey] = useState<string | null>(() => {
    try {
      const direct = localStorage.getItem(LICENSE_STORAGE_KEY);
      if (direct) return direct;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.licenseKey || null;
      }
    } catch {
      // fallback
    }
    return null;
  });

  const [proDonorName, setProDonorName] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.donorName || null;
      }
    } catch {
      // fallback
    }
    return null;
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalReason, setModalReason] = useState('Mở khóa tính năng Pro');
  const [modalInitialTab, setModalInitialTab] = useState<'pro' | 'donate' | 'hallOfFame'>('pro');

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ isPro, isPendingPro, proSince, licenseKey, donorName: proDonorName })
      );
      if (licenseKey) {
        localStorage.setItem(LICENSE_STORAGE_KEY, licenseKey);
      } else {
        localStorage.removeItem(LICENSE_STORAGE_KEY);
      }
      if (isPendingPro) {
        localStorage.setItem('isPendingPro', 'true');
        localStorage.setItem(PENDING_STORAGE_KEY, 'true');
      } else {
        localStorage.removeItem('isPendingPro');
        localStorage.removeItem(PENDING_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Unable to persist pro state to localStorage', e);
    }
  }, [isPro, isPendingPro, proSince, licenseKey, proDonorName]);

  const openProModal = (
    reason = 'Mở khóa tính năng Pro & Xử lý hàng loạt',
    initialTab: 'pro' | 'donate' | 'hallOfFame' = 'pro'
  ) => {
    setModalReason(reason);
    setModalInitialTab(initialTab);
    setIsModalOpen(true);
  };

  const closeProModal = () => {
    setIsModalOpen(false);
  };

  const markProAsPending = () => {
    setIsPendingPro(true);
    try {
      localStorage.setItem('isPendingPro', 'true');
      localStorage.setItem(PENDING_STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
  };

  const triggerConfettiCelebration = () => {
    try {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#FF758F', '#ff5d7b', '#10b981', '#3b82f6', '#f59e0b', '#ffffff'],
      });
    } catch {
      // confetti fallback
    }
  };

  const activatePro = useCallback(
    (activeLicenseKey?: string, donorName?: string) => {
      const timestamp = new Date().toISOString();
      const finalKey = activeLicenseKey || licenseKey || 'CYPRO_ACTIVE';
      const finalName = donorName || proDonorName || '';

      setIsPro(true);
      setIsPendingPro(false);
      setProSince(timestamp);
      setLicenseKey(finalKey);
      if (finalName) {
        setProDonorName(finalName);
      }

      try {
        localStorage.removeItem('isPendingPro');
        localStorage.removeItem(PENDING_STORAGE_KEY);
        localStorage.setItem(LICENSE_STORAGE_KEY, finalKey);
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            isPro: true,
            isPendingPro: false,
            proSince: timestamp,
            licenseKey: finalKey,
            donorName: finalName,
          })
        );
      } catch {
        // ignore storage failure
      }

      triggerConfettiCelebration();
    },
    [licenseKey, proDonorName]
  );

  const resetPro = () => {
    setIsPro(false);
    setIsPendingPro(false);
    setProSince(null);
    setLicenseKey(null);
    setProDonorName(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LICENSE_STORAGE_KEY);
      localStorage.removeItem('isPendingPro');
      localStorage.removeItem(PENDING_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const verifyAndActivateKey = useCallback(
    async (keyToVerify: string): Promise<{ success: boolean; donorName?: string; error?: string }> => {
      if (!keyToVerify || !keyToVerify.trim()) {
        return { success: false, error: 'Vui lòng nhập Mã Kích Hoạt PRO' };
      }

      try {
        const url = resolveApiUrl('/api/payment/verify-key');
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ key: keyToVerify.trim() }),
        });

        const data = await res.json();
        if (!res.ok || !data.valid) {
          return {
            success: false,
            error: data.error || 'Mã kích hoạt không hợp lệ hoặc chưa được kích hoạt trên hệ thống.',
          };
        }

        // Activate PRO with verified key
        activatePro(data.key, data.donorName);
        return { success: true, donorName: data.donorName };
      } catch (err) {
        console.error('Lỗi khi xác thực mã kích hoạt:', err);
        return {
          success: false,
          error: 'Không thể kết nối đến máy chủ xác thực. Vui lòng kiểm tra kết nối mạng.',
        };
      }
    },
    [activatePro]
  );

  return (
    <ProContext.Provider
      value={{
        isPro,
        isPendingPro,
        isModalOpen,
        modalReason,
        modalInitialTab,
        proSince,
        licenseKey,
        proDonorName,
        openProModal,
        closeProModal,
        activatePro,
        markProAsPending,
        resetPro,
        verifyAndActivateKey,
      }}
    >
      {children}
    </ProContext.Provider>
  );
};

export { usePro } from './usePro';
