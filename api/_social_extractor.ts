import { Ytdl } from '@distube/ytdl-core';

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
    if (host.includes('facebook.com') || host.includes('fb.watch') || host.includes('fb.com')) {
      return 'facebook';
    }
    if (host.includes('instagram.com') || host.includes('instagr.am')) {
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

const ytdlInstance = new Ytdl();

interface CobaltInstanceDef {
  endpoint: string;
  version: 'v7' | 'v10';
}

const COBALT_INSTANCES: CobaltInstanceDef[] = [
  { endpoint: 'https://rue-cobalt.xenon.zone', version: 'v10' },
  { endpoint: 'https://cobaltapi.cjs.nz', version: 'v10' },
  { endpoint: 'https://co.wuk.sh/api/json', version: 'v7' },
  { endpoint: 'https://cobalt.qoid.co/api/json', version: 'v7' },
  { endpoint: 'https://cobalt.kwiate.dev/api/json', version: 'v7' },
  { endpoint: 'https://api.cobalt.tools/api/json', version: 'v7' },
  { endpoint: 'https://cobalt.synack.cat/api/json', version: 'v7' },
  { endpoint: 'https://cobalt.slay.sh/api/json', version: 'v7' },
  { endpoint: 'https://dl.khann.me', version: 'v10' },
  { endpoint: 'https://capi.3kh0.net', version: 'v10' },
  { endpoint: 'https://cobalt-backend.canine.tools', version: 'v10' },
];

/**
 * Extracts TikTok video or photo slideshow using TikWM API.
 */
export async function extractTikTok(url: string): Promise<ExtractionResult> {
  const formData = new URLSearchParams();
  formData.append('url', url);
  formData.append('hd', '1');

  const response = await fetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    body: formData,
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`TikWM API phản hồi mã lỗi HTTP ${response.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await response.json();

  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || 'Không thể bóc tách dữ liệu từ liên kết TikTok này.');
  }

  const d = json.data;
  const author = {
    name: d.author?.nickname || 'Tác giả TikTok',
    username: d.author?.unique_id ? `@${d.author.unique_id}` : undefined,
    avatar: d.author?.avatar,
  };

  const music = d.music
    ? {
        title: d.music_info?.title || 'Nhạc gốc TikTok',
        author: d.music_info?.author || d.author?.nickname,
        playUrl: d.music,
      }
    : undefined;

  // Case 1: Photo Slideshow / Carousel Album
  if (Array.isArray(d.images) && d.images.length > 0) {
    return {
      success: true,
      platform: 'tiktok',
      type: 'slideshow',
      title: d.title || 'Bộ sưu tập ảnh TikTok',
      author,
      thumbnail: d.images[0],
      music,
      mediaOptions: d.music
        ? [
            {
              id: 'tiktok_music',
              label: 'Tách Nhạc Nền (.MP3)',
              format: 'mp3',
              isAudio: true,
              url: d.music,
            },
          ]
        : [],
      slideshowImages: d.images.map((imgUrl: string, idx: number) => ({
        id: `tt_img_${idx}`,
        url: imgUrl,
        thumbnail: imgUrl,
      })),
    };
  }

  // Case 2: Standard Single Video
  const videoHd = d.hdplay || d.play;
  const videoSd = d.play;

  return {
    success: true,
    platform: 'tiktok',
    type: 'video',
    title: d.title || 'Video TikTok Không Logo',
    duration: d.duration,
    author,
    thumbnail: d.cover,
    music,
    videoHd,
    videoSd,
    mediaOptions: [
      {
        id: 'tiktok_hd',
        label: 'MP4 HD (Gốc không logo)',
        description: 'Độ nét cao nhất, bóc tách sạch watermark',
        format: 'mp4',
        quality: 'HD 1080p',
        url: videoHd,
      },
      {
        id: 'tiktok_sd',
        label: 'MP4 Tiêu Chuẩn (SD)',
        description: 'Dung lượng nhẹ, tốc độ tải nhanh hơn',
        format: 'mp4',
        quality: 'SD 720p',
        url: videoSd,
      },
      ...(d.music
        ? [
            {
              id: 'tiktok_audio',
              label: 'M4A / MP3 Audio',
              description: 'Tách bài nhạc nền gốc TikTok',
              format: 'mp3' as const,
              quality: 'Audio',
              isAudio: true,
              url: d.music,
            },
          ]
        : []),
    ],
  };
}

/**
 * Extracts Pinterest Pin media using official Pinterest Resource API (with HTML meta fallback).
 */
export async function extractPinterest(url: string): Promise<ExtractionResult> {
  let targetUrl = url;
  let pinId: string | null = null;

  // 1. Check if numeric pin ID is already in the URL
  const pinMatch = targetUrl.match(/\/pin\/(\d+)/);
  if (pinMatch) {
    pinId = pinMatch[1];
  } else if (/^\d+$/.test(targetUrl.trim())) {
    pinId = targetUrl.trim();
  } else {
    // Follow redirect for shortlinks (pin.it/xxx or /sent/ redirects)
    try {
      const redirectRes = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(5000),
      });
      const resolvedUrl = redirectRes.url;
      const mResolved = resolvedUrl.match(/\/pin\/(\d+)/);
      if (mResolved) {
        pinId = mResolved[1];
      }
      targetUrl = resolvedUrl;
    } catch {
      // Continue to next attempts
    }
  }

  // 2. High-Fidelity Extraction via Pinterest Resource API
  if (pinId) {
    try {
      const resourceUrl = 'https://www.pinterest.com/resource/PinResource/get/';
      const params = new URLSearchParams({
        source_url: `/pin/${pinId}/`,
        data: JSON.stringify({
          options: { id: pinId, field_set_key: 'detailed' },
          context: {},
        }),
      });

      const res = await fetch(`${resourceUrl}?${params.toString()}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'X-Pinterest-PWS-Handler': 'www/[username]/pin.js',
          Accept: 'application/json, text/javascript, */*, q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await res.json();
        const pin = json.resource_response?.data;

        if (pin) {
          const title =
            pin.title?.trim() ||
            pin.grid_title?.trim() ||
            pin.closeup_unified_description?.trim() ||
            'Pinterest Pin HD';

          const author = {
            name: pin.pinner?.full_name || pin.pinner?.username || 'Pinterest Creator',
            username: pin.pinner?.username ? `@${pin.pinner.username}` : undefined,
            avatar: pin.pinner?.image_medium_url || pin.pinner?.image_small_url,
          };

          // 2a. Check for Carousel / Multi-Image Story Pin
          const storyPages = pin.story_pin_data?.pages;
          if (Array.isArray(storyPages) && storyPages.length > 1) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const images: { id: string; url: string; thumbnail: string }[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            storyPages.forEach((page: any, idx: number) => {
              const imgUrl =
                page.blocks?.[0]?.image?.images?.originals?.url ||
                page.blocks?.[0]?.image?.images?.['736x']?.url;
              if (imgUrl) {
                images.push({
                  id: `pin_slide_${idx}`,
                  url: imgUrl,
                  thumbnail: imgUrl,
                });
              }
            });

            if (images.length > 0) {
              return {
                success: true,
                platform: 'pinterest',
                type: 'slideshow',
                title,
                author,
                thumbnail: images[0].thumbnail,
                mediaOptions: [],
                slideshowImages: images,
              };
            }
          }

          // 2b. Check for Video Pin
          let videoUrl: string | null = null;
          const videoList = pin.videos?.video_list;
          if (videoList) {
            videoUrl =
              videoList.V_720P?.url ||
              videoList.V_EXP7?.url ||
              videoList.V_HLSV4?.url?.replace('/hls/', '/720p/').replace('.m3u8', '.mp4') ||
              null;
          }

          // Also check story pin video blocks
          if (!videoUrl && pin.story_pin_data?.pages?.[0]?.blocks?.[0]?.video?.video_list) {
            const storyVideos = pin.story_pin_data.pages[0].blocks[0].video.video_list;
            videoUrl =
              storyVideos.V_720P?.url ||
              storyVideos.V_EXP7?.url ||
              storyVideos.V_HLSV4?.url?.replace('/hls/', '/720p/').replace('.m3u8', '.mp4') ||
              null;
          }

          // High-Res Image (Master Original)
          const origImage =
            pin.images?.orig?.url ||
            pin.images?.['736x']?.url?.replace('/736x/', '/originals/') ||
            null;

          if (videoUrl) {
            return {
              success: true,
              platform: 'pinterest',
              type: 'video',
              title,
              author,
              thumbnail: origImage || undefined,
              videoHd: videoUrl,
              videoSd: videoUrl,
              mediaOptions: [
                {
                  id: 'pin_video_hd',
                  label: 'Tải Video Pinterest (MP4 HD)',
                  format: 'mp4',
                  quality: '720p HD',
                  url: videoUrl,
                },
                ...(origImage
                  ? [
                      {
                        id: 'pin_thumb_orig',
                        label: 'Tải Ảnh Bìa Gốc (Original Master)',
                        format: 'jpg' as const,
                        quality: 'Master High-Res',
                        url: origImage,
                      },
                    ]
                  : []),
              ],
            };
          }

          if (origImage) {
            return {
              success: true,
              platform: 'pinterest',
              type: 'image',
              title,
              author,
              thumbnail: origImage,
              mediaOptions: [
                {
                  id: 'pin_image_orig',
                  label: 'Tải Ảnh Gốc Siêu Nét (Original Master)',
                  format: 'jpg',
                  quality: 'Original Max Resolution',
                  url: origImage,
                },
              ],
            };
          }
        }
      }
    } catch {
      // Fallback to HTML scraping
    }
  }

  // 3. Fallback: Direct HTML scraping
  const browserHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  };

  const initialRes = await fetch(targetUrl, {
    method: 'GET',
    headers: browserHeaders,
    redirect: 'follow',
    signal: AbortSignal.timeout(6000),
  });

  if (!initialRes.ok) {
    throw new Error(`Không thể truy cập Pinterest: HTTP ${initialRes.status}`);
  }

  const html = await initialRes.text();

  // Extract Title
  let title = 'Pinterest Pin';
  const titleMatch =
    html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].replace(' | Pinterest', '').trim();
  }

  // Check Video
  let videoUrl: string | null = null;
  const ogVideoMatch = html.match(
    /<meta\s+property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i
  );
  if (ogVideoMatch && ogVideoMatch[1]) {
    videoUrl = ogVideoMatch[1];
  }

  if (!videoUrl) {
    const v1Match = html.match(/https:\/\/v1\.pinimg\.com\/videos\/[^\s"'<>]+/i);
    if (v1Match) {
      videoUrl = v1Match[0].replace('/hls/', '/720p/').replace('.m3u8', '.mp4');
    }
  }

  // Extract Image
  let imageUrl: string | null = null;
  const ogImgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (ogImgMatch && ogImgMatch[1]) {
    imageUrl = ogImgMatch[1];
  } else {
    const pinImgMatch = html.match(/https:\/\/i\.pinimg\.com\/(?:736x|564x|474x|236x)\/[^\s"'<>]+/i);
    if (pinImgMatch) {
      imageUrl = pinImgMatch[0];
    }
  }

  const highResImageUrl = imageUrl
    ? imageUrl.replace(/\/(?:736x|564x|474x|236x)\//, '/originals/')
    : null;

  if (videoUrl) {
    return {
      success: true,
      platform: 'pinterest',
      type: 'video',
      title,
      thumbnail: highResImageUrl || imageUrl || undefined,
      videoHd: videoUrl,
      videoSd: videoUrl,
      mediaOptions: [
        {
          id: 'pin_video_hd',
          label: 'Tải Video Pinterest (MP4 HD)',
          format: 'mp4',
          quality: '720p HD',
          url: videoUrl,
        },
        ...(highResImageUrl
          ? [
              {
                id: 'pin_thumb_orig',
                label: 'Tải Ảnh Thumbnail Gốc (Original HD)',
                format: 'jpg' as const,
                quality: 'High-Res',
                url: highResImageUrl,
              },
            ]
          : []),
      ],
    };
  }

  if (highResImageUrl || imageUrl) {
    const finalImg = highResImageUrl || imageUrl!;
    return {
      success: true,
      platform: 'pinterest',
      type: 'image',
      title,
      thumbnail: finalImg,
      mediaOptions: [
        {
          id: 'pin_image_orig',
          label: 'Tải Ảnh Gốc Siêu Nét (Original Master)',
          format: 'jpg',
          quality: 'Original Max Resolution',
          url: finalImg,
        },
      ],
    };
  }

  throw new Error('Không tìm thấy tài nguyên video hoặc hình ảnh hợp lệ trên Pin Pinterest này.');
}

/**
 * Rapidly fetches media title, thumbnail, and author via oEmbed or OpenGraph.
 */
export async function fetchMediaMetadata(targetUrl: string, platform: SocialPlatform) {
  let title = `Video ${platform.toUpperCase()} HD`;
  let thumbnail: string | undefined;
  let author: { name: string; username?: string; avatar?: string } | undefined;

  try {
    if (platform === 'youtube') {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`,
        { signal: AbortSignal.timeout(3500) }
      );
      if (oembedRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const oe: any = await oembedRes.json();
        if (oe.title) title = oe.title;
        if (oe.author_name) author = { name: oe.author_name, username: `@${oe.author_name}` };
        if (oe.thumbnail_url) thumbnail = oe.thumbnail_url;
      }
    }
  } catch {
    // Continue
  }

  if (!thumbnail || title.startsWith('Video ')) {
    try {
      const ogRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(3500),
      });
      if (ogRes.ok) {
        const html = await ogRes.text();
        const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
        const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
        if (ogTitle && ogTitle[1] && title.startsWith('Video ')) title = ogTitle[1];
        if (ogImage && ogImage[1] && !thumbnail) thumbnail = ogImage[1];
      }
    } catch {
      // Continue
    }
  }

  return { title, thumbnail, author };
}

/**
 * Multi-instance Cobalt caller with automatic retry and strict video enforcement for YouTube, FB, IG, Twitter.
 */
export async function extractCobalt(url: string, platform: SocialPlatform): Promise<ExtractionResult> {
  const metaPromise = fetchMediaMetadata(url, platform);
  const isYouTube = url.includes('youtube.com') || url.includes('youtu.be') || platform === 'youtube';

  for (const inst of COBALT_INSTANCES) {
    try {
      const isV7 = inst.version === 'v7';
      const body = isV7
        ? JSON.stringify({
            url,
            vQuality: '1080',
            isAudioOnly: false,
            aFormat: 'mp3',
            isNoTTWatermark: true,
            isTTFullAudio: true,
            vCodec: 'h264',
            filenamePattern: 'basic',
          })
        : JSON.stringify({
            url,
            videoQuality: '1080',
            audioFormat: 'mp3',
            ...(isYouTube ? { youtubeVideoCodec: 'h264' } : {}),
          });

      let response = await fetch(inst.endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        body,
        signal: AbortSignal.timeout(4500),
      });

      // If v10 returned 400 invalid body, retry with simple body { url }
      if (!response.ok && response.status === 400 && !isV7) {
        try {
          response = await fetch(inst.endpoint, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
            body: JSON.stringify({ url }),
            signal: AbortSignal.timeout(4500),
          });
        } catch {
          // Ignore retry failure
        }
      }

      if (!response.ok) {
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await response.json();

      if (data.status === 'error' || data.error) {
        continue;
      }

      if (data.status === 'tunnel' || data.status === 'redirect' || data.status === 'stream') {
        const streamUrl = data.url;

        // Guard against bare instance / invalid URLs
        if (
          !streamUrl ||
          typeof streamUrl !== 'string' ||
          streamUrl === inst.endpoint ||
          streamUrl === `${inst.endpoint}/` ||
          streamUrl.endsWith('/api/json')
        ) {
          continue;
        }

        try {
          const parsedStream = new URL(streamUrl);
          const p = parsedStream.pathname.trim();
          if (p === '' || p === '/' || p === '/api/json') {
            continue;
          }
        } catch {
          continue;
        }

        const meta = await metaPromise;
        const finalTitle = data.filename
          ? data.filename.replace(/\.[a-zA-Z0-9]+$/i, '')
          : meta.title;

        return {
          success: true,
          platform,
          type: 'video',
          title: finalTitle,
          thumbnail: meta.thumbnail,
          author: meta.author,
          videoHd: streamUrl,
          videoSd: streamUrl,
          mediaOptions: [
            {
              id: `${platform}_hd`,
              label: `MP4 HD (${platform.toUpperCase()})`,
              description: 'Chất lượng cao nhất từ máy chủ CDN',
              format: 'mp4',
              quality: '1080p / HD',
              url: streamUrl,
            },
            {
              id: `${platform}_sd`,
              label: 'MP4 SD',
              description: 'Dung lượng nhẹ, tối ưu cho thiết bị di động',
              format: 'mp4',
              quality: 'SD',
              url: streamUrl,
            },
            {
              id: `${platform}_audio`,
              label: 'M4A / MP3 Audio',
              description: 'Bóc tách âm thanh độc lập',
              format: 'mp3',
              quality: 'Audio',
              isAudio: true,
              url: streamUrl,
            },
          ],
        };
      }

      if (data.status === 'picker' && Array.isArray(data.picker)) {
        const meta = await metaPromise;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const videoItems = data.picker.filter(
          (item: any) =>
            (item.type === 'video' || item.url?.includes('.mp4')) &&
            item.url &&
            item.url !== inst.endpoint &&
            item.url !== `${inst.endpoint}/`
        );

        if (videoItems.length > 0) {
          const mainVideo = videoItems[0];
          return {
            success: true,
            platform,
            type: 'video',
            title: meta.title,
            thumbnail: mainVideo.thumb || meta.thumbnail,
            author: meta.author,
            videoHd: mainVideo.url,
            mediaOptions: videoItems.map((item: any, idx: number) => ({
              id: `${platform}_video_${idx}`,
              label: `Tải Video #${idx + 1} (MP4)`,
              format: 'mp4' as const,
              quality: 'HD',
              url: item.url,
            })),
          };
        }

        return {
          success: true,
          platform,
          type: 'slideshow',
          title: `Bộ sưu tập ${platform.toUpperCase()}`,
          author: meta.author,
          mediaOptions: [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          slideshowImages: data.picker.map((item: any, i: number) => ({
            id: `picker_${i}`,
            url: item.url,
            thumbnail: item.thumb || item.url,
          })),
        };
      }
    } catch {
      // Continue to next Cobalt instance
    }
  }

  // Fallback: Direct HTML video extraction
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const html = await res.text();
      const hdMatch = html.match(/"browser_native_hd_url":"([^"]+)"/) || html.match(/"hd_src":"([^"]+)"/);
      const sdMatch = html.match(/"browser_native_sd_url":"([^"]+)"/) || html.match(/"sd_src":"([^"]+)"/);
      const ogVideo = html.match(/<meta\s+property=["']og:video(?::secure_url)?["']\s+content=["']([^"']+)["']/i);
      const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
      const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);

      let directVideoUrl: string | null = null;
      if (hdMatch && hdMatch[1]) {
        directVideoUrl = JSON.parse(`"${hdMatch[1]}"`);
      } else if (sdMatch && sdMatch[1]) {
        directVideoUrl = JSON.parse(`"${sdMatch[1]}"`);
      } else if (ogVideo && ogVideo[1] && !ogVideo[1].includes('/embed/')) {
        directVideoUrl = ogVideo[1];
      }

      if (directVideoUrl) {
        return {
          success: true,
          platform,
          type: 'video',
          title: ogTitle ? ogTitle[1] : `Video ${platform.toUpperCase()}`,
          thumbnail: ogImage ? ogImage[1] : undefined,
          videoHd: directVideoUrl,
          mediaOptions: [
            {
              id: `${platform}_direct_mp4`,
              label: `Tải Video MP4 (${platform.toUpperCase()})`,
              format: 'mp4',
              url: directVideoUrl,
            },
          ],
        };
      }
    }
  } catch {
    // Ignore fallback errors
  }

  throw new Error(
    `Không thể trích xuất luồng video từ liên kết ${platform.toUpperCase()}. Nền tảng có thể đã hạn chế quyền truy cập hoặc video ở chế độ riêng tư/bản quyền.`
  );
}

