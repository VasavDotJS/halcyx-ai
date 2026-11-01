import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { scrubString, scrubValue } from '@/core/security/scrub';

/**
 * Crash reporting with aggressive scrubbing: no request bodies, no breadcrumbs carrying
 * HTTP data, and every string passed through the key/source scrubber.
 */
export function initSentry(): void {
  const dsn = (Constants.expoConfig?.extra as { sentryDsn?: string } | undefined)?.sentryDsn;
  if (!dsn) return;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    attachStacktrace: true,
    tracesSampleRate: 0.05,
    maxBreadcrumbs: 30,
    beforeBreadcrumb(b) {
      if (b.category === 'fetch' || b.category === 'xhr' || b.category === 'console') return null;
      return { ...b, message: b.message ? scrubString(b.message) : b.message, data: undefined };
    },
    beforeSend(event) {
      if (event.message) event.message = scrubString(event.message);
      for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrubString(ex.value);
      delete event.request;
      event.extra = scrubValue(event.extra) as typeof event.extra;
      event.contexts = scrubValue(event.contexts) as typeof event.contexts;
      return event;
    },
  });
}

export { Sentry };
