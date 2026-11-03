import type { ImageDetectionBox } from '../types/watermarkRemover';

/**
 * Client-Side Watermark & Logo Overlay Detector
 * Analyzes local Sobel edge density and high-frequency luminance gradients
 * across corner zones, bottom footer bars, and central overlay banners.
 */
export function detectWatermarkRegions(
  imageData: ImageData
): { boxes: ImageDetectionBox[]; maskImageData: ImageData } {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  // 1. Convert to 8-bit grayscale luminance
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }

  // 2. Compute 3x3 Sobel edge gradient magnitude
  const edges = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      // Sobel horizontal
      const gx =
        -gray[idx - width - 1] +
        gray[idx - width + 1] -
        2 * gray[idx - 1] +
        2 * gray[idx + 1] -
        gray[idx + width - 1] +
        gray[idx + width + 1];

      // Sobel vertical
      const gy =
        -gray[idx - width - 1] -
        2 * gray[idx - width] -
        gray[idx - width + 1] +
        gray[idx + width - 1] +
        2 * gray[idx + width] +
        gray[idx + width + 1];

      const mag = Math.min(255, Math.hypot(gx, gy));
      edges[idx] = mag;
    }
  }

  // 3. Define candidate zones for watermarks
  // Common zones: bottom-right (TikTok, CapCut, Bilibili), bottom-left, top-right, top-left, center banner
  const candidateZones = [
    // Bottom-Right Corner (Primary target for 80% of video/image platforms)
    {
      x1: Math.floor(width * 0.65),
      y1: Math.floor(height * 0.8),
      x2: width - 1,
      y2: height - 1,
      label: 'Góc dưới phải (Logo / Chữ ký)',
    },
    // Bottom-Left Corner
    {
      x1: 0,
      y1: Math.floor(height * 0.82),
      x2: Math.floor(width * 0.35),
      y2: height - 1,
      label: 'Góc dưới trái (Watermark / Timestamp)',
    },
    // Top-Right Corner
    {
      x1: Math.floor(width * 0.7),
      y1: 0,
      x2: width - 1,
      y2: Math.floor(height * 0.2),
      label: 'Góc trên phải (Logo kênh)',
    },
    // Top-Left Corner
    {
      x1: 0,
      y1: 0,
      x2: Math.floor(width * 0.3),
      y2: Math.floor(height * 0.2),
      label: 'Góc trên trái (Badge)',
    },
    // Center Diagonal Banner (Stock photos, sample stamps)
    {
      x1: Math.floor(width * 0.2),
      y1: Math.floor(height * 0.35),
      x2: Math.floor(width * 0.8),
      y2: Math.floor(height * 0.65),
      label: 'Vùng trung tâm (Dấu chìm bản quyền)',
    },
  ];

  // Output mask where 255 = inpaint target, 0 = keep
  const mask = new Uint8Array(width * height);
  const detectedBoxes: ImageDetectionBox[] = [];

  for (const zone of candidateZones) {
    const zoneW = zone.x2 - zone.x1;
    const zoneH = zone.y2 - zone.y1;
    if (zoneW <= 10 || zoneH <= 10) continue;

    // Calculate edge energy & high-frequency count in this zone
    let edgeCount = 0;
    let minX = zone.x2;
    let minY = zone.y2;
    let maxX = zone.x1;
    let maxY = zone.y1;

    for (let y = zone.y1; y <= zone.y2; y++) {
      for (let x = zone.x1; x <= zone.x2; x++) {
        const idx = y * width + x;
        if (edges[idx] > 65) {
          edgeCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const zoneArea = zoneW * zoneH;
    const edgeDensity = edgeCount / zoneArea;

    // If edge density shows clustered high-frequency detail consistent with text/logo overlays
    if (edgeDensity > 0.03 && edgeCount > 30 && maxX > minX && maxY > minY) {
      // Add padding around detected watermark cluster
      const pad = 6;
      const bX = Math.max(0, minX - pad);
      const bY = Math.max(0, minY - pad);
      const bW = Math.min(width - bX, maxX - minX + pad * 2);
      const bH = Math.min(height - bY, maxY - minY + pad * 2);

      // Fill mask in the detected bounding box
      for (let y = bY; y < bY + bH; y++) {
        for (let x = bX; x < bX + bW; x++) {
          const idx = y * width + x;
          mask[idx] = 255;
        }
      }

      detectedBoxes.push({
        x: bX,
        y: bY,
        width: bW,
        height: bH,
        label: zone.label,
        confidence: Math.min(0.98, Math.round(edgeDensity * 200) / 100),
      });
    }
  }

  // 4. Perform simple morphological dilation (radius 3) on the mask
  // to ensure anti-aliased character edges are fully encapsulated
  const dilatedMask = new Uint8Array(width * height);
  const r = 3;
  for (let y = r; y < height - r; y++) {
    for (let x = r; x < width - r; x++) {
      const idx = y * width + x;
      if (mask[idx] === 255) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            dilatedMask[(y + dy) * width + (x + dx)] = 255;
          }
        }
      }
    }
  }

  // 5. Create final RGBA ImageData for mask canvas
  // Color: semi-transparent neon pink rgba(236, 72, 153, 0.5)
  const maskImageData = new ImageData(width, height);
  const mData = maskImageData.data;
  for (let i = 0, j = 0; i < mData.length; i += 4, j++) {
    if (dilatedMask[j] === 255) {
      mData[i] = 236; // R
      mData[i + 1] = 72; // G
      mData[i + 2] = 153; // B
      mData[i + 3] = 130; // A ~ 50%
    } else {
      mData[i] = 0;
      mData[i + 1] = 0;
      mData[i + 2] = 0;
      mData[i + 3] = 0;
    }
  }

  return { boxes: detectedBoxes, maskImageData };
}
