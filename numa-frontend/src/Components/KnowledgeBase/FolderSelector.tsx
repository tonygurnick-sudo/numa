import React from 'react';
import { Form } from 'react-bootstrap';

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
  label = 'Upload to folder',
}) => {
  return (
    <Form.Group className="mb-3">
      <Form.Label>{label}</Form.Label>
      <Form.Select value={selectedFolder} onChange={(e) => onFolderChange(e.target.value)} disabled={disabled}>
        <option value="">/ (Root)</option>
        {folderOptions.map((folder) => (
          <option key={folder} value={folder}>
            /{folder}
          </option>
        ))}
      </Form.Select>
      {selectedFolder && <Form.Text className="text-muted">Files will be uploaded to: /{selectedFolder}</Form.Text>}
    </Form.Group>
  );
};

export default FolderSelector;
