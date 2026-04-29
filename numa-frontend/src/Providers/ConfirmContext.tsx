import { createContext, useContext, type ReactNode } from 'react';

export type ConfirmVariant = 'primary' | 'danger' | 'warning';

export type ConfirmOptions = {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
};

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

export type AlertOptions = {
  title?: string;
  message: ReactNode;
  okLabel?: string;
  variant?: AlertVariant;
};

export type PromptOptions = {
  title?: string;
  message?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: 'text' | 'url' | 'email';
  required?: boolean;
};

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

export const ConfirmContext = createContext<ConfirmContextValue | undefined>(undefined);

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx.confirm;
};

export const useAlert = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useAlert must be used within a ConfirmProvider');
  return ctx.alert;
};

export const usePrompt = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('usePrompt must be used within a ConfirmProvider');
  return ctx.prompt;
};
