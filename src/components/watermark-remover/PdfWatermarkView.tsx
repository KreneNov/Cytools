import React, { useState } from 'react';
import {
  FileText,
  CheckCircle2,
  Trash2,
  Plus,
  Loader2,
  Download,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import { cleanPdfWatermarks } from '../../utils/pdfWatermarkCleaner';
import type { PdfCleanResult } from '../../types/watermarkRemover';

interface PdfWatermarkViewProps {
  isCompact?: boolean;
}

export const PdfWatermarkView: React.FC<PdfWatermarkViewProps> = ({ isCompact = false }) => {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [customKeywords, setCustomKeywords] = useState<string[]>([
    'CamScanner',
    'Scanned with CamScanner',
    'CONFIDENTIAL',
    'SAMPLE',
    'DRAFT',
  ]);
  const [newKeyword, setNewKeyword] = useState<string>('');
  const [stripAnnots, setStripAnnots] = useState<boolean>(true);
  const [stripPieceInfo, setStripPieceInfo] = useState<boolean>(true);
  const [stripOverlayForms, setStripOverlayForms] = useState<boolean>(true);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<PdfCleanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        setPdfFile(file);
        setResult(null);
        setErrorMsg(null);
      }
    }
  };

  const handleAddKeyword = () => {
    const trimmed = newKeyword.trim();
    if (trimmed && !customKeywords.includes(trimmed)) {
      setCustomKeywords([...customKeywords, trimmed]);
      setNewKeyword('');
    }
  };

  const handleRemoveKeyword = (kw: string) => {
    setCustomKeywords(customKeywords.filter((k) => k !== kw));
  };

  const handleExecuteClean = async () => {
    if (!pdfFile) return;
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const res = await cleanPdfWatermarks(arrayBuffer, {
        customKeywords,
        stripAnnotations: stripAnnots,
        stripPieceInfo,
        stripOverlayForms,
      });
      setResult(res);
    } catch (err) {
      console.error('[PDF Cleaner Error]:', err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể phân tích hoặc làm sạch file PDF. File có thể bị mã hóa mật khẩu hoặc định dạng không chuẩn.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result || !pdfFile) return;
    const blob = new Blob([result.cleanedPdfBytes as unknown as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const nameWithoutExt = pdfFile.name.replace(/\.[^/.]+$/, '');
    a.href = url;
    a.download = `${nameWithoutExt}_cleaned.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className={`space-y-6 ${isCompact ? 'p-1' : ''}`}>
      {/* File Upload Dropzone */}
      {!pdfFile ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          className="border-2 border-dashed border-slate-300 dark:border-slate-800 hover:border-pink-500/50 dark:hover:border-pink-500/50 rounded-2xl p-8 sm:p-12 text-center transition-all bg-white dark:bg-slate-900/60 shadow-sm cursor-pointer"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/pdf,.pdf';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) {
                setPdfFile(file);
                setResult(null);
                setErrorMsg(null);
              }
            };
            input.click();
          }}
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
            <FileText className="w-8 h-8" />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white mb-1">
            Kéo thả tài liệu PDF vào đây
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-md mx-auto">
            Hỗ trợ bóc tách dấu chìm CamScanner, chữ đóng dấu bảo mật, stamp chú thích và watermark dạng text stream lặp lại.
          </p>
          <button
            type="button"
            className="px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-xs sm:text-sm font-bold shadow-md shadow-pink-500/20 transition-all active:scale-95 cursor-pointer"
          >
            Chọn file PDF từ máy tính
          </button>
        </div>
      ) : (
        /* PDF Processing & Customization Panel */
        <div className="space-y-5">
          {/* File Overview Card */}
          <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 shrink-0">
                <FileText className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {pdfFile.name}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Dung lượng: {formatFileSize(pdfFile.size)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setPdfFile(null);
                setResult(null);
              }}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 text-xs font-medium transition-colors cursor-pointer"
            >
              Đổi file khác
            </button>
          </div>

          {/* Options & Keywords Configuration */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Cấu hình bộ lọc Watermark PDF
            </h4>

            {/* Checkbox Options */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={stripAnnots}
                  onChange={(e) => setStripAnnots(e.target.checked)}
                  className="rounded text-pink-500 focus:ring-pink-500"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Xóa Annotations (/Watermark, /Stamp)
                </span>
              </label>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={stripPieceInfo}
                  onChange={(e) => setStripPieceInfo(e.target.checked)}
                  className="rounded text-pink-500 focus:ring-pink-500"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Xóa PieceInfo Metadata
                </span>
              </label>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={stripOverlayForms}
                  onChange={(e) => setStripOverlayForms(e.target.checked)}
                  className="rounded text-pink-500 focus:ring-pink-500"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Xóa Form XObject Overlay
                </span>
              </label>
            </div>

            {/* Watermark Keywords Tag Input */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Từ khóa cần bóc tách khỏi luồng văn bản (Content Stream):
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddKeyword();
                    }
                  }}
                  placeholder="Nhập từ khóa (vd: CamScanner, Không sao chép, tên miền web...)"
                  className="flex-1 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-pink-500"
                />
                <button
                  type="button"
                  onClick={handleAddKeyword}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm</span>
                </button>
              </div>

              {/* Tag Chips */}
              <div className="flex flex-wrap gap-2 pt-1">
                {customKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-600 dark:text-pink-400 text-xs font-medium"
                  >
                    <span>{kw}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveKeyword(kw)}
                      className="hover:text-pink-700 dark:hover:text-pink-200 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Execute Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleExecuteClean}
                disabled={isProcessing}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-xs sm:text-sm font-bold shadow-md shadow-pink-500/20 transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang bóc tách và làm sạch PDF...</span>
                  </>
                ) : (
                  <>
                    <FileCheck className="w-4 h-4" />
                    <span>Bắt đầu làm sạch PDF</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Success Result Card */}
          {result && (
            <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Đã làm sạch file PDF thành công!</span>
                </div>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all active:scale-95 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Tải file PDF đã làm sạch</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white/60 dark:bg-slate-900/60 border border-emerald-500/20">
                  <span className="text-slate-500 block">Kích thước trước / sau:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {formatFileSize(result.originalSize)} ➔ {formatFileSize(result.cleanedSize)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-white/60 dark:bg-slate-900/60 border border-emerald-500/20">
                  <span className="text-slate-500 block">Annotations đã gỡ:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {result.strippedAnnotsCount} mục
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-white/60 dark:bg-slate-900/60 border border-emerald-500/20">
                  <span className="text-slate-500 block">Khối từ khóa đã lọc:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {result.strippedKeywordsCount} khối văn bản
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-white/60 dark:bg-slate-900/60 border border-emerald-500/20">
                  <span className="text-slate-500 block">Form XObjects gỡ bỏ:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {result.strippedXObjectsCount} đối tượng
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
