"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "success" | "error" | "info" | "warn";
type Toast = { id: number; kind: ToastKind; message: string };

type Ctx = {
  push: (kind: ToastKind, message: string) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
  warn: (m: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++counter;
    setList((arr) => [...arr, { id, kind, message }]);
    setTimeout(() => {
      setList((arr) => arr.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const value: Ctx = {
    push,
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
    warn: (m) => push("warn", m),
  };

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-[100] space-y-2 pointer-events-none">
        {list.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl shadow-lg px-4 py-3 max-w-sm text-sm font-medium border ${kindClass(
              t.kind
            )}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function kindClass(k: ToastKind) {
  switch (k) {
    case "success":
      return "bg-green-50 border-green-200 text-green-800";
    case "error":
      return "bg-red-50 border-red-200 text-red-800";
    case "warn":
      return "bg-amber-50 border-amber-200 text-amber-800";
    default:
      return "bg-coco-50 border-coco-200 text-coco-800";
  }
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast deve estar dentro do <ToastProvider>");
  return ctx;
}
