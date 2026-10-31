import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the project under /tumble-trail/; pages.yml sets VITE_BASE for that.
const base = process.env.VITE_BASE ?? '/';
// The parent menu shows the version from package.json as plain text.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Rapier's WASM is embedded as base64 (rapier3d-compat), so the single JS chunk is large by design.
    chunkSizeWarningLimit: 6000,
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/apple-touch-icon-180.png'],
      manifest: {
        name: 'Tumble Trail',
        short_name: 'Tumble Trail',
        description: 'A gentle rolling-ball game for little hands.',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        background_color: '#bfe6ff',
        theme_color: '#bfe6ff',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        globIgnores: ['**/*.map'],
        // The bundle includes Rapier's base64 WASM, well above workbox's 2 MiB default.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
