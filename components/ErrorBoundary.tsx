"use client";

import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary:", error, info);
    // Reporte ao Sentry se configurado (NEXT_PUBLIC_SENTRY_DSN)
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      // Import dinâmico pra não pesar o bundle quando Sentry não está
      // ativado. Falha silenciosa se SDK não estiver instalado.
      import("@sentry/nextjs")
        .then((Sentry) => {
          Sentry.captureException(error, {
            contexts: { react: { componentStack: info.componentStack } },
          });
        })
        .catch(() => {});
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-coco-50">
          <div className="card max-w-lg w-full">
            <h1 className="text-2xl font-bold text-coco-900 mb-2">
              Algo deu errado
            </h1>
            <p className="text-coco-700 text-sm mb-4">
              A tela travou em uma exceção. Os dados não foram perdidos —
              recarregue a página pra tentar de novo.
            </p>
            <pre className="text-xs bg-red-50 border border-red-200 rounded-lg p-3 overflow-x-auto text-red-800 mb-4">
              {this.state.error.message}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={() => location.reload()}
                className="btn-primary"
              >
                Recarregar
              </button>
              <button onClick={this.reset} className="btn-ghost">
                Tentar de novo
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
