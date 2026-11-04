import type { InpaintModelSpec } from '../types/watermarkRemover';

/**
 * Pure, DOM-free pixel operations for the AI inpainting pipeline.
 * Safe to run in both the main thread and Web Workers.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MASK_ALPHA_THRESHOLD = 30;

/**
 * Converts an RGBA mask canvas buffer into a binary mask (1 = painted / fill, 0 = keep).
 */
export function rgbaMaskToBinary(maskRgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const total = width * height;
  const binary = new Uint8Array(total);
  for (let p = 0, i = 3; p < total; p++, i += 4) {
    binary[p] = maskRgba[i] > MASK_ALPHA_THRESHOLD ? 1 : 0;
  }
  return binary;
}

/**
 * Returns true if any pixel of an RGBA mask buffer is painted (early-exit scan).
 */
export function rgbaMaskHasPaint(maskRgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < maskRgba.length; i += 4) {
    if (maskRgba[i] > MASK_ALPHA_THRESHOLD) return true;
  }
  return false;
}

/**
 * Morphological dilation with a square structuring element of size (2r+1),
 * implemented as two separable 1-D max passes: O(w * h * r).
 */
export function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask.slice();
  const horizontal = new Uint8Array(mask.length);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      let v = 0;
      for (let k = x0; k <= x1; k++) {
        if (mask[row + k]) {
          v = 1;
          break;
        }
      }
      horizontal[row + x] = v;
    }
  }

  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      let v = 0;
      for (let k = y0; k <= y1; k++) {
        if (horizontal[k * width + x]) {
          v = 1;
          break;
        }
      }
      out[y * width + x] = v;
    }
  }
  return out;
}

/**
 * Bounding box of all set mask pixels, or null if the mask is empty.
 */
export function computeMaskBBox(mask: Uint8Array, width: number, height: number): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Expands a mask bounding box into a square context crop (preserving aspect ratio 1:1)
 * that is at least 2x the masked extent and at least `inputSize` px when the image allows,
 * clamped within image bounds.
 */
export function computeCropRegion(bbox: Rect, width: number, height: number, inputSize: number): Rect {
  const maskExtent = Math.max(bbox.w, bbox.h);
  let side = Math.max(maskExtent * 2, inputSize);
  side = Math.min(side, Math.max(width, height));

  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;

  const cropW = Math.min(side, width);
  const cropH = Math.min(side, height);

  let x = Math.round(cx - cropW / 2);
  let y = Math.round(cy - cropH / 2);
  x = Math.max(0, Math.min(x, width - cropW));
  y = Math.max(0, Math.min(y, height - cropH));

  return { x, y, w: Math.round(cropW), h: Math.round(cropH) };
}

/**
 * Extracts a rectangular RGBA region.
 */
export function cropRGBA(src: Uint8ClampedArray, width: number, rect: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    const srcStart = ((rect.y + y) * width + rect.x) * 4;
    out.set(src.subarray(srcStart, srcStart + rect.w * 4), y * rect.w * 4);
  }
  return out;
}

/**
 * Extracts a rectangular single-channel region.
 */
export function cropMask(src: Uint8Array, width: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    const srcStart = (rect.y + y) * width + rect.x;
    out.set(src.subarray(srcStart, srcStart + rect.w), y * rect.w);
  }
  return out;
}

/**
 * Letterbox geometry used when fitting a non-square crop into the square model input.
 */
export interface LetterboxInfo {
  scale: number;
  drawW: number;
  drawH: number;
  offsetX: number;
  offsetY: number;
}

export function computeLetterbox(srcW: number, srcH: number, size: number): LetterboxInfo {
  const scale = size / Math.max(srcW, srcH);
  const drawW = Math.max(1, Math.round(srcW * scale));
  const drawH = Math.max(1, Math.round(srcH * scale));
  return {
    scale,
    drawW,
    drawH,
    offsetX: Math.floor((size - drawW) / 2),
    offsetY: Math.floor((size - drawH) / 2),
  };
}

/**
 * Bilinear RGBA resize into a square `size x size` canvas with edge-replicated letterbox padding
 * (preserves aspect ratio).
 */
