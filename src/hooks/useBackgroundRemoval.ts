import { useState, useCallback, useRef } from 'react';
import { AutoModel, AutoProcessor, RawImage, Tensor, env } from '@huggingface/transformers';
import { Client, handle_file } from '@gradio/client';
import type { BgRemovalProgress, BgRemovalStage } from '../types/removeBg';

// Configure HuggingFace environment for browser WASM & remote CDN
env.allowLocalModels = false;
env.allowRemoteModels = true;

const LOCAL_MODEL_ID = 'briaai/RMBG-1.4';
const PRIMARY_BIREFNET_SPACE = 'ZhengPeng7/BiRefNet_demo';
const FALLBACK_CLOUD_SPACE = 'not-lain/background-removal';

// Module-level singleton caches
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedModel: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedProcessor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedBiRefNetClient: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedFallbackClient: any = null;

export type BgEngineType = 'cloud' | 'local';

export interface UseBackgroundRemovalReturn {
  stage: BgRemovalStage;
  progress: BgRemovalProgress;
  isProcessing: boolean;
  error: string | null;
  removeBg: (imageInput: File | Blob | string, engine?: BgEngineType) => Promise<Blob>;
  reset: () => void;
}

export const useBackgroundRemoval = (): UseBackgroundRemovalReturn => {
  const [stage, setStage] = useState<BgRemovalStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<BgRemovalProgress>({
    stage: 'idle',
    percentage: 0,
    message: 'Sẵn sàng xử lý',
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleProgressCallback = useCallback((p: any) => {
    if (!p) return;

    if (p.status === 'initiate') {
      setStage('loading_model');
      setProgress({
        stage: 'loading_model',
        percentage: 5,
        message: `Khởi tạo nạp mô hình RMBG-1.4: ${p.file || 'model files'}...`,
      });
    } else if (p.status === 'progress') {
      setStage('loading_model');
      const pct = typeof p.progress === 'number' ? Math.round(p.progress) : 20;
      const loadedMb = p.loaded ? (p.loaded / (1024 * 1024)).toFixed(1) : null;
      const totalMb = p.total ? (p.total / (1024 * 1024)).toFixed(1) : null;

      const sizeInfo = loadedMb && totalMb ? ` (${loadedMb}MB / ${totalMb}MB)` : '';

      setProgress({
        stage: 'loading_model',
        percentage: Math.min(95, pct),
        message: `Đang tải mô hình RMBG-1.4: ${p.file || ''}${sizeInfo}`,
        bytesLoaded: p.loaded,
        bytesTotal: p.total,
      });
    } else if (p.status === 'done') {
      setProgress((prev) => ({
        ...prev,
        percentage: 95,
        message: `Đã nạp xong: ${p.file || 'mô hình'}. Chuẩn bị suy luận...`,
      }));
    }
  }, []);

  /**
   * Cloud Studio Inference via HuggingFace Space BiRefNet (@gradio/client)
   * Primary: ZhengPeng7/BiRefNet_demo (/image endpoint with resolution 1024x1024)
   * Fallback: not-lain/background-removal (/png endpoint)
   */
  const processViaCloudStudio = async (imageInput: File | Blob | string): Promise<Blob> => {
    setStage('processing');
    setProgress({
      stage: 'processing',
      percentage: 15,
      message: 'Đang kết nối tới Studio BiRefNet AI trên HuggingFace Cloud...',
    });

    const filePayload = handle_file(imageInput);

    try {
      if (!cachedBiRefNetClient) {
        cachedBiRefNetClient = await Client.connect(PRIMARY_BIREFNET_SPACE);
      }

      setProgress({
        stage: 'processing',
        percentage: 45,
        message: 'BiRefNet AI đang phân tích đa tầng & bóc tách từng sợi tóc...',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await cachedBiRefNetClient.predict('/image', {
        images: filePayload,
        resolution: '1024x1024',
        weights_file: 'General',
      });

      setProgress({
        stage: 'processing',
        percentage: 85,
        message: 'Đang tải kết quả PNG trong suốt chuẩn Studio HD về trình duyệt...',
      });

      // BiRefNet returns an image slider tuple [original, transparentCutout]
      let fileUrl: string | null = null;
      const rawData = result?.data;
      if (Array.isArray(rawData) && rawData.length > 0) {
        const firstElem = rawData[0];
        if (Array.isArray(firstElem) && firstElem.length >= 2) {
          fileUrl = firstElem[1]?.url || (typeof firstElem[1] === 'string' ? firstElem[1] : null);
        } else if (firstElem && typeof firstElem === 'object' && 'url' in firstElem) {
          fileUrl = (firstElem as { url?: string }).url || null;
        } else if (typeof firstElem === 'string') {
          fileUrl = firstElem;
        }
      }

      if (!fileUrl) {
        throw new Error('BiRefNet Cloud không trả về URL hình ảnh hợp lệ.');
      }

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Không thể tải ảnh kết quả từ Cloud: HTTP ${response.status}`);
      }

      return await response.blob();
    } catch (primaryErr) {
      console.warn('BiRefNet primary space unavailable, trying fallback cloud space:', primaryErr);
      setProgress({
        stage: 'processing',
        percentage: 35,
        message: 'Đang kết nối Cloud dự phòng (Background Removal AI)...',
      });

      if (!cachedFallbackClient) {
        cachedFallbackClient = await Client.connect(FALLBACK_CLOUD_SPACE);
      }

      setProgress({
        stage: 'processing',
        percentage: 60,
        message: 'Đang bóc tách nền qua server dự phòng...',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fallbackResult: any = await cachedFallbackClient.predict('/png', { f: filePayload });
      const outputInfo = fallbackResult?.data?.[0];
      const fallbackUrl = outputInfo?.url || (typeof outputInfo === 'string' ? outputInfo : null);

      if (!fallbackUrl) {
        throw new Error('Cloud dự phòng không trả về URL hình ảnh hợp lệ.');
      }

      const response = await fetch(fallbackUrl);
      if (!response.ok) {
        throw new Error(`Không thể tải ảnh từ Cloud dự phòng: HTTP ${response.status}`);
      }

      return await response.blob();
    }
  };

  /**
   * Local Fast Inference via In-Browser RMBG-1.4 (ONNX WebAssembly FP32)
   */
  const processViaLocalRMBG = async (imageInput: File | Blob | string): Promise<Blob> => {
    setStage('loading_model');
    setProgress({
      stage: 'loading_model',
      percentage: 10,
      message: 'Đang chuẩn bị mô hình RMBG-1.4 FP32 trên WASM SIMD...',
    });

    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

    // 1. Ensure Model is loaded (fp32 to prevent quantization degradation)
    if (!cachedModel) {
      try {
        cachedModel = await AutoModel.from_pretrained(LOCAL_MODEL_ID, {
          device: hasWebGPU ? 'webgpu' : 'wasm',
          dtype: 'fp32',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          config: { model_type: 'custom' } as any,
          progress_callback: handleProgressCallback,
        });
      } catch (err) {
        console.warn('WebGPU failed or unsupported. Falling back to WASM SIMD fp32:', err);
        cachedModel = await AutoModel.from_pretrained(LOCAL_MODEL_ID, {
          device: 'wasm',
          dtype: 'fp32',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          config: { model_type: 'custom' } as any,
          progress_callback: handleProgressCallback,
        });
      }
    }

    // 2. Ensure Processor is loaded with native Hub configuration
    if (!cachedProcessor) {
      cachedProcessor = await AutoProcessor.from_pretrained(LOCAL_MODEL_ID, {
        progress_callback: handleProgressCallback,
      });
    }

    // 3. Load image using Transformers.js native RawImage utility
    const image = await RawImage.read(imageInput);

    if (image.width === 0 || image.height === 0) {
      throw new Error('Kích thước hình ảnh không hợp lệ.');
    }

    setStage('processing');
    setProgress({
      stage: 'processing',
      percentage: 60,
      message: 'Đang chuẩn hóa ảnh & suy luận mạng nơ-ron RMBG-1.4...',
    });

    // 4. Preprocess via natural processor (mean [0.5, 0.5, 0.5], std [1, 1, 1], resize 1024x1024)
    const { pixel_values } = await cachedProcessor(image);

    // 5. Run ONNX Model Inference
    const { output } = await cachedModel({ input: pixel_values });

    setProgress({
      stage: 'processing',
      percentage: 85,
      message: 'Đang áp dụng Contrast Clamping & khôi phục kích thước ảnh gốc...',
    });

    // 6. Direct Contrast Clamping without Double Sigmoid:
    // RMBG-1.4 ONNX output is ALREADY normalized to [0.0, 1.0].
    // Clamping values <= 0.03 to 0 and >= 0.97 to 255 eliminates background bleed and preserves fine fur edges.
    const rawData = output[0].data as Float32Array;
    const uint8Data = new Uint8ClampedArray(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      const v = rawData[i];
      if (v <= 0.03) {
        uint8Data[i] = 0;
      } else if (v >= 0.97) {
        uint8Data[i] = 255;
      } else {
        uint8Data[i] = Math.round(((v - 0.03) / 0.94) * 255);
      }
    }

    // 7. Convert to 1024x1024 RawImage Mask
    const uint8Tensor = new Tensor('uint8', uint8Data, output[0].dims);
    const mask1024 = RawImage.fromTensor(uint8Tensor);

    // 8. Native Mask Rescaling back to Original Image Dimensions (bilinear interpolation)
    const resizedMask = await mask1024.resize(image.width, image.height);

    // 9. Soft Alpha Mapping: Apply resized mask to the alpha channel of the original image
    const composite = image.clone().putAlpha(resizedMask);

    // 10. Composite to HTML5 Canvas and export transparent PNG Blob
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = composite.width;
    finalCanvas.height = composite.height;
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) {
      throw new Error('Không thể khởi tạo Canvas 2D context.');
    }

    const imgData = new ImageData(
      new Uint8ClampedArray(composite.data),
      composite.width,
      composite.height
    );
    finalCtx.putImageData(imgData, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      finalCanvas.toBlob((b) => {
        if (b) {
          resolve(b);
        } else {
          reject(new Error('Xuất Blob ảnh trong suốt từ Canvas thất bại.'));
        }
      }, 'image/png');
    });
  };

  const removeBg = useCallback(
    async (imageInput: File | Blob | string, engine: BgEngineType = 'cloud'): Promise<Blob> => {
      setError(null);

      try {
        let resultBlob: Blob;

        if (engine === 'cloud') {
          try {
            resultBlob = await processViaCloudStudio(imageInput);
          } catch (cloudErr) {
            console.warn(
              'BiRefNet Cloud Studio bận hoặc không thể kết nối. Đang tự động chuyển về Engine RMBG-1.4 cục bộ:',
              cloudErr
            );
            setProgress({
              stage: 'processing',
              percentage: 40,
              message: 'Hàng đợi Cloud bận, đang tự động chuyển sang Engine RMBG-1.4 cục bộ...',
            });
            resultBlob = await processViaLocalRMBG(imageInput);
          }
        } else {
          resultBlob = await processViaLocalRMBG(imageInput);
        }

        setStage('completed');
        setProgress({
          stage: 'completed',
          percentage: 100,
          message: 'Tách nền AI hoàn tất với độ nét chuẩn xác & viền mềm mại!',
        });

        return resultBlob;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi xử lý tách nền.';
        console.error('Error in background removal:', err);
        setError(errMsg);
        setStage('error');
        setProgress({
          stage: 'error',
          percentage: 0,
          message: `Lỗi: ${errMsg}`,
        });
        throw err;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleProgressCallback]
  );

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setStage('idle');
    setError(null);
    setProgress({
      stage: 'idle',
      percentage: 0,
      message: 'Sẵn sàng xử lý',
    });
  }, []);

  return {
    stage,
    progress,
    isProcessing: stage === 'loading_model' || stage === 'processing',
    error,
    removeBg,
    reset,
  };
};
