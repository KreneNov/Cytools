import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  FileText,
  FilePlus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Download,
  Image as ImageIcon,
  CheckCircle2,
  Loader2,
  Layers,
  Sparkles,
  AlertCircle,
  X,
  Archive,
  Crown,
  Clock,
} from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { usePro } from '../../context/ProContext';

// Configure pdfjs worker to standard CDN
if (typeof window !== 'undefined' && 'GlobalWorkerOptions' in pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '3.11.174'}/pdf.worker.min.js`;
}

type PdfSubTool = 'merge' | 'image-to-pdf' | 'pdf-to-images';

interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
}

interface ExtractedImagePage {
  pageNum: number;
  blob: Blob;
  url: string;
}

interface PdfBatchQueueItem {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  errorMsg?: string;
}

const PRO_BATCH_MESSAGE =
  'Tính năng chuyển đổi hàng loạt (Batch Processing) chỉ dành riêng cho tài khoản PRO. Hãy nâng cấp để tiết kiệm thời gian!';

export const PdfToolsTab: React.FC = () => {
  const { isPro, openProModal } = usePro();
  const [activeSubTool, setActiveSubTool] = useState<PdfSubTool>('merge');

  // Tool A: Merge PDF states
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState(false);
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null);

  // Tool B: Image to PDF states
  const [imageItems, setImageItems] = useState<ImageItem[]>([]);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [isPackagingPdf, setIsPackagingPdf] = useState(false);
  const [packageSuccess, setPackageSuccess] = useState(false);
  const [packagedBlob, setPackagedBlob] = useState<Blob | null>(null);

  // Tool C: PDF to Images (JPG/ZIP) states
  const [pdfToImgFile, setPdfToImgFile] = useState<File | null>(null);
  const [pdfBatchQueue, setPdfBatchQueue] = useState<PdfBatchQueueItem[]>([]);
  const [pdfNumPages, setPdfNumPages] = useState<number>(0);
  const [isConvertingPdfToImg, setIsConvertingPdfToImg] = useState(false);
  const [pdfToImgProgress, setPdfToImgProgress] = useState<number>(0);
  const [extractedImages, setExtractedImages] = useState<ExtractedImagePage[]>([]);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);

  // General error handling
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfToImgInputRef = useRef<HTMLInputElement>(null);

  // Drag and drop states
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      extractedImages.forEach((img) => URL.revokeObjectURL(img.url));
      imageItems.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
  }, [extractedImages, imageItems]);

  // Handle PDF files selection for Merge
  const handleSelectPdfFiles = (newFiles: FileList | File[]) => {
    setErrorMessage(null);
    setMergeSuccess(false);
    setMergedBlob(null);

    const validPdfs: File[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const f = newFiles[i];
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        validPdfs.push(f);
      }
    }

    if (validPdfs.length === 0) {
      setErrorMessage('Vui lòng chọn tệp tin định dạng PDF hợp lệ.');
      return;
    }

    setPdfFiles((prev) => [...prev, ...validPdfs]);
  };

  const removePdfFile = (index: number) => {
    setPdfFiles((prev) => prev.filter((_, i) => i !== index));
    setMergeSuccess(false);
    setMergedBlob(null);
  };

  const movePdfUp = (index: number) => {
    if (index === 0) return;
    setPdfFiles((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
    setMergeSuccess(false);
    setMergedBlob(null);
  };

  const movePdfDown = (index: number) => {
    if (index === pdfFiles.length - 1) return;
    setPdfFiles((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
    setMergeSuccess(false);
    setMergedBlob(null);
  };

  const executeMergePdfs = async () => {
    if (pdfFiles.length < 2) {
      setErrorMessage('Vui lòng chọn ít nhất 2 tệp PDF để gộp.');
      return;
    }

    setIsMerging(true);
    setErrorMessage(null);
    setMergeSuccess(false);

    try {
      const mergedPdf = await PDFDocument.create();

      for (const file of pdfFiles) {
        const fileBytes = await file.arrayBuffer();
        const pdf = await PDFDocument.load(fileBytes);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedPdfBytes = await mergedPdf.save();
      const blob = new Blob([mergedPdfBytes as unknown as BlobPart], { type: 'application/pdf' });

      setMergedBlob(blob);
      setMergeSuccess(true);

      // Auto trigger download
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cytools_merged_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Merge PDF error:', err);
      setErrorMessage('Đã xảy ra lỗi khi gộp các tệp PDF. Vui lòng kiểm tra file không bị mã hóa/khóa mật khẩu.');
    } finally {
      setIsMerging(false);
    }
  };

  // Handle Images selection for Image to PDF
  const handleSelectImageFiles = (newFiles: FileList | File[]) => {
    setErrorMessage(null);
    setPackageSuccess(false);
    setPackagedBlob(null);

    const newItems: ImageItem[] = [];
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file);
        newItems.push({
          id: `${file.name}_${Date.now()}_${Math.random()}`,
          file,
          previewUrl,
        });
      }
    }

    if (newItems.length === 0) {
      setErrorMessage('Vui lòng chọn các tệp hình ảnh hợp lệ (JPG, PNG, WebP).');
      return;
    }

    setImageItems((prev) => [...prev, ...newItems]);
  };

  const removeImage = (id: string) => {
    setImageItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
    setPackageSuccess(false);
    setPackagedBlob(null);
  };

  const executeImageToPdf = async () => {
    if (imageItems.length === 0) {
      setErrorMessage('Vui lòng thêm ít nhất một hình ảnh.');
      return;
    }

    setIsPackagingPdf(true);
    setErrorMessage(null);
    setPackageSuccess(false);

    try {
      const pdfDoc = await PDFDocument.create();

      // Standard A4 dimensions in points (72 DPI)
      const A4_PORTRAIT: [number, number] = [595.28, 841.89];
      const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
      const pageSize = orientation === 'portrait' ? A4_PORTRAIT : A4_LANDSCAPE;

      for (const item of imageItems) {
        const page = pdfDoc.addPage(pageSize);
        const { width: pageWidth, height: pageHeight } = page.getSize();

        const imageBytes = await item.file.arrayBuffer();
        let embedded;

        if (item.file.type === 'image/png') {
          embedded = await pdfDoc.embedPng(imageBytes);
        } else if (item.file.type === 'image/jpeg' || item.file.type === 'image/jpg') {
          embedded = await pdfDoc.embedJpg(imageBytes);
        } else {
          // For WebP or other formats: convert to PNG via offscreen canvas
          const img = new Image();
          const imgUrl = URL.createObjectURL(item.file);
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
            img.src = imgUrl;
          });

          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(imgUrl);

          const pngBlob = await new Promise<Blob>((resolve) =>
            canvas.toBlob((b) => resolve(b!), 'image/png')
          );
          const pngBytes = await pngBlob.arrayBuffer();
          embedded = await pdfDoc.embedPng(pngBytes);
        }

        const margin = 36;
        const usableWidth = pageWidth - margin * 2;
        const usableHeight = pageHeight - margin * 2;

        const imgWidth = embedded.width;
        const imgHeight = embedded.height;

        const scale = Math.min(usableWidth / imgWidth, usableHeight / imgHeight, 1);
        const drawW = imgWidth * scale;
        const drawH = imgHeight * scale;

        const x = (pageWidth - drawW) / 2;
        const y = (pageHeight - drawH) / 2;

        page.drawImage(embedded, {
          x,
          y,
          width: drawW,
          height: drawH,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });

      setPackagedBlob(blob);
      setPackageSuccess(true);

      // Auto trigger download
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cytools_images_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Image to PDF error:', err);
      setErrorMessage('Đã xảy ra lỗi khi tạo tệp PDF từ ảnh.');
    } finally {
      setIsPackagingPdf(false);
    }
  };

  // Handle PDF File(s) for PDF to Images
  const handleSelectPdfToImg = async (file: File) => {
    setErrorMessage(null);
    extractedImages.forEach((img) => URL.revokeObjectURL(img.url));
    setExtractedImages([]);
    setZipBlob(null);

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrorMessage('Vui lòng chọn tệp tin định dạng PDF hợp lệ.');
      return;
    }

    setPdfToImgFile(file);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
      const pdfDoc = await loadingTask.promise;
      setPdfNumPages(pdfDoc.numPages);
    } catch (err) {
      console.error('Error reading PDF metadata:', err);
      setErrorMessage('Không thể đọc cấu trúc tệp PDF này. Tệp có thể bị hỏng hoặc đã khóa mật khẩu.');
    }
  };

  const handleSelectMultiplePdfToImg = async (incomingFiles: FileList | File[]) => {
    const validPdfs = Array.from(incomingFiles).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );

    if (validPdfs.length === 0) {
      setErrorMessage('Vui lòng chọn tệp tin định dạng PDF hợp lệ.');
      return;
    }

    const existingCount = pdfBatchQueue.length > 0 ? pdfBatchQueue.length : pdfToImgFile ? 1 : 0;

    // PRO Gatekeeper for Batch Processing
    if ((validPdfs.length > 1 || (existingCount > 0 && validPdfs.length >= 1)) && !isPro) {
      openProModal(PRO_BATCH_MESSAGE);
      const firstPdf = pdfToImgFile || validPdfs[0];
      setPdfBatchQueue([]);
      if (!pdfToImgFile) {
        await handleSelectPdfToImg(firstPdf);
      }
      return;
    }

    if (validPdfs.length === 1 && existingCount === 0) {
      setPdfBatchQueue([]);
      await handleSelectPdfToImg(validPdfs[0]);
      return;
    }

    const initialItems: PdfBatchQueueItem[] = [];
    if (pdfBatchQueue.length === 0 && pdfToImgFile) {
      initialItems.push({
        id: `${pdfToImgFile.name}_${Date.now()}_init`,
        file: pdfToImgFile,
        status: 'pending',
      });
    }

    const appendedItems: PdfBatchQueueItem[] = validPdfs.map((f, idx) => ({
      id: `${f.name}_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      file: f,
      status: 'pending',
    }));

    setPdfBatchQueue((prev) => [...prev, ...initialItems, ...appendedItems]);
    if (!pdfToImgFile && validPdfs[0]) {
      await handleSelectPdfToImg(validPdfs[0]);
    }
  };

  const executeBatchPdfToImages = async () => {
    if (pdfBatchQueue.length === 0 || isConvertingPdfToImg) return;

    setIsConvertingPdfToImg(true);
    setErrorMessage(null);

    // MEMORY-SAFE SEQUENTIAL PROCESSING (STRICT for...of LOOP)
    for (let i = 0; i < pdfBatchQueue.length; i++) {
      const item = pdfBatchQueue[i];
      if (item.status === 'done') continue;

      setPdfBatchQueue((prev) =>
        prev.map((q, idx) => (idx === i ? { ...q, status: 'processing', errorMsg: undefined } : q))
      );

      try {
        const arrayBuffer = await item.file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
        const pdfDoc = await loadingTask.promise;
        const numPages = pdfDoc.numPages;

        const pageBlobs: { pageNum: number; blob: Blob }[] = [];

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, viewport.width, viewport.height);
          await page.render({ canvasContext: ctx, viewport }).promise;

          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('Canvas render failed'))),
              'image/jpeg',
              0.92
            );
          });

          // Free canvas memory immediately
          canvas.width = 0;
          canvas.height = 0;

          pageBlobs.push({ pageNum, blob });
          setPdfToImgProgress(Math.round((pageNum / numPages) * 100));
        }

        if (pageBlobs.length === 1) {
          const tempUrl = URL.createObjectURL(pageBlobs[0].blob);
          const a = document.createElement('a');
          a.href = tempUrl;
          a.download = `${item.file.name.replace(/\.[^/.]+$/, '')}_page1.jpg`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(tempUrl), 1500);
        } else if (pageBlobs.length > 1) {
          const zip = new JSZip();
          pageBlobs.forEach((p) => {
            zip.file(`trang_${p.pageNum}.jpg`, p.blob);
          });
          const generatedZipBlob = await zip.generateAsync({ type: 'blob' });
          const tempUrl = URL.createObjectURL(generatedZipBlob);
          const a = document.createElement('a');
          a.href = tempUrl;
          a.download = `${item.file.name.replace(/\.[^/.]+$/, '')}_images.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(tempUrl), 1500);
        }

        setPdfBatchQueue((prev) =>
          prev.map((q, idx) => (idx === i ? { ...q, status: 'done' } : q))
        );
      } catch (err) {
        console.error('Batch PDF to image error on:', item.file.name, err);
        setPdfBatchQueue((prev) =>
          prev.map((q, idx) =>
            idx === i ? { ...q, status: 'error', errorMsg: 'Lỗi kết xuất PDF' } : q
          )
        );
      }
    }

    setIsConvertingPdfToImg(false);
  };

  const executePdfToImages = async () => {
    if (!pdfToImgFile) return;

    setIsConvertingPdfToImg(true);
    setPdfToImgProgress(0);
    setErrorMessage(null);
    extractedImages.forEach((img) => URL.revokeObjectURL(img.url));
    setExtractedImages([]);
    setZipBlob(null);

    try {
      const arrayBuffer = await pdfToImgFile.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
      const pdfDoc = await loadingTask.promise;
      const numPages = pdfDoc.numPages;

      const results: ExtractedImagePage[] = [];

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 }); // 2x crisp HD render
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        if (!ctx) continue;

        // Fill background white
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        await page.render({ canvasContext: ctx, viewport }).promise;

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Canvas render failed'))),
            'image/jpeg',
            0.92
          );
        });

        results.push({
          pageNum,
          blob,
          url: URL.createObjectURL(blob),
        });

        setPdfToImgProgress(Math.round((pageNum / numPages) * 100));
      }

      setExtractedImages(results);

      // Single page PDF: auto trigger direct JPG download
      if (results.length === 1) {
        const a = document.createElement('a');
        a.href = results[0].url;
        a.download = `${pdfToImgFile.name.replace(/\.[^/.]+$/, '')}_page1.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else if (results.length > 1) {
        // Multi-page PDF: automatically package all into ZIP and download
        const zip = new JSZip();
        results.forEach((item) => {
          zip.file(`trang_${item.pageNum}.jpg`, item.blob);
        });
        const generatedZipBlob = await zip.generateAsync({ type: 'blob' });
        setZipBlob(generatedZipBlob);

        const a = document.createElement('a');
        a.href = URL.createObjectURL(generatedZipBlob);
        a.download = `${pdfToImgFile.name.replace(/\.[^/.]+$/, '')}_images.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error('PDF to image conversion error:', err);
      setErrorMessage('Đã xảy ra lỗi khi kết xuất ảnh từ tệp PDF. Vui lòng kiểm tra lại file.');
    } finally {
      setIsConvertingPdfToImg(false);
    }
  };

  const handleDownloadSinglePage = (img: ExtractedImagePage) => {
    const a = document.createElement('a');
    a.href = img.url;
    a.download = `${pdfToImgFile?.name.replace(/\.[^/.]+$/, '') || 'cytools'}_trang_${img.pageNum}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadZipAgain = () => {
    if (!zipBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zipBlob);
    a.download = `${pdfToImgFile?.name.replace(/\.[^/.]+$/, '') || 'cytools'}_images.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className="space-y-6">
      {/* Sub-tool Selector Header (3 Sub-tools) */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setActiveSubTool('merge');
            setErrorMessage(null);
          }}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
            activeSubTool === 'merge'
              ? 'border-pink-500 bg-pink-500 text-white'
              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Gộp PDF (Merge PDF)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveSubTool('image-to-pdf');
            setErrorMessage(null);
          }}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
            activeSubTool === 'image-to-pdf'
              ? 'border-pink-500 bg-pink-500 text-white'
              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Ảnh sang PDF (Image to PDF)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveSubTool('pdf-to-images');
            setErrorMessage(null);
          }}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
            activeSubTool === 'pdf-to-images'
              ? 'border-pink-500 bg-pink-500 text-white'
              : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>PDF sang Ảnh (PDF to JPG/ZIP)</span>
        </button>
      </div>

      {/* Graceful Error Banner */}
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

      {/* ============================================================ */}
      {/* SUB-TOOL A: MERGE PDF */}
      {/* ============================================================ */}
      {activeSubTool === 'merge' && (
        <div className="space-y-6">
          {/* Dropzone */}
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
              if (e.dataTransfer.files) {
                handleSelectPdfFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => pdfInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-4 ${
              isDraggingOver
                ? 'border-pink-500 bg-pink-500/5'
                : 'border-slate-300 dark:border-slate-800 hover:border-pink-500/40 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/70'
            }`}
          >
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleSelectPdfFiles(e.target.files)}
            />
            <div className="w-14 h-14 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
              <UploadCloud className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                Kéo thả các file PDF vào đây hoặc click để duyệt file
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
                Hỗ trợ chọn nhiều file PDF cùng lúc • Xử lý 100% trên trình duyệt với pdf-lib
              </p>
            </div>
          </div>

          {/* PDF Files List */}
          {pdfFiles.length > 0 && (
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Danh sách tệp PDF ({pdfFiles.length} file)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sắp xếp thứ tự các tệp bằng mũi tên trước khi gộp
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => pdfInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <FilePlus className="w-3.5 h-3.5 text-pink-500" />
                    <span>Thêm file</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPdfFiles([]);
                      setMergeSuccess(false);
                      setMergedBlob(null);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/50 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                  >
                    Xóa tất cả
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {pdfFiles.map((f, idx) => (
                  <div
                    key={`${f.name}_${idx}`}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 text-xs"
                  >
                    <div className="flex items-center gap-3 overflow-hidden min-w-0">
                      <span className="w-6 h-6 rounded-md bg-pink-500/10 text-pink-600 dark:text-pink-400 flex items-center justify-center font-bold font-mono text-[11px] shrink-0">
                        {idx + 1}
                      </span>
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {f.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatBytes(f.size)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-3">
                      <button
                        type="button"
                        onClick={() => movePdfUp(idx)}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                        title="Di chuyển lên trên"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePdfDown(idx)}
                        disabled={idx === pdfFiles.length - 1}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                        title="Di chuyển xuống dưới"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removePdfFile(idx)}
                        className="p-1.5 rounded-lg border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500 transition-colors cursor-pointer ml-1"
                        title="Xóa file này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={executeMergePdfs}
                  disabled={isMerging || pdfFiles.length < 2}
                  className="w-full py-3.5 px-6 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  {isMerging ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Đang Gộp Các Tệp PDF...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Gộp PDF & Tải Về ({pdfFiles.length} tệp)</span>
                    </>
                  )}
                </button>
              </div>

              {mergeSuccess && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="font-semibold">
                      Gộp PDF thành công! File đã tự động tải về máy của bạn.
                    </span>
                  </div>
                  {mergedBlob && (
                    <button
                      type="button"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(mergedBlob);
                        a.download = `cytools_merged_${Date.now()}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                      className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải lại</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* SUB-TOOL B: IMAGE TO PDF */}
      {/* ============================================================ */}
      {activeSubTool === 'image-to-pdf' && (
        <div className="space-y-6">
          {/* Dropzone */}
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
              if (e.dataTransfer.files) {
                handleSelectImageFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => imageInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-4 ${
              isDraggingOver
                ? 'border-pink-500 bg-pink-500/5'
                : 'border-slate-300 dark:border-slate-800 hover:border-pink-500/40 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/70'
            }`}
          >
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleSelectImageFiles(e.target.files)}
            />
            <div className="w-14 h-14 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
              <ImageIcon className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                Kéo thả nhiều hình ảnh vào đây hoặc click để chọn ảnh
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
                Hỗ trợ JPG, PNG, WebP • Tự động căn chỉnh vừa trang A4 tiêu chuẩn (pdf-lib)
              </p>
            </div>
          </div>

          {/* Images Management */}
          {imageItems.length > 0 && (
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800/80">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Danh sách hình ảnh ({imageItems.length} trang)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Mỗi hình ảnh sẽ được căn lề tự động thành 1 trang PDF A4
                  </p>
                </div>

                {/* Page Orientation Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Khổ giấy:
                  </span>
                  <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={() => setOrientation('portrait')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        orientation === 'portrait'
                          ? 'bg-white dark:bg-slate-900 text-pink-600 dark:text-pink-400'
                          : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      A4 Dọc
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrientation('landscape')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        orientation === 'landscape'
                          ? 'bg-white dark:bg-slate-900 text-pink-600 dark:text-pink-400'
                          : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      A4 Ngang
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setImageItems([])}
                    className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/50 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer ml-2"
                  >
                    Xóa tất cả
                  </button>
                </div>
              </div>

              {/* Thumbnails Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {imageItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="relative group rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-100 dark:bg-slate-950 flex flex-col"
                  >
                    <div className="aspect-square flex items-center justify-center p-1 overflow-hidden">
                      <img
                        src={item.previewUrl}
                        alt="Preview"
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    <div className="p-1.5 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px]">
                      <span className="font-bold text-slate-500">Trang {idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeImage(item.id)}
                        className="text-red-500 hover:text-red-700 p-0.5 cursor-pointer"
                        title="Xóa ảnh này"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={executeImageToPdf}
                  disabled={isPackagingPdf || imageItems.length === 0}
                  className="w-full py-3.5 px-6 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  {isPackagingPdf ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Đang Đóng Gói {imageItems.length} Trang PDF...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Đóng Gói PDF & Tải Về ({imageItems.length} hình ảnh)</span>
                    </>
                  )}
                </button>
              </div>

              {packageSuccess && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="font-semibold">
                      Tạo tệp PDF thành công! File đã tự động tải về máy của bạn.
                    </span>
                  </div>
                  {packagedBlob && (
                    <button
                      type="button"
                      onClick={() => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(packagedBlob);
                        a.download = `cytools_images_${Date.now()}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                      className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải lại</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* SUB-TOOL C: PDF TO IMAGES (JPG / ZIP) */}
      {/* ============================================================ */}
      {activeSubTool === 'pdf-to-images' && (
        <div className="space-y-6">
          <input
            ref={pdfToImgInputRef}
            type="file"
            multiple
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleSelectMultiplePdfToImg(e.target.files);
                e.target.value = '';
              }
            }}
          />

          {/* Dropzone */}
          {!pdfToImgFile && pdfBatchQueue.length === 0 && (
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
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleSelectMultiplePdfToImg(e.dataTransfer.files);
                }
              }}
              onClick={() => pdfToImgInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-4 ${
                isDraggingOver
                  ? 'border-pink-500 bg-pink-500/5'
                  : 'border-slate-300 dark:border-slate-800 hover:border-pink-500/40 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/70'
              }`}
            >
              <div className="w-14 h-14 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500">
                <FileText className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Chọn hoặc kéo thả file PDF cần chuyển sang ảnh JPG (Hỗ trợ nhiều file)
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
                  Trích xuất từng trang thành ảnh JPG độ nét cao • Tự động đóng gói ZIP nếu có nhiều trang • Xử lý 100% Client-side bằng PDF.js
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  📄 1 trang: Tải thẳng file .JPG
                </span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  📦 Nhiều trang: Đóng gói trọn bộ file .ZIP
                </span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 inline-flex items-center gap-1">
                  <Crown className="w-3 h-3" />
                  PRO: Chuyển đổi hàng loạt (Batch Queue)
                </span>
              </div>
            </div>
          )}

          {/* PRO Batch Queue Panel */}
          {pdfBatchQueue.length > 1 && (
            <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Hàng đợi PDF sang JPG/ZIP ({pdfBatchQueue.length} file)
                  </h3>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <Crown className="w-3 h-3" />
                    PRO Batch ({pdfBatchQueue.filter((q) => q.status === 'done').length}/{pdfBatchQueue.length})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => pdfToImgInputRef.current?.click()}
                    disabled={isConvertingPdfToImg}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <FilePlus className="w-3.5 h-3.5 text-pink-500" />
                    <span>Thêm PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPdfBatchQueue([]);
                      setPdfToImgFile(null);
                      setPdfNumPages(0);
                      setExtractedImages([]);
                      setZipBlob(null);
                    }}
                    disabled={isConvertingPdfToImg}
                    className="text-xs text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                  >
                    Xóa tất cả
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {pdfBatchQueue.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                      item.status === 'processing'
                        ? 'bg-pink-500/5 border-pink-500/40'
                        : item.status === 'done'
                        ? 'bg-emerald-500/5 border-emerald-500/20'
                        : item.status === 'error'
                        ? 'bg-red-500/5 border-red-500/20'
                        : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="overflow-hidden min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-200 truncate">
                          {idx + 1}. {item.file.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatBytes(item.file.size)}
                          {item.errorMsg ? ` • ${item.errorMsg}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === 'pending' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          <Clock className="w-3 h-3" />
                          Chờ xử lý
                        </span>
                      )}
                      {item.status === 'processing' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Đang kết xuất ({pdfToImgProgress}%)
                        </span>
                      )}
                      {item.status === 'done' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" />
                          Đã tải về
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                          <AlertCircle className="w-3 h-3" />
                          Lỗi
                        </span>
                      )}

                      {!isConvertingPdfToImg && (
                        <button
                          type="button"
                          onClick={() =>
                            setPdfBatchQueue((prev) => prev.filter((q) => q.id !== item.id))
                          }
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={executeBatchPdfToImages}
                disabled={isConvertingPdfToImg}
                className="w-full py-3.5 px-6 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                {isConvertingPdfToImg ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang chuyển đổi tuần tự & tải về...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Bắt đầu chuyển đổi hàng loạt ({pdfBatchQueue.length} file PDF)</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Selected PDF Card (Single File Mode) */}
          {pdfToImgFile && pdfBatchQueue.length <= 1 && (
            <div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-500 shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {pdfToImgFile.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatBytes(pdfToImgFile.size)} • {pdfNumPages > 0 ? `${pdfNumPages} trang tài liệu` : 'Đang phân tích...'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => pdfToImgInputRef.current?.click()}
                    disabled={isConvertingPdfToImg}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <FilePlus className="w-3.5 h-3.5 text-pink-500" />
                    <span>Thêm PDF (PRO)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPdfToImgFile(null);
                      setPdfBatchQueue([]);
                      setPdfNumPages(0);
                      setExtractedImages([]);
                      setZipBlob(null);
                    }}
                    disabled={isConvertingPdfToImg}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 disabled:opacity-50 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    Đổi file
                  </button>
                </div>
              </div>

              {/* Progress indicator */}
              {isConvertingPdfToImg && (
                <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-pink-600 dark:text-pink-400 font-semibold">
                      <Loader2 className="w-4 h-4 animate-spin text-pink-500" />
                      Đang kết xuất các trang PDF sang JPG HD...
                    </span>
                    <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">
                      {pdfToImgProgress}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-pink-500 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${pdfToImgProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Skeleton Grid during PDF-to-Image rendering */}
              {isConvertingPdfToImg && (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-48 rounded" />
                    <Skeleton className="h-4 w-20 rounded" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {Array.from({ length: Math.min(pdfNumPages || 4, 8) }).map((_, idx) => (
                      <div key={idx} className="space-y-2">
                        <Skeleton className="w-full aspect-[3/4] rounded-xl" />
                        <Skeleton className="h-3 w-16 mx-auto rounded" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Convert Action Button */}
              {extractedImages.length === 0 && !isConvertingPdfToImg && (
                <button
                  type="button"
                  onClick={executePdfToImages}
                  className="w-full py-3.5 px-6 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.99]"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>
                    Bắt đầu chuyển sang JPG {pdfNumPages > 0 ? `(${pdfNumPages} trang)` : ''}
                  </span>
                </button>
              )}

              {/* Extracted Images Results */}
              {extractedImages.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span>Đã kết xuất thành công {extractedImages.length} trang ảnh JPG!</span>
                    </div>

                    {extractedImages.length > 1 && zipBlob && (
                      <button
                        type="button"
                        onClick={handleDownloadZipAgain}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold cursor-pointer"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>Tải lại trọn bộ (.ZIP)</span>
                      </button>
                    )}
                  </div>

                  {/* Thumbnail gallery */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 pt-2">
                    {extractedImages.map((img) => (
                      <div
                        key={img.pageNum}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50 dark:bg-slate-950/60 flex flex-col"
                      >
                        <div className="aspect-[3/4] bg-white flex items-center justify-center p-2 overflow-hidden border-b border-slate-100 dark:border-slate-800">
                          <img
                            src={img.url}
                            alt={`Trang ${img.pageNum}`}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>

                        <div className="p-2 flex items-center justify-between text-xs bg-white dark:bg-slate-900">
                          <span className="font-bold text-slate-700 dark:text-slate-300">
                            Trang {img.pageNum}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDownloadSinglePage(img)}
                            className="text-pink-500 hover:text-pink-600 p-1 rounded hover:bg-pink-50 dark:hover:bg-pink-950/40 transition-colors cursor-pointer"
                            title="Tải ảnh trang này"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PdfToolsTab;
