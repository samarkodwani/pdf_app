import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE is set by the GitHub Pages workflow (e.g. "/pdf_app/"); "/" for local dev.
const base = process.env.BASE || '/';

export default defineConfig({
  base,
  // Explicit config stops PostCSS searching parent dirs (a stray empty ~/package.json breaks its JSON loader).
  css: { postcss: {} },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,mjs}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'PDF Reader',
        short_name: 'PDF Reader',
        description: 'Reflow any PDF into phone-friendly text',
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [{ src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
        share_target: {
          action: base + 'share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'pdf', accept: ['application/pdf', '.pdf'] }] },
        },
      },
    }),
  ],
});
