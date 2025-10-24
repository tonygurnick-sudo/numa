import { createContext, useContext } from 'react';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

type ShowToastOptions = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  autoHideDurationMs?: number;
};

type ToastContextValue = {
  showToast: (options: ShowToastOptions) => void;
};

export const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
