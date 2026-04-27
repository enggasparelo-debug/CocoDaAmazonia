"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import MobileNav from "./MobileNav";

const FULLSCREEN_PATHS = ["/login", "/recibo"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const fullscreen = FULLSCREEN_PATHS.some((p) => path.startsWith(p));

  if (fullscreen) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar />
      <MobileNav />
      <main className="flex-1 p-4 md:p-10 max-w-7xl mx-auto w-full pt-20 md:pt-10">
        {children}
      </main>
    </div>
  );
}
