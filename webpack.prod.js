const config = require('./webpack.config');

module.exports = {
  ...config,
  mode: 'production',
  devtool: 'source-map',
};
