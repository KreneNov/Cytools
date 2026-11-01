export type BgRemovalStage = 
  | 'idle'
  | 'loading_model'
  | 'processing'
  | 'completed'
  | 'error';

export type BackgroundPreset = 
  | 'transparent' 
  | 'white' 
  | 'id_red' 
  | 'id_blue' 
  | 'custom';

export interface BgRemovalProgress {
  stage: BgRemovalStage;
  percentage: number;
  message: string;
  bytesLoaded?: number;
  bytesTotal?: number;
}

export interface ImageProcessingItem {
  id: string;
  originalFile: File;
  originalUrl: string;
  processedBlob: Blob | null;
  processedUrl: string | null;
  width: number;
  height: number;
  status: 'pending' | 'processing' | 'success' | 'error';
  errorMessage?: string;
}
