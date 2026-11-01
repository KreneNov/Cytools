export type SocialPlatform =
  | 'tiktok'
  | 'pinterest'
  | 'facebook'
  | 'instagram'
  | 'youtube'
  | 'twitter'
  | 'unknown';

export type SocialMediaType = 'video' | 'slideshow' | 'image';

export interface AvailableFormat {
  formatId: string;
  label: string;
  type: 'video' | 'audio';
  resolution?: string;
  quality?: string;
  description?: string;
  format: 'mp4' | 'mp3';
  url: string;
}

export interface MediaDownloadOption {
  id: string;
  label: string;
  format: 'mp4' | 'mp3' | 'jpg' | 'png' | 'webp';
  quality?: string;
  description?: string;
  formatId?: string;
  resolution?: string;
  url: string;
  size?: number;
  isAudio?: boolean;
}

export interface SlideshowImageItem {
  id: string;
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
}

export interface ExtractionResult {
  success: boolean;
  platform: SocialPlatform;
  type: SocialMediaType;
  title: string;
  description?: string;
  author?: {
    name: string;
    username?: string;
    avatar?: string;
  };
  thumbnail?: string;
  duration?: number;
  videoId?: string;
  videoHd?: string;
  videoSd?: string;
  audioUrl?: string;
  music?: {
    title: string;
    author?: string;
    playUrl: string;
  };
  mediaOptions: MediaDownloadOption[];
  availableFormats?: AvailableFormat[];
  slideshowImages?: SlideshowImageItem[];
  error?: string;
}

export type DownloadStage = 'video' | 'audio' | 'muxing' | 'done';

export interface DownloadProgress {
  isDownloading: boolean;
  activeOptionId?: string;
  loadedBytes: number;
  totalBytes: number;
  percentage: number;
  fileName: string;
  stage: DownloadStage;
  status: 'idle' | 'downloading' | 'processing_zip' | 'completed' | 'error';
  errorMessage?: string;
}

/**
 * Detect social media platform from raw URL string.
 */
export function detectPlatform(rawUrl: string): SocialPlatform {
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();

    if (host.includes('tiktok.com') || host.includes('douyin.com')) {
      return 'tiktok';
    }
    if (host.includes('pinterest.com') || host.includes('pin.it')) {
      return 'pinterest';
    }
    if (
      host.includes('facebook.com') ||
      host.includes('fb.watch') ||
      host.includes('fb.me') ||
      host.includes('fb.com')
    ) {
      return 'facebook';
    }
    if (host.includes('instagram.com')) {
      return 'instagram';
    }
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      return 'youtube';
    }
    if (host.includes('twitter.com') || host.includes('x.com')) {
      return 'twitter';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}
