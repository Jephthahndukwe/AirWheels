import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Builds one self-contained script, dist/airwheels-widget.js, that airlines add to their
 * checkout page. `pnpm dev` serves index.html as a fake airline checkout (the widget host page).
 */
export default defineConfig({
  envDir: '../..',
  resolve: {
    // Bundle the brand tokens from source so the widget stays one small self-contained file.
    alias: { '@airwheels/ui': fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)) },
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'AirwheelsWidget',
      formats: ['iife'],
      fileName: () => 'airwheels-widget.js',
    },
    target: 'es2018',
    minify: true,
  },
  server: { port: 3002 },
});
