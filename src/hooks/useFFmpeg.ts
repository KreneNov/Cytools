import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import type { EngineStatus, TaskStatus, GifSettings } from '../types/mediaConverter';

const FFMPEG_CORE_BASE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

export interface UseFFmpegReturn {
  engineStatus: EngineStatus;
  taskStatus: TaskStatus;
  progressPercent: number;
  terminalLogs: string[];
  error: string | null;
  loadEngine: () => Promise<void>;
  extractAudioToMp3: (videoFile: File) => Promise<{ blob: Blob; url: string }>;
  generateGif: (videoFile: File, settings: GifSettings) => Promise<{ blob: Blob; url: string }>;
  convertVideoToMp4: (videoFile: File) => Promise<{ blob: Blob; url: string }>;
  resetTask: () => void;
}

export const useFFmpeg = (): UseFFmpegReturn => {
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('unloaded');
  const [taskStatus, setTaskStatus] = useState<TaskStatus>('idle');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const ffmpegRef = useRef<FFmpeg | null>(null);

  const loadEngine = useCallback(async () => {
    if (ffmpegRef.current && ffmpegRef.current.loaded) {
      setEngineStatus('ready');
      return;
    }

    try {
      setEngineStatus('loading');
      setError(null);

      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      ffmpeg.on('log', ({ message }) => {
        setTerminalLogs((prev) => [...prev.slice(-40), message]);
      });

      ffmpeg.on('progress', ({ progress }) => {
        const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
        setProgressPercent(pct);
      });

      // Load FFmpeg Core WebAssembly from CDN using toBlobURL
      const coreURL = await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm');

      await ffmpeg.load({
        coreURL,
        wasmURL,
      });

      setEngineStatus('ready');
    } catch (err) {
      console.error('Failed to initialize FFmpeg WASM core:', err);
      const msg = err instanceof Error ? err.message : 'Không thể tải thư viện FFmpeg WebAssembly.';
      setError(msg);
      setEngineStatus('error');
      throw err;
    }
  }, []);

  const extractAudioToMp3 = useCallback(
    async (videoFile: File): Promise<{ blob: Blob; url: string }> => {
      setError(null);
      setProgressPercent(0);
      setTaskStatus('processing');

      const inputExt = videoFile.name.substring(videoFile.name.lastIndexOf('.')) || '.mp4';
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const inputName = `input_${uniqueSuffix}${inputExt}`;
      const outputName = `output_${uniqueSuffix}.mp3`;

      try {
        if (!ffmpegRef.current || !ffmpegRef.current.loaded) {
          await loadEngine();
        }

        const ffmpeg = ffmpegRef.current!;

        // Write input file to in-memory FFmpeg virtual FS
        const fileData = await fetchFile(videoFile);
        await ffmpeg.writeFile(inputName, fileData);

        // Execute FFmpeg audio extraction command
        // -vn disables video recording
        // -acodec libmp3lame sets MP3 audio encoder
        // -b:a 192k sets audio bitrate to 192 kbps
        await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-b:a', '192k', outputName]);

        // Read output MP3 file from memory FS
        const outputData = await ffmpeg.readFile(outputName);
        const uint8 = outputData as Uint8Array;
        const blob = new Blob([uint8.buffer as ArrayBuffer], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);

        setProgressPercent(100);
        setTaskStatus('done');
        return { blob, url };
      } catch (err) {
        console.error('Error extracting audio:', err);
        const msg = err instanceof Error ? err.message : 'Lỗi khi trích xuất audio MP3.';
        setError(msg);
        setTaskStatus('failed');
        throw err;
      } finally {
        const ffmpeg = ffmpegRef.current;
        if (ffmpeg && ffmpeg.loaded) {
          try {
            await ffmpeg.deleteFile(inputName);
          } catch {
            // ignore cleanup errors if file was not written
          }
          try {
            await ffmpeg.deleteFile(outputName);
          } catch {
            // ignore cleanup errors if output was not created
          }
        }
      }
    },
    [loadEngine]
  );

  const generateGif = useCallback(
    async (videoFile: File, settings: GifSettings): Promise<{ blob: Blob; url: string }> => {
      setError(null);
      setProgressPercent(0);
      setTaskStatus('processing');

      const inputExt = videoFile.name.substring(videoFile.name.lastIndexOf('.')) || '.mp4';
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const inputName = `input_${uniqueSuffix}${inputExt}`;
      const outputName = `output_${uniqueSuffix}.gif`;

      try {
        if (!ffmpegRef.current || !ffmpegRef.current.loaded) {
          await loadEngine();
        }

        const ffmpeg = ffmpegRef.current!;

        // Write input file to virtual memory FS
        const fileData = await fetchFile(videoFile);
        await ffmpeg.writeFile(inputName, fileData);

        // High quality 2-pass palettegen + paletteuse filter
        const filterGraph = `fps=${settings.fps},scale=${settings.width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;

        await ffmpeg.exec([
          '-ss',
          String(settings.startTime),
          '-t',
          String(settings.duration),
          '-i',
          inputName,
          '-vf',
          filterGraph,
          outputName,
        ]);

        const outputData = await ffmpeg.readFile(outputName);
        const uint8 = outputData as Uint8Array;
        const blob = new Blob([uint8.buffer as ArrayBuffer], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);

        setProgressPercent(100);
        setTaskStatus('done');
        return { blob, url };
      } catch (err) {
        console.error('Error generating GIF:', err);
        const msg = err instanceof Error ? err.message : 'Lỗi khi tạo ảnh động GIF.';
        setError(msg);
        setTaskStatus('failed');
        throw err;
      } finally {
        const ffmpeg = ffmpegRef.current;
        if (ffmpeg && ffmpeg.loaded) {
          try {
            await ffmpeg.deleteFile(inputName);
          } catch {
            // ignore
          }
          try {
            await ffmpeg.deleteFile(outputName);
          } catch {
            // ignore
          }
        }
      }
    },
    [loadEngine]
  );

  const convertVideoToMp4 = useCallback(
    async (videoFile: File): Promise<{ blob: Blob; url: string }> => {
      setError(null);
      setProgressPercent(0);
      setTaskStatus('processing');

      const inputExt = videoFile.name.substring(videoFile.name.lastIndexOf('.')) || '.mov';
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const inputName = `input_${uniqueSuffix}${inputExt}`;
      const outputName = `output_${uniqueSuffix}.mp4`;

      try {
        if (!ffmpegRef.current || !ffmpegRef.current.loaded) {
          await loadEngine();
        }

        const ffmpeg = ffmpegRef.current!;

        // Write input file to virtual memory FS
        const fileData = await fetchFile(videoFile);
        await ffmpeg.writeFile(inputName, fileData);

        // Fast high-compatibility transcode to standard H.264 + AAC MP4
        await ffmpeg.exec([
          '-i',
          inputName,
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outputName,
        ]);

        const outputData = await ffmpeg.readFile(outputName);
        const uint8 = outputData as Uint8Array;
        const blob = new Blob([uint8.buffer as ArrayBuffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);

        setProgressPercent(100);
        setTaskStatus('done');
        return { blob, url };
      } catch (err) {
        console.error('Error converting video to MP4:', err);
        const msg = err instanceof Error ? err.message : 'Lỗi khi chuyển đổi video sang MP4.';
        setError(msg);
        setTaskStatus('failed');
        throw err;
      } finally {
        const ffmpeg = ffmpegRef.current;
        if (ffmpeg && ffmpeg.loaded) {
          try {
            await ffmpeg.deleteFile(inputName);
          } catch {
            // ignore
          }
          try {
            await ffmpeg.deleteFile(outputName);
          } catch {
            // ignore
          }
        }
      }
    },
    [loadEngine]
  );

  const resetTask = useCallback(() => {
    setTaskStatus('idle');
    setProgressPercent(0);
    setError(null);
  }, []);

  return {
    engineStatus,
    taskStatus,
    progressPercent,
    terminalLogs,
    error,
    loadEngine,
    extractAudioToMp3,
    generateGif,
    convertVideoToMp4,
    resetTask,
  };
};
