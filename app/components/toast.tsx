"use client"

import { useState, useCallback, useEffect } from "react"
import { CheckCircle, XCircle, Info, X } from "lucide-react"

type ToastType = "success" | "error" | "info"

interface ToastMessage {
  id: number
  type: ToastType
  message: string
}

let _show: ((message: string, type?: ToastType) => void) | null = null

/** Show a toast from anywhere (requires ToastProvider to be mounted). */
export function showToast(message: string, type: ToastType = "info") {
  _show?.(message, type)
}

const ICONS: Record<ToastType, React.ElementType> = {
  success: CheckCircle,
  error:   XCircle,
  info:    Info,
}

const COLORS: Record<ToastType, { bg: string; text: string; icon: string }> = {
  success: { bg: "#f0fdf4", text: "#166534", icon: "#22c55e" },
  error:   { bg: "#fef2f2", text: "#991b1b", icon: "#ef4444" },
  info:    { bg: "var(--brand-pale)", text: "var(--brand-dark)", icon: "var(--brand-primary)" },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [counter, setCounter] = useState(0)

  const show = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, type, message }])
    setCounter(c => c + 1)
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  useEffect(() => { _show = show; return () => { _show = null } }, [show])
  // suppress unused var warning
  void counter

  return (
    <>
      {children}
      {/* Toast container */}
      <div
        style={{ position: "fixed", bottom: "1.5rem", right: "1.5rem", zIndex: 9999 }}
        className="flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map(toast => {
          const Icon   = ICONS[toast.type]
          const colors = COLORS[toast.type]
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium"
              style={{
                background:   colors.bg,
                color:        colors.text,
                borderColor:  colors.icon,
                borderWidth:  "1px",
                minWidth:     "280px",
                maxWidth:     "380px",
              }}
            >
              <Icon size={16} style={{ color: colors.icon, flexShrink: 0 }} />
              <span className="flex-1">{toast.message}</span>
              <button
                className="opacity-50 hover:opacity-100 transition-opacity"
                onClick={() => setToasts(t => t.filter(x => x.id !== toast.id))}
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
