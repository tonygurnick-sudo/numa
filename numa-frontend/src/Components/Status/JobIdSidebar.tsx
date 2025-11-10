import { useState } from 'react';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { Button, Offcanvas } from 'react-bootstrap';

const JobIdSidebar = () => {
  const { currentJobId, numaAppData } = useNumaApp();
  const [jobIdSidebarOpen, setJobIdSidebarOpen] = useState(false);

  const handleClose = () => setJobIdSidebarOpen(false);
  const handleShow = () => setJobIdSidebarOpen(true);

  // Only render if there's a current job ID
  if (!currentJobId) return null;

  return (
    <>
      <Button
        onClick={handleShow}
        className="job-id-toggle"
        variant="primary"
        size="sm"
        aria-label="Show Job ID Information"
      >
        <i className="bi bi-info-circle me-1"></i>
        Job ID
      </Button>

      <Offcanvas
        show={jobIdSidebarOpen}
        onHide={handleClose}
        placement="end"
        style={{ width: '350px', boxShadow: '0 0 15px rgba(0,0,0,0.2)' }}
      >
        <Offcanvas.Header closeButton className="border-bottom bg-light py-3">
          <Offcanvas.Title className="d-flex align-items-center">
            <i className="bi bi-info-circle me-2"></i>
            Job Information
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body className="p-4">
          <div className="alert alert-info mb-4 p-3">
            <small>
              This information is useful for debugging and tracking your application&apos;s state.
              <br />
              <br />
              Please provide this when seeking support.
            </small>
          </div>

          <div className="mb-4">
            <h6 className="fw-bold mb-2">Current Job ID</h6>
            <div className="bg-light p-3 rounded border shadow-sm position-relative">
              <code className="d-block text-break">{currentJobId}</code>
              <button
                className="btn btn-sm btn-outline-secondary position-absolute top-0 end-0 m-2"
                onClick={() => {
                  navigator.clipboard.writeText(currentJobId);
                  // You could add a toast notification here if desired
                }}
                title="Copy to clipboard"
              >
                <i className="bi bi-clipboard"></i>
              </button>
            </div>
          </div>

          <div className="mb-3">
            <h6 className="fw-bold mb-2">App ID</h6>
            <div className="bg-light p-3 rounded border shadow-sm position-relative">
              <code className="d-block text-break">{numaAppData?.id}</code>
              <button
                className="btn btn-sm btn-outline-secondary position-absolute top-0 end-0 m-2"
                onClick={() => {
                  navigator.clipboard.writeText(numaAppData?.id);
                  // You could add a toast notification here if desired
                }}
                title="Copy to clipboard"
              >
                <i className="bi bi-clipboard"></i>
              </button>
            </div>
          </div>
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
};

export { JobIdSidebar };
