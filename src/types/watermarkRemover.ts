export type WatermarkTab = 'image' | 'pdf' | 'pptx';

export interface ImageDetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
}

/* ------------------------------------------------------------------ */
/* Image editor finite state machine                                   */
/* ------------------------------------------------------------------ */

export type ImageEditorState = 'IDLE' | 'PAINTING' | 'PROCESSING' | 'DONE';

/* ------------------------------------------------------------------ */
/* ONNX AI inpainting                                                  */
/* ------------------------------------------------------------------ */

export type InpaintModelId = 'migan' | 'lama';

export interface InpaintModelSpec {
  id: InpaintModelId;
  label: string;
  url: string;
  /** Square model input resolution (both models operate at 512x512). */
  inputSize: number;
  tensorType: 'uint8' | 'float32';
  /** Mask value meaning "fill / inpaint this pixel". */
  maskFillValue: number;
  /** Mask value meaning "keep original pixel". */
  maskKeepValue: number;
  /** How the model output must be interpreted. */
  outputScale: 'uint8' | '0-255' | '0-1';
  /** Expected approximate size, used to detect truncated downloads. */
  approxBytes: number;
}

export type ExecutionBackend = 'webgpu' | 'wasm';

export interface LoadModelRequest {
  type: 'LOAD_MODEL';
  model: InpaintModelSpec;
}

export interface RunInpaintRequest {
  type: 'RUN_INPAINT';
  jobId: number;
  model: InpaintModelSpec;
  /** RGBA pixels, length = width * height * 4. */
  image: Uint8ClampedArray;
  /** RGBA mask pixels (alpha > threshold means painted), length = width * height * 4. */
  mask: Uint8ClampedArray;
  width: number;
  height: number;
}

export type InpaintWorkerRequest = LoadModelRequest | RunInpaintRequest;

export type InpaintErrorCode =
  | 'MODEL_DOWNLOAD_FAILED'
  | 'WEBGPU_FAILED'
  | 'INFERENCE_FAILED';

export type InpaintWorkerResponse =
  | { type: 'MODEL_PROGRESS'; progress: number; cached: boolean }
  | { type: 'MODEL_READY'; backend: ExecutionBackend; cached: boolean }
  | {
      type: 'INFERENCE_PROGRESS';
      jobId: number;
      stage: 'preprocess' | 'inference' | 'postprocess';
      progress: number;
    }
  | {
      type: 'INFERENCE_SUCCESS';
      jobId: number;
      output: Uint8ClampedArray;
      width: number;
      height: number;
      backend: ExecutionBackend;
    }
  | {
      type: 'WORKER_ERROR';
      jobId?: number;
      code: InpaintErrorCode;
      message: string;
      fatal: boolean;
    };

/* ------------------------------------------------------------------ */
/* PDF (3-Tier Universal Pipeline)                                     */
/* ------------------------------------------------------------------ */

export interface PdfCleanOptions {
  customKeywords?: string[];
  stripAnnotations?: boolean;
  stripPieceInfo?: boolean;
  stripOverlayForms?: boolean;
  autoDetectDiagonal?: boolean;
}

export interface PdfStripSuccess {
  success: true;
  cleanedPdfBytes: Uint8Array;
  originalSize: number;
  cleanedSize: number;
  strippedAnnotsCount: number;
  strippedArtifactBlocks: number;
  strippedTextOps: number;
  strippedDiagonalBlocks: number;
  strippedXObjectsCount: number;
  totalRemovedCount: number;
}

export interface PdfStripFailure {
  success: false;
  reason: 'ENCRYPTED' | 'PARSE_FAILED';
  message: string;
}

export type PdfStripResult = PdfStripSuccess | PdfStripFailure;

export interface PdfRasterPageItem {
  pageNumber: number;
  width: number;
  height: number;
  pdfWidthPts: number;
  pdfHeightPts: number;
  originalImageData: ImageData;
  cleanedImageData: ImageData;
  previewUrl: string;
  aiInpainted: boolean;
}

/* ------------------------------------------------------------------ */
/* PPTX                                                                */
/* ------------------------------------------------------------------ */

export interface PptxDetectedItem {
  id: string;
  sourceFile: string;
  sourceType: 'slideMaster' | 'slideLayout' | 'slide';
  slideNumber?: number;
  shapeType: 'text' | 'image' | 'background';
  name: string;
  textSnippet?: string;
  imagePreviewUrl?: string;
  imageBytes?: Uint8Array;
  imageMimeType?: string;
  xmlXPath?: string;
  selected: boolean;
}

export interface PptxCleanResult {
  cleanedBlob: Blob;
  totalRemoved: number;
  removedItems: PptxDetectedItem[];
}
