import { resolve } from 'node:path';

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { sveltePreprocess } from 'svelte-preprocess';
import { defineConfig, loadEnv } from 'vite';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

import { svgRaw } from './vite.config.mts';

const ASSET_PATH = process.env.ASSET_PATH || 'https://ameo.dev/web-synth-headless/';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, __dirname, ''), ...process.env };

  return {
    plugins: [
      svelte({ preprocess: [sveltePreprocess({ typescript: {} })] }),
      svgRaw(),
      cssInjectedByJsPlugin(),
    ],
    resolve: {
      alias: { src: resolve(__dirname, 'src') },
    },
    json: { stringify: true, namedExports: false },
    publicDir: false,
    base: ASSET_PATH,
    define: {
      'process.env.ASSET_PATH': JSON.stringify(ASSET_PATH),
      'process.env.BACKEND_BASE_URL': JSON.stringify(env.BACKEND_BASE_URL || ''),
      'process.env.FAUST_COMPILER_ENDPOINT': JSON.stringify(env.FAUST_COMPILER_ENDPOINT || ''),
    },
    worker: {
      format: 'es' as const,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      outDir: 'dist/headless',
      rollupOptions: {
        input: resolve(__dirname, 'src/headless/index.tsx'),
        preserveEntrySignatures: 'exports-only' as const,
        output: {
          format: 'es' as const,
          entryFileNames: 'headless.js',
        },
      },
    },
  };
});
