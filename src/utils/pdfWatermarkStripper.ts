import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFNumber,
  PDFRef,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  tokenizePdfContentStream,
  spliceOutByteRanges,
  type PdfContentToken,
} from './pdfContentTokenizer';

export interface FontCMap {
  byteLength: 1 | 2;
  map: Map<number, string>;
}

export interface StreamStripSummary {
  strippedArtifactBlocks: number;
  strippedTextOps: number;
  strippedDiagonalBlocks: number;
}

/**
 * Converts a Uint8Array to a 1:1 Latin-1 string.
 */
function uint8ToLatin1(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode(...slice));
  }
  return chunks.join('');
}

/**
 * Parses a decompressed `/ToUnicode` CMap stream (`beginbfchar ... endbfchar` and
 * `beginbfrange ... endbfrange`) into a `GlyphCode -> UnicodeString` lookup table.
 */
export function parseToUnicodeCMap(cmapBytes: Uint8Array): FontCMap {
  const cmapText = uint8ToLatin1(cmapBytes);
  const map = new Map<number, string>();
  let detectedByteLength: 1 | 2 = 1;

  const decodeHexToUnicode = (hex: string): string => {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    if (clean.length === 0) return '';
    if (clean.length === 2) {
      return String.fromCharCode(parseInt(clean, 16));
    }
    let out = '';
    for (let i = 0; i < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      if (!Number.isNaN(code)) {
        out += String.fromCharCode(code);
      }
    }
    return out;
  };

  // 1. Parse beginbfchar ... endbfchar
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
      const dstStr = decodeHexToUnicode(dstHex);
      if (!Number.isNaN(srcCode) && dstStr) {
        map.set(srcCode, dstStr);
      }
    }
  }

  // 2. Parse beginbfrange ... endbfrange
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
        const span = Math.min(Math.max(0, endCode - startCode), 4096);
        for (let offset = 0; offset <= span; offset++) {
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
      const arrBody = arrRange[3];
      const itemRegex = /<([0-9a-fA-F]+)>/g;
      let item: RegExpExecArray | null;
      let offset = 0;
      while ((item = itemRegex.exec(arrBody)) !== null) {
        const dstStr = decodeHexToUnicode(item[1]);
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
 * Extracts `ToUnicode` CMap tables for all fonts in a `Resources -> Font` dictionary.
 */
export function extractResourcesFontCMaps(
  pdfDoc: PDFDocument,
  resources: PDFDict | undefined,
  targetMap: Map<string, FontCMap> = new Map()
): Map<string, FontCMap> {
  if (!(resources instanceof PDFDict)) return targetMap;

  const fontEntry = resources.get(PDFName.of('Font'));
  const fontDict = pdfDoc.context.lookup(fontEntry);
  if (!(fontDict instanceof PDFDict)) return targetMap;

  for (const key of fontDict.keys()) {
    const fontKey = key.asString(); // e.g. "/F1", "/C2_0"
    const fontObj = pdfDoc.context.lookup(fontDict.get(key));
    if (!(fontObj instanceof PDFDict)) continue;

    const toUnicodeRef = fontObj.get(PDFName.of('ToUnicode'));
    const toUnicodeObj = pdfDoc.context.lookup(toUnicodeRef);
    if (toUnicodeObj instanceof PDFRawStream) {
      try {
        const decoded = decodePDFRawStream(toUnicodeObj).decode();
        const parsed = parseToUnicodeCMap(decoded);
        if (parsed.map.size > 0) {
          targetMap.set(fontKey, parsed);
        }
      } catch {
        // Ignore unreadable CMap stream
      }
    }
  }

  return targetMap;
}

/**
 * Extracts a Set of ExtGState names (e.g. `/GS0`, `/GS1`) that specify translucent opacity (`/ca < 0.85` or `/CA < 0.85`).
 */
export function extractTranslucentExtGStates(
  pdfDoc: PDFDocument,
  resources: PDFDict | undefined,
  targetSet: Set<string> = new Set()
): Set<string> {
  if (!(resources instanceof PDFDict)) return targetSet;

  const gsEntry = resources.get(PDFName.of('ExtGState'));
  const gsDict = pdfDoc.context.lookup(gsEntry);
  if (!(gsDict instanceof PDFDict)) return targetSet;

  for (const key of gsDict.keys()) {
    const gsKey = key.asString();
    const stateObj = pdfDoc.context.lookup(gsDict.get(key));
    if (!(stateObj instanceof PDFDict)) continue;

    const caFill = stateObj.get(PDFName.of('ca'));
    const caStroke = stateObj.get(PDFName.of('CA'));

    const fillVal = caFill instanceof PDFNumber ? caFill.asNumber() : 1;
    const strokeVal = caStroke instanceof PDFNumber ? caStroke.asNumber() : 1;

    if (fillVal < 0.85 || strokeVal < 0.85) {
      targetSet.add(gsKey);
    }
  }

  return targetSet;
}

/**
 * Unescapes a PDF literal string `(...)` into raw byte values (0x00..0xFF).
 */
function unescapeLiteralBytes(rawLiteral: string): number[] {
  const bytes: number[] = [];
  const len = rawLiteral.length;
  let i = 0;

  while (i < len) {
    const ch = rawLiteral[i];
    if (ch === '\\' && i + 1 < len) {
      const next = rawLiteral[i + 1];
      if (next >= '0' && next <= '7') {
        let oct = next;
        i += 2;
        if (i < len && rawLiteral[i] >= '0' && rawLiteral[i] <= '7') oct += rawLiteral[i++];
        if (i < len && rawLiteral[i] >= '0' && rawLiteral[i] <= '7') oct += rawLiteral[i++];
        bytes.push(parseInt(oct, 8) & 0xff);
        continue;
      }
      if (next === 'n') bytes.push(10);
      else if (next === 'r') bytes.push(13);
      else if (next === 't') bytes.push(9);
      else if (next === 'b') bytes.push(8);
      else if (next === 'f') bytes.push(12);
      else if (next === '\r' || next === '\n') {
        i += 2;
        if (next === '\r' && i < len && rawLiteral[i] === '\n') i++;
        continue;
      } else {
        bytes.push(next.charCodeAt(0) & 0xff);
      }
      i += 2;
      continue;
    }
    bytes.push(ch.charCodeAt(0) & 0xff);
    i++;
  }

  return bytes;
}

/**
 * Extracts raw byte sequences from a `string`, `hexstring`, or `TJ` `array` operand token.
 */
function extractBytesFromOperandToken(token: PdfContentToken): number[] {
  const raw = token.raw;
  const out: number[] = [];
  let i = 0;
  const len = raw.length;

  while (i < len) {
    const ch = raw[i];
    if (ch === '(') {
      let depth = 1;
      const start = i + 1;
      i++;
      while (i < len && depth > 0) {
        if (raw[i] === '\\') {
          i += 2;
          continue;
        }
        if (raw[i] === '(') depth++;
        else if (raw[i] === ')') depth--;
        i++;
      }
      const slice = raw.slice(start, Math.max(start, i - 1));
      out.push(...unescapeLiteralBytes(slice));
    } else if (ch === '<' && raw[i + 1] !== '<') {
      const closeIdx = raw.indexOf('>', i + 1);
      if (closeIdx === -1) break;
      const hex = raw.slice(i + 1, closeIdx).replace(/\s+/g, '');
      const padded = hex.length % 2 === 1 ? `${hex}0` : hex;
      for (let k = 0; k < padded.length; k += 2) {
        const val = parseInt(padded.slice(k, k + 2), 16);
        if (!Number.isNaN(val)) out.push(val);
      }
      i = closeIdx + 1;
    } else {
      i++;
    }
  }

  return out;
}

/**
 * Decodes raw glyph bytes into candidate Unicode strings using the active font's `ToUnicode` CMap,
 * other page `ToUnicode` CMaps, and direct ASCII / UTF-16BE decoding.
 */
export function decodeOperandCandidates(
  token: PdfContentToken,
  activeFontKey: string | null,
  fontCMaps: Map<string, FontCMap>
): string[] {
  const bytes = extractBytesFromOperandToken(token);
  if (bytes.length === 0) return [];

  const candidates: string[] = [];

  // 1. Decode with active font's ToUnicode CMap (and fallback to other page CMaps)
  const orderedCMaps: FontCMap[] = [];
  if (activeFontKey && fontCMaps.has(activeFontKey)) {
    orderedCMaps.push(fontCMaps.get(activeFontKey)!);
  }
  for (const [key, cmap] of fontCMaps.entries()) {
    if (key !== activeFontKey) orderedCMaps.push(cmap);
  }

  for (const cmap of orderedCMaps) {
    // 2-byte big-endian CID / Identity-H lookup
    if (bytes.length >= 2 && bytes.length % 2 === 0) {
      let decoded2 = '';
      for (let i = 0; i < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        const mapped = cmap.map.get(code);
        if (mapped !== undefined) {
          decoded2 += mapped;
        } else if (code > 31 && code < 127) {
          decoded2 += String.fromCharCode(code);
        }
      }
      if (decoded2) candidates.push(decoded2);
    }

    // 1-byte glyph lookup
    let decoded1 = '';
    for (let i = 0; i < bytes.length; i++) {
      const code = bytes[i];
      const mapped = cmap.map.get(code);
      if (mapped !== undefined) {
        decoded1 += mapped;
      } else if (code > 31 && code < 127) {
        decoded1 += String.fromCharCode(code);
      }
    }
    if (decoded1) candidates.push(decoded1);
  }

  // 2. Direct ASCII / Latin-1 (ignoring 0x00 bytes from UTF-16BE)
  const ascii = bytes
    .filter((b) => b !== 0)
    .map((b) => String.fromCharCode(b))
    .join('');
  if (ascii) candidates.push(ascii);

  // 3. UTF-16BE decoding
  if (bytes.length >= 2 && bytes.length % 2 === 0) {
    let utf16 = '';
    const startIdx = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
    for (let i = startIdx; i < bytes.length; i += 2) {
      const code = (bytes[i] << 8) | bytes[i + 1];
      if (code > 0) utf16 += String.fromCharCode(code);
    }
    if (utf16) candidates.push(utf16);
  }

  return candidates;
}

function matchesAnyKeyword(candidates: string[], keywords: string[]): boolean {
  for (const cand of candidates) {
    const lower = cand.toLowerCase();
    const compact = lower.replace(/\s+/g, ' ').trim();
    const spaceless = lower.replace(/\s+/g, '');
    if (!spaceless) continue;

    for (const kw of keywords) {
      if (lower.includes(kw) || compact.includes(kw)) return true;
      const kwSpaceless = kw.replace(/\s+/g, '');
      if (kwSpaceless.length >= 4 && spaceless.includes(kwSpaceless)) return true;
    }
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

interface GraphicsStateFrame {
  qTokenIndex: number;
  hasDiagonalMatrix: boolean;
  matrixScale: number;
  isTranslucentOrLightGray: boolean;
  fontKey: string | null;
  fontSize: number;
}

/**
 * Tokenizes a decompressed PDF content stream and safely removes entire self-contained
 * watermark blocks (`BDC...EMC`, `BT...ET`, and tightly wrapping `q...Q` blocks)
 * without corrupting subsetted font glyph spacing or layout.
 */
export function analyzeAndStripContentStream(
  streamBytes: Uint8Array,
  targetKeywords: string[],
  fontCMaps: Map<string, FontCMap>,
  translucentGsNames: Set<string>,
  autoDetectDiagonal: boolean = true
): {
  cleanedBytes: Uint8Array | null;
  strippedArtifactBlocks: number;
  strippedTextOps: number;
  strippedDiagonalBlocks: number;
} {
  const tokens: PdfContentToken[] = tokenizePdfContentStream(streamBytes);
  const rangesToDelete: Array<{ start: number; end: number }> = [];

  let strippedArtifactBlocks = 0;
  let strippedTextOps = 0;
  let strippedDiagonalBlocks = 0;

  // ------------------------------------------------------------------
  // Tier 1: Marked-Content Watermark Artifacts (`BDC` / `BMC` ... `EMC`)
  // ------------------------------------------------------------------
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.kind !== 'operator' || (tok.raw !== 'BDC' && tok.raw !== 'BMC')) continue;

    let tagIdx = -1;
    let isWatermarkBlock = false;

    if (tok.raw === 'BMC' && i >= 1 && tokens[i - 1].kind === 'name') {
      tagIdx = i - 1;
      if (/^\/Watermark$/i.test(tokens[tagIdx].raw)) {
        isWatermarkBlock = true;
      }
    } else if (tok.raw === 'BDC' && i >= 2 && tokens[i - 2].kind === 'name') {
      tagIdx = i - 2;
      const tagName = tokens[tagIdx].raw;
      const propTok = tokens[i - 1];
      if (/^\/Watermark$/i.test(tagName)) {
        isWatermarkBlock = true;
      } else if (
        /^\/Artifact$/i.test(tagName) &&
        propTok.kind === 'dict' &&
        /\/Subtype\s*\/Watermark/i.test(propTok.raw)
      ) {
        isWatermarkBlock = true;
      }
    }

    if (!isWatermarkBlock || tagIdx < 0) continue;

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
  // Tier 2: Smart CMap Decoding & Self-Contained `BT ... ET` / `q ... Q` Removal
  // ------------------------------------------------------------------
  const stateStack: GraphicsStateFrame[] = [
    {
      qTokenIndex: -1,
      hasDiagonalMatrix: false,
      matrixScale: 1,
      isTranslucentOrLightGray: false,
      fontKey: null,
      fontSize: 12,
    },
  ];

  const currentFrame = (): GraphicsStateFrame => stateStack[stateStack.length - 1];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (isRangeInsideAny(tok.start, tok.end, rangesToDelete)) continue;

    if (tok.kind === 'operator') {
      const top = currentFrame();

      if (tok.raw === 'q') {
        stateStack.push({
          ...top,
          qTokenIndex: i,
        });
        continue;
      }

      if (tok.raw === 'Q') {
        if (stateStack.length > 1) stateStack.pop();
        continue;
      }

      // Font selection: `/Fx size Tf`
      if (tok.raw === 'Tf' && i >= 2 && tokens[i - 2].kind === 'name') {
        top.fontKey = tokens[i - 2].raw;
        const parsedSize = parseFloat(tokens[i - 1].raw);
        if (!Number.isNaN(parsedSize)) top.fontSize = Math.abs(parsedSize);
        continue;
      }

      // Graphics state dictionary: `/GSx gs`
      if (tok.raw === 'gs' && i >= 1 && tokens[i - 1].kind === 'name') {
        if (translucentGsNames.has(tokens[i - 1].raw)) {
          top.isTranslucentOrLightGray = true;
        }
        continue;
      }

      // Gray fill color: `gray g` or `gray G`
      if ((tok.raw === 'g' || tok.raw === 'G') && i >= 1 && tokens[i - 1].kind === 'number') {
        const gray = parseFloat(tokens[i - 1].raw);
        if (!Number.isNaN(gray) && gray >= 0.52 && gray < 0.99) {
          top.isTranslucentOrLightGray = true;
        }
        continue;
      }

      // RGB fill color: `r g b rg` or `r g b RG`
      if ((tok.raw === 'rg' || tok.raw === 'RG') && i >= 3) {
        const r = parseFloat(tokens[i - 3].raw);
        const g = parseFloat(tokens[i - 2].raw);
        const b = parseFloat(tokens[i - 1].raw);
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
          const normR = r > 1 ? r / 255 : r;
          const normG = g > 1 ? g / 255 : g;
          const normB = b > 1 ? b / 255 : b;
          const luma = 0.299 * normR + 0.587 * normG + 0.114 * normB;
          if (luma >= 0.55 && luma < 0.99) {
            top.isTranslucentOrLightGray = true;
          }
        }
        continue;
      }

      // Transformation matrix: `a b c d e f cm`
      if (tok.raw === 'cm' && i >= 6) {
        const a = parseFloat(tokens[i - 6].raw);
        const b = parseFloat(tokens[i - 5].raw);
        const c = parseFloat(tokens[i - 4].raw);
        if (!Number.isNaN(a) && !Number.isNaN(b) && !Number.isNaN(c)) {
          if (Math.abs(b) > 0.05 && Math.abs(c) > 0.05) {
            top.hasDiagonalMatrix = true;
          }
          const scale = Math.hypot(a, b);
          if (scale > 0) top.matrixScale = scale;
        }
        continue;
      }
    }

    // Inspect discrete `BT ... ET` block
    if (tok.kind === 'operator' && tok.raw === 'BT') {
      let etIdx = -1;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].kind === 'operator' && tokens[j].raw === 'ET') {
          etIdx = j;
          break;
        }
      }
      if (etIdx === -1) continue;

      const frame = currentFrame();
      let blockFontKey: string | null = frame.fontKey;
      let blockFontSize: number = frame.fontSize;
      let blockHasDiagonal: boolean = frame.hasDiagonalMatrix;
      let blockMatrixScale: number = frame.matrixScale;
      let blockIsLightOrTranslucent: boolean = frame.isTranslucentOrLightGray;

      let keywordMatchedInBlock = false;
      const blockDecodedCandidates: string[] = [];

      for (let k = i + 1; k < etIdx; k++) {
        const inner = tokens[k];
        if (inner.kind !== 'operator') continue;

        if (inner.raw === 'Tf' && k >= 2 && tokens[k - 2].kind === 'name') {
          blockFontKey = tokens[k - 2].raw;
          frame.fontKey = blockFontKey;
          const sz = parseFloat(tokens[k - 1].raw);
          if (!Number.isNaN(sz)) {
            blockFontSize = Math.abs(sz);
            frame.fontSize = blockFontSize;
          }
          continue;
        }

        if (inner.raw === 'gs' && k >= 1 && tokens[k - 1].kind === 'name') {
          if (translucentGsNames.has(tokens[k - 1].raw)) {
            blockIsLightOrTranslucent = true;
          }
          continue;
        }

        if ((inner.raw === 'g' || inner.raw === 'G') && k >= 1) {
          const gray = parseFloat(tokens[k - 1].raw);
          if (!Number.isNaN(gray) && gray >= 0.52 && gray < 0.99) {
            blockIsLightOrTranslucent = true;
          }
          continue;
        }

        if ((inner.raw === 'rg' || inner.raw === 'RG') && k >= 3) {
          const r = parseFloat(tokens[k - 3].raw);
          const g = parseFloat(tokens[k - 2].raw);
          const b = parseFloat(tokens[k - 1].raw);
          if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
            const normR = r > 1 ? r / 255 : r;
            const normG = g > 1 ? g / 255 : g;
            const normB = b > 1 ? b / 255 : b;
            const luma = 0.299 * normR + 0.587 * normG + 0.114 * normB;
            if (luma >= 0.55 && luma < 0.99) {
              blockIsLightOrTranslucent = true;
            }
          }
          continue;
        }

        if (inner.raw === 'Tm' && k >= 6) {
          const a = parseFloat(tokens[k - 6].raw);
          const b = parseFloat(tokens[k - 5].raw);
          const c = parseFloat(tokens[k - 4].raw);
          if (!Number.isNaN(a) && !Number.isNaN(b) && !Number.isNaN(c)) {
            if (Math.abs(b) > 0.05 && Math.abs(c) > 0.05) {
              blockHasDiagonal = true;
            }
            const sc = Math.hypot(a, b);
            if (sc > 0) blockMatrixScale = sc;
          }
          continue;
        }

        if (inner.raw === 'Tj' || inner.raw === 'TJ' || inner.raw === "'" || inner.raw === '"') {
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

          const candidates = decodeOperandCandidates(operandTok, blockFontKey, fontCMaps);
          if (matchesAnyKeyword(candidates, targetKeywords)) {
            keywordMatchedInBlock = true;
          }
          if (candidates.length > 0) {
            blockDecodedCandidates.push(candidates[0]);
          }
        }
      }

      // Also check concatenated text across the entire BT ... ET block (for character-by-character positioned watermarks)
      const fullBlockText = blockDecodedCandidates.join('');
      if (!keywordMatchedInBlock && fullBlockText && matchesAnyKeyword([fullBlockText], targetKeywords)) {
        keywordMatchedInBlock = true;
      }

      // Heuristic (b): Diagonal rotation + large font size / translucent gray stamp
      const effectivePointSize = blockFontSize * blockMatrixScale;
      const trimmedBlockText = fullBlockText.trim();
      const isDiagonalWatermarkBlock =
        autoDetectDiagonal &&
        !keywordMatchedInBlock &&
        blockHasDiagonal &&
        blockIsLightOrTranslucent &&
        (effectivePointSize >= 20 || (trimmedBlockText.length >= 2 && trimmedBlockText.length <= 50));

      if (keywordMatchedInBlock || isDiagonalWatermarkBlock) {
        let delStart = tokens[i].start;
        let delEnd = tokens[etIdx].end;

        // Check if tightly wrapped by a dedicated `q ... Q` block that only contains this `BT ... ET`
        const enclosingQIdx = frame.qTokenIndex;
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
            let hasOtherContentOps = false;
            for (let m = enclosingQIdx + 1; m < matchingQEndIdx; m++) {
              if (m >= i && m <= etIdx) continue;
              const t = tokens[m];
              if (
                t.kind === 'operator' &&
                (t.raw === 'BT' ||
                  t.raw === 'ET' ||
                  t.raw === 'Do' ||
                  t.raw === 'BI' ||
                  t.raw === 'S' ||
                  t.raw === 's' ||
                  t.raw === 'f' ||
                  t.raw === 'F' ||
                  t.raw === 'f*' ||
                  t.raw === 'B' ||
                  t.raw === 'B*' ||
                  t.raw === 'b' ||
                  t.raw === 'b*' ||
                  t.raw === 'sh')
              ) {
                hasOtherContentOps = true;
                break;
              }
            }
            if (!hasOtherContentOps) {
              delStart = tokens[enclosingQIdx].start;
              delEnd = tokens[matchingQEndIdx].end;
            }
          }
        }

        rangesToDelete.push({ start: delStart, end: delEnd });
        if (keywordMatchedInBlock) {
          strippedTextOps++;
        } else {
          strippedDiagonalBlocks++;
        }
      }

      i = etIdx;
    }
  }

  if (rangesToDelete.length === 0) {
    return {
      cleanedBytes: null,
      strippedArtifactBlocks: 0,
      strippedTextOps: 0,
      strippedDiagonalBlocks: 0,
    };
  }

  const cleanedBytes = spliceOutByteRanges(streamBytes, rangesToDelete);
  return {
    cleanedBytes,
    strippedArtifactBlocks,
    strippedTextOps,
    strippedDiagonalBlocks,
  };
}

