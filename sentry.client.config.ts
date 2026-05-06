// Sentry — client-side. Inicializa só se NEXT_PUBLIC_SENTRY_DSN estiver
// definido (opt-in). Sem DSN, vira no-op (sem overhead).
//
// Pra ativar:
//   1. Crie um projeto Sentry (free tier: sentry.io)
//   2. Copie o DSN
//   3. Adicione na Vercel: NEXT_PUBLIC_SENTRY_DSN=https://...@.../...
//   4. Redeploy

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  });
}
