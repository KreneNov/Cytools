import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  UploadCloud,
  Download,
  Image as ImageIcon,
  RotateCcw,
  Sliders,
  Check,
  ChevronDown,
  FileCheck,
  Sparkles,
  AlertCircle,
  X,
  Loader2,
  Smartphone,
} from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';

type TargetFormat = 'image/webp' | 'image/jpeg' | 'image/png' | 'image/bmp' | 'image/x-icon';

interface FormatOption {
  id: TargetFormat;
  label: string;
  ext: string;
  tag: string;
  desc: string;
  badgeStyle: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: 'image/webp',
    label: 'WebP (.webp)',
    ext: 'webp',
    tag: 'Khuyên dùng',
    desc: 'Dung lượng siêu nhẹ, tối ưu tải trang web',
    badgeStyle: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20',
  },
  {
    id: 'image/jpeg',
    label: 'JPG / JPEG (.jpg)',
    ext: 'jpg',
    tag: 'Phổ biến',
    desc: 'Tương thích mọi thiết bị, in ấn và chia sẻ',
    badgeStyle: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
  },
  {
    id: 'image/png',
    label: 'PNG (.png)',
    ext: 'png',
    tag: 'Chất lượng cao',
    desc: 'Không nén mất chi tiết, hỗ trợ nền trong suốt',
    badgeStyle: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
  },
  {
    id: 'image/bmp',
    label: 'Bitmap (.bmp)',
    ext: 'bmp',
    tag: 'Nguyên bản',
    desc: 'Đồ họa Windows 24-bit không nén DIB',
    badgeStyle: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700',
  },
  {
    id: 'image/x-icon',
    label: 'Icon (.ico)',
    ext: 'ico',
    tag: 'Favicon',
    desc: 'Biểu tượng cho Website Favicon và Windows',
    badgeStyle: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700',
  },
];

/**
 * Pure JS 24-bit BMP encoder from Canvas
 */
function canvasToBmpBlob(canvas: HTMLCanvasElement): Blob {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2d context for BMP');
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // 24-bit BMP with 4-byte row padding
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileLength = 54 + pixelArraySize;

  const buffer = new ArrayBuffer(fileLength);
  const view = new DataView(buffer);

  // Bitmap File Header (14 bytes)
  view.setUint16(0, 0x424d, false); // 'BM'
  view.setUint32(2, fileLength, true); // File size
  view.setUint16(6, 0, true); // Reserved
  view.setUint16(8, 0, true); // Reserved
  view.setUint32(10, 54, true); // Pixel array offset

  // DIB Header (BITMAPINFOHEADER - 40 bytes)
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // Positive for bottom-up
  view.setUint16(26, 1, true); // Planes
  view.setUint16(28, 24, true); // 24 bits
  view.setUint32(30, 0, true); // BI_RGB
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true); // 72 DPI
  view.setInt32(42, 2835, true);
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);

  // Pixel data (bottom-up BGR)
  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const pIndex = (y * width + x) * 4;
      view.setUint8(offset++, data[pIndex + 2]); // B
      view.setUint8(offset++, data[pIndex + 1]); // G
      view.setUint8(offset++, data[pIndex]);     // R
    }
    const padding = rowSize - width * 3;
    for (let p = 0; p < padding; p++) {
      view.setUint8(offset++, 0);
    }
  }

  return new Blob([buffer], { type: 'image/bmp' });
}

/**
 * Standard ICO encoder from Canvas (supports up to 256x256 embedded PNG)
 */
