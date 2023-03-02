const path = require('path');

const webpack = require('webpack');

const baseConfig = require('./webpack.base');

const ASSET_PATH = process.env.ASSET_PATH || 'https://ameo.dev/web-synth-headless/';

/**
 * @type {import('webpack').Configuration}
 */
const config = {
  ...baseConfig,
  entry: {
    headless: {
      import: './src/headless/index.tsx',
      library: {
        // name: 'web-synth-headless',
        type: 'module',
      },
    },
  },
  output: {
    path: path.resolve(__dirname, 'dist/headless'),
    // filename: '[name].[contenthash].js',
    filename: '[name].js',
    publicPath: ASSET_PATH,
    library: {
      // name: 'web-synth-headless',
      type: 'module',
    },
    libraryTarget: 'module',
  },
  plugins: [...baseConfig.plugins, new webpack.EnvironmentPlugin({ ASSET_PATH })],
  mode: 'production',
  devtool: 'source-map',
  experiments: {
    ...(baseConfig.experiments || {}),
    outputModule: true,
  },
};

module.exports = config;
