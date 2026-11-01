export type ConverterTab = 'mp3' | 'gif';

export type EngineStatus = 'unloaded' | 'loading' | 'ready' | 'error';

export type TaskStatus = 'idle' | 'processing' | 'done' | 'failed';

export interface GifSettings {
  startTime: number;
  duration: number;
  fps: 10 | 15;
  width: number;
}

export interface MediaConversionResult {
  blob: Blob;
  url: string;
  filename: string;
  sizeBytes: number;
  durationSeconds?: number;
}