async function canvasToIcoBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  let icoCanvas = canvas;
  if (canvas.width > 256 || canvas.height > 256) {
    const factor = 256 / Math.max(canvas.width, canvas.height);
    const targetW = Math.max(1, Math.round(canvas.width * factor));
    const targetH = Math.max(1, Math.round(canvas.height * factor));
    icoCanvas = document.createElement('canvas');
    icoCanvas.width = targetW;
    icoCanvas.height = targetH;
    const ctx = icoCanvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(canvas, 0, 0, targetW, targetH);
    }
  }

  const pngBlob = await new Promise<Blob>((resolve) => {
    icoCanvas.toBlob((b) => resolve(b || new Blob()), 'image/png');
  });
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());

  const icoHeader = new ArrayBuffer(22);
  const view = new DataView(icoHeader);

  // ICONDIR
  view.setUint16(0, 0, true); // Reserved
  view.setUint16(2, 1, true); // Type (1 = Icon)
  view.setUint16(4, 1, true); // Count (1 image)

  // ICONDIRENTRY
  const w = icoCanvas.width >= 256 ? 0 : icoCanvas.width;
  const h = icoCanvas.height >= 256 ? 0 : icoCanvas.height;
  view.setUint8(6, w);
  view.setUint8(7, h);
  view.setUint8(8, 0); // Colors
  view.setUint8(9, 0); // Reserved
  view.setUint16(10, 1, true); // Color planes
  view.setUint16(12, 32, true); // Bits per pixel
  view.setUint32(14, pngBytes.length, true); // Size
  view.setUint32(18, 22, true); // Offset

  return new Blob([icoHeader, pngBytes], { type: 'image/x-icon' });
}

