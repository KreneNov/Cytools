import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFRawStream,
} from 'pdf-lib';
import type { PdfCleanOptions, PdfCleanResult } from '../types/watermarkRemover';
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
 * 100% Client-Side PDF Watermark & Stamp Cleaner
 * Powered by pdf-lib: removes watermark annotations, PieceInfo dictionaries,
 * overlay form XObjects, and deep-cleans compressed Page Content Streams (Tj/TJ/BDC).
 */
export async function cleanPdfWatermarks(
  pdfBuffer: ArrayBuffer,
  options: PdfCleanOptions = {}
): Promise<PdfCleanResult> {
  const originalSize = pdfBuffer.byteLength;
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

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
        const remainingAnnots: any[] = [];
        const size = annots.size();

        for (let i = 0; i < size; i++) {
          const annotRef = annots.get(i);
          const annotDict = pdfDoc.context.lookup(annotRef);

          if (annotDict instanceof PDFDict) {
            const subtype = annotDict.get(PDFName.of('Subtype'));
            const subtypeName = subtype instanceof PDFName ? subtype.asString() : '';

            // Check if annotation is Watermark, Stamp, or FreeText with watermark text
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
              continue; // Drop this annotation
            }
          }
          remainingAnnots.push(annotRef);
        }

        // Rebuild Annots array
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

    // 3. Strip Repeated Overlay Form XObjects
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

  // 4. Deep-Clean Raw Page & Form XObject Content Streams (Tj, TJ, BDC...EMC, ToUnicode CMaps)
  const strippedKeywordsCount = stripPdfPageContentStreams(pdfDoc, allTargetKeywords);

  // Also remove PieceInfo and Watermark metadata from document Catalog
  const catalog = pdfDoc.catalog;
  if (catalog.has(PDFName.of('PieceInfo'))) {
    catalog.delete(PDFName.of('PieceInfo'));
  }

  const cleanedPdfBytes = await pdfDoc.save();

  return {
    cleanedPdfBytes,
    originalSize,
    cleanedSize: cleanedPdfBytes.byteLength,
    strippedAnnotsCount,
    strippedKeywordsCount,
    strippedXObjectsCount,
  };
}

export { stripPdfPageContentStreams } from './pdfWatermarkStripper';
