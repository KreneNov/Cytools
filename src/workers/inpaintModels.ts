import type { InpaintModelId, InpaintModelSpec } from '../types/watermarkRemover';

const env = import.meta.env as Record<string, string | undefined>;

/**
 * Registry of supported client-side inpainting models.
 * URLs can be overridden with VITE_INPAINT_MODEL_URL_MIGAN / VITE_INPAINT_MODEL_URL_LAMA
 * (e.g. to self-host on a CDN) without code changes.
 */
export const INPAINT_MODELS: Record<InpaintModelId, InpaintModelSpec> = {
  migan: {
    id: 'migan',
    label: 'MI-GAN (~28MB)',
    url:
      env.VITE_INPAINT_MODEL_URL_MIGAN ||
      'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
    inputSize: 512,
    tensorType: 'uint8',
    maskFillValue: 0,
    maskKeepValue: 255,
    outputScale: 'uint8',
    approxBytes: 28 * 1024 * 1024,
  },
  lama: {
    id: 'lama',
    label: 'LaMa fp32 (~208MB)',
    url:
      env.VITE_INPAINT_MODEL_URL_LAMA ||
      'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
    inputSize: 512,
    tensorType: 'float32',
    maskFillValue: 1,
    maskKeepValue: 0,
    outputScale: '0-255',
    approxBytes: 200 * 1024 * 1024,
  },
};

const requestedDefault = env.VITE_INPAINT_MODEL as InpaintModelId | undefined;

export const DEFAULT_INPAINT_MODEL: InpaintModelSpec =
  requestedDefault && requestedDefault in INPAINT_MODELS
    ? INPAINT_MODELS[requestedDefault]
    : INPAINT_MODELS.migan;

export const MODEL_CACHE_NAME = 'cytools-models-v1';