export function extractYouTubeVideoId(url: string): string | null {
  const m = url.match(
    /(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=|\?v=)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

/**
 * Extracts YouTube video via Cobalt mesh first, with ytdl-core metadata & oEmbed fallback.
 */
export async function extractYouTube(url: string): Promise<ExtractionResult> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error('Không thể tìm thấy Video ID hợp lệ từ liên kết YouTube.');
  }

  // 1. First strategy: Cobalt mesh (often handles YouTube streams cleanly)
  try {
    const cobaltRes = await extractCobalt(url, 'youtube');
    if (cobaltRes && cobaltRes.success) {
      return cobaltRes;
    }
  } catch {
    // Fallback to ytdl-core & oEmbed
  }

  // 2. Secondary strategy: @distube/ytdl-core info + oEmbed
  let title = 'Video YouTube HD';
  let author: { name: string; username?: string; avatar?: string } | undefined = { name: 'YouTube Creator' };
  let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let duration: number | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawFormats: any[] = [];

  try {
    const info = await ytdlInstance.getInfo(url);
    if (info.videoDetails) {
      title = info.videoDetails.title || title;
      if (info.videoDetails.author?.name) {
        author = {
          name: info.videoDetails.author.name,
          username: info.videoDetails.author.id ? `@${info.videoDetails.author.id}` : undefined,
        };
      }
      const rawSeconds = info.videoDetails.lengthSeconds;
      duration = typeof rawSeconds === 'number' ? rawSeconds : parseInt(String(rawSeconds || '0'), 10) || undefined;
      const thumbs = info.videoDetails.thumbnails;
      if (thumbs && thumbs.length > 0) {
        thumbnail = thumbs[thumbs.length - 1].url;
      }
    }
    if (Array.isArray(info.formats) && info.formats.length > 0) {
      rawFormats = info.formats;
    }
  } catch {
    const meta = await fetchMediaMetadata(url, 'youtube');
    title = meta.title;
    if (meta.author) author = meta.author;
    if (meta.thumbnail) thumbnail = meta.thumbnail;
  }

  const encodedUrl = encodeURIComponent(url);
  const mediaOptions: MediaDownloadOption[] = [];
  const availableFormats: AvailableFormat[] = [];

  // Parse direct formats if available from ytdl-core
  const targetResolutions = [1080, 720, 480, 360];
  for (const res of targetResolutions) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = rawFormats.find((f: any) =>
      (f.height === res || f.qualityLabel?.includes(`${res}p`)) && f.url
    );

    if (match && match.url) {
      const downloadUrl = `/api/download?url=${encodeURIComponent(match.url)}&quality=${res}p&filename=${encodeURIComponent(`${title}_${res}p.mp4`)}`;
      mediaOptions.push({
        id: `yt_${res}p`,
        label: `MP4 ${res}p`,
        resolution: `${res}p`,
        quality: `${res}p`,
        format: 'mp4',
        url: downloadUrl,
      });
      availableFormats.push({
        formatId: String(match.itag || res),
        label: `MP4 ${res}p`,
        resolution: `${res}p`,
        quality: `${res}p`,
        type: 'video',
        format: 'mp4',
        url: downloadUrl,
      });
    }
  }

  // Fallback options through proxy if no direct formats with URLs were extracted
  if (mediaOptions.length === 0) {
    const streamHd = `/api/download?url=${encodedUrl}&quality=1080p&filename=${encodeURIComponent(`${title}_1080p.mp4`)}`;
    const streamSd = `/api/download?url=${encodedUrl}&quality=720p&filename=${encodeURIComponent(`${title}_720p.mp4`)}`;
    const streamAudio = `/api/download?url=${encodedUrl}&quality=audio&filename=${encodeURIComponent(`${title}_audio.mp3`)}`;

    mediaOptions.push(
      {
        id: 'youtube_1080p',
        label: 'MP4 1080p (Full HD)',
        resolution: '1080p',
        quality: '1080p',
        description: 'Độ phân giải Full HD 1080p',
        format: 'mp4',
        url: streamHd,
      },
      {
        id: 'youtube_720p',
        label: 'MP4 720p (HD)',
        resolution: '720p',
        quality: '720p',
        description: 'Độ nét tiêu chuẩn HD',
        format: 'mp4',
        url: streamSd,
      },
      {
        id: 'youtube_audio',
        label: 'M4A / MP3 Audio',
        quality: '192kbps',
        description: 'Trích xuất âm thanh gốc chất lượng cao',
        format: 'mp3',
        isAudio: true,
        url: streamAudio,
      }
    );
  }

  return {
    success: true,
    platform: 'youtube',
    type: 'video',
    title,
    thumbnail,
    author,
    duration,
    videoId,
    mediaOptions,
    availableFormats,
  };
}

/**
 * Master dispatcher for social media URL extraction.
 */
export async function extractSocialMedia(url: string): Promise<ExtractionResult> {
  const cleanUrl = url.trim();
  const detectedPlatform = detectPlatform(cleanUrl);

  switch (detectedPlatform) {
    case 'tiktok':
      return await extractTikTok(cleanUrl);
    case 'pinterest':
      return await extractPinterest(cleanUrl);
    case 'youtube':
      return await extractYouTube(cleanUrl);
    case 'facebook':
    case 'instagram':
    case 'twitter':
      return await extractCobalt(cleanUrl, detectedPlatform);
    default:
      try {
        return await extractCobalt(cleanUrl, 'unknown');
      } catch {
        throw new Error(
          'Nền tảng này hiện chưa được hỗ trợ. Vui lòng dán link TikTok, Pinterest, Facebook, Instagram hoặc YouTube.'
        );
      }
  }
}
