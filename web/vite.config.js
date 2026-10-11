import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

// "npm run dev:phones" serves over HTTPS on the local network, so real phones on the same Wi-Fi can use their cameras.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'phones' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,json,woff2}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
      manifest: {
        name: 'FloodLens',
        short_name: 'FloodLens',
        description: 'Offline-first road-condition evidence for floods and landslides',
        theme_color: '#0a0f13',
        background_color: '#0a0f13',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  server: { port: mode === 'phones' ? 5443 : 5173, proxy: { '/api': { target: process.env.FLOODLENS_API || 'http://localhost:8787', rewrite: (p) => p.replace(/^\/api/, '') } } },
}));
