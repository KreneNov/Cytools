import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExecutionBackend,
  InpaintModelSpec,
  InpaintWorkerRequest,
  InpaintWorkerResponse,
} from '../types/watermarkRemover';
import { DEFAULT_INPAINT_MODEL, MODEL_CACHE_NAME } from '../workers/inpaintModels';

export type ModelStatus = 'idle' | 'downloading' | 'ready' | 'error';

export interface WatermarkRemoverNotice {
  id: number;
  tone: 'info' | 'error';
  message: string;
}

export interface UseWatermarkRemoverReturn {
  model: InpaintModelSpec;
  modelStatus: ModelStatus;
  aiModelProgress: number;
  isAiModelCached: boolean;
  backend: ExecutionBackend | null;
  inferenceProgress: number;
  notice: WatermarkRemoverNotice | null;
  dismissNotice: () => void;
  preloadModel: () => void;
  runInpaint: (image: ImageData, mask: ImageData) => Promise<ImageData>;
}

interface PendingJob {
  resolve: (data: ImageData) => void;
  reject: (err: Error) => void;
}

/**
 * Manages the ONNX inpainting Web Worker lifecycle, model Cache API status,
 * and inference jobs (`jobId`-correlated so stale responses are ignored).
 */
export function useWatermarkRemover(model: InpaintModelSpec = DEFAULT_INPAINT_MODEL): UseWatermarkRemoverReturn {
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [aiModelProgress, setAiModelProgress] = useState<number>(0);
  const [isAiModelCached, setIsAiModelCached] = useState<boolean>(false);
  const [backend, setBackend] = useState<ExecutionBackend | null>(null);
  const [inferenceProgress, setInferenceProgress] = useState<number>(0);
  const [notice, setNotice] = useState<WatermarkRemoverNotice | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const jobsRef = useRef<Map<number, PendingJob>>(new Map());
  const jobCounterRef = useRef<number>(0);
  const noticeCounterRef = useRef<number>(0);
  const modelStatusRef = useRef<ModelStatus>('idle');

  const updateModelStatus = useCallback((status: ModelStatus) => {
    modelStatusRef.current = status;
    setModelStatus(status);
  }, []);

  const pushNotice = useCallback((tone: 'info' | 'error', message: string) => {
    noticeCounterRef.current += 1;
    setNotice({ id: noticeCounterRef.current, tone, message });
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent<InpaintWorkerResponse>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'MODEL_PROGRESS':
          setAiModelProgress(msg.progress);
          if (msg.cached) setIsAiModelCached(true);
          if (msg.progress < 100 && modelStatusRef.current !== 'ready') updateModelStatus('downloading');
          break;
        case 'MODEL_READY':
          setAiModelProgress(100);
          setIsAiModelCached(true);
          setBackend(msg.backend);
          updateModelStatus('ready');
          break;
        case 'INFERENCE_PROGRESS':
          setInferenceProgress(msg.progress);
          break;
        case 'INFERENCE_SUCCESS': {
          const job = jobsRef.current.get(msg.jobId);
          if (!job) return;
          jobsRef.current.delete(msg.jobId);
          setBackend(msg.backend);
          setInferenceProgress(100);
          job.resolve(new ImageData(new Uint8ClampedArray(msg.output), msg.width, msg.height));
          break;
        }
        case 'WORKER_ERROR': {
          if (msg.code === 'WEBGPU_FAILED' && !msg.fatal) {
            setBackend('wasm');
            pushNotice('info', msg.message);
            return;
          }
          if (msg.code === 'MODEL_DOWNLOAD_FAILED') {
            updateModelStatus('error');
            setAiModelProgress(0);
          }
          pushNotice('error', msg.message);
          if (msg.jobId !== undefined) {
            const job = jobsRef.current.get(msg.jobId);
            if (job) {
              jobsRef.current.delete(msg.jobId);
              job.reject(new Error(msg.message));
            }
          }
          break;
        }
      }
    },
    [pushNotice, updateModelStatus]
  );

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      const worker = new Worker(new URL('../workers/inpaintWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', (ev: ErrorEvent) => {
        pushNotice('error', `Web Worker gặp lỗi: ${ev.message || 'không xác định'}`);
        jobsRef.current.forEach((job) => job.reject(new Error('Web Worker crashed')));
        jobsRef.current.clear();
        updateModelStatus('error');
        worker.terminate();
        workerRef.current = null;
      });
      workerRef.current = worker;
    }
    return workerRef.current;
  }, [handleMessage, pushNotice, updateModelStatus]);

  // Inspect Cache Storage on mount to reflect cached status immediately.
  useEffect(() => {
    let active = true;
    const inspect = async () => {
      if (typeof caches === 'undefined') return;
      try {
        const cache = await caches.open(MODEL_CACHE_NAME);
        const hit = await cache.match(model.url);
        if (active && hit) {
          setIsAiModelCached(true);
        }
      } catch {
        // Cache API unavailable
      }
    };
    inspect();
    return () => {
      active = false;
    };
  }, [model.url]);

  // Terminate worker and reject outstanding jobs on unmount.
  useEffect(() => {
    const jobs = jobsRef.current;
    return () => {
      jobs.forEach((job) => job.reject(new Error('Component unmounted')));
      jobs.clear();
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const preloadModel = useCallback(() => {
    if (modelStatusRef.current === 'ready' || modelStatusRef.current === 'downloading') return;
    updateModelStatus('downloading');
    const request: InpaintWorkerRequest = { type: 'LOAD_MODEL', model };
    getWorker().postMessage(request);
  }, [getWorker, model, updateModelStatus]);

  const runInpaint = useCallback(
    (image: ImageData, mask: ImageData): Promise<ImageData> => {
      jobCounterRef.current += 1;
      const jobId = jobCounterRef.current;
      setInferenceProgress(0);
      if (modelStatusRef.current !== 'ready') updateModelStatus('downloading');

      return new Promise<ImageData>((resolve, reject) => {
        jobsRef.current.set(jobId, { resolve, reject });
        const imageCopy = new Uint8ClampedArray(image.data);
        const maskCopy = new Uint8ClampedArray(mask.data);
        const request: InpaintWorkerRequest = {
          type: 'RUN_INPAINT',
          jobId,
          model,
          image: imageCopy,
          mask: maskCopy,
          width: image.width,
          height: image.height,
        };
        try {
          getWorker().postMessage(request, [imageCopy.buffer, maskCopy.buffer]);
        } catch (err) {
          jobsRef.current.delete(jobId);
          reject(err instanceof Error ? err : new Error('Không thể gửi dữ liệu tới Web Worker.'));
        }
      });
    },
    [getWorker, model, updateModelStatus]
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    model,
    modelStatus,
    aiModelProgress,
    isAiModelCached,
    backend,
    inferenceProgress,
    notice,
    dismissNotice,
    preloadModel,
    runInpaint,
  };
}
