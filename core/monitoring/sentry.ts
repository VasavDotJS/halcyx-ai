import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { scrubString } from '@/core/security/scrub';
import { setErrorSink } from './report';
import { type ScrubbableEvent, scrubEvent } from './scrubEvent';

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
    beforeSend: (event) => scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
  });
  setErrorSink((where, message) => Sentry.captureMessage(message, { level: 'warning', tags: { where } }));
}

export { Sentry };