export function letterboxRGBA(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  size: number,
  lb: LetterboxInfo
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    // Map destination pixel into draw area; clamp outside to replicate edges.
    const dy = Math.min(Math.max(y - lb.offsetY, 0), lb.drawH - 1);
    const sy = ((dy + 0.5) * srcH) / lb.drawH - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = Math.min(Math.max(sy - y0, 0), 1);
    for (let x = 0; x < size; x++) {
      const dx = Math.min(Math.max(x - lb.offsetX, 0), lb.drawW - 1);
      const sx = ((dx + 0.5) * srcW) / lb.drawW - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = Math.min(Math.max(sx - x0, 0), 1);
      const i00 = (y0 * srcW + x0) * 4;
      const i01 = (y0 * srcW + x1) * 4;
      const i10 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i01 + c] * fx;
        const bottom = src[i10 + c] * (1 - fx) + src[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bottom * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Nearest-neighbour mask resize into the letterboxed square (padding = 0 / keep).
 */
export function letterboxMask(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  size: number,
  lb: LetterboxInfo
): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < lb.drawH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / lb.drawH));
    for (let x = 0; x < lb.drawW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / lb.drawW));
      // Any source pixel in a ~2px neighbourhood being set marks the mask (avoids thin-stroke loss on downscale).
      let v = src[sy * srcW + sx];
      if (!v && lb.scale < 1) {
        const r = Math.ceil(1 / lb.scale / 2);
        for (let ky = Math.max(0, sy - r); ky <= Math.min(srcH - 1, sy + r) && !v; ky++) {
          for (let kx = Math.max(0, sx - r); kx <= Math.min(srcW - 1, sx + r); kx++) {
            if (src[ky * srcW + kx]) {
              v = 1;
              break;
            }
          }
        }
      }
      out[(y + lb.offsetY) * size + (x + lb.offsetX)] = v;
    }
  }
  return out;
}

/**
 * Bilinear resize from the letterboxed model output back to the crop's native resolution.
 */
