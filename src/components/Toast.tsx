import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

type Variant = 'success' | 'error'

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastState {
  message: string
  variant: Variant
  visible: boolean
  action?: ToastAction
  progress?: number // 0–100, shows slim progress bar when set
}

interface ToastContextValue {
  showToast: (message: string, variant?: Variant, action?: ToastAction, progress?: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>({ message: '', variant: 'success', visible: false })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string, variant: Variant = 'success', action?: ToastAction, progress?: number) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ message, variant, visible: true, action, progress })
    timerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false, action: undefined, progress: undefined }))
    }, action ? 5000 : 2500)
  }, [])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastDisplay toast={toast} onDismiss={() => setToast((prev) => ({ ...prev, visible: false, action: undefined, progress: undefined }))} />
    </ToastContext.Provider>
  )
}

function ToastDisplay({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const bg = toast.variant === 'success' ? '#F4623A' : '#DC2626'
  const hasAction = !!toast.action
  const hasProgress = toast.progress != null

  return (
    <div aria-live="polite" aria-atomic="true" className="pointer-events-none fixed bottom-20 left-0 right-0 z-50 flex justify-center">
      <AnimatePresence>
        {toast.visible && toast.message && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, scale: 0.88, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 10 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className={`pointer-events-auto text-white text-sm font-medium shadow-lg ${
              hasProgress ? 'rounded-2xl px-4 pt-2.5 pb-3 min-w-[200px] max-w-[320px]' : 'rounded-full px-4 py-2.5 max-w-[300px]'
            }`}
            style={{ background: bg }}
          >
            <div className={hasAction ? 'flex items-center gap-3' : ''}>
              <span className="leading-snug">{toast.message}</span>
              {hasAction && toast.action && (
                <button
                  onClick={() => { toast.action!.onClick(); onDismiss() }}
                  className="text-white/80 text-xs font-semibold shrink-0 underline underline-offset-2 hover:text-white focus:outline-none"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            {hasProgress && (
              <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.25)' }}>
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${toast.progress}%`, background: 'rgba(255,255,255,0.9)' }}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
