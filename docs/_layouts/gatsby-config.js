module.exports = {
  pathPrefix: `/docs`,
  siteMetadata: {
    title: `web synth docs`,
  },
  plugins: [
    {
      resolve: `gatsby-theme-garden`,
      options: {
        rootNote: '/readme',
        contentPath: `${__dirname}/..`,
        ignore: ['**/_layouts/**', '**/.git/**', '**/.github/**', '**/.vscode/**'],
      },
    },
  ],
};
