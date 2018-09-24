const path = require('path');

const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
  },
  mode: 'development',
  devtool: 'inline-source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.hbs$/,
        use: 'handlebars-loader',
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.tsx', '.js', '.wasm'],
    modules: [path.resolve('./node_modules'), path.resolve('.')],
  },
  plugins: [
    new HtmlWebpackPlugin({
      alwaysWriteToDisk: true,
      title: 'Untitled Sketch',
      minify: true,
      template: 'index.hbs',
    }),
  ],
};
