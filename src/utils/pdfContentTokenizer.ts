/**
 * Byte-accurate PDF content stream lexer (ISO 32000-1 Section 7.2 & Section 8).
 * Preserves exact [start, end) byte offsets for every token and safely skips
 * binary inline image blocks (`BI ... ID <binary> EI`) so binary payloads
 * are never misinterpreted as PDF text operators.
 */

export type PdfTokenKind =
  | 'string'
  | 'hexstring'
  | 'name'
  | 'number'
  | 'array'
  | 'dict'
  | 'operator'
  | 'inline_image';

export interface PdfContentToken {
  kind: PdfTokenKind;
  /** Raw Latin-1 slice from the stream (for debugging/operator matching). */
  raw: string;
  /** Inclusive start byte offset in the decompressed content stream. */
  start: number;
  /** Exclusive end byte offset in the decompressed content stream. */
  end: number;
}

function isWhitespace(byte: number): boolean {
  return (
    byte === 0x00 ||
    byte === 0x09 ||
    byte === 0x0a ||
    byte === 0x0c ||
    byte === 0x0d ||
    byte === 0x20
  );
}

function isDelimiter(byte: number): boolean {
  return (
    byte === 0x28 || // (
    byte === 0x29 || // )
    byte === 0x3c || // <
    byte === 0x3e || // >
    byte === 0x5b || // [
    byte === 0x5d || // ]
    byte === 0x7b || // {
    byte === 0x7d || // }
    byte === 0x2f || // /
    byte === 0x25 // %
  );
}

function bytesToAsciiSlice(bytes: Uint8Array, start: number, end: number): string {
  const len = Math.min(end - start, 16384);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += String.fromCharCode(bytes[start + i]);
  }
  return out;
}

/**
 * Advances `pos` past a PDF literal string `(...)`, handling nested parentheses and backslash escapes.
 */
function scanLiteralString(bytes: Uint8Array, start: number): number {
  let i = start + 1;
  let depth = 1;
  const len = bytes.length;
  while (i < len && depth > 0) {
    const b = bytes[i];
    if (b === 0x5c) {
      // Backslash escape: skip next byte
      i += 2;
      continue;
    }
    if (b === 0x28) depth++;
    else if (b === 0x29) depth--;
    i++;
  }
  return i;
}

/**
 * Advances `pos` past a PDF dictionary `<< ... >>`, handling nested dictionaries and literal strings.
 */
