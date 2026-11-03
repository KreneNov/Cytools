import { Readable } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Plugin } from 'vite';
import { Ytdl } from '@distube/ytdl-core';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectPlatform } from '../types/socialDownloader.ts';
import type { ExtractionResult, SocialPlatform, SocialMediaType, MediaDownloadOption, AvailableFormat } from '../types/socialDownloader.ts';

const ytdlInstance = new Ytdl();

/**
 * Extracts TikTok video or photo slideshow using TikWM API.
 */
async function extractTikTok(url: string): Promise<ExtractionResult> {
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
async function extractPinterest(url: string): Promise<ExtractionResult> {
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
 * Extracts YouTube 11-character video ID from varied URL formats (standard, short, embed, shorts).
 */
export function extractYouTubeVideoId(url: string): string | null {
  const m = url.match(
    /(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=|\?v=)([a-zA-Z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

/**
 * Extracts YouTube video directly via @distube/ytdl-core without relying on public Cobalt instances.
 * Parses exact available formats (e.g. 1080p, 720p, 480p, 360p, MP3) and returns exact formatId mappings.
 */
async function extractYouTubeDirect(url: string): Promise<ExtractionResult> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error('Không thể tìm thấy Video ID hợp lệ từ liên kết YouTube.');
  }

  const encodedUrl = encodeURIComponent(url);

  // 1. Try Dedicated Backend Service First (/api/info powered by yt-dlp)
  try {
    const backendRes = await fetch(`http://localhost:3000/api/info?url=${encodedUrl}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (backendRes.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await backendRes.json()) as any;
      if (json && json.success && json.data) {
        const d = json.data;
        const availableFormats: AvailableFormat[] = [];
        const mediaOptions: MediaDownloadOption[] = [];

        if (Array.isArray(d.availableFormats)) {
          for (const fmt of d.availableFormats) {
            const res = fmt.qualityLabel || '720p';
            const num = parseInt(res.replace('p', ''), 10) || 720;
            const resLabel = num >= 2160 ? '4K Ultra HD' : num >= 1440 ? '2K QHD' : num >= 1080 ? 'Full HD' : num >= 720 ? 'HD' : 'SD';
            const cleanDesc = `Độ phân giải ${res} (${resLabel}) • Tải trực tiếp tốc độ cao`;
            const downloadUrl = `/api/download?url=${encodedUrl}&quality=${res}&formatId=${encodeURIComponent(fmt.formatId || '')}`;

            const item: AvailableFormat = {
              formatId: String(fmt.formatId || res),
              label: `MP4 ${res} (${resLabel})`,
              resolution: res,
              quality: res,
              description: cleanDesc,
              type: 'video',
              format: 'mp4',
              url: downloadUrl,
            };
            availableFormats.push(item);

            mediaOptions.push({
              id: `yt_${res}`,
              label: `MP4 ${res} (${resLabel})`,
              resolution: res,
              quality: res,
              description: cleanDesc,
              formatId: String(fmt.formatId || res),
              format: 'mp4',
              url: downloadUrl,
            });
          }
        }

        // Add MP3 Audio Option
        const audioUrl = `/api/download?url=${encodedUrl}&quality=audio`;
        const audioDesc = 'Trích xuất âm thanh gốc chất lượng cao (192kbps MP3)';
        availableFormats.push({
          formatId: 'audio',
          label: 'M4A / MP3 Audio',
          quality: '192kbps',
          description: audioDesc,
          type: 'audio',
          format: 'mp3',
          url: audioUrl,
        });
        mediaOptions.push({
          id: 'yt_audio',
          label: 'M4A / MP3 Audio',
          quality: '192kbps',
          description: audioDesc,
          formatId: 'audio',
          format: 'mp3',
          isAudio: true,
          url: audioUrl,
        });

        return {
          success: true,
          platform: 'youtube',
          type: 'video',
          title: d.title || 'Video YouTube HD',
          author: d.author || { name: 'YouTube Creator' },
          thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          duration: d.duration,
          mediaOptions,
          availableFormats,
        };
      }
    }
  } catch (backendErr) {
    console.warn('[socialExtractor] Local backend info error, falling back to local ytdl:', backendErr instanceof Error ? backendErr.message : backendErr);
  }

  // 2. Fallback to @distube/ytdl-core & oEmbed
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
  } catch (ytdlErr) {
    console.warn('[ytdl.getInfo failed, falling back to oEmbed]:', ytdlErr instanceof Error ? ytdlErr.message : ytdlErr);
    const meta = await fetchMediaMetadata(url, 'youtube');
    title = meta.title;
    if (meta.author) author = meta.author;
    if (meta.thumbnail) thumbnail = meta.thumbnail;
  }

  const availableFormats: AvailableFormat[] = [];
  const mediaOptions: MediaDownloadOption[] = [];

  // 1. Find Best Audio Stream
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audioFormat =
    rawFormats.find((f: any) => f.itag === 140) ||
    rawFormats.find((f: any) => f.hasAudio && f.container === 'mp4') ||
    rawFormats.find((f: any) => f.hasAudio);
  const audioItag = audioFormat ? audioFormat.itag : 140;
  const audioBitrate = audioFormat?.audioBitrate ? `${audioFormat.audioBitrate}kbps` : '192kbps';

  // 2. Parse Exact Video Resolutions (Descending)
  const targetResolutions = [2160, 1440, 1080, 720, 480, 360];

  for (const res of targetResolutions) {
    // Prefer mp4 container or qualityLabel matching exactly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match =
      rawFormats.find((f: any) => f.height === res && f.container === 'mp4') ||
      rawFormats.find((f: any) => f.qualityLabel?.includes(`${res}p`) && f.container === 'mp4') ||
      rawFormats.find((f: any) => f.height === res) ||
      rawFormats.find((f: any) => f.qualityLabel?.includes(`${res}p`));

    if (match) {
      const formatId = match.hasAudio ? String(match.itag) : `${match.itag}+${audioItag}`;
      const resLabel = res >= 2160 ? '4K Ultra HD' : res >= 1440 ? '2K QHD' : res >= 1080 ? 'Full HD' : res >= 720 ? 'HD' : 'SD';
      const cleanDesc = match.hasAudio
        ? `Độ phân giải ${res}p (${resLabel}) • Kèm âm thanh gốc`
        : `Độ phân giải ${res}p (${resLabel}) • Mux ghép âm thanh AAC 192k`;

      const downloadUrl = `/api/download?url=${encodedUrl}&formatId=${encodeURIComponent(formatId)}&quality=${res}p`;

      const fmt: AvailableFormat = {
        formatId,
        label: `MP4 ${res}p (${resLabel})`,
        resolution: `${res}p`,
        quality: `${res}p`,
        description: cleanDesc,
        type: 'video',
        format: 'mp4',
        url: downloadUrl,
      };
      availableFormats.push(fmt);

      mediaOptions.push({
        id: `yt_${res}p`,
        label: `MP4 ${res}p (${resLabel})`,
        resolution: `${res}p`,
        quality: `${res}p`,
        description: cleanDesc,
        formatId,
        format: 'mp4',
        url: downloadUrl,
      });
    }
  }

  // 3. Add Audio Format Option
  if (audioFormat || rawFormats.length > 0) {
    const audioUrl = `/api/download?url=${encodedUrl}&formatId=${audioItag}&quality=audio`;
    const audioDesc = `Trích xuất âm thanh gốc chất lượng cao (${audioBitrate})`;

    const audioFmt: AvailableFormat = {
      formatId: String(audioItag),
      label: 'M4A / MP3 Audio',
      quality: audioBitrate,
      description: audioDesc,
      type: 'audio',
      format: 'mp3',
      url: audioUrl,
    };
    availableFormats.push(audioFmt);

    mediaOptions.push({
      id: 'yt_audio',
      label: 'M4A / MP3 Audio',
      quality: audioBitrate,
      description: audioDesc,
      formatId: String(audioItag),
      format: 'mp3',
      isAudio: true,
      url: audioUrl,
    });
  }

  // Fallback if no format parsed (e.g. oEmbed fallback)
  if (mediaOptions.length === 0) {
    const streamHd = `/api/download?url=${encodedUrl}&quality=1080p&formatId=137+140`;
    const streamSd = `/api/download?url=${encodedUrl}&quality=720p&formatId=136+140`;
    const streamAudio = `/api/download?url=${encodedUrl}&quality=audio&formatId=140`;

    mediaOptions.push(
      {
        id: 'youtube_1080p',
        label: 'MP4 1080p (Full HD)',
        resolution: '1080p',
        quality: '1080p',
        description: 'Chất lượng cao nhất, đầy đủ hình ảnh và âm thanh',
        formatId: '137+140',
        format: 'mp4',
        url: streamHd,
      },
      {
        id: 'youtube_720p',
        label: 'MP4 720p (HD)',
        resolution: '720p',
        quality: '720p',
        description: 'Độ nét tiêu chuẩn HD, tải nhanh',
        formatId: '136+140',
        format: 'mp4',
        url: streamSd,
      },
      {
        id: 'youtube_audio',
        label: 'M4A / MP3 Audio',
        quality: '192kbps',
        description: 'Trích xuất âm thanh gốc chất lượng cao (192kbps)',
        formatId: '140',
        format: 'mp3',
        isAudio: true,
        url: streamAudio,
      }
    );
  }

  const topVideo = mediaOptions.find((m) => !m.isAudio);
  const streamHd = topVideo?.url || `/api/download?url=${encodedUrl}&quality=hd`;
  const streamSd = mediaOptions.find((m) => !m.isAudio && m.id !== topVideo?.id)?.url || streamHd;

  return {
    success: true,
    platform: 'youtube',
    type: 'video',
    title,
    thumbnail,
    author,
    duration,
    videoId,
    videoHd: streamHd,
    videoSd: streamSd,
    mediaOptions,
    availableFormats,
  };
}

/**
 * Rapidly fetches media title, thumbnail, and author via oEmbed or OpenGraph.
 */
async function fetchMediaMetadata(targetUrl: string, platform: SocialPlatform) {
  let title = `Video ${platform.toUpperCase()} HD`;
  let thumbnail: string | undefined;
  let author: { name: string; username?: string; avatar?: string } | undefined;

  try {
    if (platform === 'youtube') {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`,
        { signal: AbortSignal.timeout(3000) }
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
        signal: AbortSignal.timeout(3000),
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
async function extractCobalt(url: string, platform: SocialPlatform): Promise<ExtractionResult> {
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
            downloadMode: 'auto',
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

      // If v10 returned 400 invalid body, retry with simple body { url, downloadMode: 'auto' }
      if (!response.ok && response.status === 400 && !isV7) {
        try {
          response = await fetch(inst.endpoint, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
            body: JSON.stringify({ url, downloadMode: 'auto' }),
            signal: AbortSignal.timeout(4500),
          });
        } catch {
          // Ignore retry failure
        }
      }

      if (!response.ok) {
        console.warn(`[Cobalt Skipped] ${inst.endpoint} returned HTTP ${response.status}`);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await response.json();

      // Check for error payload from Cobalt node
      if (data.status === 'error' || data.error) {
        console.warn(`[Cobalt Error] ${inst.endpoint}:`, data.error?.code || data.text || 'Unknown error');
        continue;
      }

      if (data.status === 'tunnel' || data.status === 'redirect' || data.status === 'stream') {
        const streamUrl = data.url;

        // Strict Guard: DO NOT ACCEPT root instance endpoint, bare API endpoint, or invalid paths
        if (
          !streamUrl ||
          typeof streamUrl !== 'string' ||
          streamUrl === inst.endpoint ||
          streamUrl === `${inst.endpoint}/` ||
          streamUrl.endsWith('/api/json')
        ) {
          console.warn(`[Cobalt Skipped] Node ${inst.endpoint} returned invalid/root streamUrl:`, streamUrl);
          continue;
        }

        try {
          const parsedStream = new URL(streamUrl);
          const p = parsedStream.pathname.trim();
          if (p === '' || p === '/' || p === '/api/json') {
            console.warn(`[Cobalt Skipped] Node ${inst.endpoint} returned root path streamUrl:`, streamUrl);
            continue;
          }
        } catch {
          console.warn(`[Cobalt Skipped] Node ${inst.endpoint} returned unparseable streamUrl:`, streamUrl);
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

  // Fallback: Direct HTML video extraction (NEVER fallback to og:image for video platforms)
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
      // 1. Direct browser native stream strings (used by Facebook & Instagram)
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

  // Strict enforcement: Do NOT return og:image pretending to be a successful download!
  throw new Error(
    `Không thể trích xuất luồng video từ liên kết ${platform.toUpperCase()}. Nền tảng có thể đã hạn chế quyền truy cập hoặc video ở chế độ riêng tư/bản quyền.`
  );
}

/**
 * Master dispatcher for social media URL extraction.
 * Routes requests to the Universal Backend (/api/info powered by yt-dlp) as primary source,
 * completely offloading heavy parsing and bypassing bot-detection for TikTok, Pinterest, YouTube, Facebook, and Instagram.
 */
export async function extractSocialMedia(url: string): Promise<ExtractionResult> {
  const cleanUrl = url.trim();
  const encodedUrl = encodeURIComponent(cleanUrl);
  const detectedPlatform = detectPlatform(cleanUrl);

  // 1. Primary Strategy: Universal Dedicated Backend Service (/api/info)
  try {
    const backendRes = await fetch(`http://localhost:3000/api/info?url=${encodedUrl}`, {
      signal: AbortSignal.timeout(6000),
    });

    if (backendRes.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await backendRes.json()) as any;
      if (json && json.success && json.data) {
        const d = json.data;
        const availableFormats: AvailableFormat[] = [];
        const mediaOptions: MediaDownloadOption[] = [];

        if (Array.isArray(d.availableFormats) && d.availableFormats.length > 0) {
          for (const fmt of d.availableFormats) {
            const res = fmt.qualityLabel || 'HD';
            const cleanDesc = `Chất lượng ${res} • Tải trực tiếp tốc độ cao`;
            const downloadUrl = `/api/download?url=${encodedUrl}&quality=${encodeURIComponent(res)}&formatId=${encodeURIComponent(fmt.formatId || '')}`;

            const item: AvailableFormat = {
              formatId: String(fmt.formatId || res),
              label: `MP4 ${res}`,
              resolution: res,
              quality: res,
              description: cleanDesc,
              type: fmt.hasVideo ? 'video' : 'audio',
              format: fmt.hasVideo ? 'mp4' : 'mp3',
              url: downloadUrl,
            };
            availableFormats.push(item);

            mediaOptions.push({
              id: `dl_${fmt.formatId || res}`,
              label: `MP4 ${res}`,
              resolution: res,
              quality: res,
              description: cleanDesc,
              formatId: String(fmt.formatId || res),
              format: 'mp4',
              url: downloadUrl,
            });
          }
        } else {
          // Default Best Option
          const downloadUrl = `/api/download?url=${encodedUrl}&quality=best`;
          mediaOptions.push({
            id: 'dl_best',
            label: 'MP4 HD (Gốc)',
            resolution: 'HD',
            quality: 'HD',
            description: 'Chất lượng cao nhất từ nguồn gốc',
            formatId: 'best',
            format: 'mp4',
            url: downloadUrl,
          });
        }

        // Add Audio Option
        const audioUrl = `/api/download?url=${encodedUrl}&quality=audio`;
        availableFormats.push({
          formatId: 'audio',
          label: 'M4A / MP3 Audio',
          quality: '192kbps',
          description: 'Trích xuất âm thanh gốc chất lượng cao (192kbps MP3)',
          type: 'audio',
          format: 'mp3',
          url: audioUrl,
        });
        mediaOptions.push({
          id: 'dl_audio',
          label: 'MP3 Audio (192kbps)',
          quality: '192kbps',
          description: 'Trích xuất âm thanh gốc chất lượng cao (192kbps MP3)',
          formatId: 'audio',
          format: 'mp3',
          isAudio: true,
          url: audioUrl,
        });

        const platform = (d.platform || detectedPlatform) as SocialPlatform;
        const mediaType: SocialMediaType = d.isVideo !== false ? 'video' : 'image';

        return {
          success: true,
          platform,
          type: mediaType,
          title: d.title || 'Media Video HD',
          author: d.author || { name: `${platform.toUpperCase()} Creator` },
          thumbnail: d.thumbnail || '',
          duration: d.duration,
          mediaOptions,
          availableFormats,
        };
      }
    }
  } catch (backendErr) {
    console.warn('[socialExtractor] Universal backend extraction failed, attempting fallback:', backendErr instanceof Error ? backendErr.message : backendErr);
  }

  // 2. Secondary Strategy: Fallback to existing client/server proxies
  switch (detectedPlatform) {
    case 'tiktok':
      return await extractTikTok(cleanUrl);
    case 'pinterest':
      return await extractPinterest(cleanUrl);
    case 'youtube':
      return await extractYouTubeDirect(cleanUrl);
    case 'facebook':
    case 'instagram':
    case 'twitter':
      return await extractCobalt(cleanUrl, detectedPlatform);
    default:
      try {
        return await extractCobalt(cleanUrl, 'unknown');
      } catch {
        throw new Error('Nền tảng này hiện chưa được hỗ trợ. Vui lòng dán link TikTok, Pinterest, Facebook, Instagram hoặc YouTube.');
      }
  }
}

/**
 * Direct YouTube Innertube player API query using ANDROID_VR client with server Cobalt tunnel fallback.
 * Returns pre-muxed itag 18 MP4 (video+audio) and high-bitrate itag 140 M4A audio.
 */
export async function resolveInnertubeStreams(videoId: string): Promise<{
  preMuxedUrl: string | null;
  audioUrl: string | null;
  resolvedBy?: string;
  debugReason?: string;
}> {
  // 1. Try Innertube player API with ANDROID_VR client
  try {
    const body = {
      videoId,
      context: {
        client: {
          clientName: 'ANDROID_VR',
          clientVersion: '1.60.19',
          deviceMake: 'Oculus',
          deviceModel: 'Quest 3',
          osName: 'Android',
          osVersion: '12L',
          androidSdkVersion: 32,
          hl: 'vi',
          gl: 'VN',
        },
      },
    };

    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      if (data.playabilityStatus?.status === 'OK') {
        const formats = data.streamingData?.formats || [];
        const adaptive = data.streamingData?.adaptiveFormats || [];

        // Pre-muxed video (itag 18 has video + audio)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const preMuxed =
          formats.find((f: any) => f.url && f.mimeType?.includes('video/mp4')) ||
          formats.find((f: any) => f.url);

        // Direct high-quality M4A audio (itag 140)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const audio =
          adaptive.find((f: any) => f.url && f.itag === 140) ||
          adaptive.find((f: any) => f.url && f.mimeType?.includes('audio/mp4'));

        if (preMuxed?.url || audio?.url) {
          return {
            preMuxedUrl: preMuxed?.url || null,
            audioUrl: audio?.url || null,
            resolvedBy: 'innertube_android_vr',
            debugReason: 'OK',
          };
        }
      }
    }
  } catch (err) {
    console.warn('[Innertube Stream Warning]:', err instanceof Error ? err.message : err);
  }

  // 2. Server-side Cobalt instance fallback
  try {
    const cRes = await fetch('https://rue-cobalt.xenon.zone', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        downloadMode: 'auto',
      }),
      signal: AbortSignal.timeout(4000),
    });

    if (cRes.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cData: any = await cRes.json();
      if (
        cData.url &&
        (cData.status === 'tunnel' || cData.status === 'redirect' || cData.status === 'stream')
      ) {
        return {
          preMuxedUrl: cData.url,
          audioUrl: cData.url,
          resolvedBy: 'cobalt_server_tunnel',
          debugReason: 'OK',
        };
      }
    }
  } catch (cErr) {
    console.warn('[Cobalt Server Stream Warning]:', cErr instanceof Error ? cErr.message : cErr);
  }

  return { preMuxedUrl: null, audioUrl: null, resolvedBy: 'none', debugReason: 'No valid stream found' };
}

/**
 * Vite plugin implementing /api/social/extract and /api/social/proxy-download middlewares.
 */
export function socialDownloadProxyPlugin(): Plugin {
  return {
    name: 'social-download-proxy-plugin',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const reqUrl = req.url || '';
        const urlObj = new URL(reqUrl, 'http://127.0.0.1:5173');

        // Preflight OPTIONS CORS handling for Extension and Cross-Origin requests
        if (req.method === 'OPTIONS' && (urlObj.pathname.startsWith('/api/social/') || urlObj.pathname === '/api/download-extension')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
          res.statusCode = 204;
          res.end();
          return;
        }

        // Extension Package Binary Stream Download Endpoint
        if (urlObj.pathname === '/api/download-extension' || urlObj.pathname === '/cytools-extension.zip') {
          const publicZip = path.resolve(process.cwd(), 'public', 'cytools-extension.zip');
          if (fs.existsSync(publicZip)) {
            const fileBuf = fs.readFileSync(publicZip);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="cytools-extension.zip"');
            res.setHeader('Content-Length', fileBuf.length.toString());
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.end(fileBuf);
            return;
          }
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Gói tiện ích chưa được khởi tạo trên máy chủ.' }));
          return;
        }

        // 1. Extraction Endpoint: /api/social/extract
        if (urlObj.pathname === '/api/social/extract') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

          try {
            const action = urlObj.searchParams.get('action');
            const videoId = urlObj.searchParams.get('videoId');

            if (action === 'resolve' && videoId) {
              const streams = await resolveInnertubeStreams(videoId);
              res.statusCode = 200;
              res.end(
                JSON.stringify({
                  success: !!(streams.preMuxedUrl || streams.audioUrl),
                  videoId,
                  preMuxedUrl: streams.preMuxedUrl,
                  audioUrl: streams.audioUrl,
                  resolvedBy: streams.resolvedBy || 'innertube',
                  debugReason: streams.debugReason || 'OK',
                })
              );
              return;
            }

            let targetUrl = urlObj.searchParams.get('url');

            // If POST request, read body
            if (!targetUrl && req.method === 'POST') {
              const buffers: Buffer[] = [];
              for await (const chunk of req) {
                buffers.push(chunk);
              }
              const bodyStr = Buffer.concat(buffers).toString('utf-8');
              try {
                const bodyJson = JSON.parse(bodyStr);
                targetUrl = bodyJson.url;
                if (bodyJson.action === 'resolve' && bodyJson.videoId) {
                  const streams = await resolveInnertubeStreams(bodyJson.videoId);
                  res.statusCode = 200;
                  res.end(
                    JSON.stringify({
                      success: !!(streams.preMuxedUrl || streams.audioUrl),
                      videoId: bodyJson.videoId,
                      preMuxedUrl: streams.preMuxedUrl,
                      audioUrl: streams.audioUrl,
                      resolvedBy: streams.resolvedBy || 'innertube',
                      debugReason: streams.debugReason || 'OK',
                    })
                  );
                  return;
                }
              } catch {
                targetUrl = new URLSearchParams(bodyStr).get('url');
              }
            }

            if (!targetUrl) {
              res.statusCode = 400;
              res.end(JSON.stringify({ success: false, error: 'Thiếu tham số url để bóc tách.' }));
              return;
            }

            const result = await extractSocialMedia(targetUrl);
            res.statusCode = 200;
            res.end(JSON.stringify(result));
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Lỗi không xác định khi bóc tách media.';
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: message }));
          }
          return;
        }

        // 2. Direct Proxy Download Streamer: /api/social/proxy-download
        if (urlObj.pathname === '/api/social/proxy-download') {
          const mediaUrl = urlObj.searchParams.get('url');
          const fileName = urlObj.searchParams.get('filename') || 'download_media.mp4';

          if (!mediaUrl) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: 'Thiếu tham số url để tải xuống.' }));
            return;
          }

          let parsedMediaUrl: URL;
          try {
            parsedMediaUrl = new URL(mediaUrl);
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: 'URL phương tiện tải xuống không hợp lệ.' }));
            return;
          }

          // Strict Guard: Prevent downloading root domain or API endpoints directly (which causes 0.4 kB JSON dumps)
          const pathname = parsedMediaUrl.pathname.trim();
          const isRootOrApiEndpoint =
            pathname === '' ||
            pathname === '/' ||
            pathname === '/api/json' ||
            pathname === '/api' ||
            mediaUrl.endsWith('.zone') ||
            mediaUrl.endsWith('.zone/') ||
            mediaUrl.endsWith('.tools') ||
            mediaUrl.endsWith('.tools/');

          if (isRootOrApiEndpoint) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: false,
                error: 'URL media không chứa đường dẫn tệp hợp lệ (trỏ về máy chủ gốc thay vì luồng video).',
              })
            );
            return;
          }

          try {
            // Fetch upstream with redirect: 'follow'
            const remoteRes = await fetch(mediaUrl, {
              method: 'GET',
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                Accept: '*/*',
              },
              redirect: 'follow',
            });

            const contentType = remoteRes.headers.get('content-type') || '';

            // Only validate headers to check for errors before piping.
            // If the content type indicates JSON, HTML or plain text error, read error text and return 500.
            if (
              contentType.includes('application/json') ||
              contentType.includes('text/html') ||
              contentType.includes('text/plain')
            ) {
              const errorText = await remoteRes.text();
              console.error('[Proxy Error Data]:', errorText.slice(0, 500));
              res.statusCode = 500;
              res.setHeader('Content-Type', 'text/plain; charset=utf-8');
              res.end(errorText);
              return;
            }

            if (!remoteRes.ok || !remoteRes.body) {
              res.statusCode = remoteRes.status || 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: false,
                  error: `Máy chủ CDN upstream phản hồi lỗi: HTTP ${remoteRes.status} ${remoteRes.statusText}`,
                })
              );
              return;
            }

            // DO NOT check or read the body here if we intend to pipe it!
            // Just set headers and pipe it directly.
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);

            if (contentType) {
              res.setHeader('Content-Type', contentType);
            } else {
              res.setHeader('Content-Type', 'video/mp4');
            }

            // ONLY set Content-Length if upstream provides an EXACT content-length.
            const exactContentLength = remoteRes.headers.get('content-length');
            if (exactContentLength) {
              res.setHeader('Content-Length', exactContentLength);
            }

            // Stream remote web response directly to node response
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nodeStream = Readable.fromWeb(remoteRes.body as any);
            nodeStream.on('error', (streamErr) => {
              console.error('[Proxy Stream Pipe Error]:', streamErr);
              if (!res.headersSent) {
                res.statusCode = 502;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'Lỗi đường truyền stream dữ liệu.' }));
              }
            });

            nodeStream.pipe(res);
          } catch (streamErr) {
            console.error('Error in proxy download stream:', streamErr);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Lỗi máy chủ proxy nội bộ khi truyền luồng.' }));
            }
          }
          return;
        }

        // 3. Dedicated YouTube Direct Streaming Endpoint with ffmpeg-static Muxing: /api/social/yt-stream
        if (urlObj.pathname === '/api/social/yt-stream') {
          const targetUrl = urlObj.searchParams.get('url');
          const formatId = urlObj.searchParams.get('formatId');
          const quality = urlObj.searchParams.get('quality') || 'hd';
          const customFilename = urlObj.searchParams.get('filename');

          if (!targetUrl) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: 'Thiếu tham số url để phát luồng YouTube.' }));
            return;
          }

          const tempFilesToClean: string[] = [];

          try {
            const info = await ytdlInstance.getInfo(targetUrl);
            const cleanTitle = (info.videoDetails?.title || 'youtube_video')
              .slice(0, 50)
              .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');

            // 1. Audio Extraction to high-quality MP3 (192k)
            const isAudioRequest =
              quality === 'audio' ||
              (formatId && !formatId.includes('+') && (formatId === '140' || formatId === '251' || formatId === '139'));

            if (isAudioRequest) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const requestedItag = formatId ? parseInt(formatId, 10) : 140;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const audioFormat =
                info.formats.find((f: any) => f.itag === requestedItag) ||
                info.formats.find((f: any) => f.itag === 140) ||
                info.formats.find((f: any) => f.hasAudio && f.container === 'mp4') ||
                info.formats.find((f: any) => f.hasAudio);

              if (!audioFormat) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'Không tìm thấy luồng âm thanh trên video YouTube này.' }));
                return;
              }

              const fileName = customFilename || `${cleanTitle}_audio.mp3`;
              const tempRawAudio = path.join(os.tmpdir(), `yt_raw_a_${Date.now()}_${Math.random().toString(36).slice(2)}.m4a`);
              const tempOutMp3 = path.join(os.tmpdir(), `yt_out_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
              tempFilesToClean.push(tempRawAudio, tempOutMp3);

              // Download raw audio
              const aStream = await ytdlInstance.download(targetUrl, { format: audioFormat });
              await new Promise<void>((resolve, reject) => {
                const ws = fs.createWriteStream(tempRawAudio);
                aStream.pipe(ws);
                ws.on('finish', () => resolve());
                aStream.on('error', reject);
                ws.on('error', reject);
              });

              // Convert to MP3 using ffmpeg-static
              await new Promise<void>((resolve, reject) => {
                const proc = spawn(ffmpegPath as unknown as string, [
                  '-i', tempRawAudio,
                  '-c:a', 'libmp3lame',
                  '-b:a', '192k',
                  '-y', tempOutMp3,
                ]);
                proc.on('close', (code) => {
                  if (code === 0) resolve();
                  else reject(new Error(`ffmpeg audio conversion failed with code ${code}`));
                });
                proc.on('error', reject);
              });

              const stats = fs.statSync(tempOutMp3);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'audio/mpeg');
              res.setHeader('Content-Length', stats.size.toString());
              res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');

              const fileStream = fs.createReadStream(tempOutMp3);
              const cleanup = () => {
                for (const f of tempFilesToClean) {
                  try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
                }
              };
              fileStream.on('close', cleanup);
              res.on('finish', cleanup);
              fileStream.pipe(res);
              return;
            }

            // 2. Exact Video Downloads (either formatId specified or fallback quality)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let videoFormat: any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let audioFormat: any;

            if (formatId && formatId.includes('+')) {
              // Exact Video + Audio Muxing requested
              const [vItagStr, aItagStr] = formatId.split('+');
              const vItag = parseInt(vItagStr, 10);
              const aItag = parseInt(aItagStr, 10) || 140;

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              videoFormat = info.formats.find((f: any) => f.itag === vItag);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              audioFormat =
                info.formats.find((f: any) => f.itag === aItag) ||
                info.formats.find((f: any) => f.itag === 140) ||
                info.formats.find((f: any) => f.hasAudio);
            } else if (formatId && !isNaN(Number(formatId))) {
              // Exact single format itag requested
              const itag = parseInt(formatId, 10);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              videoFormat = info.formats.find((f: any) => f.itag === itag);
              if (videoFormat && !videoFormat.hasAudio) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                audioFormat = info.formats.find((f: any) => f.itag === 140) || info.formats.find((f: any) => f.hasAudio);
              }
            } else {
              // Fallback quality heuristic
              const isHd = quality === 'hd' || quality === '1080p' || quality === '720p';
              if (isHd) {
                videoFormat =
                  info.formats.find((f: any) => f.hasVideo && (f.qualityLabel?.includes('1080') || f.itag === 137) && f.container === 'mp4') ||
                  info.formats.find((f: any) => f.hasVideo && (f.qualityLabel?.includes('720') || f.itag === 136 || f.itag === 22) && f.container === 'mp4') ||
                  info.formats.find((f: any) => f.hasVideo && f.container === 'mp4') ||
                  info.formats.find((f: any) => f.hasVideo);
              } else {
                videoFormat =
                  info.formats.find((f: any) => f.hasVideo && (f.qualityLabel?.includes('480') || f.itag === 135) && f.container === 'mp4') ||
                  info.formats.find((f: any) => f.hasVideo && (f.qualityLabel?.includes('360') || f.itag === 134 || f.itag === 18) && f.container === 'mp4') ||
                  info.formats.find((f: any) => f.hasVideo && typeof f.height === 'number' && f.height <= 480 && f.container === 'mp4') ||
                  info.formats.find((f: any) => f.hasVideo && f.container === 'mp4') ||
                  info.formats.find((f: any) => f.hasVideo);
              }
              audioFormat =
                info.formats.find((f: any) => f.itag === 140) ||
                info.formats.find((f: any) => f.hasAudio && f.container === 'mp4') ||
                info.formats.find((f: any) => f.hasAudio);
            }

            if (!videoFormat) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Không tìm thấy định dạng video phù hợp trên YouTube.' }));
              return;
            }

            const formatLabel = quality || videoFormat.qualityLabel || 'video';
            const fileName = customFilename || `${cleanTitle}_${formatLabel}.mp4`;
            const tempRawVideo = path.join(os.tmpdir(), `yt_raw_v_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
            const tempRawAudio = path.join(os.tmpdir(), `yt_raw_a_${Date.now()}_${Math.random().toString(36).slice(2)}.m4a`);
            const tempOutMp4 = path.join(os.tmpdir(), `yt_out_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
            tempFilesToClean.push(tempRawVideo, tempRawAudio, tempOutMp4);

            // Download video track (and audio track if separated)
            const downloadPromises: Promise<void>[] = [];

            downloadPromises.push(
              (async () => {
                const vStream = await ytdlInstance.download(targetUrl, { format: videoFormat });
                await new Promise<void>((resolve, reject) => {
                  const ws = fs.createWriteStream(tempRawVideo);
                  vStream.pipe(ws);
                  ws.on('finish', () => resolve());
                  vStream.on('error', reject);
                  ws.on('error', reject);
                });
              })()
            );

            // If format does not have audio, download audio track separately
            const needSeparateAudio = !videoFormat.hasAudio && audioFormat;
            if (needSeparateAudio) {
              downloadPromises.push(
                (async () => {
                  const aStream = await ytdlInstance.download(targetUrl, { format: audioFormat });
                  await new Promise<void>((resolve, reject) => {
                    const ws = fs.createWriteStream(tempRawAudio);
                    aStream.pipe(ws);
                    ws.on('finish', () => resolve());
                    aStream.on('error', reject);
                    ws.on('error', reject);
                  });
                })()
              );
            }

            await Promise.all(downloadPromises);

            // Mux with ffmpeg-static using -movflags +faststart
            const ffmpegArgs = needSeparateAudio
              ? ['-i', tempRawVideo, '-i', tempRawAudio, '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', '-y', tempOutMp4]
              : ['-i', tempRawVideo, '-c', 'copy', '-movflags', '+faststart', '-y', tempOutMp4];

            await new Promise<void>((resolve, reject) => {
              const proc = spawn(ffmpegPath as unknown as string, ffmpegArgs);
              proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg muxing failed with code ${code}`));
              });
              proc.on('error', reject);
            });

            const stats = fs.statSync(tempOutMp4);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Length', stats.size.toString());
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');

            const fileStream = fs.createReadStream(tempOutMp4);
            const cleanup = () => {
              for (const f of tempFilesToClean) {
                try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
              }
            };
            fileStream.on('close', cleanup);
            res.on('finish', cleanup);
            fileStream.pipe(res);
          } catch (err: any) {
            console.error('[YT Stream Error]:', err?.message || err);
            for (const f of tempFilesToClean) {
              try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
            }
            if (!res.headersSent) {
              const isNotFound = err?.message?.includes('unavailable') || err?.code === 'NOT_FOUND';
              res.statusCode = isNotFound ? 404 : 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: false,
                  error: isNotFound
                    ? 'Video YouTube này không tồn tại hoặc đã bị xóa/đặt ở chế độ riêng tư.'
                    : `Lỗi khi xử lý luồng YouTube: ${err?.message || 'Không xác định'}`,
                })
              );
            }
          }
          return;
        }

        next();
      });
    },
  };
}
