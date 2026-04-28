import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { ToastProvider } from "@/components/Toast";
import RegisterSW from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "Coco da Amazônia · Controle de Vendas",
  description: "Sistema de controle de vendas de coco verde",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Coco da Amazônia",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#1f4d33",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
