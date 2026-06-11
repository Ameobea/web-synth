import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sentryVitePlugin } from '@sentry/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { sveltePreprocess } from 'svelte-preprocess';
import { defineConfig, loadEnv, type Plugin, type PluginOption } from 'vite';

// Replaces <!--inline-css:file.css--> placeholders with the contents of public/<file>
const inlineCSS = (): Plugin => ({
  name: 'inline-css-placeholders',
  transformIndexHtml: html =>
    html.replace(/<!--inline-css:([^>]+)-->/g, (_m, file) =>
      readFileSync(resolve(__dirname, 'public', file.trim()), 'utf8')
    ),
});

// Default import of .svg returns the markup as a string, with width/height stripped from
// the root tag so icons size to their containers (svg-inline-loader parity)
export const svgRaw = (): Plugin => ({
  name: 'svg-raw',
  enforce: 'pre',
  load(id) {
    const path = id.split('?')[0];
    if (!path.endsWith('.svg')) {
      return null;
    }
    const svg = readFileSync(path, 'utf8').replace(
      /<svg([^>]*)>/,
      (_m, attrs) => `<svg${attrs.replace(/\s(?:width|height)="[^"]*"/g, '')}>`
    );
    return `export default ${JSON.stringify(svg)};`;
  },
});

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, __dirname, ''), ...process.env };

  const plugins: PluginOption[] = [
    svelte({ preprocess: [sveltePreprocess({ typescript: {} })] }),
    svgRaw(),
    inlineCSS(),
  ];
  if (mode === 'production' && env.SENTRY_AUTH_TOKEN) {
    plugins.push(
      sentryVitePlugin({
        authToken: env.SENTRY_AUTH_TOKEN,
        org: 'sentry',
        project: 'web-synth',
        url: 'https://sentry.ameo.design/',
      })
    );
  }

  return {
    plugins,
    resolve: {
      alias: { src: resolve(__dirname, 'src') },
    },
    // Large JSON (init-composition) ships as JSON.parse("...") which parses faster than an object literal
    json: { stringify: true, namedExports: false },
    define: {
      'process.env.ASSET_PATH': JSON.stringify(env.ASSET_PATH || '/'),
      'process.env.BACKEND_BASE_URL': JSON.stringify(env.BACKEND_BASE_URL || ''),
      'process.env.FAUST_COMPILER_ENDPOINT': JSON.stringify(env.FAUST_COMPILER_ENDPOINT || ''),
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          fm: resolve(__dirname, 'fm.html'),
        },
      },
    },
    worker: {
      format: 'es' as const,
    },
    server: {
      port: 9000,
      strictPort: true,
      host: true,
      headers: crossOriginIsolationHeaders,
    },
    preview: {
      port: 9000,
      strictPort: true,
      headers: crossOriginIsolationHeaders,
    },
  };
});
