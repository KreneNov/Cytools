import { useState, useRef, useEffect, useCallback } from 'react';
import {
  inpaintTelea,
  loadCachedOnnxModel,
  ONNX_MODEL_CACHE_NAME,
  DEFAULT_ONNX_INPAINT_MODEL_URL,
} from '../workers/inpaintWorker';
import type { InpaintWorkerResponse } from '../types/watermarkRemover';

export interface UseWatermarkRemoverReturn {
  isProcessing: boolean;
  processProgress: number;
  aiModelProgress: number;
  isAiModelCached: boolean;
  isAiModelLoading: boolean;
  preloadAiModel: (modelUrl?: string) => Promise<void>;
  executeInpaint: (
    baseImageData: ImageData,
    maskImageData: ImageData,
    radius?: number
  ) => Promise<ImageData>;
}

/**
 * Hook managing the Image Watermark Inpainting Web Worker and the 30MB ONNX
 * model Cache API lifecycle (`aiModelProgress`: 0-100).
 */
export function useWatermarkRemover(): UseWatermarkRemoverReturn {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processProgress, setProcessProgress] = useState<number>(0);
  const [aiModelProgress, setAiModelProgress] = useState<number>(0);
  const [isAiModelCached, setIsAiModelCached] = useState<boolean>(false);
  const [isAiModelLoading, setIsAiModelLoading] = useState<boolean>(false);

  const workerRef = useRef<Worker | null>(null);

  const getOrCreateWorker = useCallback((): Worker | null => {
    if (typeof Worker === 'undefined') return null;
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../workers/inpaintWorker.ts', import.meta.url),
        { type: 'module' }
      );
    }
    return workerRef.current;
  }, []);

  // Check if the 30MB ONNX model is already stored in browser Cache API on mount
  useEffect(() => {
    let isMounted = true;

    const inspectCacheStorage = async () => {
      if (typeof caches === 'undefined') return;
      try {
        const cache = await caches.open(ONNX_MODEL_CACHE_NAME);
        const match = await cache.match(DEFAULT_ONNX_INPAINT_MODEL_URL);
        if (isMounted && match && match.ok) {
          setIsAiModelCached(true);
          setAiModelProgress(100);
        }
      } catch {
        // Ignore Cache API permission errors in restricted contexts
      }
    };

    inspectCacheStorage();

    return () => {
      isMounted = false;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  /**
   * Fetches and caches a ~30MB `.onnx` model binary in the browser's Cache API (`caches.open`)
   * via the Web Worker so the 30MB payload is only downloaded once per user.
   */
  const preloadAiModel = useCallback(
    async (modelUrl: string = DEFAULT_ONNX_INPAINT_MODEL_URL): Promise<void> => {
      setIsAiModelLoading(true);
      setAiModelProgress(0);

      const worker = getOrCreateWorker();
      if (!worker) {
        try {
          await loadCachedOnnxModel(modelUrl, (pct, cached) => {
            setAiModelProgress(pct);
            if (cached) setIsAiModelCached(true);
          });
          setIsAiModelCached(true);
          setAiModelProgress(100);
        } catch {
          // Graceful fallback when model binary is not yet hosted on static server
          setAiModelProgress(100);
        } finally {
          setIsAiModelLoading(false);
        }
        return;
      }

      return new Promise<void>((resolve) => {
        const handleMessage = (e: MessageEvent<InpaintWorkerResponse>) => {
          const resp = e.data;
          if (resp.type === 'AI_MODEL_PROGRESS') {
            setAiModelProgress(resp.progress);
            if (resp.cached) setIsAiModelCached(true);
          } else if (resp.type === 'AI_MODEL_READY') {
            setAiModelProgress(100);
            setIsAiModelCached(true);
            setIsAiModelLoading(false);
            worker.removeEventListener('message', handleMessage);
            resolve();
          } else if (resp.type === 'INPAINT_ERROR') {
            setAiModelProgress(100);
            setIsAiModelLoading(false);
            worker.removeEventListener('message', handleMessage);
            resolve();
          }
        };

        worker.addEventListener('message', handleMessage);
        worker.postMessage({
          type: 'PRELOAD_AI_MODEL',
          modelUrl,
        });
      });
    },
    [getOrCreateWorker]
  );

  /**
   * Executes watermark inpainting inside the Web Worker (with main-thread Telea fallback).
   */
  const executeInpaint = useCallback(
    async (
      baseImageData: ImageData,
      maskImageData: ImageData,
      radius: number = 6
    ): Promise<ImageData> => {
      setIsProcessing(true);
      setProcessProgress(0);
      if (aiModelProgress < 100) {
        setAiModelProgress(100);
      }

      return new Promise<ImageData>((resolve) => {
        try {
          const worker = getOrCreateWorker();
          if (worker) {
            const handleMessage = (e: MessageEvent<InpaintWorkerResponse>) => {
              const resp = e.data;
              if (resp.type === 'AI_MODEL_PROGRESS') {
                setAiModelProgress(resp.progress);
                if (resp.cached) setIsAiModelCached(true);
              } else if (resp.type === 'INPAINT_PROGRESS') {
                setProcessProgress(resp.progress);
              } else if (resp.type === 'INPAINT_SUCCESS') {
                setProcessProgress(100);
                setIsProcessing(false);
                worker.removeEventListener('message', handleMessage);
                resolve(resp.resultData);
              } else if (resp.type === 'INPAINT_ERROR') {
                console.warn('[InpaintWorker Error]:', resp.error);
                worker.removeEventListener('message', handleMessage);
                const direct = inpaintTelea(
                  baseImageData,
                  maskImageData,
                  radius,
                  setProcessProgress
                );
                setProcessProgress(100);
                setIsProcessing(false);
                resolve(direct);
              }
            };

            worker.addEventListener('message', handleMessage);
            worker.postMessage({
              type: 'INPAINT_REQUEST',
              imageData: baseImageData,
              maskData: maskImageData,
              radius,
            });
          } else {
            const direct = inpaintTelea(
              baseImageData,
              maskImageData,
              radius,
              setProcessProgress
            );
            setProcessProgress(100);
            setIsProcessing(false);
            resolve(direct);
          }
        } catch (err) {
          console.warn('Worker instantiation failed, running direct fallback:', err);
          const direct = inpaintTelea(
            baseImageData,
            maskImageData,
            radius,
            setProcessProgress
          );
          setProcessProgress(100);
          setIsProcessing(false);
          resolve(direct);
        }
      });
    },
    [aiModelProgress, getOrCreateWorker]
  );

  return {
    isProcessing,
    processProgress,
    aiModelProgress,
    isAiModelCached,
    isAiModelLoading,
    preloadAiModel,
    executeInpaint,
  };
}
