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
    {
      resolve: `gatsby-plugin-gtag`,
      options: {
        // your google analytics tracking id
        trackingId: `G-B1ES83ZTMR`,
        // Puts tracking script in the head instead of the body
        head: false,
        // enable ip anonymization
        anonymize: false,
      },
    },
    {
      resolve: 'gatsby-plugin-plausible',
      options: {
        domain: 'notes.ameo.design',
        customDomain: 'plausible.ameo.dev',
      },
    },
  ],
};
