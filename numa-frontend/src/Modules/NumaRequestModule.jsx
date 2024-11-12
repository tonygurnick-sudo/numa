import { useState, useEffect } from 'react';

import { Row, Col } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';

function NumaRequestModule({ task }) {
  const { loading, numaTaskResponse, error, runActive, startApp, numaAppData } =
    useNumaApp();

  useEffect(() => {
    // Logic to initiate Step Function execution and track its status
    // ...
  }, []);

  if (!task) return;

  return null;
}

export { NumaRequestModule };