/**
 * Helper to process and update a single `PDFRawStream` in `pdfDoc`.
 */
function processPdfRawStream(
  pdfDoc: PDFDocument,
  rawStream: PDFRawStream,
  streamRef: PDFRef | undefined,
  targetKeywords: string[],
  fontCMaps: Map<string, FontCMap>,
  translucentGsNames: Set<string>,
  autoDetectDiagonal: boolean
): {
  updatedStream: PDFRawStream | null;
  strippedArtifactBlocks: number;
  strippedTextOps: number;
  strippedDiagonalBlocks: number;
} {
  let decodedBytes: Uint8Array;
  try {
    decodedBytes = decodePDFRawStream(rawStream).decode();
  } catch {
    return {
      updatedStream: null,
      strippedArtifactBlocks: 0,
      strippedTextOps: 0,
      strippedDiagonalBlocks: 0,
    };
  }

  const analysis = analyzeAndStripContentStream(
    decodedBytes,
    targetKeywords,
    fontCMaps,
    translucentGsNames,
    autoDetectDiagonal
  );

  if (!analysis.cleanedBytes) {
    return {
      updatedStream: null,
      strippedArtifactBlocks: 0,
      strippedTextOps: 0,
      strippedDiagonalBlocks: 0,
    };
  }

  const newStream = pdfDoc.context.flateStream(analysis.cleanedBytes);
  for (const key of rawStream.dict.keys()) {
    const keyName = key.asString();
    if (keyName !== '/Length' && keyName !== '/Filter' && keyName !== '/DecodeParms') {
      const existing = rawStream.dict.get(key);
      if (existing) newStream.dict.set(key, existing);
    }
  }

  if (streamRef) {
    pdfDoc.context.assign(streamRef, newStream);
  }

  return {
    updatedStream: newStream,
    strippedArtifactBlocks: analysis.strippedArtifactBlocks,
    strippedTextOps: analysis.strippedTextOps,
    strippedDiagonalBlocks: analysis.strippedDiagonalBlocks,
  };
}

