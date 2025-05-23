const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const { sentryWebpackPlugin } = require('@sentry/webpack-plugin');

const config = require('./webpack.config');

module.exports = {
  ...config,
  mode: 'production',
  devtool: 'source-map',
  plugins: [
    ...config.plugins,
    // new BundleAnalyzerPlugin(),
    sentryWebpackPlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: 'sentry',
      project: 'web-synth',
      url: 'https://sentry.ameo.design/',
    }),
  ],
};
