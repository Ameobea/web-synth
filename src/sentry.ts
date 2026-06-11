import {
  addBreadcrumb,
  captureException,
  captureMessage,
  init,
  setContext,
} from '@sentry/browser';

const SentryAPI = { addBreadcrumb, captureException, captureMessage, setContext };

export const getSentry = (): typeof SentryAPI | undefined => {
  // Don't clutter up sentry logs with debug stuff
  if (window.location.href.includes('http://localhost')) {
    return undefined;
  }
  return SentryAPI;
};

export const initSentry = () => {
  // Don't clutter up sentry logs with debug stuff
  if (window.location.href.includes('http://localhost')) {
    return;
  }

  init({
    dsn: 'https://013dd3a6743b7aec9a2e165574202833@sentry.ameo.design/14',
    beforeBreadcrumb: (breadcrumb, hint) => {
      if (breadcrumb.category === 'ui.click') {
        const target = hint?.event?.target as HTMLElement;
        if (target) {
          // append all `data-` attributes to the breadcrumb
          const dataAttributes = Object.keys(target.dataset).map(key => [key, target.dataset[key]]);
          for (const [key, val] of dataAttributes) {
            breadcrumb.message += `[data-${key}="${val}"]`;
          }
        }
      }
      return breadcrumb;
    },
  });
};

export const logError = (msg: string, err?: any) => {
  console.error(msg, err);
  const sentry = getSentry();
  if (sentry) {
    if (err) {
      sentry.captureException(err);
    } else {
      sentry.captureMessage(msg, 'error');
    }
  }
};
