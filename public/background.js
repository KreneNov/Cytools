// Background Service Worker for Cytools Chrome Extension (Manifest V3)
const PRODUCTION_ORIGIN = 'https://cytools.io.vn';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  console.log('[Cytools Extension] Background service worker activated for', PRODUCTION_ORIGIN);
});

function isAllowedExternalOrigin(urlOrOrigin) {
  if (!urlOrOrigin || typeof urlOrOrigin !== 'string') return false;
  try {
    const parsed = new URL(urlOrOrigin);
    return (
      parsed.hostname === 'cytools.io.vn' ||
      parsed.hostname.endsWith('.cytools.io.vn') ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

function relayFetchRequest(request, sendResponse) {
  const { url, options = {} } = request;
  const targetUrl =
    typeof url === 'string' && url.startsWith('/')
      ? `${PRODUCTION_ORIGIN}${url}`
      : url;

  fetch(targetUrl, options)
    .then(async (response) => {
      const contentType = response.headers.get('content-type') || '';
      let bodyData;

      if (contentType.includes('application/json')) {
        try {
          bodyData = await response.json();
        } catch {
          bodyData = null;
        }
      } else {
        try {
          bodyData = await response.text();
        } catch {
          bodyData = null;
        }
      }

      sendResponse({
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
        data: bodyData,
      });
    })
    .catch((error) => {
      sendResponse({
        success: false,
        status: 0,
        statusText: 'Network Error',
        error:
          error instanceof Error
            ? error.message
            : 'Lỗi kết nối mạng qua Background Service Worker.',
      });
    });
}

// Relay API requests to bypass strict CORS if direct popup fetch encounters restrictions
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request && request.type === 'CYTOOLS_PROXY_FETCH') {
    relayFetchRequest(request, sendResponse);
    return true;
  }
  return false;
});

// Support externally_connectable messages from https://cytools.io.vn and https://*.cytools.io.vn
if (chrome.runtime && chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    const senderOrigin = sender?.origin || sender?.url || '';
    if (!isAllowedExternalOrigin(senderOrigin)) {
      sendResponse({
        success: false,
        status: 403,
        error: 'Origin not authorized',
      });
      return false;
    }

    if (request && request.type === 'CYTOOLS_PING') {
      sendResponse({
        success: true,
        installed: true,
        origin: PRODUCTION_ORIGIN,
      });
      return false;
    }

    if (request && request.type === 'CYTOOLS_PROXY_FETCH') {
      relayFetchRequest(request, sendResponse);
      return true;
    }

    return false;
  });
}
