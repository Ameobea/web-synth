const path = require('path');

const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const sveltePreprocess = require('svelte-preprocess');
const subcomponentPreprocessor = require('svelte-subcomponent-preprocessor');

const mode = process.env.NODE_ENV || 'development';
const prod = mode === 'production';

const ASSET_PATH = process.env.ASSET_PATH || '/';

/**
 * @type {import('webpack').Configuration}
 */
const config = {
  mode: 'development',
  devtool: 'eval-cheap-module-source-map',
  module: {
    rules: [
      {
        test: /\.(tsx?)|(js)$/,
        exclude: /node_modules/,
        loader: 'babel-loader',
      },
      {
        test: /\.hbs$/,
        use: 'handlebars-loader',
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.scss$/,
        use: [
          {
            loader: 'style-loader',
          },
          {
            loader: 'css-loader',
          },
          {
            loader: 'sass-loader',
            options: {
              sassOptions: {
                includePaths: ['src'],
              },
            },
          },
        ],
      },
      {
        test: /\.svelte$/,
        use: {
          loader: 'svelte-loader',
          options: {
            preprocess: [subcomponentPreprocessor(), sveltePreprocess({ typescript: {} })],
            compilerOptions: {
              dev: !prod,
            },
            emitCss: prod,
            hotReload: !prod,
          },
        },
      },
      {
        // required to prevent errors from Svelte on Webpack 5+
        test: /node_modules\/svelte\/.*\.mjs$/,
        resolve: {
          fullySpecified: false,
        },
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.wasm', '.svelte', '.mjs'],
    modules: [path.resolve('./node_modules'), path.resolve('.')],
    alias: {
      svelte: path.dirname(require.resolve('svelte/package.json')),
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      alwaysWriteToDisk: true,
      title: 'Web Synth - Realtime Browser Audio Synthesis Plaform',
      minify: true,
      template: 'src/index.hbs',
      chunks: ['index'],
    }),
    new HtmlWebpackPlugin({
      alwaysWriteToDisk: true,
      title: 'Rust + Wasm-powered FM Synthesizer',
      minify: true,
      template: 'src/fm-synth-demo.hbs',
      filename: 'fm.html',
      hash: true,
      chunks: ['fmDemo'],
    }),
    new webpack.EnvironmentPlugin(['BACKEND_BASE_URL', 'FAUST_COMPILER_ENDPOINT']),
  ],
  devServer: {
    port: 9000,
    historyApiFallback: true,
    host: '0.0.0.0',
    hot: true,
    client: {
      overlay: {
        warnings: false,
        errors: true,
      },
    },
    headers: {
      // Support sending `SharedArrayBuffer` between threads
      // 'Cross-Origin-Opener-Policy': 'same-origin',
      // 'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  experiments: {
    syncWebAssembly: true,
    backCompat: false,
    outputModule: true,
  },
};

module.exports = config;
