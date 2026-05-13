import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { ToastProvider } from "@/components/Toast";
import RegisterSW from "@/components/RegisterSW";
import ErrorBoundary from "@/components/ErrorBoundary";
import GlobalSearch from "@/components/GlobalSearch";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";

export const metadata: Metadata = {
  title: "Coco da Amazônia · Controle de Vendas",
  description: "Sistema de controle de vendas de coco verde",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Coco",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon.svg" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#1f4d33",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <ErrorBoundary>
          <ToastProvider>
            <AppShell>{children}</AppShell>
            <GlobalSearch />
            <KeyboardShortcuts />
          </ToastProvider>
        </ErrorBoundary>
        <RegisterSW />
      </body>
    </html>
  );
}
