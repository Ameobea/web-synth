const path = require('path');

const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const baseConfig = require('./webpack.base');

const ASSET_PATH = process.env.ASSET_PATH || '/';

/**
 * @type {import('webpack').Configuration}
 */
const config = {
  ...baseConfig,
  entry: {
    index: './src/index.tsx',
    fmDemo: './src/fmDemo/index.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash].js',
    publicPath: ASSET_PATH,
  },
  plugins: [
    ...baseConfig.plugins,
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
    new webpack.EnvironmentPlugin({ ASSET_PATH: '/' }),
  ],
};

// module.exports = smp.wrap(config);
module.exports = config;
