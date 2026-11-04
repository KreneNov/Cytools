import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFRef,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import type { PdfUnsupportedDetail } from '../types/watermarkRemover';
import {
  tokenizePdfContentStream,
  extractSafeAsciiFromOperand,
  spliceOutByteRanges,
  type PdfContentToken,
} from './pdfContentTokenizer';

export interface FontSafetyInfo {
  fontKey: string;
  baseFont: string;
  fontKind: string;
  safe: boolean;
}

export interface StreamStripSummary {
  strippedArtifactBlocks: number;
  strippedTextOps: number;
  unsupportedDetails: PdfUnsupportedDetail[];
}

/**
 * Inspects `/Resources -> /Font` on a page and classifies each font as `safe`
 * (standard uncompressed ASCII with explicit identity/WinAnsi encoding and no subset prefix)
 * vs `unsafe` (subsetted font `ABCDEF+Name`, Type0/CID `Identity-H`, or custom `ToUnicode` CMap).
 */
export function classifyPageFonts(
  pdfDoc: PDFDocument,
  resources: PDFDict | undefined
): Map<string, FontSafetyInfo> {
  const result = new Map<string, FontSafetyInfo>();
  if (!(resources instanceof PDFDict)) return result;

  const fontEntry = resources.get(PDFName.of('Font'));
  const fontDict = pdfDoc.context.lookup(fontEntry);
  if (!(fontDict instanceof PDFDict)) return result;

  for (const key of fontDict.keys()) {
    const fontKey = key.asString(); // e.g. "/F1"
    const fontObj = pdfDoc.context.lookup(fontDict.get(key));
    if (!(fontObj instanceof PDFDict)) continue;

    const subtypeObj = fontObj.get(PDFName.of('Subtype'));
    const subtype = subtypeObj instanceof PDFName ? subtypeObj.asString() : '/Unknown';

    const baseFontObj = fontObj.get(PDFName.of('BaseFont'));
    const rawBaseFont = baseFontObj instanceof PDFName ? baseFontObj.asString().replace(/^\//, '') : 'UnknownFont';

    const encodingObj = fontObj.get(PDFName.of('Encoding'));
    const encodingName =
      encodingObj instanceof PDFName
        ? encodingObj.asString()
        : encodingObj instanceof PDFDict
        ? 'CustomEncodingDict'
        : 'Default';

    const hasToUnicode = Boolean(fontObj.get(PDFName.of('ToUnicode')));
    const hasSubsetPrefix = /^[A-Z]{6}\+/.test(rawBaseFont);
    const isCompositeOrType3 =
      subtype === '/Type0' ||
      subtype === '/CIDFontType0' ||
      subtype === '/CIDFontType2' ||
      subtype === '/Type3';
    const isIdentityEncoding =
      encodingName === '/Identity-H' ||
      encodingName === '/Identity-V' ||
      encodingName === 'CustomEncodingDict';

    const safe =
      !hasSubsetPrefix &&
      !isCompositeOrType3 &&
      !isIdentityEncoding &&
      !hasToUnicode &&
      (subtype === '/Type1' || subtype === '/TrueType');

    const reasons: string[] = [];
    if (hasSubsetPrefix) reasons.push('Font Subset');
    if (isCompositeOrType3) reasons.push(`Composite ${subtype.replace('/', '')}`);
    if (isIdentityEncoding) reasons.push(encodingName.replace('/', ''));
    if (hasToUnicode) reasons.push('ToUnicode CMap');

    result.set(fontKey, {
      fontKey,
      baseFont: rawBaseFont,
      fontKind: reasons.length > 0 ? reasons.join(' · ') : `${subtype.replace('/', '')} (${encodingName.replace('/', '')})`,
      safe,
    });
  }

  return result;
}

function matchesKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  const compact = lower.replace(/\s+/g, ' ').trim();
  const spaceless = lower.replace(/\s+/g, '');
  if (!spaceless) return false;

  for (const kw of keywords) {
    if (lower.includes(kw) || compact.includes(kw)) return true;
    const kwSpaceless = kw.replace(/\s+/g, '');
    if (kwSpaceless.length >= 4 && spaceless.includes(kwSpaceless)) return true;
  }
  return false;
}

function isRangeInsideAny(
  start: number,
  end: number,
  ranges: Array<{ start: number; end: number }>
): boolean {
  for (const r of ranges) {
    if (start >= r.start && end <= r.end) return true;
  }
  return false;
}

