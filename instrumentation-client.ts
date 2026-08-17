import * as Sentry from "@sentry/nextjs";

// Only initializes when NEXT_PUBLIC_SENTRY_DSN is set — safe to leave
// empty locally.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
