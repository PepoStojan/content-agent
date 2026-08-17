import * as Sentry from "@sentry/nextjs";

// Only initializes when SENTRY_DSN is set — safe to leave empty locally.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
});
