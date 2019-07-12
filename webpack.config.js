const path = require('path');

const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
  },
  mode: 'development',
  devtool: 'inline-source-map',
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
    ],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.wasm'],
    modules: [path.resolve('./node_modules'), path.resolve('.')],
    alias: {
      Tone: path.resolve('./node_modules/tone/Tone'),
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      alwaysWriteToDisk: true,
      title: 'Chords',
      minify: true,
      template: 'index.hbs',
    }),
    new webpack.EnvironmentPlugin(['BACKEND_BASE_URL']),
  ],
  devServer: {
    port: 9000,
    contentBase: './public/',
  },
};
