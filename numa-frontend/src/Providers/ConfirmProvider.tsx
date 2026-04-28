import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import {
  AlertOptions,
  AlertVariant,
  ConfirmContext,
  ConfirmOptions,
  ConfirmVariant,
  PromptOptions,
} from './ConfirmContext';

type PendingConfirm = ConfirmOptions & {
  kind: 'confirm';
  resolve: (value: boolean) => void;
};

type PendingAlert = AlertOptions & {
  kind: 'alert';
  resolve: () => void;
};

type PendingPrompt = PromptOptions & {
  kind: 'prompt';
  resolve: (value: string | null) => void;
};

type Pending = PendingConfirm | PendingAlert | PendingPrompt;

const ALERT_BUTTON_VARIANT: Record<AlertVariant, string> = {
  info: 'primary',
  success: 'success',
  warning: 'warning',
  error: 'danger',
};

const CONFIRM_BUTTON_VARIANT: Record<ConfirmVariant, string> = {
  primary: 'primary',
  danger: 'danger',
  warning: 'warning',
};

const cancelPrior = (prior: Pending | null) => {
  if (!prior) return;
  if (prior.kind === 'confirm') prior.resolve(false);
  else if (prior.kind === 'prompt') prior.resolve(null);
  else prior.resolve();
};

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation('common');
  const [pending, setPending] = useState<Pending | null>(null);
  const [promptValue, setPromptValue] = useState('');
  // Track the active dialog so a stale onHide (after resolve) cannot double-resolve.
  const activeRef = useRef<Pending | null>(null);

  const dismiss = useCallback(() => {
    activeRef.current = null;
    setPending(null);
    setPromptValue('');
  }, []);

  // Reset the input when a new prompt opens.
  useEffect(() => {
    if (pending?.kind === 'prompt') {
      setPromptValue(pending.defaultValue ?? '');
    }
  }, [pending]);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        cancelPrior(activeRef.current);
        const next: PendingConfirm = { ...options, kind: 'confirm', resolve };
        activeRef.current = next;
        setPending(next);
      }),
    []
  );

  const alert = useCallback(
    (options: AlertOptions) =>
      new Promise<void>((resolve) => {
        cancelPrior(activeRef.current);
        const next: PendingAlert = { ...options, kind: 'alert', resolve };
        activeRef.current = next;
        setPending(next);
      }),
    []
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        cancelPrior(activeRef.current);
        const next: PendingPrompt = { ...options, kind: 'prompt', resolve };
        activeRef.current = next;
        setPending(next);
      }),
    []
  );

  const handleConfirmOk = useCallback(() => {
    const current = activeRef.current;
    if (!current || current.kind !== 'confirm') return;
    current.resolve(true);
    dismiss();
  }, [dismiss]);

  const handlePromptOk = useCallback(() => {
    const current = activeRef.current;
    if (!current || current.kind !== 'prompt') return;
    if (current.required && !promptValue.trim()) return;
    current.resolve(promptValue);
    dismiss();
  }, [dismiss, promptValue]);

  const handleCancel = useCallback(() => {
    const current = activeRef.current;
    cancelPrior(current);
    dismiss();
  }, [dismiss]);

  const value = useMemo(() => ({ confirm, alert, prompt }), [confirm, alert, prompt]);

  const renderBody = (p: Pending) => {
    if (p.kind === 'prompt') {
      return (
        <>
          {p.message != null && <div className="mb-2">{p.message}</div>}
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              handlePromptOk();
            }}
          >
            <Form.Control
              type={p.inputType ?? 'text'}
              autoFocus
              value={promptValue}
              placeholder={p.placeholder}
              onChange={(e) => setPromptValue(e.target.value)}
            />
          </Form>
        </>
      );
    }
    return typeof p.message === 'string' ? <span style={{ whiteSpace: 'pre-wrap' }}>{p.message}</span> : p.message;
  };

  const renderTitle = (p: Pending) => {
    if (p.title) return p.title;
    if (p.kind === 'confirm') return t('confirm.defaultTitle');
    if (p.kind === 'prompt') return t('prompt.defaultTitle');
    return t(`alert.titles.${(p as PendingAlert).variant ?? 'info'}`);
  };

  const renderFooter = (p: Pending) => {
    if (p.kind === 'confirm') {
      return (
        <>
          <Button size="sm" variant="outline-secondary" onClick={handleCancel}>
            {p.cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            size="sm"
            variant={CONFIRM_BUTTON_VARIANT[p.variant ?? 'primary']}
            onClick={handleConfirmOk}
            autoFocus
          >
            {p.confirmLabel ?? t('common.ok')}
          </Button>
        </>
      );
    }
    if (p.kind === 'prompt') {
      const disabled = p.required ? !promptValue.trim() : false;
      return (
        <>
          <Button size="sm" variant="outline-secondary" onClick={handleCancel}>
            {p.cancelLabel ?? t('common.cancel')}
          </Button>
          <Button size="sm" variant="primary" onClick={handlePromptOk} disabled={disabled}>
            {p.confirmLabel ?? t('common.ok')}
          </Button>
        </>
      );
    }
    return (
      <Button size="sm" variant={ALERT_BUTTON_VARIANT[p.variant ?? 'info']} onClick={handleCancel} autoFocus>
        {p.okLabel ?? t('common.ok')}
      </Button>
    );
  };

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <style>{`
        .numa-confirm-backdrop {
          z-index: 1075 !important;
          background-color: rgba(15, 23, 42, 0.45) !important;
        }
        .numa-confirm-backdrop.show {
          opacity: 1 !important;
        }
        .numa-confirm-modal-wrap {
          z-index: 1080 !important;
        }
        .numa-confirm-modal {
          border: none;
          border-radius: 0.5rem;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
        }
      `}</style>
      <Modal
        show={!!pending}
        onHide={handleCancel}
        centered
        backdrop="static"
        keyboard
        className="numa-confirm-modal-wrap"
        backdropClassName="numa-confirm-backdrop"
        contentClassName="numa-confirm-modal"
        data-testid="global-confirm-modal"
      >
        {pending && (
          <>
            <Modal.Header
              closeButton
              style={{
                padding: '0 1rem',
                minHeight: '48px',
                borderBottom: '1px solid #eef0f3',
              }}
            >
              <Modal.Title
                style={{
                  fontFamily: "'Metropolis Semi Bold', sans-serif",
                  fontWeight: 'normal',
                  fontSize: '1rem',
                  lineHeight: 1.3,
                  margin: 0,
                }}
              >
                {renderTitle(pending)}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body
              style={{
                fontFamily: "'Metropolis Regular', sans-serif",
                fontSize: '0.875rem',
                lineHeight: 1.5,
                padding: '0.875rem 1rem',
                color: '#1f2937',
              }}
            >
              {renderBody(pending)}
            </Modal.Body>
            <Modal.Footer
              style={{
                padding: '0 1rem',
                minHeight: '48px',
                borderTop: '1px solid #eef0f3',
                gap: '0.375rem',
              }}
            >
              {renderFooter(pending)}
            </Modal.Footer>
          </>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
};
