import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { socialDownloadProxyPlugin } from './src/server/socialExtractor.ts';

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    socialDownloadProxyPlugin(),
  ],
  server: {
    host: true, // Listen on 0.0.0.0 to expose the dev server to the LAN for mobile testing
    allowedHosts: true, // Allow all hosts through tunnels (Ngrok, Cloudflare Tunnel, custom domains)
    cors: true, // Allow cross-origin requests for webhooks & tunneled access
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: {
      '/api/download': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/info': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    allowedHosts: true,
    cors: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@huggingface/transformers'],
  },
});
