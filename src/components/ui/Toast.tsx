"use client";

import { AlertTriangle, Check, X } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastTone = "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4000;

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, tone: ToastTone = "success") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        // Clears MemberBottomNav's fixed mobile tab bar (+ safe area) so a
        // toast never covers it or the primary action above it; md: resets
        // to the original tight corner offset once that bar is md:hidden.
        className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px)+1rem)] z-[var(--z-toast)] flex flex-col gap-2 md:inset-x-auto md:right-4 md:bottom-4 md:w-full md:max-w-xs"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${
              t.tone === "success" ? "border-line bg-ink text-white" : "border-alert bg-alert text-white"
            }`}
          >
            {t.tone === "success" ? (
              <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            )}
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded p-0.5 hover:bg-white/20"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
