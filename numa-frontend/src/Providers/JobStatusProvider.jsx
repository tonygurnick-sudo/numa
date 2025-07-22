import { JobStatusContext } from './JobStatusContext';
import { useState, useEffect } from 'react';
import { useJobsApi } from '../Services/jobsApi';
import { manifestService } from '../Services/manifestService';

const REFRESH_INTERVAL = 5 * 1000;

export const JobStatusProvider = ({ children }) => {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const jobsApi = useJobsApi();

  const fetchStatus = async () => {
    setLoading(true);
    const appsData = await manifestService.fetchAppsFromManifest();
    const sortedJobs = (await Promise.all(appsData.map((app) => app.id).map((appId) => jobsApi.getJobsByAppId(appId))))
      .flatMap((appResult) => appResult.items.map((item) => ({ appId: appResult.appId, ...item })))
      .map((job) => ({
        id: job.jobId,
        started: job.startedAt ?? job.createdAt,
        app: job.appId,
        appName: job.appName,
        status: job.status,
      }))
      .sort((a, b) => (a.started < b.started ? 1 : -1));
    setJobs(sortedJobs);
    setLoading(false);
    setHasLoaded(true);
  };

  useEffect(() => {
    fetchStatus();

    const interval = setInterval(() => {
      fetchStatus();
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  const contextValue = {
    loading,
    hasLoaded,
    jobs,
  };

  return <JobStatusContext.Provider value={contextValue}>{children}</JobStatusContext.Provider>;
};
