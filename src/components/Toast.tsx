import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

type Variant = 'success' | 'error'

interface ToastState {
  message: string
  variant: Variant
  visible: boolean
}

interface ToastContextValue {
  showToast: (message: string, variant?: Variant) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>({ message: '', variant: 'success', visible: false })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string, variant: Variant = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ message, variant, visible: true })
    timerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }))
    }, 2500)
  }, [])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastDisplay toast={toast} />
    </ToastContext.Provider>
  )
}

function ToastDisplay({ toast }: { toast: ToastState }) {
  const bg = toast.variant === 'success' ? 'bg-[#16A34A]' : 'bg-[#DC2626]'
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={`fixed bottom-20 left-1/2 z-50 -translate-x-1/2 px-4 py-2.5 rounded-full text-white text-sm font-medium shadow-lg pointer-events-none transition-all duration-300 ${bg} ${
        toast.visible && toast.message
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-2'
      }`}
    >
      {toast.message}
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
