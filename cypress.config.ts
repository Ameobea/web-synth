import { defineConfig } from 'cypress'

export default defineConfig({
  projectId: 'gahph7',
  e2e: {
    setupNodeEvents(on, config) {},
    specPattern: 'cypress/e2e/**/*.{js,jsx,ts,tsx}',
  },
})