/**
 * Analyzes a single decompressed content stream using the byte-accurate tokenizer:
 * - Tier A: Removes balanced `/Artifact << ... /Subtype /Watermark ... >> BDC ... EMC` and `/Watermark BMC/BDC ... EMC` blocks.
 * - Tier B: Removes `Tj`/`TJ` text operators drawn with verified `safe` fonts (along with enclosing `BT...ET` and `q...Q` if empty).
 * - Guardrail: Records `unsupportedDetails` when subsetted/hex-encoded fonts are encountered in text blocks.
 */
export function analyzeAndStripContentStream(
  streamBytes: Uint8Array,
  targetKeywords: string[],
  pageFonts: Map<string, FontSafetyInfo>,
  pageIndex: number
): {
  cleanedBytes: Uint8Array | null;
  strippedArtifactBlocks: number;
  strippedTextOps: number;
  unsupportedDetails: PdfUnsupportedDetail[];
} {
  const tokens: PdfContentToken[] = tokenizePdfContentStream(streamBytes);
  const rangesToDelete: Array<{ start: number; end: number }> = [];
  const unsupportedMap = new Map<string, PdfUnsupportedDetail>();

  let strippedArtifactBlocks = 0;
  let strippedTextOps = 0;

  // ------------------------------------------------------------------
  // Tier A: Marked-Content Watermark Artifacts (`BDC` / `BMC` ... `EMC`)
  // ------------------------------------------------------------------
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.kind !== 'operator' || (tok.raw !== 'BDC' && tok.raw !== 'BMC')) continue;

    let tagIdx = -1;
    let isWatermarkMarkedBlock = false;

    if (tok.raw === 'BMC' && i >= 1 && tokens[i - 1].kind === 'name') {
      tagIdx = i - 1;
      if (/^\/Watermark$/i.test(tokens[tagIdx].raw)) {
        isWatermarkMarkedBlock = true;
      }
    } else if (tok.raw === 'BDC' && i >= 2 && tokens[i - 2].kind === 'name') {
      tagIdx = i - 2;
      const tagName = tokens[tagIdx].raw;
      const propTok = tokens[i - 1];
      if (/^\/Watermark$/i.test(tagName)) {
        isWatermarkMarkedBlock = true;
      } else if (
        /^\/Artifact$/i.test(tagName) &&
        propTok.kind === 'dict' &&
        /\/Subtype\s*\/Watermark/i.test(propTok.raw)
      ) {
        isWatermarkMarkedBlock = true;
      }
    }

    if (!isWatermarkMarkedBlock || tagIdx < 0) continue;

    // Find matching balanced `EMC`
    let depth = 1;
    let emcIdx = -1;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].kind === 'operator') {
        if (tokens[j].raw === 'BMC' || tokens[j].raw === 'BDC') depth++;
        else if (tokens[j].raw === 'EMC') {
          depth--;
          if (depth === 0) {
            emcIdx = j;
            break;
          }
        }
      }
    }

    if (emcIdx !== -1) {
      rangesToDelete.push({
        start: tokens[tagIdx].start,
        end: tokens[emcIdx].end,
      });
      strippedArtifactBlocks++;
      i = emcIdx;
    }
  }

  // ------------------------------------------------------------------
  // Tier B: Inspect `BT ... ET` blocks and `q ... Q` state wrappers
  // ------------------------------------------------------------------
  let activeFontKey: string | null = null;
  const qStack: number[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (isRangeInsideAny(tok.start, tok.end, rangesToDelete)) continue;

    if (tok.kind === 'operator') {
      if (tok.raw === 'q') {
        qStack.push(i);
        continue;
      }
      if (tok.raw === 'Q') {
        qStack.pop();
        continue;
      }
      if (tok.raw === 'Tf' && i >= 2 && tokens[i - 2].kind === 'name') {
        activeFontKey = tokens[i - 2].raw;
        continue;
      }
    }

    if (tok.kind === 'operator' && tok.raw === 'BT') {
      // Find matching ET
      let etIdx = -1;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].kind === 'operator' && tokens[j].raw === 'ET') {
          etIdx = j;
          break;
        }
      }
      if (etIdx === -1) continue;

      let blockFontKey: string | null = activeFontKey;
      let totalTextOpsInBlock = 0;
      let matchedSafeTextOpsInBlock = 0;
      const opDeleteRanges: Array<{ start: number; end: number }> = [];
      let concatenatedSafeText = '';
      let blockUsesUnsafeFont = false;

      for (let k = i + 1; k < etIdx; k++) {
        const inner = tokens[k];
        if (inner.kind === 'operator' && inner.raw === 'Tf' && k >= 2 && tokens[k - 2].kind === 'name') {
          blockFontKey = tokens[k - 2].raw;
          activeFontKey = blockFontKey;
          continue;
        }

        if (
          inner.kind === 'operator' &&
          (inner.raw === 'Tj' || inner.raw === 'TJ' || inner.raw === "'" || inner.raw === '"')
        ) {
          const operandIdx = k - 1;
          if (operandIdx <= i) continue;
          const operandTok = tokens[operandIdx];
          if (
            operandTok.kind !== 'string' &&
            operandTok.kind !== 'hexstring' &&
            operandTok.kind !== 'array'
          ) {
            continue;
          }

          totalTextOpsInBlock++;
          const fontInfo = blockFontKey ? pageFonts.get(blockFontKey) : undefined;
          const isFontSafe = fontInfo ? fontInfo.safe : true;
          const { text, hasHexOrBinary } = extractSafeAsciiFromOperand(operandTok);

          if (!isFontSafe || hasHexOrBinary) {
            blockUsesUnsafeFont = true;
            const detailKey = `${pageIndex}:${fontInfo?.baseFont || blockFontKey || 'HexEncodedStream'}`;
            if (!unsupportedMap.has(detailKey)) {
              unsupportedMap.set(detailKey, {
                pageIndex: pageIndex + 1,
                fontName: fontInfo?.baseFont || (blockFontKey ? blockFontKey.replace('/', '') : 'CID/Hex Font'),
                fontKind: fontInfo?.fontKind || 'Hex-Encoded Glyph Stream',
              });
            }
            continue;
          }

          concatenatedSafeText += text;
          if (matchesKeyword(text, targetKeywords)) {
            matchedSafeTextOpsInBlock++;
            const opStart =
              inner.raw === '"' && k >= 3 ? tokens[k - 3].start : operandTok.start;
            opDeleteRanges.push({ start: opStart, end: inner.end });
          }
        }
      }

      // Check if individual safe operators matched, or if single-char positioned Tj calls form a keyword
      const wholeBlockMatchedSafe =
        !blockUsesUnsafeFont &&
        totalTextOpsInBlock > 0 &&
        (matchedSafeTextOpsInBlock === totalTextOpsInBlock ||
          (matchedSafeTextOpsInBlock === 0 && matchesKeyword(concatenatedSafeText, targetKeywords)));

      if (wholeBlockMatchedSafe) {
        let delStart = tokens[i].start;
        let delEnd = tokens[etIdx].end;

        // Check if this BT...ET is wrapped in a dedicated graphics state `q ... Q` pair
        // that only contains transformation matrices (`cm`) / graphics state (`gs`, `g`, `rg`, `G`, `RG`)
        const enclosingQIdx = qStack.length > 0 ? qStack[qStack.length - 1] : -1;
        if (enclosingQIdx !== -1) {
          let matchingQEndIdx = -1;
          let qDepth = 1;
          for (let m = enclosingQIdx + 1; m < tokens.length; m++) {
            if (tokens[m].kind === 'operator') {
              if (tokens[m].raw === 'q') qDepth++;
              else if (tokens[m].raw === 'Q') {
                qDepth--;
                if (qDepth === 0) {
                  matchingQEndIdx = m;
                  break;
                }
              }
            }
          }

          if (matchingQEndIdx > etIdx) {
            let hasOtherDrawingOps = false;
            for (let m = enclosingQIdx + 1; m < matchingQEndIdx; m++) {
              if (m >= i && m <= etIdx) continue;
              const t = tokens[m];
              if (
                t.kind === 'operator' &&
                !['cm', 'gs', 'g', 'G', 'rg', 'RG', 'k', 'K', 'cs', 'CS', 'sc', 'SC', 'scn', 'SCN', 'w', 'J', 'j', 'M', 'd', 'ri', 'i'].includes(
                  t.raw
                )
              ) {
                hasOtherDrawingOps = true;
                break;
              }
            }
            if (!hasOtherDrawingOps) {
              delStart = tokens[enclosingQIdx].start;
              delEnd = tokens[matchingQEndIdx].end;
            }
          }
        }

        rangesToDelete.push({ start: delStart, end: delEnd });
        strippedTextOps += Math.max(1, matchedSafeTextOpsInBlock);
      } else if (matchedSafeTextOpsInBlock > 0) {
        rangesToDelete.push(...opDeleteRanges);
        strippedTextOps += matchedSafeTextOpsInBlock;
      }

      i = etIdx;
    }
  }

  if (rangesToDelete.length === 0) {
    return {
      cleanedBytes: null,
      strippedArtifactBlocks: 0,
      strippedTextOps: 0,
      unsupportedDetails: Array.from(unsupportedMap.values()),
    };
  }

  const cleanedBytes = spliceOutByteRanges(streamBytes, rangesToDelete);
  return {
    cleanedBytes,
    strippedArtifactBlocks,
    strippedTextOps,
    unsupportedDetails: Array.from(unsupportedMap.values()),
  };
}

