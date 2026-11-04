import * as ort from 'onnxruntime-web/webgpu';
import type {
  ExecutionBackend,
  InpaintModelSpec,
  InpaintWorkerRequest,
  InpaintWorkerResponse,
  RunInpaintRequest,
} from '../types/watermarkRemover';
import { MODEL_CACHE_NAME } from './inpaintModels';
import {
  computeCropRegion,
  computeLetterbox,
  computeMaskBBox,
  cropMask,
  cropRGBA,
  dilateMask,
  featherBlendBack,
  fromModelOutput,
  letterboxMask,
  letterboxRGBA,
  rgbaMaskToBinary,
  toModelTensors,
  unletterboxRGBA,
} from '../utils/inpaintImageOps';

/* ------------------------------------------------------------------ */
/* ONNX Runtime environment                                            */
/* ------------------------------------------------------------------ */

const ORT_VERSION = '1.22.0';
const MASK_DILATION_RADIUS = 4;
const FEATHER_PX = 4;

interface WorkerScope {
  crossOriginIsolated?: boolean;
  navigator: Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } };
  postMessage(message: InpaintWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent<InpaintWorkerRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

const hardwareThreads = scope.navigator?.hardwareConcurrency || 2;
ort.env.wasm.numThreads = scope.crossOriginIsolated
  ? Math.max(1, Math.min(4, hardwareThreads - 1))
  : 1;
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

function post(message: InpaintWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

/* ------------------------------------------------------------------ */
/* Model download + Cache API                                          */
/* ------------------------------------------------------------------ */

async function loadModelBytes(spec: InpaintModelSpec): Promise<{ bytes: Uint8Array; cached: boolean }> {
  const hasCacheApi = typeof caches !== 'undefined';

  if (hasCacheApi) {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      const hit = await cache.match(spec.url);
      if (hit && hit.ok) {
        const buffer = await hit.arrayBuffer();
        if (buffer.byteLength >= spec.approxBytes * 0.8) {
          post({ type: 'MODEL_PROGRESS', progress: 100, cached: true });
          return { bytes: new Uint8Array(buffer), cached: true };
        }
        // Corrupted / truncated cache entry: purge and re-download
        await cache.delete(spec.url);
      }
    } catch {
      // Cache API unavailable (private mode, quota) -> continue with network download
    }
  }

  post({ type: 'MODEL_PROGRESS', progress: 0, cached: false });
  const response = await fetch(spec.url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} khi tải mô hình ${spec.label}`);
  }

  const lengthHeader = Number(response.headers.get('Content-Length') || 0);
  const expected = lengthHeader > 0 ? lengthHeader : spec.approxBytes;
  let bytes: Uint8Array;

  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastReported = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        const pct = Math.min(99, Math.floor((received / expected) * 100));
        if (pct !== lastReported) {
          lastReported = pct;
          post({ type: 'MODEL_PROGRESS', progress: pct, cached: false });
        }
      }
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  const truncated =
    (lengthHeader > 0 && bytes.byteLength !== lengthHeader) ||
    bytes.byteLength < spec.approxBytes * 0.8;
  if (truncated) {
    throw new Error('Tải mô hình bị gián đoạn (dữ liệu không đầy đủ). Vui lòng thử lại.');
  }

  if (hasCacheApi) {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME);
      await cache.put(
        spec.url,
        new Response(bytes.slice().buffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(bytes.byteLength),
          },
        })
      );
    } catch {
      // Quota exceeded: model still usable for this session
    }
  }

  post({ type: 'MODEL_PROGRESS', progress: 100, cached: false });
  return { bytes, cached: false };
}

/* ------------------------------------------------------------------ */
/* Session management with webgpu -> wasm fallback                     */
/* ------------------------------------------------------------------ */

interface LoadedSession {
  session: ort.InferenceSession;
  backend: ExecutionBackend;
  bytes: Uint8Array;
}

const sessions = new Map<string, LoadedSession>();
const pendingLoads = new Map<string, Promise<LoadedSession>>();

async function isWebGpuUsable(): Promise<boolean> {
  try {
    const gpu = scope.navigator?.gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function createSession(bytes: Uint8Array, preferWebGpu: boolean): Promise<{ session: ort.InferenceSession; backend: ExecutionBackend }> {
  if (preferWebGpu && (await isWebGpuUsable())) {
    try {
      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
      });
      return { session, backend: 'webgpu' };
    } catch (err) {
      post({
        type: 'WORKER_ERROR',
        code: 'WEBGPU_FAILED',
        message: `WebGPU không khả dụng (${err instanceof Error ? err.message : 'unknown'}). Đã chuyển sang WASM.`,
        fatal: false,
      });
    }
  }
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return { session, backend: 'wasm' };
}

async function ensureSession(spec: InpaintModelSpec): Promise<LoadedSession> {
  const existing = sessions.get(spec.id);
  if (existing) return existing;
  const pending = pendingLoads.get(spec.id);
  if (pending) return pending;

  const loader = (async (): Promise<LoadedSession> => {
    const modelBytes = await loadModelBytes(spec);
    const { session, backend } = await createSession(modelBytes.bytes, true);
    const loaded: LoadedSession = { session, backend, bytes: modelBytes.bytes };
    sessions.set(spec.id, loaded);
    post({ type: 'MODEL_READY', backend, cached: modelBytes.cached });
    return loaded;
  })();

  pendingLoads.set(spec.id, loader);
  try {
    return await loader;
  } finally {
    pendingLoads.delete(spec.id);
  }
}

async function downgradeToWasm(spec: InpaintModelSpec, current: LoadedSession): Promise<LoadedSession> {
  try {
    await current.session.release();
  } catch {
    // ignore
  }
  const { session } = await createSession(current.bytes, false);
  const downgraded: LoadedSession = { session, backend: 'wasm', bytes: current.bytes };
  sessions.set(spec.id, downgraded);
  return downgraded;
}

/* ------------------------------------------------------------------ */
/* Inference pipeline                                                  */
/* ------------------------------------------------------------------ */

function resolveInputNames(session: ort.InferenceSession): { imageName: string; maskName: string } {
  const names = session.inputNames;
  const maskName = names.find((n) => n.toLowerCase().includes('mask')) ?? names[1];
  const imageName = names.find((n) => n !== maskName) ?? names[0];
  return { imageName, maskName };
}

async function runModel(
  loaded: LoadedSession,
  spec: InpaintModelSpec,
  squareRgba: Uint8ClampedArray,
  squareMask: Uint8Array
): Promise<Uint8ClampedArray> {
  const size = spec.inputSize;
  const tensors = toModelTensors(squareRgba, squareMask, size, spec);
  const { imageName, maskName } = resolveInputNames(loaded.session);

  const imageTensor =
    tensors.image instanceof Float32Array
      ? new ort.Tensor('float32', tensors.image, tensors.dims.image)
      : new ort.Tensor('uint8', tensors.image, tensors.dims.image);
  const maskTensor =
    tensors.mask instanceof Float32Array
      ? new ort.Tensor('float32', tensors.mask, tensors.dims.mask)
      : new ort.Tensor('uint8', tensors.mask, tensors.dims.mask);

  const results = await loaded.session.run({ [imageName]: imageTensor, [maskName]: maskTensor });
  const output = results[loaded.session.outputNames[0]];
  const dims = output.dims;
  const outH = Number(dims[dims.length - 2]);
  const outW = Number(dims[dims.length - 1]);
  const data = (await output.getData()) as ArrayLike<number>;

  imageTensor.dispose();
  maskTensor.dispose();
  output.dispose();

  if (outW !== size || outH !== size) {
    throw new Error(`Kích thước đầu ra mô hình không hợp lệ (${outW}x${outH}).`);
  }
  return fromModelOutput(data, outW, outH, spec);
}

async function handleRunInpaint(req: RunInpaintRequest): Promise<void> {
  const { jobId, model, width, height } = req;

  post({ type: 'INFERENCE_PROGRESS', jobId, stage: 'preprocess', progress: 5 });

  let loaded: LoadedSession;
  try {
    loaded = await ensureSession(model);
  } catch (err) {
    post({
      type: 'WORKER_ERROR',
      jobId,
      code: 'MODEL_DOWNLOAD_FAILED',
      message: err instanceof Error ? err.message : 'Không thể tải mô hình AI.',
      fatal: true,
    });
    return;
  }

  const binary = rgbaMaskToBinary(req.mask, width, height);
  const dilated = dilateMask(binary, width, height, MASK_DILATION_RADIUS);
  const bbox = computeMaskBBox(dilated, width, height);

  if (!bbox) {
    const passthrough = new Uint8ClampedArray(req.image);
    post(
      { type: 'INFERENCE_SUCCESS', jobId, output: passthrough, width, height, backend: loaded.backend },
      [passthrough.buffer]
    );
    return;
  }

  const crop = computeCropRegion(bbox, width, height, model.inputSize);
  const cropPixels = cropRGBA(req.image, width, crop);
  const cropMaskBinary = cropMask(dilated, width, crop);
  const lb = computeLetterbox(crop.w, crop.h, model.inputSize);
  const squareRgba = letterboxRGBA(cropPixels, crop.w, crop.h, model.inputSize, lb);
  const squareMask = letterboxMask(cropMaskBinary, crop.w, crop.h, model.inputSize, lb);

  post({ type: 'INFERENCE_PROGRESS', jobId, stage: 'inference', progress: 25 });

  let modelOut: Uint8ClampedArray;
  try {
    modelOut = await runModel(loaded, model, squareRgba, squareMask);
  } catch (firstErr) {
    if (loaded.backend === 'webgpu') {
      post({
        type: 'WORKER_ERROR',
        jobId,
        code: 'WEBGPU_FAILED',
        message: 'Suy luận WebGPU thất bại, đang thử lại bằng WASM...',
        fatal: false,
      });
      try {
        loaded = await downgradeToWasm(model, loaded);
        modelOut = await runModel(loaded, model, squareRgba, squareMask);
      } catch (secondErr) {
        post({
          type: 'WORKER_ERROR',
          jobId,
          code: 'INFERENCE_FAILED',
          message: secondErr instanceof Error ? secondErr.message : 'Suy luận AI thất bại.',
          fatal: true,
        });
        return;
      }
    } else {
      post({
        type: 'WORKER_ERROR',
        jobId,
        code: 'INFERENCE_FAILED',
        message: firstErr instanceof Error ? firstErr.message : 'Suy luận AI thất bại.',
        fatal: true,
      });
      return;
    }
  }

  post({ type: 'INFERENCE_PROGRESS', jobId, stage: 'postprocess', progress: 85 });

  const patch = unletterboxRGBA(modelOut, model.inputSize, lb, crop.w, crop.h);
  const blended = featherBlendBack(req.image, width, patch, crop, cropMaskBinary, FEATHER_PX);

  post({ type: 'INFERENCE_PROGRESS', jobId, stage: 'postprocess', progress: 100 });
  post(
    { type: 'INFERENCE_SUCCESS', jobId, output: blended, width, height, backend: loaded.backend },
    [blended.buffer]
  );
}

/* ------------------------------------------------------------------ */
/* Message routing                                                     */
/* ------------------------------------------------------------------ */

scope.addEventListener('message', (event: MessageEvent<InpaintWorkerRequest>) => {
  const req = event.data;
  if (req.type === 'LOAD_MODEL') {
    ensureSession(req.model).catch((err: unknown) => {
      post({
        type: 'WORKER_ERROR',
        code: 'MODEL_DOWNLOAD_FAILED',
        message: err instanceof Error ? err.message : 'Không thể tải mô hình AI.',
        fatal: true,
      });
    });
    return;
  }
  if (req.type === 'RUN_INPAINT') {
    handleRunInpaint(req).catch((err: unknown) => {
      post({
        type: 'WORKER_ERROR',
        jobId: req.jobId,
        code: 'INFERENCE_FAILED',
        message: err instanceof Error ? err.message : 'Lỗi không xác định trong Web Worker.',
        fatal: true,
      });
    });
  }
});
