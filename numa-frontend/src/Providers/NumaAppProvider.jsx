import { createContext, useState, useContext, useEffect } from 'react';

// Create the context
const NumaAppContext = createContext();

// Custom hook for using context
export const useNumaApp = () => useContext(NumaAppContext);

// Provider component
export const NumaAppProvider = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [numaTaskResponse, setNumaTaskResponse] = useState(null);
  const [error, setError] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [runActive, setRunActive] = useState('disabled');

  // Numa related
  const [numaApps, setNumaApps] = useState([]);
  const [numaAppData, setNumaAppData] = useState(null);
  const [numaAppId, setNumaAppId] = useState(null);

  // Q native related
  const [qAppData, setqAppData] = useState([]);
  const [qSsessionId, setQSessionId] = useState(null);
  const [qCardInputValues, setQCardInputValues] = useState({});

  // Get an apps details from manifest via session
  useEffect(() => {
    if (!numaAppId) return;

    const fetchData = async () => {
      try {
        const appsData = JSON.parse(sessionStorage.getItem('appsData'));
        const app = appsData.apps.find((app) => app.id === numaAppId);
        setNumaAppData(app);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching app data:', error);
        setError(error);
        setLoading(false);
      }
    };

    fetchData();
  }, [numaAppId]);

  const doNumaTaskReq = async (appId, payload) => {
    try {
      setLoading(true);
      console.log('Starting app with ID:', appId);
      console.log('Payload:', payload);

      // Simulate starting the app or calling an API
      const startResponse = 'TODO'; // Replace this with actual logic
      if (startResponse) {
        setIsPolling(true);
        // Additional logic here
      }
      setNumaTaskResponse(startResponse);
    } catch (err) {
      console.error('Error starting app session:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <NumaAppContext.Provider
      value={{
        loading,
        setLoading,
        numaTaskResponse,
        error,
        setError,
        isPolling,
        setIsPolling,
        runActive,
        setRunActive,
        doNumaTaskReq,
        setNumaApps,
        numaApps,
        setNumaAppId,
        numaAppData,
        setqAppData,
        qAppData,
        setQCardInputValues,
        qCardInputValues,
        setQSessionId,
        qSsessionId,
      }}
    >
      {children}
    </NumaAppContext.Provider>
  );
};
