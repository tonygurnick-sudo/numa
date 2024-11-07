import { useState } from 'react';
import { Button } from 'react-bootstrap';

const NumaAppDetailHeader = ({ numaAppData, runActive, setIsPolling }) => {
  console.log('run is active: ', runActive);

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);
  const appId = numaAppData.id;

  const handleRunApp = async () => {
    console.log('debug - numaAppData.id', appId);
    console.log('debug - numaAppData', numaAppData);
    try {
      const payload = {
        // TODO
      };
      const start_response = 'TODO';
      if (start_response) {
        setIsPolling(true);
        // TODO
      }
    } catch (error) {
      console.error('Error starting app session:', error);
      setError(error); // Set error state
    }
  };

  return (
    <>
      <div className="d-flex gap-2"></div>

      <Button
        type="submit"
        id="submit"
        className="btn btn-primary run_btn w-auto"
        disabled={runActive || loading}
        onClick={handleRunApp}
      >
        <i className="bi bi-play-fill me-2"></i> Run
      </Button>
    </>
  );
};

export { NumaAppDetailHeader };
