import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFObject,
  PDFRawStream,
} from 'pdf-lib';
import type { PdfCleanOptions, PdfStripResult } from '../types/watermarkRemover';
import { stripPdfPageContentStreams } from './pdfWatermarkStripper';

const DEFAULT_WATERMARK_KEYWORDS = [
  'camscanner',
  'scanned with camscanner',
  'confidential',
  'sample',
  'draft',
  'do not copy',
  'watermark',
  'tài liệu nội bộ',
  'bản nháp',
  'không sao chép',
];

/**
 * Safe Client-Side PDF Watermark & Stamp Stripper
 * - Strips `/Watermark`, `/Stamp`, `/FreeText` annotations, `PieceInfo` metadata, and watermark Form XObject overlays.
 * - Uses a byte-accurate content-stream tokenizer to remove Marked-Content watermark artifacts
 *   and standard ASCII text operators (`Tj`, `TJ`) on non-subsetted fonts.
 * - Defensive Guardrail: Returns `{ success: false, reason: 'SUBSET_FONT_UNSUPPORTED' }` instead of
 *   corrupting subsetted/CID-encoded fonts when vector-baked text watermarks cannot be safely removed.
 */
export async function cleanPdfWatermarks(
  pdfBuffer: ArrayBuffer,
  options: PdfCleanOptions = {}
): Promise<PdfStripResult> {
  const originalSize = pdfBuffer.byteLength;
  let pdfDoc: PDFDocument;

  try {
    pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  } catch {
    return {
      success: false,
      reason: 'PARSE_FAILED',
      message: 'Không thể đọc cấu trúc tệp PDF. Tệp có thể bị mã hóa mật khẩu hoặc bị hỏng.',
      details: [],
    };
  }

  const customKeywords = (options.customKeywords || [])
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);

  const allTargetKeywords = Array.from(
    new Set([...DEFAULT_WATERMARK_KEYWORDS, ...customKeywords])
  );

  let strippedAnnotsCount = 0;
  let strippedXObjectsCount = 0;

  const pages = pdfDoc.getPages();

  for (const page of pages) {
    const pageNode = page.node;

    // 1. Strip Watermark / Stamp / FreeText Annotations
    if (options.stripAnnotations !== false) {
      const annots = pageNode.Annots();
      if (annots instanceof PDFArray) {
        const remainingAnnots: PDFObject[] = [];
        const size = annots.size();

        for (let i = 0; i < size; i++) {
          const annotRef = annots.get(i);
          const annotDict = pdfDoc.context.lookup(annotRef);

          if (annotDict instanceof PDFDict) {
            const subtype = annotDict.get(PDFName.of('Subtype'));
            const subtypeName = subtype instanceof PDFName ? subtype.asString() : '';

            const isWatermarkType =
              subtypeName === '/Watermark' ||
              subtypeName === '/Stamp' ||
              subtypeName === '/FreeText';

            let hasWatermarkContent = false;
            const contents = annotDict.get(PDFName.of('Contents'));
            if (contents) {
              const textStr = contents.toString().toLowerCase();
              if (allTargetKeywords.some((kw) => textStr.includes(kw))) {
                hasWatermarkContent = true;
              }
            }

            if (isWatermarkType || hasWatermarkContent) {
              strippedAnnotsCount++;
              continue;
            }
          }
          remainingAnnots.push(annotRef);
        }

        if (remainingAnnots.length < size) {
          pageNode.set(PDFName.of('Annots'), pdfDoc.context.obj(remainingAnnots));
        }
      }
    }

    // 2. Strip PieceInfo Dictionary
    if (options.stripPieceInfo !== false) {
      if (pageNode.has(PDFName.of('PieceInfo'))) {
        pageNode.delete(PDFName.of('PieceInfo'));
      }
    }

    // 3. Strip Explicit Watermark Overlay Form XObjects
    if (options.stripOverlayForms !== false) {
      const resources = pageNode.Resources();
      if (resources instanceof PDFDict) {
        const xObjects = resources.get(PDFName.of('XObject'));
        const xObjDict = pdfDoc.context.lookup(xObjects);

        if (xObjDict instanceof PDFDict) {
          const keysToDelete: PDFName[] = [];
          for (const key of xObjDict.keys()) {
            const keyStr = key.asString().toLowerCase();
            if (
              keyStr.includes('watermark') ||
              keyStr.includes('stamp') ||
              keyStr.includes('bgoverlay')
            ) {
              keysToDelete.push(key);
            } else {
              const xObj = pdfDoc.context.lookup(xObjDict.get(key));
              const targetDict =
                xObj instanceof PDFDict
                  ? xObj
                  : xObj instanceof PDFRawStream
                  ? xObj.dict
                  : null;
              if (targetDict) {
                const subtype = targetDict.get(PDFName.of('Subtype'));
                if (subtype instanceof PDFName && subtype.asString() === '/Form') {
                  const pieceInfo = targetDict.get(PDFName.of('PieceInfo'));
                  if (pieceInfo) keysToDelete.push(key);
                }
              }
            }
          }

          for (const key of keysToDelete) {
            xObjDict.delete(key);
            strippedXObjectsCount++;
          }
        }
      }
    }
  }

  // 4. Tokenize & Strip Page Content Streams with Font-Safety Guardrail
  const streamSummary = stripPdfPageContentStreams(pdfDoc, allTargetKeywords);

  const totalRemovedItems =
    strippedAnnotsCount +
    strippedXObjectsCount +
    streamSummary.strippedArtifactBlocks +
    streamSummary.strippedTextOps;

  // Defensive Guardrail: If nothing could be safely stripped AND the document uses subsetted / CID fonts,
  // do NOT apply blind regex that would corrupt glyph indices or binary layout.
  if (totalRemovedItems === 0 && streamSummary.unsupportedDetails.length > 0) {
    return {
      success: false,
      reason: 'SUBSET_FONT_UNSUPPORTED',
      message:
        'Tệp PDF này sử dụng bảng mã Font Subset (hoặc mã hóa Glyph ToUnicode/CID) khiến watermark đã bị nướng cứng vào luồng vector. Việc can thiệp trực tiếp vào luồng byte sẽ làm hỏng font chữ và bố cục tài liệu.',
      details: streamSummary.unsupportedDetails,
    };
  }

  // Remove PieceInfo from document Catalog
  const catalog = pdfDoc.catalog;
  if (catalog.has(PDFName.of('PieceInfo'))) {
    catalog.delete(PDFName.of('PieceInfo'));
  }

  const cleanedPdfBytes = await pdfDoc.save();

  // 5. Post-save structural integrity verification
  try {
    const verifyDoc = await PDFDocument.load(cleanedPdfBytes, { ignoreEncryption: true });
    if (verifyDoc.getPageCount() !== pages.length) {
      return {
        success: false,
        reason: 'PARSE_FAILED',
        message: 'Kiểm tra toàn vẹn cấu trúc PDF không thành công. Đã hủy thay đổi để bảo vệ tệp gốc.',
        details: [],
      };
    }
  } catch {
    return {
      success: false,
      reason: 'PARSE_FAILED',
      message: 'Kiểm tra toàn vẹn cấu trúc PDF không thành công. Đã hủy thay đổi để bảo vệ tệp gốc.',
      details: [],
    };
  }

  return {
    success: true,
    cleanedPdfBytes,
    originalSize,
    cleanedSize: cleanedPdfBytes.byteLength,
    strippedAnnotsCount,
    strippedArtifactBlocks: streamSummary.strippedArtifactBlocks,
    strippedTextOps: streamSummary.strippedTextOps,
    strippedXObjectsCount,
  };
}

export { stripPdfPageContentStreams } from './pdfWatermarkStripper';
