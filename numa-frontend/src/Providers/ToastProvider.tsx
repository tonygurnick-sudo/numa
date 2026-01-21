import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toast, ToastContainer } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ToastContext } from './ToastContext';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export type ToastOptions = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  autoHideDurationMs?: number;
};

type ToastRecord = ToastOptions & { id: number; variant: ToastVariant };

const DEFAULT_AUTOHIDE_MS: Record<ToastVariant, number> = {
  success: 4000,
  info: 5000,
  warning: 6000,
  error: 8000,
};

type VariantStyle = {
  background: string;
  text: string;
  border: string;
  headerBackground: string;
  headerText: string;
};

const VARIANT_STYLES: Record<ToastVariant, VariantStyle> = {
  success: {
    background: '#edf8f2',
    text: '#0f5132',
    border: '#bce3cc',
    headerBackground: '#d6f1e3',
    headerText: '#0f5132',
  },
  error: {
    background: '#fdecea',
    text: '#611a15',
    border: '#f1aeb5',
    headerBackground: '#f9d5d2',
    headerText: '#611a15',
  },
  warning: {
    background: '#fff4e5',
    text: '#7f4a01',
    border: '#ffd8a8',
    headerBackground: '#ffe4c2',
    headerText: '#7f4a01',
  },
  info: {
    background: '#f2e8f9',
    text: '#4b2d67',
    border: '#d3b3f0',
    headerBackground: '#e4d1f5',
    headerText: '#4b2d67',
  },
};

let idCounter = 0;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const { t } = useTranslation('common');

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(({ title, message, variant = 'info', autoHideDurationMs }: ToastOptions) => {
    if (!message) {
      return;
    }

    const id = ++idCounter;
    setToasts((prev) => [
      ...prev,
      {
        id,
        title,
        message,
        variant,
        autoHideDurationMs: autoHideDurationMs ?? DEFAULT_AUTOHIDE_MS[variant],
      },
    ]);
  }, []);

  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {createPortal(
        <ToastContainer
          position="bottom-end"
          className="position-fixed bottom-0 end-0 p-3"
          style={{ zIndex: 1080, minWidth: '320px', pointerEvents: 'none' }}
          data-testid="global-toast-container"
        >
          {toasts.map((toast) => {
            const style = VARIANT_STYLES[toast.variant] ?? VARIANT_STYLES.info;
            return (
              <Toast
                key={toast.id}
                onClose={() => dismissToast(toast.id)}
                show
                delay={toast.autoHideDurationMs}
                autohide={toast.autoHideDurationMs !== Infinity}
                style={{
                  pointerEvents: 'auto',
                  backgroundColor: style.background,
                  color: style.text,
                  borderColor: style.border,
                  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
                }}
              >
                <Toast.Header
                  closeButton
                  closeVariant="white"
                  style={{
                    backgroundColor: style.headerBackground,
                    color: style.headerText,
                    borderColor: style.border,
                  }}
                >
                  <strong className="me-auto">{toast.title ?? t(`toast.titles.${toast.variant}`)}</strong>
                </Toast.Header>
                <Toast.Body style={{ color: style.text }}>{toast.message}</Toast.Body>
              </Toast>
            );
          })}
        </ToastContainer>,
        document.body,
      )}
    </ToastContext.Provider>
  );
};
