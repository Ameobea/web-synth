const path = require(`path`);

exports.onCreateWebpackConfig = ({ actions }) => {
  const installedBabelRuntime = path.dirname(
    require.resolve(`@babel/runtime/package.json`)
  );
  const legacyBabelRuntimePath = path.join(
    __dirname,
    `node_modules`,
    `babel-preset-gatsby`,
    `node_modules`,
    `@babel`,
    `runtime`
  );

  actions.setWebpackConfig({
    resolve: {
      alias: {
        // Older Gatsby dependency transpilation can emit this stale absolute path
        // when @babel/runtime gets hoisted to the project root.
        [legacyBabelRuntimePath]: installedBabelRuntime,
      },
    },
  });
};
