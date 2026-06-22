import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { rolldown } from 'rolldown';
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
    return { code: `export default ${JSON.stringify(svg)};`, moduleType: 'js' };
  },
});

// Bundles `transport.worklet-entry.ts` into a classic script exposing the transport classes on
// `globalThis`, loaded into the AudioWorklet scope via `addModule('transport.js')`.  Served from
// source in dev and emitted at build time, so there's no committed/generated artifact to drift.
const buildTransportWorklet = async (): Promise<string> => {
  const bundle = await rolldown({
    input: resolve(__dirname, 'src/eventScheduler/transport.worklet-entry.ts'),
    logLevel: 'silent',
  });
  const { output } = await bundle.generate({ format: 'iife', name: 'WebSynthTransportBundle' });
  await bundle.close();
  return output[0].code;
};

export const transportWorklet = (): Plugin => ({
  name: 'transport-worklet',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/transport.js') {
        next();
        return;
      }
      buildTransportWorklet().then(
        code => {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(code);
        },
        err => next(err)
      );
    });
  },
  async generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'transport.js', source: await buildTransportWorklet() });
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
    transportWorklet(),
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
    // react-ace is CJS-with-__esModule which the vite 8 dep optimizer no longer auto-detects;
    // without this, its default import resolves to the exports namespace in dev
    optimizeDeps: {
      needsInterop: ['react-ace'],
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
      rolldownOptions: {
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
