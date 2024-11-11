import { useNumaApp } from '../Providers/NumaAppProvider';

import { Button } from 'react-bootstrap';

const NumaAppItemHeader = () => {
  const {
    loading,
    numaTaskResponse,
    error,
    runActive,
    doNumaTaskReq,
    numaAppData,
  } = useNumaApp();

  const appId = numaAppData.id;
  console.log('debug - runActive:', runActive);

  const handleRunApp = async () => {
    console.log('debug - numaAppData.id:', appId);
    console.log('debug - numaAppData:', numaAppData);

    try {
      const payload = {
        // TODO: Add payload construction logic
      };

      // Using context's startApp function
      await doNumaTaskReq(appId, payload);
    } catch (error) {
      // No need to set the error here as `startApp` in the context already handles it
      console.error('Error starting app session:', error);
    }
  };

  return (
    <>
      <div className="d-flex gap-2"></div>

      {error && <p className="text-danger">Error: {error.message}</p>}
      {numaTaskResponse && (
        <p className="text-success">Response: {numaTaskResponse}</p>
      )}

      <Button
        type="submit"
        id="submit"
        className="btn btn-primary run_btn w-auto"
        disabled={runActive}
        onClick={handleRunApp}
      >
        <i className="bi bi-play-fill me-2"></i> Run
      </Button>
    </>
  );
};

export { NumaAppItemHeader };
