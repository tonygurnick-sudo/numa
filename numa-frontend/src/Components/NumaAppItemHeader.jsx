import { useState } from 'react';
import { useNumaApp } from '../Providers/NumaAppProvider';

import { Button, ProgressBar } from 'react-bootstrap';

const NumaAppItemHeader = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const { error, progress, runActive, handleRunButtonClick, numaAppData } =
    useNumaApp();

  const handleRunApp = async () => {
    try {
      // Using context's startApp function
      await handleRunButtonClick(numaAppData);
    } catch (error) {
      // No need to set the error here as `startApp` in the context already handles it
      console.error('Error starting app session:', error);
    }
  };

  return (
    <>
      <div
        className="d-flex flex-row gap-2 align-items-center"
        style={{ width: '100%' }}
      >
        {!isMobile && (
          <div className="flex-grow-1 mb-3">
            <div className="d-flex align-items-center">
              <ProgressBar
                now={progress}
                label={`${Math.round(progress)}%`}
                animated
                variant="success"
                className="flex-grow-1 progress-bar"
              />
              <Button
                type="submit"
                id="submit"
                className="btn btn-primary run_btn w-auto d-inline-flex align-items-center"
                disabled={runActive}
                onClick={handleRunApp}
              >
                Run{' '}
                <i
                  style={{ lineHeight: '1px' }}
                  className={`bi bi-arrow-right ${!runActive ? 'bounce-icon' : ''}`}
                ></i>
              </Button>
            </div>
            Complete the required items to run
          </div>
        )}
      </div>
      {error && <p className="text-danger">Error: {error.message}</p>}
    </>
  );
};

export { NumaAppItemHeader };
