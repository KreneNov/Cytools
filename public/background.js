// Background Service Worker for Cytools Chrome Extension (Manifest V3)
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  console.log('[Cytools Extension] Background service worker activated.');
});

// Relay API requests to bypass strict CORS if direct popup fetch encounters restrictions
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.type === 'CYTOOLS_PROXY_FETCH') {
    const { url, options = {} } = request;

    fetch(url, options)
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
          error: error instanceof Error ? error.message : 'Lỗi kết nối mạng qua Background Service Worker.',
        });
      });

    // Return true to keep message channel open for asynchronous sendResponse
    return true;
  }
});
