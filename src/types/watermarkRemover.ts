export type WatermarkTab = 'image' | 'pdf' | 'pptx';

export interface ImageDetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
}

export interface InpaintWorkerInpaintRequest {
  type: 'INPAINT_REQUEST';
  imageData: ImageData;
  maskData: ImageData;
  radius: number;
  modelUrl?: string;
}

export interface InpaintWorkerModelPreloadRequest {
  type: 'PRELOAD_AI_MODEL';
  modelUrl: string;
}

export type InpaintWorkerRequest =
  | InpaintWorkerInpaintRequest
  | InpaintWorkerModelPreloadRequest;

export interface InpaintWorkerProgress {
  type: 'INPAINT_PROGRESS';
  progress: number;
}

export interface InpaintWorkerSuccess {
  type: 'INPAINT_SUCCESS';
  resultData: ImageData;
}

export interface InpaintWorkerError {
  type: 'INPAINT_ERROR';
  error: string;
}

export interface InpaintWorkerModelProgress {
  type: 'AI_MODEL_PROGRESS';
  progress: number;
  cached: boolean;
}

export interface InpaintWorkerModelReady {
  type: 'AI_MODEL_READY';
  cached: boolean;
  byteLength: number;
}

export type InpaintWorkerResponse =
  | InpaintWorkerProgress
  | InpaintWorkerSuccess
  | InpaintWorkerError
  | InpaintWorkerModelProgress
  | InpaintWorkerModelReady;

export interface PdfCleanOptions {
  customKeywords?: string[];
  stripAnnotations?: boolean;
  stripPieceInfo?: boolean;
  stripOverlayForms?: boolean;
}

export interface PdfCleanResult {
  cleanedPdfBytes: Uint8Array;
  originalSize: number;
  cleanedSize: number;
  strippedAnnotsCount: number;
  strippedKeywordsCount: number;
  strippedXObjectsCount: number;
}

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