/**
 * Iterates through all pages of `pdfDoc`, parses `ToUnicode` CMaps and `ExtGState` opacity dicts,
 * and performs safe block-level `BT ... ET` / `q ... Q` and `BDC ... EMC` watermark stripping
 * across both Page Content Streams and Form XObject streams.
 */
export function stripPdfPageContentStreams(
  pdfDoc: PDFDocument,
  targetKeywords: string[],
  autoDetectDiagonal: boolean = true
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
  let strippedDiagonalBlocks = 0;

  const pages = pdfDoc.getPages();

  for (const page of pages) {
    const pageNode = page.node;
    const resources = pageNode.Resources();
    const fontCMaps = extractResourcesFontCMaps(pdfDoc, resources);
    const translucentGs = extractTranslucentExtGStates(pdfDoc, resources);

    // 1. Clean Page Content Streams (`page.node.Contents`)
    const contentsEntry = pageNode.get(PDFName.of('Contents'));
    const contentsObj = pdfDoc.context.lookup(contentsEntry);

    if (contentsObj instanceof PDFRawStream) {
      const ref = contentsEntry instanceof PDFRef ? contentsEntry : undefined;
      const res = processPdfRawStream(
        pdfDoc,
        contentsObj,
        ref,
        normalizedKeywords,
        fontCMaps,
        translucentGs,
        autoDetectDiagonal
      );
      strippedArtifactBlocks += res.strippedArtifactBlocks;
      strippedTextOps += res.strippedTextOps;
      strippedDiagonalBlocks += res.strippedDiagonalBlocks;
      if (res.updatedStream && !ref) {
        pageNode.set(PDFName.of('Contents'), pdfDoc.context.register(res.updatedStream));
      }
    } else if (contentsObj instanceof PDFArray) {
      for (let i = 0; i < contentsObj.size(); i++) {
        const item = contentsObj.get(i);
        const streamObj = pdfDoc.context.lookup(item);
        if (streamObj instanceof PDFRawStream) {
          const ref = item instanceof PDFRef ? item : undefined;
          const res = processPdfRawStream(
            pdfDoc,
            streamObj,
            ref,
            normalizedKeywords,
            fontCMaps,
            translucentGs,
            autoDetectDiagonal
          );
          strippedArtifactBlocks += res.strippedArtifactBlocks;
          strippedTextOps += res.strippedTextOps;
          strippedDiagonalBlocks += res.strippedDiagonalBlocks;
          if (res.updatedStream && !ref) {
            contentsObj.set(i, pdfDoc.context.register(res.updatedStream));
          }
        }
      }
    }

    // 2. Also clean Form XObject streams (`/Subtype /Form`) in `Resources -> XObject`
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
              const formResourcesObj = pdfDoc.context.lookup(xObj.dict.get(PDFName.of('Resources')));
              const formResources = formResourcesObj instanceof PDFDict ? formResourcesObj : undefined;
              const mergedCMaps = extractResourcesFontCMaps(
                pdfDoc,
                formResources,
                new Map(fontCMaps)
              );
              const mergedGs = extractTranslucentExtGStates(
                pdfDoc,
                formResources,
                new Set(translucentGs)
              );
              const ref = xObjRef instanceof PDFRef ? xObjRef : undefined;
              const res = processPdfRawStream(
                pdfDoc,
                xObj,
                ref,
                normalizedKeywords,
                mergedCMaps,
                mergedGs,
                autoDetectDiagonal
              );
              strippedArtifactBlocks += res.strippedArtifactBlocks;
              strippedTextOps += res.strippedTextOps;
              strippedDiagonalBlocks += res.strippedDiagonalBlocks;
            }
          }
        }
      }
    }
  }

  return {
    strippedArtifactBlocks,
    strippedTextOps,
    strippedDiagonalBlocks,
  };
}
