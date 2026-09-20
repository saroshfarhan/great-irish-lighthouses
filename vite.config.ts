import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
// Vitest's defineConfig, not Vite's — Vite's does not know about the `test` key.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // MapLibre loads its tile-parsing worker via `new Worker(new URL(...))`. When
  // Vite pre-bundles maplibre-gl, that URL is rewritten to a path inside
  // .vite/deps that is never emitted, so the worker 404s. MapLibre then waits
  // for a worker that will never answer: no style loads, no 'load' event fires,
  // and — the part that made this slow to find — no error is raised either.
  // Excluding it from the optimiser makes the worker resolve against real files.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },

  worker: {
    format: 'es',
  },

  build: {
    // NO `manualChunks`. This has now bitten twice and both times silently:
    //
    //  1. Naming `three` made Rollup treat it as an eager entry, shipping
    //     ~194 KiB of Three.js on first load even though nothing imports it
    //     until a station is clicked.
    //  2. Naming `maplibre-gl` stopped Vite emitting MapLibre's tile-parsing
    //     worker into dist/. The bundle still referenced
    //     `maplibre-gl-worker.mjs`, the request fell through to the SPA's
    //     index.html, the browser rejected it for a `text/html` MIME type, and
    //     the basemap never rendered — in production builds only.
    //
    // The caching gain was never worth this. Let Rollup chunk it.
    // MapLibre minifies to ~1.02 MB on its own and there is nothing we can do
    // about that short of replacing the renderer, so the default 500 kB advisory
    // fires on every build with no action available. The figure actually worth
    // watching is the gzipped total (~357 kB), tracked in CLAUDE.md's budget.
    chunkSizeWarningLimit: 1100,
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
