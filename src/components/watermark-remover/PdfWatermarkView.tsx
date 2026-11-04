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
  Sparkles,
  ScanEye,
  Sliders,
  Wand2,
} from 'lucide-react';
import { cleanPdfWatermarks } from '../../utils/pdfWatermarkCleaner';
import {
  renderPdfPagesForRasterClean,
  applySmartWatermarkLumaFilter,
  buildWatermarkMaskFromPage,
  imageDataToDataUrl,
  packRasterPagesToPdf,
} from '../../utils/pdfRasterCleaner';
import { useWatermarkRemover } from '../../hooks/useWatermarkRemover';
import type {
  PdfStripSuccess,
  PdfRasterPageItem,
} from '../../types/watermarkRemover';

interface PdfWatermarkViewProps {
  isCompact?: boolean;
}

export const PdfWatermarkView: React.FC<PdfWatermarkViewProps> = ({
  isCompact = false,
}) => {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [customKeywords, setCustomKeywords] = useState<string[]>([
    'CamScanner',
    'Scanned with CamScanner',
    'CONFIDENTIAL',
    'SAMPLE',
    'DRAFT',
    'DO NOT COPY',
  ]);
  const [newKeyword, setNewKeyword] = useState<string>('');
  const [stripAnnots, setStripAnnots] = useState<boolean>(true);
  const [stripPieceInfo, setStripPieceInfo] = useState<boolean>(true);
  const [stripOverlayForms, setStripOverlayForms] = useState<boolean>(true);
  const [autoDetectDiagonal, setAutoDetectDiagonal] = useState<boolean>(true);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<PdfStripSuccess | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tier 3: Visual Raster & AI Clean states
  const [rasterPages, setRasterPages] = useState<PdfRasterPageItem[]>([]);
  const [isRasterizing, setIsRasterizing] = useState<boolean>(false);
  const [isPackingPdf, setIsPackingPdf] = useState<boolean>(false);
  const [rasterProgress, setRasterProgress] = useState<number>(0);
  const [lumaThreshold, setLumaThreshold] = useState<number>(195);
  const [inpaintingPageNumber, setInpaintingPageNumber] = useState<number | null>(
    null
  );

  const { runInpaint, aiModelProgress } = useWatermarkRemover();

  const resetAllStates = () => {
    setPdfFile(null);
    setPdfBuffer(null);
    setResult(null);
    setErrorMsg(null);
    setRasterPages([]);
    setIsRasterizing(false);
    setIsPackingPdf(false);
    setRasterProgress(0);
    setInpaintingPageNumber(null);
  };

  const loadSelectedPdfFile = async (file: File) => {
    setPdfFile(file);
    setResult(null);
    setErrorMsg(null);
    setRasterPages([]);
    try {
      const buf = await file.arrayBuffer();
      setPdfBuffer(buf);
    } catch {
      setErrorMsg('Không thể đọc dữ liệu từ file PDF đã chọn.');
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (
        file.name.toLowerCase().endsWith('.pdf') ||
        file.type === 'application/pdf'
      ) {
        void loadSelectedPdfFile(file);
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
    setResult(null);
    setRasterPages([]);

    try {
      const arrayBuffer = pdfBuffer ?? (await pdfFile.arrayBuffer());
      if (!pdfBuffer) {
        setPdfBuffer(arrayBuffer);
      }

      const res = await cleanPdfWatermarks(arrayBuffer.slice(0), {
        customKeywords,
        stripAnnotations: stripAnnots,
        stripPieceInfo,
        stripOverlayForms,
        autoDetectDiagonal,
      });

      if (res.success) {
        setResult(res);
      } else {
        setErrorMsg(res.message);
      }
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

  const handleStartRasterClean = async () => {
    if (!pdfFile) return;
    setIsRasterizing(true);
    setErrorMsg(null);
    setRasterProgress(0);

    try {
      const sourceBuffer = pdfBuffer ?? (await pdfFile.arrayBuffer());
      if (!pdfBuffer) {
        setPdfBuffer(sourceBuffer);
      }

      const pages = await renderPdfPagesForRasterClean(
        sourceBuffer,
        2.0,
        lumaThreshold,
        (pct) => setRasterProgress(pct)
      );
      setRasterPages(pages);
    } catch (err) {
      console.error('[PDF Raster Clean Error]:', err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể kết xuất trang PDF sang chế độ Quét Sâu Thị Giác.'
      );
    } finally {
      setIsRasterizing(false);
    }
  };

  const handleThresholdChange = (newThreshold: number) => {
    setLumaThreshold(newThreshold);
    if (rasterPages.length === 0) return;

    const updated = rasterPages.map((p) => {
      const refiltered = applySmartWatermarkLumaFilter(
        p.originalImageData,
        newThreshold
      );
      return {
        ...p,
        cleanedImageData: refiltered,
        previewUrl: imageDataToDataUrl(refiltered, 'image/jpeg', 0.92),
        aiInpainted: false,
      };
    });
    setRasterPages(updated);
  };

  const handleAiInpaintPage = async (pageItem: PdfRasterPageItem) => {
    setInpaintingPageNumber(pageItem.pageNumber);
    setErrorMsg(null);
    try {
      const autoMask = buildWatermarkMaskFromPage(
        pageItem.originalImageData,
        lumaThreshold
      );
      const inpainted = await runInpaint(pageItem.cleanedImageData, autoMask);
      const previewUrl = imageDataToDataUrl(inpainted, 'image/jpeg', 0.92);

      setRasterPages((prev) =>
        prev.map((p) =>
          p.pageNumber === pageItem.pageNumber
            ? {
                ...p,
                cleanedImageData: inpainted,
                previewUrl,
                aiInpainted: true,
              }
            : p
        )
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : `Không thể chạy AI Inpaint trên trang ${pageItem.pageNumber}.`
      );
    } finally {
      setInpaintingPageNumber(null);
    }
  };

  const handleDownloadRasterPdf = async () => {
    if (rasterPages.length === 0 || !pdfFile) return;
    setIsPackingPdf(true);
    setRasterProgress(0);

    try {
      const pdfBytes = await packRasterPagesToPdf(rasterPages, (pct) =>
        setRasterProgress(pct)
      );
      const blob = new Blob([pdfBytes as unknown as BlobPart], {
        type: 'application/pdf',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const nameWithoutExt = pdfFile.name.replace(/\.[^/.]+$/, '');
      a.href = url;
      a.download = `${nameWithoutExt}_visual_cleaned.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      resetAllStates();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể đóng gói các trang đã làm sạch thành file PDF.'
      );
    } finally {
      setIsPackingPdf(false);
    }
  };

  const handleDownload = () => {
    if (!result || !pdfFile) return;
    const blob = new Blob([result.cleanedPdfBytes as unknown as BlobPart], {
      type: 'application/pdf',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const nameWithoutExt = pdfFile.name.replace(/\.[^/.]+$/, '');
    a.href = url;
    a.download = `${nameWithoutExt}_cleaned.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    resetAllStates();
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
                void loadSelectedPdfFile(file);
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
            Hệ thống 3 Tầng Universal: Giải mã bảng mã Font Subset (ToUnicode CMap), gỡ khối chữ
            chìm xoay chéo (BT...ET) và Quét Sâu Thị Giác kết hợp AI ONNX ngay trong trình duyệt.
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
              onClick={resetAllStates}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 text-xs font-medium transition-colors cursor-pointer"
            >
              Đổi file khác
            </button>
          </div>

          {/* Options & Keywords Configuration */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Tầng 1 & 2: Giải Mã CMap Font Subset & Gỡ Khối Stream (BT...ET)
              </h4>
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-pink-500/10 text-pink-600 dark:text-pink-400 font-semibold">
                Giữ nguyên 100% Vector & Font gốc
              </span>
            </div>

            {/* Checkbox Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDetectDiagonal}
                  onChange={(e) => setAutoDetectDiagonal(e.target.checked)}
                  className="rounded text-pink-500 focus:ring-pink-500"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Tự động nhận diện chữ chìm xoay chéo (Ma trận Tm/cm + Độ mờ)
                </span>
              </label>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={stripAnnots}
                  onChange={(e) => setStripAnnots(e.target.checked)}
                  className="rounded text-pink-500 focus:ring-pink-500"
                />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Xóa Annotations (/Watermark, /Stamp, /FreeText)
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
                  Xóa PieceInfo & Metadata ẩn
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
                  Quét đệ quy trong Form XObject Overlay
                </span>
              </label>
            </div>

            {/* Watermark Keywords Tag Input */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Từ khóa cần giải mã ToUnicode CMap & bóc tách khỏi luồng văn bản:
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
                  placeholder="Nhập từ khóa trên tài liệu (vd: CONFIDENTIAL, BẢN NHÁP, TÀI LIỆU MẬT...)"
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

            {/* Action Buttons: Tier 1/2 Stream Clean & Tier 3 Deep Visual Scan */}
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExecuteClean}
                disabled={isProcessing || isRasterizing}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-xs sm:text-sm font-bold shadow-md shadow-pink-500/20 transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang giải mã CMap & bóc tách khối BT...ET...</span>
                  </>
                ) : (
                  <>
                    <FileCheck className="w-4 h-4" />
                    <span>Bắt đầu làm sạch PDF (Chuẩn Vector)</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleStartRasterClean}
                disabled={isProcessing || isRasterizing}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-semibold transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isRasterizing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-pink-500" />
                    <span>Đang quét thị giác ({rasterProgress}%)...</span>
                  </>
                ) : (
                  <>
                    <ScanEye className="w-4 h-4 text-pink-500" />
                    <span>Chế độ Quét Sâu Thị Giác (Auto Raster & AI)</span>
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

          {/* Tier 1 & 2 Result Card */}
          {result && (
            <div className="p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>
                    {result.totalRemovedCount > 0
                      ? `Đã bóc tách thành công ${result.totalRemovedCount} khối Watermark Vector!`
                      : 'Hoàn tất quét luồng Vector — Không phát hiện khối chữ trùng khớp'}
                  </span>
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
                  <span className="text-slate-500 block">Khối từ khóa & Artifact:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {result.strippedArtifactBlocks + result.strippedTextOps} khối
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-white/60 dark:bg-slate-900/60 border border-emerald-500/20">
                  <span className="text-slate-500 block">Khối chữ xoay chéo (Tm/cm):</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {result.strippedDiagonalBlocks} khối
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-white/60 dark:bg-slate-900/60 border border-emerald-500/20">
                  <span className="text-slate-500 block">Annotations & XObjects:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {result.strippedAnnotsCount + result.strippedXObjectsCount} mục
                  </span>
                </div>
              </div>

              {/* Automatic Tier 3 Prompt when 0 vector blocks were matched */}
              {result.totalRemovedCount === 0 && rasterPages.length === 0 && (
                <div className="p-4 rounded-xl bg-amber-500/15 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="space-y-1 text-xs text-slate-700 dark:text-slate-200">
                    <p className="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4" />
                      Watermark dạng Đường Cong Vector (Outlines) hoặc Ảnh Scan?
                    </p>
                    <p className="text-slate-600 dark:text-slate-300">
                      Một số PDF chuyển chữ chìm thành hình vẽ (curves) hoặc ảnh nền. Hãy bật{' '}
                      <strong>Quét Sâu Thị Giác (Tier 3)</strong> để tự động lọc sạch màu chữ chìm và
                      đóng gói lại thành PDF ngay tại đây.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleStartRasterClean}
                    disabled={isRasterizing}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shrink-0 shadow-sm cursor-pointer transition-colors"
                  >
                    Chạy Quét Sâu Thị Giác ngay
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tier 3: Visual Raster & AI Clean Workspace */}
          {rasterPages.length > 0 && (
            <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-pink-500/30 shadow-sm space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <ScanEye className="w-4 h-4 text-pink-500" />
                    <span>
                      Tầng 3: Kết quả Quét Sâu Thị Giác ({rasterPages.length} trang PDF)
                    </span>
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Đã tự động lọc chữ chìm xám/mờ trên từng trang. Bạn có thể tinh chỉnh độ nhạy
                    hoặc bấm AI Inpaint cho từng trang trước khi tải PDF.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadRasterPdf}
                  disabled={isPackingPdf}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 text-white text-xs sm:text-sm font-bold shadow-md shadow-pink-500/20 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {isPackingPdf ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Đang đóng gói PDF ({rasterProgress}%)...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Tải PDF Đã Quét Sâu ({rasterPages.length} trang)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Smart Luma Threshold Slider */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <Sliders className="w-4 h-4 text-pink-500" />
                  <span>Ngưỡng lọc độ sáng chữ chìm (Smart Luma Filter): {lumaThreshold}</span>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-72">
                  <span className="text-[11px] text-slate-400">Mạnh (160)</span>
                  <input
                    type="range"
                    min={160}
                    max={235}
                    value={lumaThreshold}
                    onChange={(e) => handleThresholdChange(Number(e.target.value))}
                    className="flex-1 accent-pink-500 cursor-pointer"
                  />
                  <span className="text-[11px] text-slate-400">Nhẹ (235)</span>
                </div>
              </div>

              {/* Page Grid Previews */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[540px] overflow-y-auto pr-1">
                {rasterPages.map((pageItem) => {
                  const isPageInpainting = inpaintingPageNumber === pageItem.pageNumber;
                  return (
                    <div
                      key={pageItem.pageNumber}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 space-y-2.5 flex flex-col"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700 dark:text-slate-200">
                          Trang {pageItem.pageNumber}
                        </span>
                        {pageItem.aiInpainted && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold">
                            Đã xử lý ONNX AI
                          </span>
                        )}
                      </div>

                      <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-white aspect-[1/1.35] flex items-center justify-center">
                        <img
                          src={pageItem.previewUrl}
                          alt={`Trang PDF ${pageItem.pageNumber}`}
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleAiInpaintPage(pageItem)}
                        disabled={isPageInpainting || inpaintingPageNumber !== null}
                        className="w-full py-1.5 px-3 rounded-lg bg-slate-200/80 hover:bg-pink-500 hover:text-white dark:bg-slate-800 dark:hover:bg-pink-500 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {isPageInpainting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>
                              AI ONNX ({aiModelProgress > 0 ? `${aiModelProgress}%` : '...'})
                            </span>
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-3.5 h-3.5" />
                            <span>Khử sâu bằng AI ONNX</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
