const path = require('path');

const webpack = require('webpack');

const baseConfig = require('./webpack.base');

const ASSET_PATH = process.env.ASSET_PATH || 'https://ameo.dev/web-synth-headless/';

/**
 * @type {import('webpack').Configuration}
 */
const config = {
  ...baseConfig,
  entry: './src/headless/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist/headless'),
    filename: 'headless.js',
    publicPath: ASSET_PATH,
    library: {
      type: 'modern-module',
    },
  },
  plugins: [
    new webpack.EnvironmentPlugin(['BACKEND_BASE_URL', 'FAUST_COMPILER_ENDPOINT']),
    new webpack.EnvironmentPlugin({ ASSET_PATH }),
  ],
  mode: 'production',
  devtool: 'source-map',
  experiments: {
    ...(baseConfig.experiments || {}),
    outputModule: true,
  },
};

module.exports = config;
