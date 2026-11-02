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

interface CobaltInstanceDef {
  endpoint: string;
  version: 'v7' | 'v10';
}

const COBALT_INSTANCES: CobaltInstanceDef[] = [
  { endpoint: 'https://api.cobalt.tools/api/json', version: 'v7' },
  { endpoint: 'https://rue-cobalt.xenon.zone', version: 'v10' },
  { endpoint: 'https://co.wuk.sh/api/json', version: 'v7' },
];

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
 * Multi-instance Cobalt caller with automatic retry, anti-bot filtering and direct CDN URLs.
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        body,
        signal: AbortSignal.timeout(2800),
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
            signal: AbortSignal.timeout(2500),
          });
        } catch {
          // Ignore retry failure
        }
      }

      if (!response.ok) {
        continue;
      }

      // Check content-type to guard against HTML anti-bot responses
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await response.json();

      if (data.status === 'error' || data.error) {
        continue;
      }

      if (data.status === 'tunnel' || data.status === 'redirect' || data.status === 'stream') {
        const streamUrl = data.url;

        // Guard against bare instance / invalid URLs or HTML
        if (
          !streamUrl ||
          typeof streamUrl !== 'string' ||
          streamUrl === inst.endpoint ||
          streamUrl === `${inst.endpoint}/` ||
          streamUrl.endsWith('/api/json') ||
          streamUrl.startsWith('data:text/html') ||
          streamUrl.includes('<!DOCTYPE')
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
              id: `${platform}_1080p`,
              label: `MP4 1080p (${platform.toUpperCase()})`,
              description: 'Chất lượng cao nhất từ máy chủ CDN',
              format: 'mp4',
              quality: '1080p / HD',
              url: streamUrl,
            },
            {
              id: `${platform}_720p`,
              label: 'MP4 720p (HD)',
              description: 'Độ nét tiêu chuẩn, tốc độ tải nhanh',
              format: 'mp4',
              quality: '720p',
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

  // Fallback for Facebook/Instagram: Direct HTML native stream regex
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

      if (directVideoUrl && !directVideoUrl.includes('<!DOCTYPE') && !directVideoUrl.startsWith('data:text/html')) {
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

/**
 * Extracts TikTok video or photo slideshow using TikWM API with fallback to Cobalt.
 */
export async function extractTikTok(url: string): Promise<ExtractionResult> {
  try {
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
      signal: AbortSignal.timeout(7000),
    });

    if (response.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await response.json();

      if (json.code === 0 && json.data) {
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

        // Case 1: Photo Slideshow
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
    }
  } catch {
    // Continue to Cobalt fallback
  }

  // Fallback to Cobalt API mesh
  return await extractCobalt(url, 'tiktok');
}

/**
 * Extracts Pinterest Pin media using official Pinterest Resource API with fallback to Cobalt.
 */
export async function extractPinterest(url: string): Promise<ExtractionResult> {
  let targetUrl = url;
  let pinId: string | null = null;

  const pinMatch = targetUrl.match(/\/pin\/(\d+)/);
  if (pinMatch) {
    pinId = pinMatch[1];
  } else if (/^\d+$/.test(targetUrl.trim())) {
    pinId = targetUrl.trim();
  } else {
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
      // Continue
    }
  }

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

          // Check Story pin pages
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

          // Check Video Pin
          let videoUrl: string | null = null;
          const videoList = pin.videos?.video_list;
          if (videoList) {
            videoUrl =
              videoList.V_720P?.url ||
              videoList.V_EXP7?.url ||
              videoList.V_HLSV4?.url?.replace('/hls/', '/720p/').replace('.m3u8', '.mp4') ||
              null;
          }

          if (!videoUrl && pin.story_pin_data?.pages?.[0]?.blocks?.[0]?.video?.video_list) {
            const storyVideos = pin.story_pin_data.pages[0].blocks[0].video.video_list;
            videoUrl =
              storyVideos.V_720P?.url ||
              storyVideos.V_EXP7?.url ||
              storyVideos.V_HLSV4?.url?.replace('/hls/', '/720p/').replace('.m3u8', '.mp4') ||
              null;
          }

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
      // Continue to Cobalt fallback
    }
  }

  // Fallback to Cobalt API mesh
  return await extractCobalt(url, 'pinterest');
}

export function extractYouTubeVideoId(url: string): string | null {
  const m = url.match(
    /(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=|\?v=)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

/**
 * Extracts YouTube video exclusively via Cobalt API mesh, avoiding datacenter IP bans.
 */
export async function extractYouTube(url: string): Promise<ExtractionResult> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error('Không thể tìm thấy Video ID hợp lệ từ liên kết YouTube.');
  }

  try {
    const cobaltRes = await extractCobalt(url, 'youtube');
    if (cobaltRes && cobaltRes.success && cobaltRes.videoHd) {
      return cobaltRes;
    }
  } catch (err) {
    console.warn('[YouTube Cobalt Failed]:', err instanceof Error ? err.message : err);
  }

  // If Cobalt fails, do NOT generate /api/download?url=... which fails on Vercel!
  // Throw clear guidance to user
  throw new Error(
    'Bị chặn bởi nền tảng YouTube (Anti-Bot). Vui lòng thử lại sau giây lát hoặc sử dụng Tiện ích mở rộng Cytools trên Chrome để tải trực tiếp từ IP cá nhân của bạn.'
  );
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
