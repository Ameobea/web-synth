import * as Sentry from '@sentry/react';
import { Integrations } from '@sentry/tracing';

export const initSentry = () => {
  // Don't clutter up sentry logs with debug stuff
  if (window.location.href.includes('http://localhost')) {
    return;
  }

  Sentry.init({
    dsn: 'https://fe6f2402504d4e2383ff4566e3676cc5@sentry.ameo.design/6',
    integrations: [new Integrations.BrowserTracing()],
    tracesSampleRate: 1.0,
  });
};
