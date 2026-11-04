/**
 * Cấu hình liên kết tải xuống Chrome Extension (.zip)
 * Lập trình viên chỉ cần thay đổi 1 dòng này hoặc đặt biến môi trường VITE_EXTENSION_DRIVE_URL trong Vercel.
 */
export const RAW_EXTENSION_DRIVE_URL: string =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_EXTENSION_DRIVE_URL) ||
  'https://drive.google.com/file/d/1X2Riswcl4d-fqjCiSbYfFnaAH4KVxXM5/view?usp=drivesdk';

/**
 * Tự động chuyển đổi link Google Drive dạng chia sẻ sang Direct Download link.
 * Hỗ trợ các định dạng:
 * - https://drive.google.com/file/d/<FILE_ID>/view...
 * - https://drive.google.com/open?id=<FILE_ID>
 * - <FILE_ID> thuần túy
 * - URL trực tiếp ngoài Drive (GitHub Release, CDN, ...) được giữ nguyên.
 */
export function getDirectDriveDownloadUrl(urlOrId: string): string {
  if (!urlOrId || typeof urlOrId !== 'string') return '';
  const trimmed = urlOrId.trim();

  // Nếu là URL ngoài không thuộc Google Drive
  if (!trimmed.includes('drive.google.com') && !trimmed.includes('docs.google.com')) {
    // Nếu là ID thuần (chuỗi 25+ ký tự không chứa dấu gạch chéo '/')
    if (!trimmed.includes('/') && /^[a-zA-Z0-9_-]{25,}$/.test(trimmed)) {
      return `https://drive.google.com/uc?export=download&id=${trimmed}`;
    }
    return trimmed;
  }

  // Bóc tách Google Drive File ID
  const match =
    trimmed.match(/\/d\/([a-zA-Z0-9_-]{25,})/) ||
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]{25,})/) ||
    trimmed.match(/([a-zA-Z0-9_-]{25,})/);

  if (match && match[1]) {
    return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  }

  return trimmed;
}

export const EXTENSION_DOWNLOAD_URL: string = getDirectDriveDownloadUrl(RAW_EXTENSION_DRIVE_URL);

/**
 * URL chính thức của ứng dụng web Cytools
 */
export const CYTOOLS_WEB_URL: string =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_URL) ||
  'https://cytools.io.vn';