export function unletterboxRGBA(
  src: Uint8ClampedArray,
  size: number,
  lb: LetterboxInfo,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = lb.offsetY + ((y + 0.5) * lb.drawH) / dstH - 0.5;
    const y0 = Math.min(size - 1, Math.max(0, Math.floor(sy)));
    const y1 = Math.min(size - 1, y0 + 1);
    const fy = Math.min(Math.max(sy - y0, 0), 1);
    for (let x = 0; x < dstW; x++) {
      const sx = lb.offsetX + ((x + 0.5) * lb.drawW) / dstW - 0.5;
      const x0 = Math.min(size - 1, Math.max(0, Math.floor(sx)));
      const x1 = Math.min(size - 1, x0 + 1);
      const fx = Math.min(Math.max(sx - x0, 0), 1);
      const i00 = (y0 * size + x0) * 4;
      const i01 = (y0 * size + x1) * 4;
      const i10 = (y1 * size + x0) * 4;
      const i11 = (y1 * size + x1) * 4;
      const o = (y * dstW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i01 + c] * fx;
        const bottom = src[i10 + c] * (1 - fx) + src[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bottom * fy;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

export interface ModelTensorData {
  image: Uint8Array | Float32Array;
  mask: Uint8Array | Float32Array;
  dims: { image: [number, number, number, number]; mask: [number, number, number, number] };
}

/**
 * Converts square RGBA + binary mask into NCHW tensors matching the model spec.
 * - float32 (LaMa): RGB / 255 in [0,1], mask {0,1} with 1 = fill.
 * - uint8 (MI-GAN): RGB 0..255, mask 255 = keep, 0 = fill.
 */
export function toModelTensors(rgba: Uint8ClampedArray, mask: Uint8Array, size: number, spec: InpaintModelSpec): ModelTensorData {
  const plane = size * size;
  if (spec.tensorType === 'float32') {
    const image = new Float32Array(3 * plane);
    const maskT = new Float32Array(plane);
    for (let p = 0, i = 0; p < plane; p++, i += 4) {
      image[p] = rgba[i] / 255;
      image[plane + p] = rgba[i + 1] / 255;
      image[2 * plane + p] = rgba[i + 2] / 255;
      maskT[p] = mask[p] ? spec.maskFillValue : spec.maskKeepValue;
    }
    return { image, mask: maskT, dims: { image: [1, 3, size, size], mask: [1, 1, size, size] } };
  }
  const image = new Uint8Array(3 * plane);
  const maskT = new Uint8Array(plane);
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    image[p] = rgba[i];
    image[plane + p] = rgba[i + 1];
    image[2 * plane + p] = rgba[i + 2];
    maskT[p] = mask[p] ? spec.maskFillValue : spec.maskKeepValue;
  }
  return { image, mask: maskT, dims: { image: [1, 3, size, size], mask: [1, 1, size, size] } };
}

/**
 * Converts an NCHW model output tensor into RGBA, clamping according to the model output scale.
 */
export function fromModelOutput(
  data: ArrayLike<number>,
  width: number,
  height: number,
  spec: InpaintModelSpec
): Uint8ClampedArray {
  const plane = width * height;
  const out = new Uint8ClampedArray(plane * 4);
  const mul = spec.outputScale === '0-1' ? 255 : 1;
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    out[i] = Number(data[p]) * mul;
    out[i + 1] = Number(data[plane + p]) * mul;
    out[i + 2] = Number(data[2 * plane + p]) * mul;
    out[i + 3] = 255;
  }
  return out;
}

/**
 * Computes a per-pixel alpha in [0,1] for the dilated mask with a soft inner feather:
 * pixels deep inside the mask get 1, pixels within `featherPx` of the mask border ramp down,
 * pixels outside the mask get 0 (so unmasked pixels are guaranteed to be byte-identical).
 */
export function computeFeatherAlpha(mask: Uint8Array, width: number, height: number, featherPx: number): Float32Array {
  const total = width * height;
  const alpha = new Float32Array(total);
  if (featherPx <= 0) {
    for (let p = 0; p < total; p++) alpha[p] = mask[p] ? 1 : 0;
    return alpha;
  }
  // Two-pass chamfer distance transform (distance from each masked pixel to nearest unmasked pixel).
  const INF = 1e9;
  const dist = new Float32Array(total);
  for (let p = 0; p < total; p++) dist[p] = mask[p] ? INF : 0;
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (dist[p] === 0) continue;
      let d = dist[p];
      if (x > 0) d = Math.min(d, dist[p - 1] + D1);
      if (y > 0) {
        d = Math.min(d, dist[p - width] + D1);
        if (x > 0) d = Math.min(d, dist[p - width - 1] + D2);
        if (x < width - 1) d = Math.min(d, dist[p - width + 1] + D2);
      }
      // Image border counts as boundary
      if (x === 0 || y === 0) d = Math.min(d, 1);
      dist[p] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x;
      if (dist[p] === 0) continue;
      let d = dist[p];
      if (x < width - 1) d = Math.min(d, dist[p + 1] + D1);
      if (y < height - 1) {
        d = Math.min(d, dist[p + width] + D1);
        if (x < width - 1) d = Math.min(d, dist[p + width + 1] + D2);
        if (x > 0) d = Math.min(d, dist[p + width - 1] + D2);
      }
      if (x === width - 1 || y === height - 1) d = Math.min(d, 1);
      dist[p] = d;
    }
  }
  for (let p = 0; p < total; p++) {
    alpha[p] = mask[p] ? Math.min(1, dist[p] / featherPx) : 0;
  }
  return alpha;
}

/**
 * Blends an inpainted crop patch back into the full-resolution image.
 * Only pixels inside the (dilated) mask are modified; feathered alpha avoids visible seams.
 */
export function featherBlendBack(
  original: Uint8ClampedArray,
  width: number,
  patch: Uint8ClampedArray,
  crop: Rect,
  cropMaskBinary: Uint8Array,
  featherPx: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(original);
  const alpha = computeFeatherAlpha(cropMaskBinary, crop.w, crop.h, featherPx);
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const cp = y * crop.w + x;
      const a = alpha[cp];
      if (a <= 0) continue;
      const pi = cp * 4;
      const oi = ((crop.y + y) * width + (crop.x + x)) * 4;
      out[oi] = patch[pi] * a + original[oi] * (1 - a);
      out[oi + 1] = patch[pi + 1] * a + original[oi + 1] * (1 - a);
      out[oi + 2] = patch[pi + 2] * a + original[oi + 2] * (1 - a);
      out[oi + 3] = original[oi + 3];
    }
  }
  return out;
}
