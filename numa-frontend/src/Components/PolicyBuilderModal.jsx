import { useState, useEffect, useRef } from 'react';
import { Container, Table, Badge, Button, Tabs, Tab, Dropdown, Modal, OverlayTrigger, Tooltip } from 'react-bootstrap';
import {
  Download as DownloadIcon,
  Share as ShareIcon,
  ThreeDotsVertical as ThreeDotsIcon,
  Clock as ClockIcon,
  Plus as PlusIcon,
  Trash as TrashIcon,
  PencilFill,
  PencilSquare,
} from 'react-bootstrap-icons';
import pdfPolicy from '../assets/policies.pdf';
import PolicyEditor from './PolicyEditor';

export const CreatePolicyModal = ({
  visible,
  onClose,
  selectedTemplate,
  policyInputs,
  setPolicyInputs,
  handleGeneratePolicy,
  isGenerating,
}) => {
  return (
    <Modal show={visible} onHide={onClose} size="xl">
      <Modal.Header closeButton>
        <Modal.Title>
          Create New Policy
          {selectedTemplate && <div className="fs-6 fw-normal text-muted">Using {selectedTemplate.name} Scenario</div>}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <form className="d-flex flex-column gap-3">
          <div>
            <label className="form-label">School Name</label>
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
              placeholder="e.g., St Theresa's School (Plimmerton)"
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
                  variant="outline-secondary"
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
            <label className="form-label">School Context</label>
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
              placeholder="Describe your school's characteristics, values, and community..."
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
          Cancel
        </Button>
        <Button variant="primary" onClick={handleGeneratePolicy} disabled={isGenerating}>
          {isGenerating ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Generating...
            </>
          ) : (
            'Generate Policy'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
