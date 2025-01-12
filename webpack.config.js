const path = require('path');

const webpack = require('webpack');

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
  plugins: [...baseConfig.plugins, new webpack.EnvironmentPlugin({ ASSET_PATH: '/' })],
};

module.exports = config;
