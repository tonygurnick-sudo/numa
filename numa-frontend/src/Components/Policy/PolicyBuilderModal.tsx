import { Button, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

export const CreatePolicyModal = ({
  visible,
  onClose,
  selectedTemplate,
  policyInputs,
  setPolicyInputs,
  handleGeneratePolicy,
  isGenerating,
}) => {
  const { t } = useTranslation('apps');
  return (
    <Modal show={visible} onHide={onClose} size="xl">
      <Modal.Header closeButton>
        <Modal.Title>
          {t('policyBuilder.modal.title')}
          {selectedTemplate && (
            <div className="fs-6 fw-normal text-muted">
              {t('policyBuilder.modal.usingScenario', { name: selectedTemplate.name })}
            </div>
          )}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <form className="d-flex flex-column gap-3">
          <div>
            <label className="form-label">{t('policyBuilder.modal.schoolName.label')}</label>
            <input
              type="text"
              className="form-control"
              value={policyInputs.schoolName}
              onChange={(e) =>
                setPolicyInputs({
                  ...policyInputs,
                  schoolName: e.target.value,
                })
              }
              placeholder={t('policyBuilder.modal.schoolName.placeholder')}
            />
          </div>

          {/* <div>
            <label className="form-label">Special Character URLs</label>
            {policyInputs.characterUrls.map((urlObj, index) => (
              <div key={index} className="mb-2">
                <div className="input-group">
                  <input
                    type="url"
                    className="form-control"
                    value={urlObj.url}
                    onChange={(e) =>
                      handleUrlChange(index, 'url', e.target.value)
                    }
                    placeholder="https://school.edu/special-character"
                  />
                  <input
                    type="text"
                    className="form-control"
                    value={urlObj.description}
                    onChange={(e) =>
                      handleUrlChange(index, 'description', e.target.value)
                    }
                    placeholder="Description (e.g., Mission Statement)"
                  />
                  <Button
                    variant="outline-danger"
                    onClick={() => handleRemoveUrl(index)}
                    className="btn-numa-outline"
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </div>
            ))}
            <OverlayTrigger
              placement="top"
              overlay={<Tooltip>Coming Soon</Tooltip>}
            >
              <span>
                <Button
                  variant="secondary"
                  onClick={handleAddUrl}
                  className="btn-numa-outline d-flex align-items-center gap-2"
                  size="sm"
                  disabled
                >
                  <PlusIcon />
                  Add URL
                </Button>
              </span>
            </OverlayTrigger>
            <small className="text-muted">
              Add links to your school&apos;s special character, values, or
              other relevant pages
            </small>
          </div> */}

          <div className="flex-grow-1">
            <label className="form-label">{t('policyBuilder.modal.schoolContext.label')}</label>
            <textarea
              className="form-control h-100"
              rows={8}
              value={policyInputs.schoolContext || selectedTemplate?.defaultInstructions || ''}
              onChange={(e) =>
                setPolicyInputs({
                  ...policyInputs,
                  schoolContext: e.target.value,
                })
              }
              placeholder={t('policyBuilder.modal.schoolContext.placeholder')}
            />
          </div>

          {/* <div>
              <label className="form-label">
                Additional Instructions (Optional)
              </label>
              <textarea
                className="form-control"
                rows={3}
                value={policyInputs.customInstructions}
                onChange={(e) =>
                  setPolicyInputs({
                    ...policyInputs,
                    customInstructions: e.target.value,
                  })
                }
                placeholder="Any specific requirements or preferences for this policy..."
              />
            </div> */}
        </form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>
          {t('policyBuilder.modal.actions.cancel')}
        </Button>
        <Button variant="primary" onClick={handleGeneratePolicy} disabled={isGenerating}>
          {isGenerating ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              {t('policyBuilder.modal.actions.generating')}
            </>
          ) : (
            t('policyBuilder.modal.actions.generate')
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
