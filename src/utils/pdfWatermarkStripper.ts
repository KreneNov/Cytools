import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFRef,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';

export interface FontCMap {
  byteLength: 1 | 2;
  map: Map<number, string>;
}

/**
 * Converts a Uint8Array to a 1:1 Latin-1 string so raw byte values (0x00-0xFF)
 * are preserved losslessly during string regex manipulation.
 */
export function uint8ToLatin1(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode(...slice));
  }
  return chunks.join('');
}

/**
 * Converts a 1:1 Latin-1 string back into a Uint8Array.
 */
export function latin1ToUint8(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Parses a decoded PDF /ToUnicode CMap stream into a glyphId -> Unicode string lookup map.
 */
export function parseToUnicodeCMap(cmapText: string): FontCMap {
  const map = new Map<number, string>();
  let detectedByteLength: 1 | 2 = 1;

  const decodeUtf16Hex = (hex: string): string => {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    if (clean.length === 0) return '';
    if (clean.length === 2) {
      return String.fromCharCode(parseInt(clean, 16));
    }
    let out = '';
    for (let i = 0; i < clean.length; i += 4) {
      const unit = parseInt(clean.slice(i, i + 4), 16);
      if (!Number.isNaN(unit)) {
        out += String.fromCharCode(unit);
      }
    }
    return out;
  };

  // 1. Parse beginbfchar ... endbfchar blocks
  const bfCharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let bfCharMatch: RegExpExecArray | null;
  while ((bfCharMatch = bfCharRegex.exec(cmapText)) !== null) {
    const body = bfCharMatch[1];
    const pairRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let pair: RegExpExecArray | null;
    while ((pair = pairRegex.exec(body)) !== null) {
      const srcHex = pair[1];
      const dstHex = pair[2];
      if (srcHex.length > 2) detectedByteLength = 2;
      const srcCode = parseInt(srcHex, 16);
      const dstStr = decodeUtf16Hex(dstHex);
      if (!Number.isNaN(srcCode) && dstStr) {
        map.set(srcCode, dstStr);
      }
    }
  }

  // 2. Parse beginbfrange ... endbfrange blocks
  const bfRangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  let bfRangeMatch: RegExpExecArray | null;
  while ((bfRangeMatch = bfRangeRegex.exec(cmapText)) !== null) {
    const body = bfRangeMatch[1];
    // Form A: <startHex> <endHex> <dstStartHex>
    const directRangeRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let range: RegExpExecArray | null;
    while ((range = directRangeRegex.exec(body)) !== null) {
      const startHex = range[1];
      const endHex = range[2];
      const dstHex = range[3];
      if (startHex.length > 2) detectedByteLength = 2;
      const startCode = parseInt(startHex, 16);
      const endCode = parseInt(endHex, 16);
      const dstStart = parseInt(dstHex, 16);
      if (!Number.isNaN(startCode) && !Number.isNaN(endCode) && !Number.isNaN(dstStart)) {
        const count = Math.min(endCode - startCode, 2048);
        for (let offset = 0; offset <= count; offset++) {
          map.set(startCode + offset, String.fromCharCode(dstStart + offset));
        }
      }
    }

    // Form B: <startHex> <endHex> [ <dst1> <dst2> ... ]
    const arrayRangeRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g;
    let arrRange: RegExpExecArray | null;
    while ((arrRange = arrayRangeRegex.exec(body)) !== null) {
      const startHex = arrRange[1];
      if (startHex.length > 2) detectedByteLength = 2;
      const startCode = parseInt(startHex, 16);
      const arrayBody = arrRange[3];
      const itemRegex = /<([0-9a-fA-F]+)>/g;
      let item: RegExpExecArray | null;
      let offset = 0;
      while ((item = itemRegex.exec(arrayBody)) !== null) {
        const dstStr = decodeUtf16Hex(item[1]);
        if (dstStr) {
          map.set(startCode + offset, dstStr);
        }
        offset++;
      }
    }
  }

  return { byteLength: detectedByteLength, map };
}

/**
 * Extracts all Font /ToUnicode CMaps from a PDF Resources dictionary.
 */
export function extractResourcesFontCMaps(
  pdfDoc: PDFDocument,
  resources: PDFDict | undefined,
  existingMap: Map<string, FontCMap> = new Map()
): Map<string, FontCMap> {
  if (!(resources instanceof PDFDict)) return existingMap;

  const fontEntry = resources.get(PDFName.of('Font'));
  const fontDict = pdfDoc.context.lookup(fontEntry);
  if (!(fontDict instanceof PDFDict)) return existingMap;

  for (const fontKey of fontDict.keys()) {
    const fontName = fontKey.asString(); // e.g. "/F1"
    const fontObj = pdfDoc.context.lookup(fontDict.get(fontKey));
    if (!(fontObj instanceof PDFDict)) continue;

    const toUnicodeRef = fontObj.get(PDFName.of('ToUnicode'));
    const toUnicodeObj = pdfDoc.context.lookup(toUnicodeRef);
    if (toUnicodeObj instanceof PDFRawStream) {
      try {
        const decodedBytes = decodePDFRawStream(toUnicodeObj).decode();
        const cmapText = uint8ToLatin1(decodedBytes);
        const parsed = parseToUnicodeCMap(cmapText);
        if (parsed.map.size > 0) {
          existingMap.set(fontName, parsed);
        }
      } catch {
        // Ignore malformed CMap streams
      }
    }
  }

  return existingMap;
}

/**
 * Unescapes a PDF literal string `(...)` into raw byte values.
 */
function unescapePdfLiteralBytes(rawContent: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < rawContent.length; i++) {
    const ch = rawContent[i];
    if (ch === '\\' && i + 1 < rawContent.length) {
      const next = rawContent[i + 1];
      if (next >= '0' && next <= '7') {
        let octal = next;
        i++;
        if (i + 1 < rawContent.length && rawContent[i + 1] >= '0' && rawContent[i + 1] <= '7') {
          octal += rawContent[++i];
          if (i + 1 < rawContent.length && rawContent[i + 1] >= '0' && rawContent[i + 1] <= '7') {
            octal += rawContent[++i];
          }
        }
        bytes.push(parseInt(octal, 8) & 0xff);
      } else if (next === 'n') {
        bytes.push(10);
        i++;
      } else if (next === 'r') {
        bytes.push(13);
        i++;
      } else if (next === 't') {
        bytes.push(9);
        i++;
      } else if (next === 'b') {
        bytes.push(8);
        i++;
      } else if (next === 'f') {
        bytes.push(12);
        i++;
      } else if (next === '\r' || next === '\n') {
        // Line continuation backslash
        i++;
        if (next === '\r' && i + 1 < rawContent.length && rawContent[i + 1] === '\n') {
          i++;
        }
      } else {
        bytes.push(next.charCodeAt(0) & 0xff);
        i++;
      }
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return bytes;
}

/**
 * Converts a sequence of raw bytes from a PDF string or hex string into candidate readable strings
 * using direct ASCII/UTF-16BE decoding as well as any available Font ToUnicode CMaps.
 */
function decodePdfBytesCandidates(
  bytes: number[],
  activeFontName: string | null,
  fontCMaps: Map<string, FontCMap>
): string[] {
  if (bytes.length === 0) return [];
  const candidates: string[] = [];

  // 1. Direct ASCII / Latin-1 (stripping NUL bytes used in UTF-16BE / 2-byte big-endian ASCII)
  const ascii = bytes
    .filter((b) => b !== 0)
    .map((b) => String.fromCharCode(b))
    .join('');
  if (ascii) candidates.push(ascii);

  // 2. UTF-16BE decoding when even length
  if (bytes.length >= 2 && bytes.length % 2 === 0) {
    let utf16 = '';
    const startIdx = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
    for (let i = startIdx; i < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      if (code > 0) utf16 += String.fromCharCode(code);
    }
    if (utf16) candidates.push(utf16);
  }

  // 3. Decode using active font CMap or any page font CMap
  const cmapsToTry: FontCMap[] = [];
  if (activeFontName && fontCMaps.has(activeFontName)) {
    cmapsToTry.push(fontCMaps.get(activeFontName)!);
  }
  for (const [k, cmap] of fontCMaps.entries()) {
    if (k !== activeFontName) cmapsToTry.push(cmap);
  }

  for (const cmap of cmapsToTry) {
    // Try 2-byte big-endian lookup if even length
    if (bytes.length >= 2 && bytes.length % 2 === 0) {
      let mapped2 = '';
      for (let i = 0; i < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        mapped2 += cmap.map.get(code) ?? (code > 31 && code < 127 ? String.fromCharCode(code) : '');
      }
      if (mapped2) candidates.push(mapped2);
    }

    // Try 1-byte lookup
    let mapped1 = '';
    for (let i = 0; i < bytes.length; i++) {
      const code = bytes[i];
      mapped1 += cmap.map.get(code) ?? (code > 31 && code < 127 ? String.fromCharCode(code) : '');
    }
    if (mapped1) candidates.push(mapped1);
  }

  return candidates;
}

/**
 * Extracts all candidate decoded strings from a PDF text operator operand (`(...)`, `<...>`, or `[...]`).
 */
export function extractTextCandidatesFromOperand(
  operandText: string,
  activeFontName: string | null,
  fontCMaps: Map<string, FontCMap>
): string[] {
  const allBytes: number[] = [];

  // Scan operandText in order for (...) literal strings and <...> hex strings
  let i = 0;
  const len = operandText.length;

  while (i < len) {
    const ch = operandText[i];

    if (ch === '(') {
      // Parse balanced parentheses literal string (...)
      let depth = 1;
      let start = i + 1;
      i++;
      while (i < len && depth > 0) {
        if (operandText[i] === '\\') {
          i += 2;
          continue;
        }
        if (operandText[i] === '(') depth++;
        else if (operandText[i] === ')') depth--;
        i++;
      }
      const rawLiteral = operandText.slice(start, Math.max(start, i - 1));
      allBytes.push(...unescapePdfLiteralBytes(rawLiteral));
    } else if (ch === '<' && operandText[i + 1] !== '<') {
      // Parse hex string <...>
      const end = operandText.indexOf('>', i + 1);
      if (end === -1) break;
      const hex = operandText.slice(i + 1, end).replace(/\s+/g, '');
      const padded = hex.length % 2 === 1 ? `${hex}0` : hex;
      for (let h = 0; h < padded.length; h += 2) {
        const byteVal = parseInt(padded.slice(h, h + 2), 16);
        if (!Number.isNaN(byteVal)) {
          allBytes.push(byteVal);
        }
      }
      i = end + 1;
    } else {
      i++;
    }
  }

  return decodePdfBytesCandidates(allBytes, activeFontName, fontCMaps);
}

/**
 * Strips balanced Marked Content `/Artifact << ... /Subtype /Watermark ... >> BDC ... EMC`
 * and `/Watermark ... BDC/BMC ... EMC` blocks generated by MS Word and Adobe Acrobat.
 */
export function stripMarkedContentWatermarkBlocks(streamText: string): {
  cleanedText: string;
  removedCount: number;
} {
  let removedCount = 0;
  let result = '';
  let cursor = 0;

  // Match /Artifact <<...>> BDC or /Watermark BDC/BMC
  const headerRegex =
    /(?:\/Artifact\s*<<[\s\S]*?>>\s*BDC|\/Watermark(?:\s*<<[\s\S]*?>>)?\s*(?:BDC|BMC))/gi;
  let match: RegExpExecArray | null;

  while ((match = headerRegex.exec(streamText)) !== null) {
    const headerStr = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + headerStr.length;

    // If /Artifact, verify it is a Watermark or Background artifact
    const isWatermarkHeader =
      /^\/Watermark/i.test(headerStr.trim()) ||
      /\/Subtype\s*\/Watermark/i.test(headerStr) ||
      /\/Subtype\s*\/Background/i.test(headerStr);

    if (!isWatermarkHeader) {
      continue;
    }

    // Find matching balanced EMC
    const tokenRegex = /\b(BMC|BDC|EMC)\b/g;
    tokenRegex.lastIndex = matchEnd;
    let depth = 1;
    let emcEnd = -1;
    let tok: RegExpExecArray | null;

    while ((tok = tokenRegex.exec(streamText)) !== null) {
      const op = tok[1];
      if (op === 'BMC' || op === 'BDC') {
        depth++;
      } else if (op === 'EMC') {
        depth--;
        if (depth === 0) {
          emcEnd = tok.index + tok[0].length;
          break;
        }
      }
    }

    if (emcEnd !== -1) {
      result += streamText.slice(cursor, matchStart);
      cursor = emcEnd;
      headerRegex.lastIndex = emcEnd;
      removedCount++;
    }
  }

  if (removedCount === 0) {
    return { cleanedText: streamText, removedCount: 0 };
  }

  result += streamText.slice(cursor);
  return { cleanedText: result, removedCount };
}

/**
 * Checks whether any candidate string contains one of the normalized target keywords.
 */
function matchesAnyKeyword(candidates: string[], targetKeywords: string[]): boolean {
  for (const cand of candidates) {
    const lower = cand.toLowerCase();
    const compact = lower.replace(/\s+/g, ' ').trim();
    const spaceless = lower.replace(/\s+/g, '');
    for (const kw of targetKeywords) {
      if (lower.includes(kw) || compact.includes(kw)) {
        return true;
      }
      const kwSpaceless = kw.replace(/\s+/g, '');
      if (kwSpaceless.length >= 4 && spaceless.includes(kwSpaceless)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Deep cleans a single decoded PDF content stream string:
 * 1. Strips MS Word `/Artifact <</Subtype /Watermark>> BDC ... EMC` blocks.
 * 2. Inspects every `BT ... ET` text object, decoding `Tj`, `TJ`, `'`, `"` operands
 *    (including split kerning arrays `[(C)-2(O)...] TJ`, hex strings, and ToUnicode CMaps)
 *    and strips matching watermark text-drawing commands or entire watermark `BT ... ET` blocks.
 * 3. Strips any standalone `(...) Tj` or `[...] TJ` operators matching target keywords.
 */
export function stripWatermarkFromStreamText(
  streamText: string,
  targetKeywords: string[],
  fontCMaps: Map<string, FontCMap> = new Map()
): { cleanedText: string; removedCount: number } {
  let totalRemoved = 0;

  // Pass 1: Strip Marked-Content Watermark Artifacts (/Artifact <</Subtype/Watermark>> BDC ... EMC)
  const markedPass = stripMarkedContentWatermarkBlocks(streamText);
  let workingText = markedPass.cleanedText;
  totalRemoved += markedPass.removedCount;

  // Pass 2: Inspect BT ... ET text blocks and strip matching Tj / TJ operators or entire BT ... ET block
  const btBlockRegex = /\bBT\b([\s\S]*?)\bET\b/g;

  // Regex matching individual text-showing commands inside BT ... ET:
  // - (...) Tj or (...) '
  // - <...> Tj
  // - [...] TJ
  const textOpRegex =
    /(\[(?:[^[\]\\]|\\.|(?:\((?:[^()\\]|\\.)*\)))*\]\s*TJ|\((?:[^()\\]|\\.)*\)\s*(?:Tj|'|")|<[0-9a-fA-F\s]+>\s*Tj)/g;

  workingText = workingText.replace(btBlockRegex, (fullBtBlock, innerContent: string) => {
    // Detect active font inside this BT ... ET block (e.g. "/F1 48 Tf")
    const fontMatch = innerContent.match(/(\/[A-Za-z0-9_.+-]+)\s+[-0-9.]+\s+Tf/);
    const activeFont = fontMatch ? fontMatch[1] : null;

    let opRemovedInBlock = 0;
    let remainingOpsInBlock = 0;

    // Check individual Tj / TJ operations first
    const cleanedInner = innerContent.replace(textOpRegex, (opMatch) => {
      const candidates = extractTextCandidatesFromOperand(opMatch, activeFont, fontCMaps);
      if (matchesAnyKeyword(candidates, targetKeywords)) {
        opRemovedInBlock++;
        totalRemoved++;
        return '';
      }
      remainingOpsInBlock++;
      return opMatch;
    });

    if (opRemovedInBlock > 0) {
      // If all text-drawing operators in this BT...ET block were watermarks, drop the entire BT...ET block
      if (remainingOpsInBlock === 0) {
        return '';
      }
      return `BT${cleanedInner}ET`;
    }

    // What if MS Word positioned each character with separate Tj commands (e.g. (C) Tj ... (O) Tj ...)?
    // Concatenate all text operands inside the BT ... ET block and check against target keywords.
    const allBlockCandidates = extractTextCandidatesFromOperand(innerContent, activeFont, fontCMaps);
    if (matchesAnyKeyword(allBlockCandidates, targetKeywords)) {
      totalRemoved++;
      return '';
    }

    return fullBtBlock;
  });

  // Pass 3: Standalone operator-level pass (in case BT/ET spans across multiple stream chunks in a PDFArray)
  workingText = workingText.replace(textOpRegex, (opMatch) => {
    const candidates = extractTextCandidatesFromOperand(opMatch, null, fontCMaps);
    if (matchesAnyKeyword(candidates, targetKeywords)) {
      totalRemoved++;
      return '';
    }
    return opMatch;
  });

  return {
    cleanedText: workingText,
    removedCount: totalRemoved,
  };
}

/**
 * Decodes, strips watermark text/operators, re-encodes with FlateDecode, and updates a single PDFRawStream.
 */
function processSingleRawStream(
  pdfDoc: PDFDocument,
  rawStream: PDFRawStream,
  streamRef: PDFRef | undefined,
  targetKeywords: string[],
  fontCMaps: Map<string, FontCMap>
): { updatedStream: PDFRawStream | null; removedCount: number } {
  try {
    const decodedBytes = decodePDFRawStream(rawStream).decode();
    const streamText = uint8ToLatin1(decodedBytes);

    const { cleanedText, removedCount } = stripWatermarkFromStreamText(
      streamText,
      targetKeywords,
      fontCMaps
    );

    if (removedCount > 0) {
      const cleanedBytes = latin1ToUint8(cleanedText);
      const newStream = pdfDoc.context.flateStream(cleanedBytes);

      // Preserve Form XObject dictionary keys (such as /Type, /Subtype, /BBox, /Matrix, /Resources)
      for (const key of rawStream.dict.keys()) {
        const keyStr = key.asString();
        if (keyStr !== '/Length' && keyStr !== '/Filter' && keyStr !== '/DecodeParms') {
          const existingVal = rawStream.dict.get(key);
          if (existingVal) {
            newStream.dict.set(key, existingVal);
          }
        }
      }

      if (streamRef instanceof PDFRef) {
        pdfDoc.context.assign(streamRef, newStream);
      }

      return { updatedStream: newStream, removedCount };
    }
  } catch {
    // Ignore unreadable or non-standard binary streams
  }

  return { updatedStream: null, removedCount: 0 };
}

/**
 * Iterates through all pages of `pdfDoc`, extracts raw content streams (`page.node.Contents`)
 * and Form XObject streams, decodes them, strips target watermark text-drawing operators
 * (`Tj`, `TJ`, `BDC...EMC`), and rebuilds/updates the streams in `pdfDoc`.
 */
export function stripPdfPageContentStreams(
  pdfDoc: PDFDocument,
  targetKeywords: string[]
): number {
  const normalizedKeywords = Array.from(
    new Set(
      targetKeywords
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0)
    )
  );

  if (normalizedKeywords.length === 0) return 0;

  let totalStrippedCount = 0;
  const pages = pdfDoc.getPages();

  for (const page of pages) {
    const pageNode = page.node;
    const resources = pageNode.Resources();
    const fontCMaps = extractResourcesFontCMaps(pdfDoc, resources);

    // 1. Clean Page Content Streams (page.node.Contents)
    const contentsEntry = pageNode.get(PDFName.of('Contents'));
    const contentsObj = pdfDoc.context.lookup(contentsEntry);

    if (contentsObj instanceof PDFRawStream) {
      const ref = contentsEntry instanceof PDFRef ? contentsEntry : undefined;
      const { updatedStream, removedCount } = processSingleRawStream(
        pdfDoc,
        contentsObj,
        ref,
        normalizedKeywords,
        fontCMaps
      );
      totalStrippedCount += removedCount;
      if (updatedStream && !ref) {
        pageNode.set(PDFName.of('Contents'), pdfDoc.context.register(updatedStream));
      }
    } else if (contentsObj instanceof PDFArray) {
      for (let i = 0; i < contentsObj.size(); i++) {
        const item = contentsObj.get(i);
        const streamObj = pdfDoc.context.lookup(item);
        if (streamObj instanceof PDFRawStream) {
          const ref = item instanceof PDFRef ? item : undefined;
          const { updatedStream, removedCount } = processSingleRawStream(
            pdfDoc,
            streamObj,
            ref,
            normalizedKeywords,
            fontCMaps
          );
          totalStrippedCount += removedCount;
          if (updatedStream && !ref) {
            contentsObj.set(i, pdfDoc.context.register(updatedStream));
          }
        }
      }
    }

    // 2. Also clean any Form XObject content streams (/Subtype /Form) referenced on the page
    if (resources instanceof PDFDict) {
      const xObjectsEntry = resources.get(PDFName.of('XObject'));
      const xObjDict = pdfDoc.context.lookup(xObjectsEntry);
      if (xObjDict instanceof PDFDict) {
        for (const key of xObjDict.keys()) {
          const xObjRef = xObjDict.get(key);
          const xObj = pdfDoc.context.lookup(xObjRef);
          if (xObj instanceof PDFRawStream) {
            const subtype = xObj.dict.get(PDFName.of('Subtype'));
            if (subtype instanceof PDFName && subtype.asString() === '/Form') {
              const formResources = pdfDoc.context.lookup(xObj.dict.get(PDFName.of('Resources')));
              const mergedCMaps = extractResourcesFontCMaps(
                pdfDoc,
                formResources instanceof PDFDict ? formResources : undefined,
                new Map(fontCMaps)
              );
              const ref = xObjRef instanceof PDFRef ? xObjRef : undefined;
              const { removedCount } = processSingleRawStream(
                pdfDoc,
                xObj,
                ref,
                normalizedKeywords,
                mergedCMaps
              );
              totalStrippedCount += removedCount;
            }
          }
        }
      }
    }
  }

  return totalStrippedCount;
}
