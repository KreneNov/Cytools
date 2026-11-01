import React from 'react';
import cyreneAvatar from '../../assets/cyrene.jpg';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
}) => {
  const avatarSizes = {
    sm: 'w-8 h-8',
    md: 'w-9.5 h-9.5',
    lg: 'w-11 h-11',
  };

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Clean Circular Avatar without erratic shadows or unstable rings */}
      <div className="shrink-0">
        <img
          src={cyreneAvatar}
          alt="Cytools Avatar"
          className={`${avatarSizes[size]} rounded-full object-cover border border-pink-500/30`}
        />
      </div>

      {showText && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-lg tracking-tight font-sans">
              <span className="text-[#FF758F]">Cy</span>
              <span className="text-slate-900 dark:text-white">tools</span>
            </span>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tracking-tight font-medium">
            Tiện Ích Trình Duyệt Đa Năng
          </span>
        </div>
      )}
    </div>
  );
};
