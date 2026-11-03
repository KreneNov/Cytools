import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
} from 'pdf-lib';
import type { PdfCleanOptions, PdfCleanResult } from '../types/watermarkRemover';

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
 * overlay form XObjects, and content stream text blocks matching target keywords.
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
  let strippedKeywordsCount = 0;
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
              if (xObj instanceof PDFDict) {
                const subtype = xObj.get(PDFName.of('Subtype'));
                if (subtype instanceof PDFName && subtype.asString() === '/Form') {
                  const pieceInfo = xObj.get(PDFName.of('PieceInfo'));
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

    // 4. Strip matching BT ... ET text blocks from page Content Streams
    try {
      const contentsRef = pageNode.get(PDFName.of('Contents'));
      const contentsObj = pdfDoc.context.lookup(contentsRef);

      const contentStreams = Array.isArray(contentsObj)
        ? contentsObj
        : contentsObj
        ? [contentsObj]
        : [];

      for (const stream of contentStreams) {
        if (
          stream &&
          typeof (stream as any).getContents === 'function' &&
          typeof (stream as any).setContents === 'function'
        ) {
          const rawBytes: Uint8Array = (stream as any).getContents();
          const decoder = new TextDecoder('latin1');
          const streamText = decoder.decode(rawBytes);

          // Regex matching BT ... ET text blocks
          const btRegex = /BT[\s\S]*?ET/g;
          let modified = false;

          const cleanedText = streamText.replace(btRegex, (match) => {
            const lowerMatch = match.toLowerCase();
            const containsWatermark = allTargetKeywords.some((kw) =>
              lowerMatch.includes(kw)
            );

            if (containsWatermark) {
              strippedKeywordsCount++;
              modified = true;
              return ''; // Remove matching BT ... ET block
            }
            return match;
          });

          if (modified) {
            const encoder = new TextEncoder();
            (stream as any).setContents(encoder.encode(cleanedText));
          }
        }
      }
    } catch {
      // Ignore content stream parsing issues on encrypted or non-standard streams
    }
  }

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