function scanDictionary(bytes: Uint8Array, start: number): number {
  let i = start + 2;
  let depth = 1;
  const len = bytes.length;
  while (i < len && depth > 0) {
    const b = bytes[i];
    if (b === 0x25) {
      // Comment until EOL
      while (i < len && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }
    if (b === 0x28) {
      i = scanLiteralString(bytes, i);
      continue;
    }
    if (b === 0x3c && i + 1 < len && bytes[i + 1] === 0x3c) {
      depth++;
      i += 2;
      continue;
    }
    if (b === 0x3e && i + 1 < len && bytes[i + 1] === 0x3e) {
      depth--;
      i += 2;
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Advances `pos` past a PDF array `[ ... ]`, handling nested arrays and literal strings.
 */
function scanArray(bytes: Uint8Array, start: number): number {
  let i = start + 1;
  let depth = 1;
  const len = bytes.length;
  while (i < len && depth > 0) {
    const b = bytes[i];
    if (b === 0x25) {
      while (i < len && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }
    if (b === 0x28) {
      i = scanLiteralString(bytes, i);
      continue;
    }
    if (b === 0x5b) {
      depth++;
      i++;
      continue;
    }
    if (b === 0x5d) {
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Scans an inline image from `BI` through `ID <binary data> EI`.
 */
function scanInlineImage(bytes: Uint8Array, biStart: number, afterBi: number): number {
  let i = afterBi;
  const len = bytes.length;

  // 1. Find the `ID` operator that ends the inline image header
  while (i < len - 1) {
    if (bytes[i] === 0x28) {
      i = scanLiteralString(bytes, i);
      continue;
    }
    if (
      bytes[i] === 0x49 && // 'I'
      bytes[i + 1] === 0x44 && // 'D'
      (i === biStart || isWhitespace(bytes[i - 1]) || isDelimiter(bytes[i - 1])) &&
      (i + 2 >= len || isWhitespace(bytes[i + 2]))
    ) {
      i += 3; // Move past 'I', 'D', and the single mandatory whitespace byte
      break;
    }
    i++;
  }

  // 2. Find the closing `<whitespace>EI<whitespace_or_EOF>` sequence
  while (i < len - 1) {
    if (
      isWhitespace(bytes[i - 1]) &&
      bytes[i] === 0x45 && // 'E'
      bytes[i + 1] === 0x49 && // 'I'
      (i + 2 >= len || isWhitespace(bytes[i + 2]) || isDelimiter(bytes[i + 2]))
    ) {
      return i + 2;
    }
    i++;
  }

  return len;
}

/**
 * Tokenizes a decompressed PDF content stream into an ordered list of tokens with exact byte offsets.
 */
export function tokenizePdfContentStream(bytes: Uint8Array): PdfContentToken[] {
  const tokens: PdfContentToken[] = [];
  const len = bytes.length;
  let i = 0;

  while (i < len) {
    const b = bytes[i];

    // Skip whitespace
    if (isWhitespace(b)) {
      i++;
      continue;
    }

    // Skip comments `% ... EOL`
    if (b === 0x25) {
      while (i < len && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }

    // Literal string `(...)`
    if (b === 0x28) {
      const end = scanLiteralString(bytes, i);
      tokens.push({
        kind: 'string',
        raw: bytesToAsciiSlice(bytes, i, end),
        start: i,
        end,
      });
      i = end;
      continue;
    }

    // Dictionary `<< ... >>` or Hex string `< ... >`
    if (b === 0x3c) {
      if (i + 1 < len && bytes[i + 1] === 0x3c) {
        const end = scanDictionary(bytes, i);
        tokens.push({
          kind: 'dict',
          raw: bytesToAsciiSlice(bytes, i, end),
          start: i,
          end,
        });
        i = end;
        continue;
      }
      let end = i + 1;
      while (end < len && bytes[end] !== 0x3e) end++;
      if (end < len) end++;
      tokens.push({
        kind: 'hexstring',
        raw: bytesToAsciiSlice(bytes, i, end),
        start: i,
        end,
      });
      i = end;
      continue;
    }

    // Array `[ ... ]`
    if (b === 0x5b) {
      const end = scanArray(bytes, i);
      tokens.push({
        kind: 'array',
        raw: bytesToAsciiSlice(bytes, i, end),
        start: i,
        end,
      });
      i = end;
      continue;
    }

    // Name `/Name`
    if (b === 0x2f) {
      let end = i + 1;
      while (end < len && !isWhitespace(bytes[end]) && !isDelimiter(bytes[end])) {
        end++;
      }
      tokens.push({
        kind: 'name',
        raw: bytesToAsciiSlice(bytes, i, end),
        start: i,
        end,
      });
      i = end;
      continue;
    }

    // Regular token (number, boolean, null, or operator)
    let end = i + 1;
    while (end < len && !isWhitespace(bytes[end]) && !isDelimiter(bytes[end])) {
      end++;
    }
    const raw = bytesToAsciiSlice(bytes, i, end);

    // Inline image `BI ... ID <binary> EI`
    if (raw === 'BI') {
      const eiEnd = scanInlineImage(bytes, i, end);
      tokens.push({
        kind: 'inline_image',
        raw: 'BI...EI',
        start: i,
        end: eiEnd,
      });
      i = eiEnd;
      continue;
    }

    const isNum = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw);
    tokens.push({
      kind: isNum ? 'number' : 'operator',
      raw,
      start: i,
      end,
    });
    i = end;
  }

  return tokens;
}

/**
 * Extracts and unescapes all literal ASCII strings `(...)` from a `string` or `array` token.
 * Returns null if the token uses hex strings `<...>` or non-printable binary glyph codes.
 */
export function extractSafeAsciiFromOperand(token: PdfContentToken): {
  text: string;
  hasHexOrBinary: boolean;
} {
  if (token.kind === 'hexstring') {
    return { text: '', hasHexOrBinary: true };
  }

  const raw = token.raw;
  // Detect any hex string `<...>` inside a TJ array `[<0026> -3 <0032>]`
  if (/<[0-9a-fA-F\s]+>/.test(raw)) {
    return { text: '', hasHexOrBinary: true };
  }

  let out = '';
  let hasBinary = false;
  let i = 0;
  const len = raw.length;

  while (i < len) {
    if (raw[i] === '(') {
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        const ch = raw[i];
        if (ch === '\\' && i + 1 < len) {
          const next = raw[i + 1];
          if (next >= '0' && next <= '7') {
            let oct = next;
            i += 2;
            if (i < len && raw[i] >= '0' && raw[i] <= '7') oct += raw[i++];
            if (i < len && raw[i] >= '0' && raw[i] <= '7') oct += raw[i++];
            const code = parseInt(oct, 8);
            if (code < 9 || (code > 13 && code < 32)) hasBinary = true;
            out += String.fromCharCode(code);
            continue;
          }
          if (next === 'n') out += '\n';
          else if (next === 'r') out += '\r';
          else if (next === 't') out += '\t';
          else out += next;
          i += 2;
          continue;
        }
        if (ch === '(') {
          depth++;
          out += ch;
        } else if (ch === ')') {
          depth--;
          if (depth > 0) out += ch;
        } else {
          const code = ch.charCodeAt(0);
          if (code === 0) hasBinary = true;
          out += ch;
        }
        i++;
      }
    } else {
      i++;
    }
  }

  return { text: out, hasHexOrBinary: hasBinary };
}

/**
 * Splices out byte ranges `[start, end)` from `source` without re-serializing untouched bytes.
 */
export function spliceOutByteRanges(
  source: Uint8Array,
  ranges: Array<{ start: number; end: number }>
): Uint8Array {
  if (ranges.length === 0) return source;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);

  // Merge overlapping or adjacent ranges
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of sorted) {
    const start = Math.max(0, Math.min(source.length, r.start));
    const end = Math.max(start, Math.min(source.length, r.end));
    if (end <= start) continue;
    const prev = merged[merged.length - 1];
    if (prev && start <= prev.end) {
      prev.end = Math.max(prev.end, end);
    } else {
      merged.push({ start, end });
    }
  }

  let removedBytes = 0;
  for (const r of merged) removedBytes += r.end - r.start;
  const out = new Uint8Array(source.length - removedBytes);

  let srcPos = 0;
  let dstPos = 0;
  for (const r of merged) {
    if (r.start > srcPos) {
      const slice = source.subarray(srcPos, r.start);
      out.set(slice, dstPos);
      dstPos += slice.length;
    }
    srcPos = r.end;
  }
  if (srcPos < source.length) {
    const tail = source.subarray(srcPos);
    out.set(tail, dstPos);
  }
  return out;
}
