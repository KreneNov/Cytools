import React, { useState, useRef } from 'react';
import {
  Presentation,
  Upload,
  CheckCircle2,
  Trash2,
  Loader2,
  Download,
  AlertCircle,
  FileCheck,
  Image as ImageIcon,
  CheckSquare,
  Square,
  Layers,
} from 'lucide-react';
import JSZip from 'jszip';
import { scanPptxWatermarks, removePptxWatermarks } from '../../utils/pptxWatermarkCleaner';
import type { PptxDetectedItem, PptxCleanResult } from '../../types/watermarkRemover';

interface PptxWatermarkViewProps {
  isCompact?: boolean;
}

export const PptxWatermarkView: React.FC<PptxWatermarkViewProps> = ({ isCompact = false }) => {
  const [pptxFile, setPptxFile] = useState<File | null>(null);
  const [zipInstance, setZipInstance] = useState<JSZip | null>(null);
  const [detectedItems, setDetectedItems] = useState<PptxDetectedItem[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isCleaning, setIsCleaning] = useState<boolean>(false);
  const [result, setResult] = useState<PptxCleanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProcessFile = async (file: File) => {
    setPptxFile(file);
    setResult(null);
    setErrorMsg(null);
    setIsScanning(true);

    try {
      const buffer = await file.arrayBuffer();
      const { zip, detectedItems: items } = await scanPptxWatermarks(buffer);
      setZipInstance(zip);
      // Mark all detected items as selected by default
      setDetectedItems(items.map((it) => ({ ...it, selected: true })));
    } catch (err) {
      console.error('[PPTX Scan Error]:', err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Không thể phân tích tệp PowerPoint. Tệp có thể bị hỏng hoặc định dạng không được hỗ trợ.'
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (
        file.name.toLowerCase().endsWith('.pptx') ||
        file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ) {
        handleProcessFile(file);
      } else {
        setErrorMsg('Vui lòng chọn định dạng tệp .pptx hợp lệ.');
      }
    }
  };

  const toggleItemSelection = (id: string) => {
    setDetectedItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item))
    );
  };

  const toggleSelectAll = (select: boolean) => {
    setDetectedItems((prev) => prev.map((item) => ({ ...item, selected: select })));
  };

  const handleExecuteClean = async () => {
    if (!zipInstance || !pptxFile) return;

    const selectedCount = detectedItems.filter((i) => i.selected).length;
    if (selectedCount === 0) {
      setErrorMsg('Vui lòng chọn ít nhất một hình mờ hoặc logo để xóa.');
      return;
    }

    setIsCleaning(true);
    setErrorMsg(null);

    try {
      const res = await removePptxWatermarks(zipInstance, detectedItems);
      setResult(res);
    } catch (err) {
      console.error('[PPTX Clean Error]:', err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Đã xảy ra lỗi trong quá trình làm sạch tệp PowerPoint.'
      );
    } finally {
      setIsCleaning(false);
    }
  };

  const triggerDirectDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setPptxFile(null);
    setZipInstance(null);
    setDetectedItems([]);
    setResult(null);
    setErrorMsg(null);
    setIsScanning(false);
    setIsCleaning(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = () => {
    if (!result || !pptxFile) return;
    const originalName = pptxFile.name.replace(/\.[^/.]+$/, '');
    triggerDirectDownload(result.cleanedBlob, `${originalName}_cleaned.pptx`);
    handleReset();
  };

  const allSelected = detectedItems.length > 0 && detectedItems.every((i) => i.selected);
  const selectedCount = detectedItems.filter((i) => i.selected).length;

  return (
    <div className={`space-y-6 ${isCompact ? 'p-2' : ''}`}>
      {/* Upload Dropzone */}
      {!pptxFile && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className="relative group border-2 border-dashed border-slate-300 dark:border-slate-800 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 bg-white dark:bg-slate-900/60 hover:bg-slate-50 dark:hover:bg-slate-900"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleProcessFile(e.target.files[0]);
              }
            }}
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
          />

          <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 group-hover:scale-105 transition-transform duration-200">
            <Presentation className="w-8 h-8" />
          </div>

          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Kéo thả tệp PowerPoint (.pptx) vào đây
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-4">
            Quét và loại bỏ dấu bản quyền trong Slide Master, Slide Layouts, hình mờ chìm và logo góc slide mà không làm vỡ bố cục trình chiếu.
          </p>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-200">
            <Upload className="w-4 h-4" />
            <span>Chọn tệp PowerPoint từ thiết bị</span>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {errorMsg && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">{errorMsg}</div>
        </div>
      )}

      {/* Scanning State */}
      {isScanning && (
        <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Đang quét cấu trúc Slide Master, Layouts và tệp hình ảnh đính kèm...
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Xử lý hoàn toàn trong trình duyệt với JSZip, không tải tệp lên máy chủ.
          </p>
        </div>
      )}

      {/* File Loaded & Detection Results */}
      {pptxFile && !isScanning && !result && (
        <div className="space-y-6">
          {/* File Info Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Presentation className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {pptxFile.name}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {(pptxFile.size / 1024 / 1024).toFixed(2)} MB • Phát hiện {detectedItems.length} hình mờ / logo khả nghi
                </p>
              </div>
            </div>

            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Chọn tệp khác
            </button>
          </div>

          {/* Detected Items List */}
          {detectedItems.length > 0 ? (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/60 pb-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleSelectAll(!allSelected)}
                    className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                  >
                    {allSelected ? (
                      <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                    <span>{allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</span>
                  </button>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    ({selectedCount}/{detectedItems.length} mục đã chọn)
                  </span>
                </div>

                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Bấm vào mục để bật/tắt lựa chọn xóa
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[380px] overflow-y-auto pr-1">
                {detectedItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => toggleItemSelection(item.id)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                      item.selected
                        ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-300 dark:border-indigo-800'
                        : 'bg-slate-50/50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 opacity-60'
                    }`}
                  >
                    <div className="mt-0.5 text-indigo-600 dark:text-indigo-400">
                      {item.selected ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                            item.shapeType === 'text'
                              ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                              : item.shapeType === 'image'
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                              : 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
                          }`}
                        >
                          {item.shapeType === 'text' ? (
                            <Layers className="w-3 h-3 mr-1 inline" />
                          ) : (
                            <ImageIcon className="w-3 h-3 mr-1 inline" />
                          )}
                          {item.shapeType === 'text'
                            ? 'Văn bản / Khối'
                            : item.shapeType === 'image'
                            ? 'Hình ảnh / Logo'
                            : 'Nền slide'}
                        </span>

                        <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                          {item.sourceType === 'slideMaster'
                            ? 'Slide Master'
                            : item.sourceType === 'slideLayout'
                            ? 'Slide Layout'
                            : `Slide ${item.slideNumber ?? 1}`}
                        </span>
                      </div>

                      {item.textSnippet && (
                        <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                          "{item.textSnippet}"
                        </p>
                      )}

                      {item.imagePreviewUrl && (
                        <div className="mt-1.5 w-16 h-12 rounded border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                          <img
                            src={item.imagePreviewUrl}
                            alt="Logo preview"
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                      )}

                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {item.name}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Button */}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleExecuteClean}
                  disabled={isCleaning || selectedCount === 0}
                  className="px-6 py-2.5 rounded-xl font-medium text-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
                >
                  {isCleaning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Đang xử lý tệp PPTX...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      <span>Xóa {selectedCount} mục watermark đã chọn</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <FileCheck className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Không phát hiện watermark phổ biến trong Master hoặc Slides
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                Tệp trình chiếu này không chứa các từ khóa bản quyền chuẩn hoặc hình ảnh logo nhận dạng tự động.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Result State */}
      {result && pptxFile && (
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Làm sạch PowerPoint thành công
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Đã loại bỏ {result.totalRemoved} đối tượng watermark và tái tạo tệp .pptx hoàn chỉnh.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Số mục đã loại bỏ</p>
              <p className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {result.totalRemoved}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Dung lượng tệp mới</p>
              <p className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {(result.cleanedBlob.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm font-medium rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Làm sạch tệp khác
            </button>
            <button
              onClick={handleDownload}
              className="px-6 py-2.5 rounded-xl font-medium text-sm text-white bg-emerald-600 hover:bg-emerald-700 flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>Tải PPTX Đã Làm Sạch</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
