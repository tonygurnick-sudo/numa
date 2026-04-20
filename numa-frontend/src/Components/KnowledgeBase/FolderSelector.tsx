import React from 'react';
import { Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface FolderSelectorProps {
  selectedFolder: string;
  onFolderChange: (folder: string) => void;
  folderOptions: string[];
  disabled?: boolean;
  label?: string;
}

const FolderSelector: React.FC<FolderSelectorProps> = ({
  selectedFolder,
  onFolderChange,
  folderOptions,
  disabled = false,
  label,
}) => {
  const { t } = useTranslation('knowledgeBase');
  const resolvedLabel = label ?? t('folderSelector.label');

  return (
    <Form.Group className="mb-3">
      <Form.Label>{resolvedLabel}</Form.Label>
      <Form.Control
        type="text"
        list="folder-options"
        value={selectedFolder}
        onChange={(e) => onFolderChange(e.target.value)}
        disabled={disabled}
        placeholder={t('folderSelector.rootOption')}
      />
      <datalist id="folder-options">
        {folderOptions.map((folder) => (
          <option key={folder} value={folder}>
            /{folder}
          </option>
        ))}
      </datalist>
      {selectedFolder && (
        <Form.Text className="text-muted">{t('folderSelector.uploadHint', { folder: `/${selectedFolder}` })}</Form.Text>
      )}
    </Form.Group>
  );
};

export default FolderSelector;
