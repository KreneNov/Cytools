import React from 'react';
import { Palette, Check } from 'lucide-react';
import type { BackgroundPreset } from '../../types/removeBg';

interface BgPresetsBarProps {
  selectedPreset: BackgroundPreset;
  customColor: string;
  onSelectPreset: (preset: BackgroundPreset) => void;
  onChangeCustomColor: (color: string) => void;
}

export const BgPresetsBar: React.FC<BgPresetsBarProps> = ({
  selectedPreset,
  customColor,
  onSelectPreset,
  onChangeCustomColor,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-zinc-900/70 border border-zinc-800">
      <span className="text-xs font-semibold text-zinc-400 mr-1 flex items-center gap-1.5">
        <Palette className="w-3.5 h-3.5 text-sky-400" />
        Chọn phông nền:
      </span>

      {/* Preset: Trong suốt */}
      <button
        onClick={() => onSelectPreset('transparent')}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          selectedPreset === 'transparent'
            ? 'bg-sky-500/10 border-sky-500/50 text-sky-300'
            : 'bg-zinc-800/80 border-zinc-700/60 text-zinc-300 hover:bg-zinc-800'
        }`}
      >
        <div className="w-4 h-4 rounded bg-checkerboard border border-zinc-600 shrink-0" />
        <span>Trong suốt (PNG gốc)</span>
        {selectedPreset === 'transparent' && <Check className="w-3 h-3 text-sky-400 ml-0.5" />}
      </button>

      {/* Preset: Trắng tinh khôi */}
      <button
        onClick={() => onSelectPreset('white')}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          selectedPreset === 'white'
            ? 'bg-sky-500/10 border-sky-500/50 text-sky-300'
            : 'bg-zinc-800/80 border-zinc-700/60 text-zinc-300 hover:bg-zinc-800'
        }`}
      >
        <div className="w-4 h-4 rounded bg-white border border-zinc-300 shrink-0" />
        <span>Trắng TMĐT</span>
        {selectedPreset === 'white' && <Check className="w-3 h-3 text-sky-400 ml-0.5" />}
      </button>

      {/* Preset: Nền Đỏ Ảnh Thẻ */}
      <button
        onClick={() => onSelectPreset('id_red')}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          selectedPreset === 'id_red'
            ? 'bg-sky-500/10 border-sky-500/50 text-sky-300'
            : 'bg-zinc-800/80 border-zinc-700/60 text-zinc-300 hover:bg-zinc-800'
        }`}
      >
        <div className="w-4 h-4 rounded bg-[#cc0000] border border-red-700 shrink-0" />
        <span>Ảnh thẻ Đỏ (#cc0000)</span>
        {selectedPreset === 'id_red' && <Check className="w-3 h-3 text-sky-400 ml-0.5" />}
      </button>

      {/* Preset: Nền Xanh Ảnh Thẻ */}
      <button
        onClick={() => onSelectPreset('id_blue')}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          selectedPreset === 'id_blue'
            ? 'bg-sky-500/10 border-sky-500/50 text-sky-300'
            : 'bg-zinc-800/80 border-zinc-700/60 text-zinc-300 hover:bg-zinc-800'
        }`}
      >
        <div className="w-4 h-4 rounded bg-[#0066cc] border border-blue-700 shrink-0" />
        <span>Ảnh thẻ Xanh (#0066cc)</span>
        {selectedPreset === 'id_blue' && <Check className="w-3 h-3 text-sky-400 ml-0.5" />}
      </button>

      {/* Preset: Tùy chỉnh màu */}
      <label
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-all ${
          selectedPreset === 'custom'
            ? 'bg-sky-500/10 border-sky-500/50 text-sky-300'
            : 'bg-zinc-800/80 border-zinc-700/60 text-zinc-300 hover:bg-zinc-800'
        }`}
      >
        <div
          className="w-4 h-4 rounded border border-zinc-500 shrink-0"
          style={{ backgroundColor: customColor }}
        />
        <span>Màu tùy chọn</span>
        <input
          type="color"
          value={customColor}
          onChange={(e) => {
            onChangeCustomColor(e.target.value);
            onSelectPreset('custom');
          }}
          className="w-0 h-0 opacity-0 absolute pointer-events-none"
        />
        {selectedPreset === 'custom' && <Check className="w-3 h-3 text-sky-400 ml-0.5" />}
      </label>
    </div>
  );
};
