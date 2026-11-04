import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import type { PdfRasterPageItem } from '../types/watermarkRemover';

if (typeof window !== 'undefined' && 'GlobalWorkerOptions' in pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '3.11.174'}/pdf.worker.min.js`;
}

/**
 * Builds an ImageData binary mask (alpha > 128 where watermark pixels are detected)
 * for ONNX AI Inpainting on a rendered PDF page.
 */
export function buildWatermarkMaskFromPage(
  src: ImageData,
  lumaThreshold = 195
): ImageData {
  const mask = new ImageData(src.width, src.height);
  const s = src.data;
  const m = mask.data;
  let markedPixels = 0;

  for (let i = 0; i < s.length; i += 4) {
    const r = s[i];
    const g = s[i + 1];
    const b = s[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);

    // Target mid-to-light gray or translucent stamp pixels (150..244)
    if (luma >= Math.max(145, lumaThreshold - 40) && luma <= 246 && chroma <= 50) {
      m[i] = 255;
      m[i + 1] = 255;
      m[i + 2] = 255;
      m[i + 3] = 255;
      markedPixels++;
    }
  }

  // Fallback: if no mid-gray pixels matched, mark center diagonal band
  if (markedPixels === 0) {
    const cx = Math.floor(src.width * 0.5);
    const cy = Math.floor(src.height * 0.5);
    const rx = Math.floor(src.width * 0.28);
    const ry = Math.floor(src.height * 0.08);
    for (let y = Math.max(0, cy - ry); y < Math.min(src.height, cy + ry); y++) {
      for (let x = Math.max(0, cx - rx); x < Math.min(src.width, cx + rx); x++) {
        const idx = (y * src.width + x) * 4;
        m[idx] = 255;
        m[idx + 1] = 255;
        m[idx + 2] = 255;
        m[idx + 3] = 255;
      }
    }
  }

  return mask;
}

/**
 * Smart Luma/Chroma watermark filter:
 * Strips light-gray or semi-transparent diagonal/background watermark stamps
 * (where luminance is above `lumaThreshold` and saturation is low) back to pure white (255,255,255)
 * while preserving crisp dark body text, tables, and saturated colored figures.
 */
export function applySmartWatermarkLumaFilter(
  src: ImageData,
  lumaThreshold = 195
): ImageData {
  const out = new ImageData(
    new Uint8ClampedArray(src.data),
    src.width,
    src.height
  );
  const d = out.data;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];

    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const chroma = maxC - minC;

    // Neutral light-gray / faint stamp watermark or very faint pastel tint
    if (luma >= lumaThreshold && chroma <= 42) {
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
    } else if (luma >= lumaThreshold - 18 && luma < lumaThreshold && chroma <= 28) {
      // Softly boost transition pixels near the watermark edge to prevent haloing
      const boost = Math.min(255, Math.round(luma + (255 - luma) * 0.65));
      d[i] = boost;
      d[i + 1] = boost;
      d[i + 2] = boost;
    }
  }

  return out;
}

/**
 * Converts an ImageData buffer into a data URL (JPEG or PNG) via an offscreen HTML5 canvas.
 */
export function imageDataToDataUrl(
  imageData: ImageData,
  mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality = 0.92
): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Không thể khởi tạo Canvas 2D context.');
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL(mimeType, quality);
}

/**
 * Converts a data URL into a Uint8Array binary buffer for embedding in pdf-lib.
 */
function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Renders every page of a PDF ArrayBuffer at high resolution (`scale = 2.0`)
 * and applies the Smart Luma Watermark Filter to produce clean raster pages.
 */
export async function renderPdfPagesForRasterClean(
  pdfBuffer: ArrayBuffer,
  scale = 2.0,
  lumaThreshold = 195,
  onProgress?: (pct: number) => void
): Promise<PdfRasterPageItem[]> {
  // Slice buffer so pdf.js worker does not detach the caller's ArrayBuffer
  const safeCopy = new Uint8Array(pdfBuffer.slice(0));
  const loadingTask = pdfjsLib.getDocument({ data: safeCopy });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pages: PdfRasterPageItem[] = [];

  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex);
    const baseViewport = page.getViewport({ scale: 1.0 });
    const renderViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(renderViewport.width);
    canvas.height = Math.round(renderViewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Không thể khởi tạo Canvas 2D cho trang PDF.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport: renderViewport,
    }).promise;

    const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const cleanedImageData = applySmartWatermarkLumaFilter(
      originalImageData,
      lumaThreshold
    );
    const previewUrl = imageDataToDataUrl(cleanedImageData, 'image/jpeg', 0.92);

    pages.push({
      pageNumber: pageIndex,
      width: canvas.width,
      height: canvas.height,
      pdfWidthPts: baseViewport.width,
      pdfHeightPts: baseViewport.height,
      originalImageData,
      cleanedImageData,
      previewUrl,
      aiInpainted: false,
    });

    if (onProgress) {
      onProgress(Math.round((pageIndex / totalPages) * 100));
    }
  }

  return pages;
}

/**
 * Re-packs all cleaned raster pages back into a standard multi-page PDF document
 * preserving each page's original point dimensions (`pdfWidthPts x pdfHeightPts`).
 */
export async function packRasterPagesToPdf(
  pages: PdfRasterPageItem[],
  onProgress?: (pct: number) => void
): Promise<Uint8Array> {
  const outPdf = await PDFDocument.create();
  outPdf.setTitle('');
  outPdf.setProducer('AioTools Universal PDF Cleaner');
  outPdf.setCreator('AioTools Universal PDF Cleaner');

  for (let i = 0; i < pages.length; i++) {
    const item = pages[i];
    const jpegUrl = imageDataToDataUrl(item.cleanedImageData, 'image/jpeg', 0.92);
    const jpegBytes = dataUrlToUint8Array(jpegUrl);
    const embeddedJpg = await outPdf.embedJpg(jpegBytes);

    const page = outPdf.addPage([item.pdfWidthPts, item.pdfHeightPts]);
    page.drawImage(embeddedJpg, {
      x: 0,
      y: 0,
      width: item.pdfWidthPts,
      height: item.pdfHeightPts,
    });

    if (onProgress) {
      onProgress(Math.round(((i + 1) / pages.length) * 100));
    }
  }

  return outPdf.save({ useObjectStreams: false });
}
