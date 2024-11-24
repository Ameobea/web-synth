import fs from 'fs';

import { defineConfig } from 'cypress';

export default defineConfig({
  projectId: 'gahph7',
  e2e: {
    specPattern: 'cypress/e2e/**/*.{js,jsx,ts,tsx}',
    // delete videos for tests without errors
    setupNodeEvents(on, _config) {
      on('after:spec', (_spec: Cypress.Spec, results: CypressCommandLine.RunResult) => {
        if (results && results.video) {
          // Do we have failures for any retry attempts?
          const failures = results.tests.some(test =>
            test.attempts.some(attempt => attempt.state === 'failed')
          );
          if (!failures) {
            // delete the video if the spec passed and no tests retried
            fs.unlinkSync(results.video);
          }
        }
      });
    },
  },
  viewportWidth: 1920,
  viewportHeight: 1080,
  video: true,
});