/**
 * Iterates through all pages of `pdfDoc`, inspects page content streams (`Contents`),
 * applies Tier A (Marked-Content Watermark Artifacts) and Tier B (Safe Font Text Operators),
 * and collects subset-font diagnostics when text cannot be safely parsed without corruption.
 */
export function stripPdfPageContentStreams(
  pdfDoc: PDFDocument,
  targetKeywords: string[]
): StreamStripSummary {
  const normalizedKeywords = Array.from(
    new Set(
      targetKeywords
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0)
    )
  );

  let strippedArtifactBlocks = 0;
  let strippedTextOps = 0;
  const allUnsupported: PdfUnsupportedDetail[] = [];

  const pages = pdfDoc.getPages();

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageNode = pages[pageIdx].node;
    const resources = pageNode.Resources();
    const pageFonts = classifyPageFonts(pdfDoc, resources);

    const contentsEntry = pageNode.get(PDFName.of('Contents'));
    const contentsObj = pdfDoc.context.lookup(contentsEntry);

    const streamEntries: Array<{ ref: PDFRef | undefined; stream: PDFRawStream; arrayIdx?: number }> = [];

    if (contentsObj instanceof PDFRawStream) {
      streamEntries.push({
        ref: contentsEntry instanceof PDFRef ? contentsEntry : undefined,
        stream: contentsObj,
      });
    } else if (contentsObj instanceof PDFArray) {
      for (let i = 0; i < contentsObj.size(); i++) {
        const item = contentsObj.get(i);
        const lookedUp = pdfDoc.context.lookup(item);
        if (lookedUp instanceof PDFRawStream) {
          streamEntries.push({
            ref: item instanceof PDFRef ? item : undefined,
            stream: lookedUp,
            arrayIdx: i,
          });
        }
      }
    }

    for (const entry of streamEntries) {
      let decodedBytes: Uint8Array;
      try {
        decodedBytes = decodePDFRawStream(entry.stream).decode();
      } catch {
        continue;
      }

      const analysis = analyzeAndStripContentStream(
        decodedBytes,
        normalizedKeywords,
        pageFonts,
        pageIdx
      );

      strippedArtifactBlocks += analysis.strippedArtifactBlocks;
      strippedTextOps += analysis.strippedTextOps;
      for (const detail of analysis.unsupportedDetails) {
        if (
          !allUnsupported.some(
            (d) => d.pageIndex === detail.pageIndex && d.fontName === detail.fontName
          )
        ) {
          allUnsupported.push(detail);
        }
      }

      if (analysis.cleanedBytes) {
        const newStream = pdfDoc.context.flateStream(analysis.cleanedBytes);
        for (const key of entry.stream.dict.keys()) {
          const keyName = key.asString();
          if (keyName !== '/Length' && keyName !== '/Filter' && keyName !== '/DecodeParms') {
            const existing = entry.stream.dict.get(key);
            if (existing) newStream.dict.set(key, existing);
          }
        }

        if (entry.ref) {
          pdfDoc.context.assign(entry.ref, newStream);
        } else if (contentsObj instanceof PDFArray && entry.arrayIdx !== undefined) {
          contentsObj.set(entry.arrayIdx, pdfDoc.context.register(newStream));
        } else {
          pageNode.set(PDFName.of('Contents'), pdfDoc.context.register(newStream));
        }
      }
    }
  }

  return {
    strippedArtifactBlocks,
    strippedTextOps,
    unsupportedDetails: allUnsupported,
  };
}
