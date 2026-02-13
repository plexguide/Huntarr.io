import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'static/js/dist',
    emptyOutDir: false, // Don't erase existing bundles
    lib: {
      entry: resolve(__dirname, 'static/js/modules/features/requestarr/requestarr-entry.js'),
      name: 'RequestarrBundle',
      fileName: () => 'requestarr-bundle.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
  },
});
