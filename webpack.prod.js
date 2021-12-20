const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

const config = require('./webpack.config');

module.exports = {
  ...config,
  mode: 'production',
  devtool: 'source-map',
  // plugins: [...config.plugins, new BundleAnalyzerPlugin()],
};
