// Sentry — edge runtime. Opt-in via SENTRY_DSN.
import * as Sentry from "@sentry/nextjs";
import { sentryBeforeSend } from "./lib/sentryRedact";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV ?? "development",
    beforeSend: sentryBeforeSend,
  });
}