export const ImageConverterTab: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [targetFormat, setTargetFormat] = useState<TargetFormat>('image/webp');
  const [quality, setQuality] = useState<number>(85);
  const [scale, setScale] = useState<number>(1);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // HEIC decoding state
  const [isDecodingHeic, setIsDecodingHeic] = useState<boolean>(false);
  const [heicProgress, setHeicProgress] = useState<string>('');

  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null);
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null);
  const [originalDimensions, setOriginalDimensions] = useState<{ width: number; height: number } | null>(null);
  const [convertedDimensions, setConvertedDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Real-time dynamic dimensions calculation while slider is being dragged
  const dynamicDimensions = useMemo(() => {
    if (!originalDimensions) return null;
    return {
      width: Math.max(1, Math.round(originalDimensions.width * scale)),
      height: Math.max(1, Math.round(originalDimensions.height * scale)),
    };
  }, [originalDimensions, scale]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clean up object URLs on unmount or replace
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (convertedUrl) URL.revokeObjectURL(convertedUrl);
    };
  }, [previewUrl, convertedUrl]);

  const processSelectedFile = (selectedFile: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (convertedUrl) URL.revokeObjectURL(convertedUrl);

    const url = URL.createObjectURL(selectedFile);
    setFile(selectedFile);
    setPreviewUrl(url);
    setConvertedBlob(null);
    setConvertedUrl(null);
  };

  const handleSelectFile = async (selectedFile: File) => {
    setErrorMessage(null);

    const isHeic =
      selectedFile.name.toLowerCase().endsWith('.heic') ||
      selectedFile.name.toLowerCase().endsWith('.heif') ||
      selectedFile.type.includes('heic') ||
      selectedFile.type.includes('heif');

    if (isHeic) {
      setIsDecodingHeic(true);
      setHeicProgress('Đang giải mã ảnh Apple HEIC sang định dạng chuẩn...');
      try {
        const heic2anyModule = await import('heic2any');
        const heic2any = heic2anyModule.default || heic2anyModule;
        const res = await heic2any({
          blob: selectedFile,
          toType: 'image/jpeg',
          quality: 0.95,
        });

        const standardBlob = Array.isArray(res) ? res[0] : res;
        const regularFile = new File(
          [standardBlob],
          selectedFile.name.replace(/\.(heic|heif)$/i, '.jpg'),
          { type: 'image/jpeg' }
        );

        processSelectedFile(regularFile);
      } catch (err) {
        console.error('HEIC decoding failed:', err);
        setErrorMessage('Không thể giải mã file ảnh HEIC này. Vui lòng thử lại với file khác.');
      } finally {
        setIsDecodingHeic(false);
        setHeicProgress('');
      }
      return;
    }

    if (!selectedFile.type.startsWith('image/')) {
      setErrorMessage('Vui lòng chọn tệp tin hình ảnh hợp lệ (JPG, PNG, WebP, HEIC, BMP, v.v.).');
      return;
    }

    processSelectedFile(selectedFile);
  };

  /**
   * Render to canvas and convert 100% Client-side
   */
  const executeConversion = useCallback(async () => {
    if (!file) return;

    setIsConverting(true);
    setErrorMessage(null);

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = async () => {
      try {
        setOriginalDimensions({ width: img.naturalWidth, height: img.naturalHeight });

        const targetWidth = Math.max(1, Math.round(img.naturalWidth * scale));
        const targetHeight = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          setIsConverting(false);
          URL.revokeObjectURL(objectUrl);
          return;
        }

        // Fill background with white for JPEG and BMP to prevent black background
        if (targetFormat === 'image/jpeg' || targetFormat === 'image/bmp') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetWidth, targetHeight);
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        let finalBlob: Blob;

        if (targetFormat === 'image/bmp') {
          finalBlob = canvasToBmpBlob(canvas);
        } else if (targetFormat === 'image/x-icon') {
          finalBlob = await canvasToIcoBlob(canvas);
        } else {
          const mimeQuality = targetFormat === 'image/png' ? undefined : quality / 100;
          finalBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (b) => {
                if (b) resolve(b);
                else reject(new Error('Canvas export failed'));
              },
              targetFormat,
              mimeQuality
            );
          });
        }

        setIsConverting(false);
        URL.revokeObjectURL(objectUrl);

        if (finalBlob) {
          setConvertedBlob(finalBlob);
          setConvertedDimensions({ width: targetWidth, height: targetHeight });
          setConvertedUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(finalBlob);
          });
        }
      } catch (err) {
        console.error('Image conversion error:', err);
        setIsConverting(false);
        URL.revokeObjectURL(objectUrl);
        setErrorMessage('Không thể chuyển đổi hình ảnh này trên canvas.');
      }
    };

    img.onerror = () => {
      setIsConverting(false);
      URL.revokeObjectURL(objectUrl);
      setErrorMessage('Không thể đọc file hình ảnh này. Vui lòng thử lại với ảnh khác.');
    };

    img.src = objectUrl;
  }, [file, targetFormat, quality, scale]);

  // Auto trigger conversion on settings change
  useEffect(() => {
    if (file) {
      const timer = setTimeout(() => {
        executeConversion();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [file, targetFormat, quality, scale, executeConversion]);

  const handleDownload = () => {
    if (!convertedBlob || !file) return;

    const opt = FORMAT_OPTIONS.find((f) => f.id === targetFormat);
    const ext = opt ? opt.ext : 'jpg';
    const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const downloadFileName = `${baseName}_converted.${ext}`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(convertedBlob);
    a.download = downloadFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleReset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (convertedUrl) URL.revokeObjectURL(convertedUrl);
    setFile(null);
    setPreviewUrl(null);
    setConvertedBlob(null);
    setConvertedUrl(null);
    setOriginalDimensions(null);
    setConvertedDimensions(null);
    setErrorMessage(null);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  interface SavingsResult {
    difference: number;
    percentage: string;
    type: 'saved' | 'increased' | 'equal';
    label: string;
    display: string;
    colorClass: string;
  }

  const calculateSavings = (): SavingsResult | null => {
    if (!file || !convertedBlob) return null;
    const oldSize = file.size;
    const newSize = convertedBlob.size;
    const difference = newSize - oldSize;
    const percentage = Math.abs((difference / oldSize) * 100).toFixed(0);

    if (newSize < oldSize) {
      return {
        difference,
        percentage,
        type: 'saved',
        label: 'Tiết kiệm',
        display: `Tiết kiệm ${percentage}%`,
        colorClass: 'text-emerald-500 dark:text-emerald-400',
      };
    } else if (newSize > oldSize) {
      return {
        difference,
        percentage,
        type: 'increased',
        label: 'Tăng thêm',
        display: `Tăng thêm ${percentage}%`,
        colorClass: 'text-rose-500 dark:text-rose-400',
      };
    } else {
      return {
        difference: 0,
        percentage: '0',
        type: 'equal',
        label: 'Biến động',
        display: '0%',
        colorClass: 'text-slate-600 dark:text-slate-400',
      };
    }
  };

  const savings = calculateSavings();
  const selectedOption = FORMAT_OPTIONS.find((f) => f.id === targetFormat) || FORMAT_OPTIONS[0];

  return (
    <div className="space-y-6">

      {/* HEIC Decoding Loading Indicator */}
      {isDecodingHeic && (
        <div className="p-4 rounded-xl bg-pink-500/10 border border-pink-500/30 flex items-center gap-3 text-xs text-pink-600 dark:text-pink-400 animate-in fade-in">
          <Loader2 className="w-4 h-4 animate-spin shrink-0 text-pink-500" />
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            <span className="font-semibold">{heicProgress}</span>
          </div>
        </div>
      )}

      {/* Graceful Inline Error Banner */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-between text-xs text-red-600 dark:text-red-400 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-1 rounded hover:bg-red-500/20 text-red-500 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Upload Dropzone */}
      {!file && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
              handleSelectFile(e.dataTransfer.files[0]);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-4 ${
            isDraggingOver
              ? 'border-pink-500 bg-pink-500/5'
              : 'border-slate-300 dark:border-slate-800 hover:border-pink-500/40 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/70'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleSelectFile(e.target.files[0])}
          />
          <div className="w-16 h-16 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
            <UploadCloud className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100">
              Kéo thả hình ảnh vào đây hoặc click để chọn file
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
              Hỗ trợ JPG, PNG, WebP, Apple HEIC/HEIF, BMP, ICO • Xử lý 100% trong trình duyệt (HTML5 Canvas)
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              📱 Tự động giải mã Apple HEIC
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              Tạo Favicon ICO & Windows BMP
            </span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              Bảo mật 100% In-Browser
            </span>
          </div>
        </div>
      )}

      {/* Editor & Conversion Controls */}
      {file && (
        <div className="space-y-6">
          {/* Top Control Bar */}
          <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 shrink-0">
                  <ImageIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {file.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Gốc: {formatBytes(file.size)}
                    {originalDimensions && ` • ${originalDimensions.width} × ${originalDimensions.height} px`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors self-start sm:self-auto cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Chọn ảnh khác</span>
              </button>
            </div>

            {/* Custom Dropdown for Target Format */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2" ref={dropdownRef}>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-pink-500" />
                  <span>Định dạng đầu ra (Output Format):</span>
                </label>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsDropdownOpen((prev) => !prev)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-pink-500/60 dark:hover:border-pink-500/60 text-left transition-all cursor-pointer"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {selectedOption.label}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${selectedOption.badgeStyle}`}>
                          {selectedOption.tag}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {selectedOption.desc}
                      </p>
                    </div>

                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ml-2 ${
                        isDropdownOpen ? 'rotate-180 text-pink-500' : ''
                      }`}
                    />
                  </button>

                  {isDropdownOpen && (
                    <div className="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100 max-h-72 overflow-y-auto">
                      {FORMAT_OPTIONS.map((opt) => {
                        const isSelected = targetFormat === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setTargetFormat(opt.id);
                              setIsDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold">{opt.label}</span>
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${opt.badgeStyle}`}>
                                  {opt.tag}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {opt.desc}
                              </p>
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-pink-500 shrink-0 ml-2" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Quality Slider (0% to 100%, default 85%) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    Chất lượng nén (Quality):
                  </span>
                  <span className="font-mono font-bold text-pink-500">
                    {targetFormat === 'image/png'
                      ? 'Lossless (PNG giữ nguyên nét)'
                      : targetFormat === 'image/bmp'
                      ? 'Uncompressed (24-bit BMP)'
                      : targetFormat === 'image/x-icon'
                      ? '32-bit RGBA (Chuẩn Icon)'
                      : `${quality}% ${quality === 85 ? '(Mặc định chuẩn)' : quality >= 90 ? '(Rất cao)' : '(Nén nhẹ)'}`}
                  </span>
                </div>
                <div className="pt-2">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    disabled={targetFormat === 'image/png' || targetFormat === 'image/bmp' || targetFormat === 'image/x-icon'}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="w-full accent-pink-500 disabled:opacity-40 cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
                  />
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">
                    <span>0% (Nhỏ nhất)</span>
                    <span className="text-pink-500 font-bold">85% (Chuẩn đẹp)</span>
                    <span>100% (Gốc)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Scale Dimensions Continuous Slider */}
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  Tỷ lệ thu phóng (Scale Dimensions):
                </span>
                <span className="font-mono font-bold text-pink-500">
                  {Math.round(scale * 100)}%
                  {(dynamicDimensions || convertedDimensions) &&
                    ` (${(dynamicDimensions || convertedDimensions)!.width} × ${(dynamicDimensions || convertedDimensions)!.height} px)`}
                </span>
              </div>
              <div className="pt-2">
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="1"
                  value={Math.round(scale * 100)}
                  onChange={(e) => setScale(Number(e.target.value) / 100)}
                  className="w-full accent-[#FF758F] cursor-pointer h-2 bg-slate-200 dark:bg-slate-700 rounded-lg"
                  aria-label="Tỷ lệ thu phóng kích thước ảnh"
                />
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">
                  <span>5% (Siêu nhỏ)</span>
                  <span>50%</span>
                  <span className="text-pink-500 font-bold">100% (Gốc)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Results Comparison & Download Card */}
          <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-pink-500" />
                <span>Kết Quả Chuyển Đổi Trực Tuyến</span>
              </h2>
              {isConverting && (
                <span className="text-xs text-pink-500 font-semibold animate-pulse flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Đang xử lý canvas...
                </span>
              )}
            </div>

            {/* Flattened Metrics Container */}
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 rounded-xl bg-slate-50/80 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="p-4">
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Dung lượng gốc</p>
                <p className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-1">
                  {formatBytes(file.size)}
                </p>
              </div>

              <div className="p-4">
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Dung lượng mới</p>
                {isConverting ? (
                  <Skeleton className="h-6 w-24 rounded my-1" />
                ) : (
                  <p className="text-lg font-bold text-pink-600 dark:text-pink-400 mt-1">
                    {convertedBlob ? formatBytes(convertedBlob.size) : '...'}
                  </p>
                )}
              </div>

              <div className="p-4">
                <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                  {savings ? savings.label : 'Biến động dung lượng'}
                </p>
                {isConverting ? (
                  <Skeleton className="h-6 w-28 rounded my-1" />
                ) : (
                  <p
                    className={`text-lg font-bold mt-1 ${
                      savings ? savings.colorClass : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {savings ? savings.display : '...'}
                  </p>
                )}
              </div>
            </div>

            {/* Live Visual Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Hình ảnh gốc:</p>
                <div className="w-full h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 flex items-center justify-center overflow-hidden p-2">
                  {previewUrl && (
                    <img
                      src={previewUrl}
                      alt="Original"
                      className="max-h-full max-w-full object-contain rounded"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Hình ảnh xuất ra:</p>
                <div className="w-full h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 flex items-center justify-center overflow-hidden p-2">
                  {isConverting ? (
                    <Skeleton className="w-full h-full rounded-lg" />
                  ) : convertedUrl ? (
                    <img
                      src={convertedUrl}
                      alt="Converted"
                      className="max-h-full max-w-full object-contain rounded"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">Đang chuẩn bị preview...</span>
                  )}
                </div>
              </div>
            </div>

            {/* Instant Action Download */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={!convertedBlob || isConverting}
                className="w-full py-3.5 px-6 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>
                  Tải Về File {selectedOption.ext.toUpperCase()} (
                  {convertedBlob ? formatBytes(convertedBlob.size) : '...'})
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
