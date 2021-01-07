const path = require('path');

const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: {
    index: './src/index.tsx',
    fmDemo: './src/fmDemo/index.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash].js',
    publicPath: '/',
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
    ],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.wasm'],
    modules: [path.resolve('./node_modules'), path.resolve('.')],
    alias: {},
  },
  plugins: [
    new HtmlWebpackPlugin({
      alwaysWriteToDisk: true,
      title: 'Web Synth',
      minify: true,
      template: 'index.hbs',
      chunks: ['index'],
    }),
    new HtmlWebpackPlugin({
      alwaysWriteToDisk: true,
      title: 'Rust/Wasm FM Synth',
      minify: true,
      injdex: true,
      template: 'fm-synth-demo.hbs',
      filename: 'fm.html',
      hash: true,
      chunks: ['fmDemo'],
    }),
    new webpack.EnvironmentPlugin(['BACKEND_BASE_URL', 'FAUST_COMPILER_ENDPOINT']),
  ],
  devServer: {
    port: 9000,
    contentBase: './public/',
    historyApiFallback: true,
  },
  experiments: {
    syncWebAssembly: true,
  },
};
