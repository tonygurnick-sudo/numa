import React, { useState, useEffect } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface ReasonInputConfig {
  /** Label shown above the textarea — defaults to "Reason (optional)". */
  label?: string;
  /** Placeholder for the textarea. */
  placeholder?: string;
  /** When true, blocks the confirm button until the user types something. */
  required?: boolean;
  /** Max characters; defaults to 500 to match the server-side schema cap. */
  maxLength?: number;
  /** Render as multi-line `textarea` (default true) or single-line `text`. */
  multiline?: boolean;
}

interface ConfirmModalProps {
  show: boolean;
  onHide: () => void;
  /**
   * Called when the user confirms. Receives the reason text when
   * `reasonInput` is configured; absent otherwise. Plain-confirm callers may
   * declare `() => void` and ignore the arg.
   */
  onConfirm: (reason?: string) => void;
  title?: string;
  message?: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info' | 'primary' | 'success';
  /**
   * When set, requires the user to type the exact value before confirming —
   * use for high-blast-radius destructive actions (e.g. delete-by-name).
   */
  typeToConfirm?: string;
  /**
   * When set, renders an extra text input (textarea by default) and passes
   * the value to `onConfirm`. Use to replace `window.prompt`-style flows
   * where the action needs a reason (e.g. admin-lock, admin-pause-with-note).
   */
  reasonInput?: ReasonInputConfig;
  /**
   * When true, suppresses the danger-variant "this cannot be undone"
   * boilerplate. Useful for destructive-but-recoverable actions like
   * pause / lock where the warning is misleading.
   */
  suppressDeleteWarning?: boolean;
}

/**
 * Generic confirmation modal. Replaces native `window.confirm` and
 * `window.prompt` (which block the JS thread, are unstyled, are screen-
 * reader hostile, and provide no character-count or validation hints for
 * input).
 *
 * Three modes:
 *   - **Plain confirm**: just show a message, get a yes/no.
 *   - **Type-to-confirm**: high-blast-radius destructives — user must type
 *     an exact value (typically the resource name) before the confirm
 *     button enables.
 *   - **Reason input**: replaces `window.prompt` — render a textarea and
 *     pass the value to `onConfirm`. Use for admin actions that record a
 *     note alongside the state change (lock reason, etc).
 *
 * Translation defaults come from the `ops` namespace because that's where
 * this lived originally; new callers from other surfaces should pass their
 * own labels via props rather than relying on the fallback.
 */
export function ConfirmModal({
  show,
  onHide,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  typeToConfirm,
  reasonInput,
  suppressDeleteWarning,
}: ConfirmModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [confirmInput, setConfirmInput] = useState('');
  const [reasonText, setReasonText] = useState('');

  // Reset both inputs whenever the modal closes — otherwise stale text
  // from a prior open carries over into the next confirm.
  useEffect(() => {
    if (!show) {
      setConfirmInput('');
      setReasonText('');
    }
  }, [show]);

  const typeToConfirmBlocks = typeToConfirm ? confirmInput !== typeToConfirm : false;
  const reasonRequiredBlocks = reasonInput?.required ? reasonText.trim().length === 0 : false;
  const isConfirmDisabled = typeToConfirmBlocks || reasonRequiredBlocks;

  const handleConfirm = () => {
    if (isConfirmDisabled) return;
    // Pass `undefined` when no reason input was configured so plain-confirm
    // call sites that read `arguments[0]` don't see an empty-string arg.
    onConfirm(reasonInput ? reasonText : undefined);
  };

  const reasonMaxLength = reasonInput?.maxLength ?? 500;
  const reasonAsTextarea = reasonInput?.multiline !== false;

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>{title ?? t('confirm.areYouSure')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {message && (typeof message === 'string' ? <p>{message}</p> : message)}

        {variant === 'danger' && !suppressDeleteWarning && (
          <p className="text-danger fw-semibold mb-3">{t('confirm.deleteWarning')}</p>
        )}

        {typeToConfirm && (
          <Form.Group className="mb-3">
            <Form.Label>{t('confirm.typeToConfirm', { value: typeToConfirm })}</Form.Label>
            <Form.Control
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              autoFocus
            />
          </Form.Group>
        )}

        {reasonInput && (
          <Form.Group>
            <Form.Label>{reasonInput.label ?? 'Reason (optional)'}</Form.Label>
            {reasonAsTextarea ? (
              <Form.Control
                as="textarea"
                rows={3}
                value={reasonText}
                maxLength={reasonMaxLength}
                placeholder={reasonInput.placeholder}
                onChange={(e) => setReasonText(e.target.value)}
                autoFocus={!typeToConfirm}
              />
            ) : (
              <Form.Control
                type="text"
                value={reasonText}
                maxLength={reasonMaxLength}
                placeholder={reasonInput.placeholder}
                onChange={(e) => setReasonText(e.target.value)}
                autoFocus={!typeToConfirm}
              />
            )}
            <Form.Text className="text-muted">
              {reasonText.length}/{reasonMaxLength}
              {reasonInput.required ? ' · required' : ''}
            </Form.Text>
          </Form.Group>
        )}
      </Modal.Body>

      <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
        <Button variant="secondary" onClick={onHide}>
          {cancelLabel ?? t('confirm.cancel')}
        </Button>
        <Button variant={variant} onClick={handleConfirm} disabled={isConfirmDisabled}>
          {confirmLabel ?? t('confirm.confirm')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
