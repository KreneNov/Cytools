import type {
  InpaintWorkerRequest,
  InpaintWorkerResponse,
} from '../types/watermarkRemover';

export const ONNX_MODEL_CACHE_NAME = 'cytools-onnx-models-v1';
export const DEFAULT_ONNX_INPAINT_MODEL_URL = '/models/inpaint-lama-fp16.onnx';

// In-memory cached buffer inside the Worker thread to avoid repeated CacheStorage reads
let workerCachedOnnxBuffer: ArrayBuffer | null = null;
let workerCachedOnnxUrl: string | null = null;

/**
 * Fetches an ONNX binary payload (~30MB) and caches it permanently in the browser's Cache API
 * so the 30MB payload is only downloaded once per user device.
 * Reports streaming download progress (0-100) via `onProgress`.
 */
export async function loadCachedOnnxModel(
  modelUrl: string = DEFAULT_ONNX_INPAINT_MODEL_URL,
  onProgress?: (progress: number, cached: boolean) => void
): Promise<ArrayBuffer> {
  if (workerCachedOnnxBuffer && workerCachedOnnxUrl === modelUrl) {
    if (onProgress) onProgress(100, true);
    return workerCachedOnnxBuffer;
  }

  const hasCacheApi = typeof caches !== 'undefined';

  // 1. Check browser Cache Storage first
  if (hasCacheApi) {
    try {
      const cache = await caches.open(ONNX_MODEL_CACHE_NAME);
      const cachedResponse = await cache.match(modelUrl);
      if (cachedResponse && cachedResponse.ok) {
        if (onProgress) onProgress(50, true);
        const buffer = await cachedResponse.arrayBuffer();
        workerCachedOnnxBuffer = buffer;
        workerCachedOnnxUrl = modelUrl;
        if (onProgress) onProgress(100, true);
        return buffer;
      }
    } catch (cacheReadErr) {
      console.warn('[ONNX Cache API] Không thể đọc bộ nhớ đệm CacheStorage:', cacheReadErr);
    }
  }

  // 2. Cache miss -> Stream download with live 0-100% progress reporting
  if (onProgress) onProgress(0, false);
  const response = await fetch(modelUrl, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Không thể tải mô hình AI (${response.status} ${response.statusText})`);
  }

  const contentLengthHeader = response.headers.get('Content-Length');
  const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 30 * 1024 * 1024;

  let modelBuffer: ArrayBuffer;

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.byteLength;
        if (onProgress && totalBytes > 0) {
          const pct = Math.min(99, Math.max(1, Math.round((receivedBytes / totalBytes) * 100)));
          onProgress(pct, false);
        }
      }
    }

    const merged = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    modelBuffer = merged.buffer;
  } else {
    modelBuffer = await response.arrayBuffer();
  }

  // 3. Persist the 30MB ONNX payload into Browser Cache API for future sessions
  if (hasCacheApi && modelBuffer.byteLength > 0) {
    try {
      const cache = await caches.open(ONNX_MODEL_CACHE_NAME);
      const responseToCache = new Response(modelBuffer.slice(0), {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(modelBuffer.byteLength),
          'X-Cytools-Cached-At': new Date().toISOString(),
        },
      });
      await cache.put(modelUrl, responseToCache);
    } catch (cacheWriteErr) {
      console.warn('[ONNX Cache API] Không thể lưu mô hình vào CacheStorage:', cacheWriteErr);
    }
  }

  workerCachedOnnxBuffer = modelBuffer;
  workerCachedOnnxUrl = modelUrl;
  if (onProgress) onProgress(100, false);

  return modelBuffer;
}

/**
 * Binary Min-Heap Priority Queue for Fast Marching Method (FMM)
 */
class MinHeap {
  private indices: Int32Array;
  private priorities: Float32Array;
  private size: number = 0;

  constructor(capacity: number) {
    this.indices = new Int32Array(capacity);
    this.priorities = new Float32Array(capacity);
  }

  push(idx: number, priority: number): void {
    let i = this.size++;
    this.indices[i] = idx;
    this.priorities[i] = priority;

    // Up-heap
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[i] < this.priorities[parent]) {
        this.swap(i, parent);
        i = parent;
      } else {
        break;
      }
    }
  }

  pop(): number | null {
    if (this.size === 0) return null;
    const top = this.indices[0];
    this.size--;

    if (this.size > 0) {
      this.indices[0] = this.indices[this.size];
      this.priorities[0] = this.priorities[this.size];
      this.downHeap(0);
    }

    return top;
  }

  isEmpty(): boolean {
    return this.size === 0;
  }

  private downHeap(i: number): void {
    while (true) {
      const left = (i << 1) + 1;
      const right = left + 1;
      let smallest = i;

      if (left < this.size && this.priorities[left] < this.priorities[smallest]) {
        smallest = left;
      }
      if (right < this.size && this.priorities[right] < this.priorities[smallest]) {
        smallest = right;
      }

      if (smallest !== i) {
        this.swap(i, smallest);
        i = smallest;
      } else {
        break;
      }
    }
  }

  private swap(a: number, b: number): void {
    const tempIdx = this.indices[a];
    this.indices[a] = this.indices[b];
    this.indices[b] = tempIdx;

    const tempPri = this.priorities[a];
    this.priorities[a] = this.priorities[b];
    this.priorities[b] = tempPri;
  }
}

const FLAG_KNOWN = 0;
const FLAG_BAND = 1;
const FLAG_INSIDE = 2;

/**
 * Pure TypeScript Telea Inpainting Algorithm (Alexandru Telea, 2004)
 * Executes Fast Marching Method on pixel buffers with directional gradient propagation.
 */
export function inpaintTelea(
  srcImg: ImageData,
  maskImg: ImageData,
  radius: number = 5,
  onProgress?: (progress: number) => void
): ImageData {
  const width = srcImg.width;
  const height = srcImg.height;
  const numPixels = width * height;

  // Clone source image data buffer
  const outImg = new ImageData(
    new Uint8ClampedArray(srcImg.data),
    width,
    height
  );
  const outData = outImg.data;
  const maskData = maskImg.data;

  // Flags map & Distance transform map T
  const flags = new Uint8Array(numPixels);
  const T = new Float32Array(numPixels);
  T.fill(1e9);

  let targetCount = 0;

  // Initialize flags: 0 = KNOWN, 2 = INSIDE (any mask alpha > 30 or mask red > 30)
  for (let i = 0, p = 0; i < maskData.length; i += 4, p++) {
    if (maskData[i + 3] > 30 || maskData[i] > 30) {
      flags[p] = FLAG_INSIDE;
      targetCount++;
    } else {
      flags[p] = FLAG_KNOWN;
      T[p] = 0;
    }
  }

  // If nothing to inpaint, return original copy immediately
  if (targetCount === 0) {
    if (onProgress) onProgress(100);
    return outImg;
  }

  const heap = new MinHeap(Math.max(1024, targetCount * 2));

  // Find initial narrow band pixels (INSIDE pixels adjacent to KNOWN pixels)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (flags[p] === FLAG_INSIDE) {
        let hasKnownNeighbor = false;
        // Check 4-neighborhood
        if (x > 0 && flags[p - 1] === FLAG_KNOWN) hasKnownNeighbor = true;
        else if (x < width - 1 && flags[p + 1] === FLAG_KNOWN) hasKnownNeighbor = true;
        else if (y > 0 && flags[p - width] === FLAG_KNOWN) hasKnownNeighbor = true;
        else if (y < height - 1 && flags[p + width] === FLAG_KNOWN) hasKnownNeighbor = true;

        if (hasKnownNeighbor) {
          flags[p] = FLAG_BAND;
          T[p] = 0;
          heap.push(p, 0);
        }
      }
    }
  }

  let processedCount = 0;
  let lastReportedProgress = 0;
  const reportInterval = Math.max(100, Math.floor(targetCount / 40));

  // Fast Marching Main Loop
  while (!heap.isEmpty()) {
    const p = heap.pop();
    if (p === null) break;

    const px = p % width;
    const py = Math.floor(p / width);

    flags[p] = FLAG_KNOWN;
    processedCount++;

    if (onProgress && processedCount % reportInterval === 0) {
      const currentProgress = Math.min(99, Math.round((processedCount / targetCount) * 100));
      if (currentProgress > lastReportedProgress) {
        lastReportedProgress = currentProgress;
        onProgress(currentProgress);
      }
    }

    // Inpaint color at pixel p from surrounding KNOWN pixels within radius
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumW = 0;

    // Directional gradient computation \nabla T(p)
    let gradX = 0;
    let gradY = 0;

    if (px > 0 && px < width - 1) {
      gradX = (T[py * width + (px + 1)] - T[py * width + (px - 1)]) * 0.5;
    } else if (px > 0) {
      gradX = T[p] - T[py * width + (px - 1)];
    } else if (px < width - 1) {
      gradX = T[py * width + (px + 1)] - T[p];
    }

    if (py > 0 && py < height - 1) {
      gradY = (T[(py + 1) * width + px] - T[(py - 1) * width + px]) * 0.5;
    } else if (py > 0) {
      gradY = T[p] - T[(py - 1) * width + px];
    } else if (py < height - 1) {
      gradY = T[(py + 1) * width + px] - T[p];
    }

    const gradLen = Math.hypot(gradX, gradY) + 1e-6;
    const normGradX = gradX / gradLen;
    const normGradY = gradY / gradLen;

    const rMinX = Math.max(0, px - radius);
    const rMaxX = Math.min(width - 1, px + radius);
    const rMinY = Math.max(0, py - radius);
    const rMaxY = Math.min(height - 1, py + radius);

    for (let qy = rMinY; qy <= rMaxY; qy++) {
      for (let qx = rMinX; qx <= rMaxX; qx++) {
        const q = qy * width + qx;
        if (flags[q] === FLAG_KNOWN) {
          const dx = px - qx;
          const dy = py - qy;
          const distSq = dx * dx + dy * dy;
          if (distSq === 0 || distSq > radius * radius) continue;

          const dist = Math.sqrt(distSq);

          // Direction factor: alignment with contour normal
          const dir = Math.abs(dx * normGradX + dy * normGradY) / dist + 1e-4;

          // Geometric distance factor
          const dst = 1.0 / distSq;

          // Level set distance factor
          const lev = 1.0 / (1.0 + Math.abs(T[p] - T[q]));

          const weight = dir * dst * lev;
          const qIdx = q * 4;

          sumR += weight * outData[qIdx];
          sumG += weight * outData[qIdx + 1];
          sumB += weight * outData[qIdx + 2];
          sumW += weight;
        }
      }
    }

    if (sumW > 0) {
      const pIdx = p * 4;
      outData[pIdx] = Math.min(255, Math.max(0, Math.round(sumR / sumW)));
      outData[pIdx + 1] = Math.min(255, Math.max(0, Math.round(sumG / sumW)));
      outData[pIdx + 2] = Math.min(255, Math.max(0, Math.round(sumB / sumW)));
      outData[pIdx + 3] = 255;
    }

    // Update 4-connected neighbors
    const neighbors = [
      { x: px - 1, y: py },
      { x: px + 1, y: py },
      { x: px, y: py - 1 },
      { x: px, y: py + 1 },
    ];

    for (const n of neighbors) {
      if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
        const nIdx = n.y * width + n.x;
        if (flags[nIdx] !== FLAG_KNOWN) {
          // Compute new distance estimate for neighbor
          let minKnownT = 1e9;
          if (n.x > 0 && flags[n.y * width + n.x - 1] === FLAG_KNOWN) {
            minKnownT = Math.min(minKnownT, T[n.y * width + n.x - 1]);
          }
          if (n.x < width - 1 && flags[n.y * width + n.x + 1] === FLAG_KNOWN) {
            minKnownT = Math.min(minKnownT, T[n.y * width + n.x + 1]);
          }
          if (n.y > 0 && flags[(n.y - 1) * width + n.x] === FLAG_KNOWN) {
            minKnownT = Math.min(minKnownT, T[(n.y - 1) * width + n.x]);
          }
          if (n.y < height - 1 && flags[(n.y + 1) * width + n.x] === FLAG_KNOWN) {
            minKnownT = Math.min(minKnownT, T[(n.y + 1) * width + n.x]);
          }

          const newT = minKnownT < 1e8 ? minKnownT + 1.0 : T[p] + 1.0;

          if (flags[nIdx] === FLAG_INSIDE) {
            flags[nIdx] = FLAG_BAND;
            T[nIdx] = newT;
            heap.push(nIdx, newT);
          } else if (flags[nIdx] === FLAG_BAND && newT < T[nIdx]) {
            T[nIdx] = newT;
            heap.push(nIdx, newT);
          }
        }
      }
    }
  }

  if (onProgress) onProgress(100);
  return outImg;
}

// Web Worker Event Listener (works in both classic and ES module Web Workers)
const isWorkerContext =
  typeof self !== 'undefined' &&
  typeof window === 'undefined';

if (isWorkerContext) {
  self.addEventListener('message', async (event: MessageEvent<InpaintWorkerRequest>) => {
    const data = event.data;

    if (data?.type === 'PRELOAD_AI_MODEL') {
      try {
        const modelUrl = data.modelUrl || DEFAULT_ONNX_INPAINT_MODEL_URL;
        let wasCached = false;
        const buffer = await loadCachedOnnxModel(modelUrl, (progress, cached) => {
          wasCached = cached;
          self.postMessage({
            type: 'AI_MODEL_PROGRESS',
            progress,
            cached,
          } as InpaintWorkerResponse);
        });

        self.postMessage({
          type: 'AI_MODEL_READY',
          cached: wasCached,
          byteLength: buffer.byteLength,
        } as InpaintWorkerResponse);
      } catch (err) {
        self.postMessage({
          type: 'INPAINT_ERROR',
          error:
            err instanceof Error
              ? err.message
              : 'Không thể tải hoặc lưu bộ nhớ đệm mô hình AI ONNX.',
        } as InpaintWorkerResponse);
      }
      return;
    }

    if (data?.type === 'INPAINT_REQUEST') {
      try {
        // Optional ONNX model cache warm-up if a modelUrl was supplied
        if (data.modelUrl) {
          try {
            await loadCachedOnnxModel(data.modelUrl, (progress, cached) => {
              self.postMessage({
                type: 'AI_MODEL_PROGRESS',
                progress,
                cached,
              } as InpaintWorkerResponse);
            });
          } catch {
            // Continue with Telea FMM engine if external ONNX binary is not yet hosted
          }
        }

        const result = inpaintTelea(data.imageData, data.maskData, data.radius, (progress) => {
          self.postMessage({
            type: 'INPAINT_PROGRESS',
            progress,
          } as InpaintWorkerResponse);
        });

        self.postMessage({
          type: 'INPAINT_SUCCESS',
          resultData: result,
        } as InpaintWorkerResponse);
      } catch (err) {
        self.postMessage({
          type: 'INPAINT_ERROR',
          error: err instanceof Error ? err.message : 'Lỗi không xác định khi xóa watermark hình ảnh.',
        } as InpaintWorkerResponse);
      }
    }
  });
}
