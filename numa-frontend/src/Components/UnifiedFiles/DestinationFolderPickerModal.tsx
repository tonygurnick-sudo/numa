import React from 'react';
import { Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import DestinationFolderPicker, { type DestinationFolderPickerValue } from './DestinationFolderPicker';
import type { UserKB } from '../../Services/knowledgeBaseService';

interface KBOption {
  kb: UserKB;
  displayName: string;
}

interface DestinationFolderPickerModalProps {
  show: boolean;
  onHide: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  /** Disable confirm — eg destination is the same as source. */
  confirmDisabled?: boolean;
  /** Spinner inside confirm button. */
  inProgress?: boolean;
  onConfirm: (value: DestinationFolderPickerValue) => void;
  kbOptions: KBOption[];
  rootKBOption?: KBOption | null;
  loadFoldersForKB: (kbId: string) => Promise<string[]>;
  lockedKbId?: string;
  disabledKbIds?: Set<string>;
  disabledFolderPaths?: string[];
  initialValue?: DestinationFolderPickerValue | null;
}

export function DestinationFolderPickerModal({
  show,
  onHide,
  title,
  description,
  confirmLabel,
  confirmDisabled,
  inProgress,
  onConfirm,
  kbOptions,
  rootKBOption,
  loadFoldersForKB,
  lockedKbId,
  disabledKbIds,
  disabledFolderPaths,
  initialValue,
}: DestinationFolderPickerModalProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const [value, setValue] = React.useState<DestinationFolderPickerValue | null>(initialValue ?? null);

  React.useEffect(() => {
    if (show) {
      setValue(initialValue ?? null);
    }
  }, [show, initialValue]);

  const canConfirm = !!value && !!value.kbId && !confirmDisabled && !inProgress;

  return (
    <Modal show={show} onHide={onHide} centered size="lg" backdrop={inProgress ? 'static' : true}>
      <Modal.Header closeButton={!inProgress}>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {description && <p className="text-muted small mb-3">{description}</p>}
        <DestinationFolderPicker
          kbOptions={kbOptions}
          rootKBOption={rootKBOption}
          value={value}
          onChange={setValue}
          loadFoldersForKB={loadFoldersForKB}
          lockedKbId={lockedKbId}
          disabledKbIds={disabledKbIds}
          disabledFolderPaths={disabledFolderPaths}
          autoPickSingleKb
        />
      </Modal.Body>
      <Modal.Footer>
        <button className="btn btn-secondary btn-sm" type="button" onClick={onHide} disabled={inProgress}>
          {t('bulk.cancel', { defaultValue: 'Cancel' })}
        </button>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={() => value && onConfirm(value)}
          disabled={!canConfirm}
        >
          {inProgress ? (
            <>
              <Spinner animation="border" size="sm" className="me-1" />
              {t('bulk.working', { defaultValue: 'Working…' })}
            </>
          ) : (
            confirmLabel
          )}
        </button>
      </Modal.Footer>
    </Modal>
  );
}

export default DestinationFolderPickerModal;
