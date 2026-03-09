import React, { useState } from 'react';
import { Button, Form, Modal, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { GlobalChatSettings } from '../../Services/AdminChatSettingsService';

interface NumaLibrariesPanelProps {
  globalChatSettings: GlobalChatSettings;
  setGlobalChatSettings: React.Dispatch<React.SetStateAction<GlobalChatSettings>>;
  setChatDefaultsDirty: React.Dispatch<React.SetStateAction<boolean>>;
  isAdmin: boolean;
}

export function NumaLibrariesPanel({
  globalChatSettings,
  setGlobalChatSettings,
  setChatDefaultsDirty,
  isAdmin,
}: NumaLibrariesPanelProps) {
  const { t } = useTranslation('settings');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLibName, setNewLibName] = useState('');
  const [newLibVersion, setNewLibVersion] = useState('');

  const libraries = globalChatSettings.allowedPythonLibraries || [];

  const handleAddLibrary = () => {
    if (!newLibName || !newLibVersion) return;
    const newLibs = [...libraries, { name: newLibName.trim(), version: newLibVersion.trim() }];
    const newSettings = { ...globalChatSettings, allowedPythonLibraries: newLibs };
    setGlobalChatSettings(newSettings);
    setChatDefaultsDirty(true);
    setShowAddModal(false);
    setNewLibName('');
    setNewLibVersion('');
  };

  const handleRemoveLibrary = (index: number) => {
    const newLibs = libraries.filter((_, i) => i !== index);
    const newSettings = { ...globalChatSettings, allowedPythonLibraries: newLibs };
    setGlobalChatSettings(newSettings);
    setChatDefaultsDirty(true);
  };

  if (!isAdmin) return null;

  return (
    <div className="card shadow-sm border-0 mb-4 h-100 p-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h4 className="fw-semibold mb-1">{t('numaPermittedLibrariesTitle', 'Numa Permitted Libraries')}</h4>
          <p className="text-muted small mb-0">
            {t(
              'numaPermittedLibrariesDesc',
              'Define explicit Python libraries and versions that Numa is allowed to use for code execution. Numa will be blocked from downloading any libraries not listed here. Format versions precisely (e.g. {{ example1 }} or {{ example2 }}).',
              { example1: '1.0.0', example2: '>=2.1.0' }
            )}
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
          <i className="bi bi-plus-lg me-2"></i>
          {t('addLibrary', 'Add Library')}
        </Button>
      </div>

      {libraries.length === 0 ? (
        <div className="text-center py-5 border rounded bg-light">
          <i className="bi bi-box-seam display-6 text-muted mb-3 d-block"></i>
          <p className="text-muted mb-0">{t('noApprovedLibraries', 'No approved libraries configured.')}</p>
          <small className="text-muted">
            {t('numaCannotDownload', 'Numa will not be able to download any external packages.')}
          </small>
        </div>
      ) : (
        <Table responsive hover className="align-middle border rounded">
          <thead className="table-light">
            <tr>
              <th>{t('libraryName', 'Library Name')}</th>
              <th>{t('versionRequirement', 'Version Requirement')}</th>
              <th className="text-end">{t('actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {libraries.map((lib, idx) => (
              <tr key={idx}>
                <td className="fw-medium font-monospace">{lib.name}</td>
                <td>
                  <span className="badge bg-secondary font-monospace">{lib.version}</span>
                </td>
                <td className="text-end">
                  <Button variant="outline-danger" size="sm" onClick={() => handleRemoveLibrary(idx)}>
                    <i className="bi bi-trash"></i>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal show={showAddModal} onHide={() => setShowAddModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title className="h5">{t('addPermittedLibrary', 'Add Permitted Library')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>{t('libraryName', 'Library Name')}</Form.Label>
            <Form.Control
              type="text"
              placeholder={t('egPandas', 'e.g. pandas')}
              value={newLibName}
              onChange={(e) => setNewLibName(e.target.value)}
              className="font-monospace"
            />
            <Form.Text className="text-muted">
              {t('exactPackageName', 'The exact package name as it would be pip installed.')}
            </Form.Text>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>{t('versionRequirement', 'Version Requirement')}</Form.Label>
            <Form.Control
              type="text"
              placeholder={t('egVersion', 'e.g. ==2.1.0 or >=1.0')}
              value={newLibVersion}
              onChange={(e) => setNewLibVersion(e.target.value)}
              className="font-monospace"
            />
            <Form.Text className="text-muted">
              {t(
                'standardPipVersion',
                'Standard pip version specifier. Use {{ latest }} if no version restriction is needed.',
                { latest: 'latest' }
              )}
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowAddModal(false)}>
            {t('cancel', 'Cancel')}
          </Button>
          <Button variant="primary" onClick={handleAddLibrary} disabled={!newLibName || !newLibVersion}>
            {t('saveLibrary', 'Save Library')}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
